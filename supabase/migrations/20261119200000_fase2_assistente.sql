-- =====================================================================
-- Fase 2: Assistente central — mensagens recebidas e rascunhos propostos.
-- Mensagens são gravadas apenas pelo servidor (Edge Function), que valida
-- o usuário e os limites do plano. O usuário lê, confirma ou descarta.
-- Administrador NÃO tem acesso ao conteúdo (pode conter dados sensíveis).
-- =====================================================================

create type public.message_channel as enum ('app', 'whatsapp');
create type public.message_status as enum ('received', 'processing', 'processed', 'failed', 'ignored');
create type public.draft_status as enum ('pending', 'confirmed', 'rejected');

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel public.message_channel not null default 'app',
  external_id text,
  content_type text not null default 'text' check (content_type in ('text', 'audio', 'image', 'document')),
  content_text text,
  attachment_path text,
  status public.message_status not null default 'received',
  intent text check (intent in ('registro', 'pergunta', 'comando', 'agendamento', 'indefinido')),
  reply_text text,
  error text,
  attempts int not null default 0,
  model text,
  tokens_in int,
  tokens_out int,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (channel, external_id)
);
comment on table public.assistant_messages is 'Mensagens recebidas pelo assistente (app/WhatsApp). external_id evita processamento duplicado.';
create index assistant_messages_owner_idx on public.assistant_messages(owner_id, created_at desc);
create index assistant_messages_status_idx on public.assistant_messages(status) where status in ('received', 'processing', 'failed');

create table public.assistant_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.assistant_messages(id) on delete cascade,
  module_key text references public.modules(key),
  kind text not null,
  title text not null,
  data jsonb not null default '{}'::jsonb,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  ambiguity text,
  status public.draft_status not null default 'pending',
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.assistant_drafts is 'Registros propostos pela IA. Só viram definitivos após confirmação do usuário.';
create index assistant_drafts_owner_idx on public.assistant_drafts(owner_id, status, created_at desc);
create index assistant_drafts_message_idx on public.assistant_drafts(message_id);
create index assistant_drafts_module_idx on public.assistant_drafts(module_key);
create trigger assistant_drafts_updated_at before update on public.assistant_drafts
  for each row execute function private.set_updated_at();

-- Usuário só pode decidir (confirmar/descartar) e corrigir rascunho pendente.
create or replace function private.guard_draft()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if; -- servidor
  if new.owner_id <> old.owner_id or new.message_id <> old.message_id
     or new.created_at <> old.created_at then
    raise exception 'Alteração não permitida';
  end if;
  if old.status <> 'pending' then
    raise exception 'Este registro já foi decidido';
  end if;
  if new.status = 'pending' then
    new.decided_at := null;
  else
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger guard_draft before update on public.assistant_drafts
  for each row execute function private.guard_draft();

-- Auditoria apenas da decisão (sem copiar conteúdo das mensagens).
create or replace function private.audit_draft_decision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, subject_id, action, table_name, record_id, changes)
    values ((select auth.uid()), new.owner_id, 'update', 'assistant_drafts', new.id::text,
            jsonb_build_object('status', jsonb_build_object('de', old.status, 'para', new.status), 'modulo', new.module_key));
  end if;
  return new;
end $$;
create trigger audit_draft_decision after update on public.assistant_drafts
  for each row execute function private.audit_draft_decision();

alter table public.assistant_messages enable row level security;
alter table public.assistant_drafts enable row level security;

create policy "mensagens: dono le" on public.assistant_messages for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "mensagens: dono apaga" on public.assistant_messages for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "rascunhos: dono le" on public.assistant_drafts for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "rascunhos: dono decide" on public.assistant_drafts for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

revoke insert, update on public.assistant_messages from anon, authenticated;
revoke insert, delete on public.assistant_drafts from anon, authenticated;
revoke all on public.assistant_messages, public.assistant_drafts from anon;

revoke execute on function private.guard_draft, private.audit_draft_decision from public, anon;

-- Indicadores do admin passam a incluir volume de mensagens (só contagem).
create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  return jsonb_build_object(
    'usuarios', (select count(*) from auth.users),
    'novos_7_dias', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'profissionais', (select count(*) from public.user_roles where role = 'professional'),
    'profissionais_pendentes', (select count(*) from public.professional_profiles where approved_at is null),
    'vinculos_ativos', (select count(*) from public.professional_client_links where status = 'active'),
    'consentimentos_ativos', (select count(*) from public.consent_grants where revoked_at is null),
    'mensagens_mes', (select count(*) from public.assistant_messages where created_at >= date_trunc('month', now())),
    'mensagens_falha_mes', (select count(*) from public.assistant_messages where status = 'failed' and created_at >= date_trunc('month', now()))
  );
end $$;
