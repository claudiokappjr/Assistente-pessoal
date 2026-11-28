-- Pedido de acesso: o profissional pede para ver módulos de um cliente vinculado;
-- o cliente aprova (vira consentimento) ou recusa. Nada é liberado sem o cliente.
create table public.consent_requests (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null references public.modules(key),
  note text check (length(note) <= 500),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index consent_requests_one_pending on public.consent_requests(professional_id, client_id, module_key) where status = 'pendente';
create index consent_requests_client_idx on public.consent_requests(client_id, status);

-- Só o cliente decide (aprovar/recusar); o profissional só cancela o próprio pedido.
create or replace function private.consent_request_decide()
returns trigger language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid());
begin
  if new.professional_id <> old.professional_id or new.client_id <> old.client_id or new.module_key <> old.module_key
     or new.created_at <> old.created_at then
    raise exception 'Alteração não permitida';
  end if;
  if new.status = old.status then return new; end if;
  if old.status <> 'pendente' then raise exception 'Este pedido já foi respondido'; end if;
  if new.status in ('aprovado', 'recusado') and _uid is not null and _uid <> old.client_id then
    raise exception 'Somente o cliente responde ao pedido';
  end if;
  if new.status = 'cancelado' and _uid is not null and _uid <> old.professional_id then
    raise exception 'Somente o profissional cancela o pedido';
  end if;
  new.decided_at := now();
  if new.status = 'aprovado' then
    insert into public.consent_grants (client_id, professional_id, module_key, purpose)
    select new.client_id, new.professional_id, new.module_key,
           'Acompanhamento profissional — ' || (select name from public.modules where key = new.module_key)
     where not exists (select 1 from public.consent_grants c where c.client_id = new.client_id and c.professional_id = new.professional_id
                         and c.module_key = new.module_key and c.revoked_at is null);
  end if;
  return new;
end $$;
create trigger consent_request_decide before update on public.consent_requests
  for each row execute function private.consent_request_decide();
revoke execute on function private.consent_request_decide from public, anon;

alter table public.consent_requests enable row level security;
revoke all on public.consent_requests from anon;
revoke delete on public.consent_requests from authenticated;

create policy "pedidos de acesso: partes leem" on public.consent_requests for select to authenticated
  using (professional_id = (select auth.uid()) or client_id = (select auth.uid()));
-- Profissional pede só a cliente com vínculo ativo e só módulo que está no plano dele.
create policy "pedidos de acesso: profissional pede" on public.consent_requests for insert to authenticated
  with check (
    professional_id = (select auth.uid()) and status = 'pendente'
    and exists (select 1 from public.professional_client_links l where l.professional_id = (select auth.uid())
                  and l.client_id = consent_requests.client_id and l.status = 'active')
    and exists (select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
                 where s.user_id = (select auth.uid()) and s.status = 'active' and p.audience = 'professional'
                   and consent_requests.module_key = any (s.pro_modules)));
create policy "pedidos de acesso: partes respondem" on public.consent_requests for update to authenticated
  using (professional_id = (select auth.uid()) or client_id = (select auth.uid()))
  with check (professional_id = (select auth.uid()) or client_id = (select auth.uid()));

create trigger audit_consent_requests after insert or update on public.consent_requests
  for each row execute function private.audit_row('client_id');
