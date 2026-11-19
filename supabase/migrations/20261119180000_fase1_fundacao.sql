-- =====================================================================
-- Assistente Pessoal — Fase 1: Fundação
-- Perfis, papéis, organizações, módulos, planos, especialidades,
-- vínculos profissional-cliente, consentimentos, identidades WhatsApp
-- e auditoria. Todo acesso é controlado por RLS.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type public.app_role as enum ('user', 'professional', 'admin');
create type public.org_kind as enum ('personal', 'clinic', 'company');
create type public.org_member_role as enum ('owner', 'admin', 'member');
create type public.link_status as enum ('invited', 'active', 'ended');
create type public.plan_audience as enum ('individual', 'professional');

-- ---------------------------------------------------------------------
-- Função utilitária de updated_at
-- ---------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Catálogos (leitura pública, escrita só admin)
-- ---------------------------------------------------------------------
create table public.modules (
  key text primary key check (key ~ '^[a-z_]+$'),
  name text not null,
  description text,
  is_sensitive boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on table public.modules is 'Módulos da plataforma (finanças, saúde, etc.). is_sensitive marca dados de saúde/vida íntima (LGPD art. 11).';

create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z_]+$'),
  name text not null,
  council text,
  module_keys text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
comment on column public.specialties.module_keys is 'Módulos que um profissional desta especialidade pode acessar (com consentimento do cliente).';

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  audience public.plan_audience not null,
  price_monthly_cents bigint check (price_monthly_cents >= 0),
  price_yearly_cents bigint check (price_yearly_cents >= 0),
  limits jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

create table public.plan_modules (
  plan_id uuid not null references public.plans(id) on delete cascade,
  module_key text not null references public.modules(key),
  primary key (plan_id, module_key)
);
create index plan_modules_module_idx on public.plan_modules(module_key);

-- ---------------------------------------------------------------------
-- Perfis e papéis
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  display_name text,
  avatar_url text,
  timezone text not null default 'America/Sao_Paulo',
  locale text not null default 'pt-BR',
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

-- Funções de verificação usadas pelas políticas (security definer para
-- evitar recursão de RLS; search_path vazio por segurança).
create or replace function private.has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = _role
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role('admin'::public.app_role);
$$;

-- ---------------------------------------------------------------------
-- Organizações
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind public.org_kind not null default 'personal',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create index organizations_created_by_idx on public.organizations(created_by);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);

create or replace function private.org_role(_org uuid)
returns public.org_member_role language sql stable security definer set search_path = '' as $$
  select role from public.organization_members
  where organization_id = _org and user_id = (select auth.uid());
$$;

create or replace function private.org_creator(_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select created_by from public.organizations where id = _org;
$$;

-- ---------------------------------------------------------------------
-- Profissionais
-- ---------------------------------------------------------------------
create table public.professional_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_name text not null,
  bio text,
  council text,
  registration_number text,
  slug text unique check (slug ~ '^[a-z0-9-]+$'),
  is_public boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.professional_profiles.approved_at is 'Só administradores aprovam. Sem aprovação o profissional não aparece no catálogo público nem pode convidar clientes.';
create trigger professional_profiles_updated_at before update on public.professional_profiles
  for each row execute function private.set_updated_at();

create table public.professional_specialties (
  professional_id uuid not null references public.professional_profiles(user_id) on delete cascade,
  specialty_id uuid not null references public.specialties(id),
  primary key (professional_id, specialty_id)
);
create index professional_specialties_specialty_idx on public.professional_specialties(specialty_id);

create or replace function private.is_approved_professional(_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.professional_profiles pp
    join public.user_roles ur on ur.user_id = pp.user_id and ur.role = 'professional'
    where pp.user_id = _user and pp.approved_at is not null
  );
$$;

-- ---------------------------------------------------------------------
-- Vínculo profissional ↔ cliente e consentimentos
-- ---------------------------------------------------------------------
create table public.professional_client_links (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references auth.users(id) on delete cascade,
  status public.link_status not null default 'invited',
  invited_by uuid not null references auth.users(id),
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, client_id),
  check (professional_id <> client_id)
);
create index pcl_client_idx on public.professional_client_links(client_id);
create trigger pcl_updated_at before update on public.professional_client_links
  for each row execute function private.set_updated_at();

create table public.consent_grants (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references auth.users(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null references public.modules(key),
  purpose text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  check (expires_at is null or expires_at > granted_at)
);
comment on table public.consent_grants is 'Consentimento específico e revogável (LGPD): cliente autoriza um profissional a ver um módulo, para uma finalidade.';
create index consent_grants_prof_idx on public.consent_grants(professional_id, client_id, module_key);
create index consent_grants_client_idx on public.consent_grants(client_id);
create unique index consent_grants_one_active
  on public.consent_grants(client_id, professional_id, module_key)
  where revoked_at is null;

-- Verdadeiro se o usuário atual é profissional com vínculo ativo e
-- consentimento vigente para o módulo do cliente. Será usado pelas
-- políticas dos módulos nas próximas fases.
create or replace function private.has_consent(_client uuid, _module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.consent_grants cg
    join public.professional_client_links l
      on l.professional_id = cg.professional_id
     and l.client_id = cg.client_id
     and l.status = 'active'
    where cg.client_id = _client
      and cg.professional_id = (select auth.uid())
      and cg.module_key = _module
      and cg.revoked_at is null
      and (cg.expires_at is null or cg.expires_at > now())
  );
$$;

create or replace function private.is_linked(_other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.professional_client_links
    where status in ('invited', 'active')
      and ((professional_id = (select auth.uid()) and client_id = _other)
        or (client_id = (select auth.uid()) and professional_id = _other))
  );
$$;

-- ---------------------------------------------------------------------
-- Módulos habilitados por usuário
-- ---------------------------------------------------------------------
create table public.user_modules (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null references public.modules(key),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key)
);
create index user_modules_module_idx on public.user_modules(module_key);
create trigger user_modules_updated_at before update on public.user_modules
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------
-- Identidades de WhatsApp (número vinculado ao usuário)
-- ---------------------------------------------------------------------
create table public.whatsapp_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index whatsapp_identities_user_idx on public.whatsapp_identities(user_id);
comment on column public.whatsapp_identities.verified_at is 'Preenchido apenas pelo servidor após verificação por código.';

-- ---------------------------------------------------------------------
-- Auditoria (somente inserção via gatilhos; ninguém edita ou apaga)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  subject_id uuid,
  action text not null,
  table_name text not null,
  record_id text,
  changes jsonb
);
create index audit_logs_subject_idx on public.audit_logs(subject_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, occurred_at desc);
create index audit_logs_occurred_idx on public.audit_logs(occurred_at desc);

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _subject_col text := tg_argv[0];
  _row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  _changes jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('de', o.value, 'para', n.value))
      into _changes
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if _changes is null then return new; end if;
  elsif tg_op = 'INSERT' then
    _changes := _row;
  else
    _changes := to_jsonb(old);
  end if;

  insert into public.audit_logs (actor_id, subject_id, action, table_name, record_id, changes)
  values (
    (select auth.uid()),
    nullif(_row ->> _subject_col, '')::uuid,
    lower(tg_op),
    tg_table_name,
    coalesce(_row ->> 'id', _row ->> 'user_id'),
    _changes
  );
  return coalesce(new, old);
end $$;

create trigger audit_user_roles after insert or update or delete on public.user_roles
  for each row execute function private.audit_row('user_id');
create trigger audit_consent_grants after insert or update or delete on public.consent_grants
  for each row execute function private.audit_row('client_id');
create trigger audit_links after insert or update or delete on public.professional_client_links
  for each row execute function private.audit_row('client_id');
create trigger audit_professional_profiles after insert or update or delete on public.professional_profiles
  for each row execute function private.audit_row('user_id');
create trigger audit_whatsapp after insert or update or delete on public.whatsapp_identities
  for each row execute function private.audit_row('user_id');
create trigger audit_user_modules after insert or update or delete on public.user_modules
  for each row execute function private.audit_row('user_id');

-- ---------------------------------------------------------------------
-- Gatilhos de integridade (o que RLS sozinha não impede)
-- ---------------------------------------------------------------------

-- Profissional não pode se auto-aprovar.
create or replace function private.guard_professional_profile()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    if tg_op = 'INSERT' then
      new.approved_at := null;
      new.approved_by := null;
    elsif new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by then
      raise exception 'Somente administradores aprovam profissionais';
    end if;
  end if;
  return new;
end $$;
create trigger guard_professional_profile before insert or update on public.professional_profiles
  for each row execute function private.guard_professional_profile();

-- Transições de vínculo: cliente aceita/encerra, profissional só encerra.
create or replace function private.guard_link()
returns trigger language plpgsql set search_path = '' as $$
declare _uid uuid := (select auth.uid());
begin
  if _uid is null then return new; end if; -- serviço
  if new.professional_id <> old.professional_id or new.client_id <> old.client_id
     or new.invited_by <> old.invited_by then
    raise exception 'Não é permitido alterar as partes do vínculo';
  end if;
  if new.status = old.status then return new; end if;
  if old.status = 'ended' then
    raise exception 'Vínculo encerrado não pode ser reaberto; crie um novo convite';
  end if;
  if new.status = 'active' then
    if _uid <> old.client_id then
      raise exception 'Somente o cliente pode aceitar o convite';
    end if;
    new.accepted_at := now();
  elsif new.status = 'ended' then
    new.ended_at := now();
  else
    raise exception 'Transição de vínculo inválida';
  end if;
  return new;
end $$;
create trigger guard_link before update on public.professional_client_links
  for each row execute function private.guard_link();

-- Encerrar vínculo revoga todos os consentimentos daquele par.
create or replace function private.revoke_consents_on_link_end()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status <> 'ended' then
    update public.consent_grants
       set revoked_at = now()
     where client_id = new.client_id
       and professional_id = new.professional_id
       and revoked_at is null;
  end if;
  return new;
end $$;
create trigger revoke_consents_on_link_end after update on public.professional_client_links
  for each row execute function private.revoke_consents_on_link_end();

-- Consentimento: só o campo revoked_at pode mudar, e só uma vez.
create or replace function private.guard_consent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null then return new; end if;
  if new.client_id <> old.client_id or new.professional_id <> old.professional_id
     or new.module_key <> old.module_key or new.purpose <> old.purpose
     or new.granted_at <> old.granted_at
     or new.expires_at is distinct from old.expires_at then
    raise exception 'Consentimento não pode ser alterado; revogue e conceda outro';
  end if;
  if old.revoked_at is not null then
    raise exception 'Consentimento já revogado';
  end if;
  if new.revoked_at is null then
    raise exception 'Use revoked_at para revogar';
  end if;
  new.revoked_at := now();
  return new;
end $$;
create trigger guard_consent before update on public.consent_grants
  for each row execute function private.guard_consent();

-- Número de WhatsApp: usuário não marca verificação sozinho.
create or replace function private.guard_whatsapp()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    if tg_op = 'INSERT' then
      new.verified_at := null;
    elsif new.verified_at is distinct from old.verified_at
       or new.phone_e164 <> old.phone_e164
       or new.user_id <> old.user_id then
      raise exception 'Alteração não permitida; remova e cadastre o número novamente';
    end if;
  end if;
  return new;
end $$;
create trigger guard_whatsapp before insert or update on public.whatsapp_identities
  for each row execute function private.guard_whatsapp();

-- ---------------------------------------------------------------------
-- Novo usuário: perfil, papel 'user', organização pessoal e módulos
-- padrão do plano gratuito.
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _org uuid;
  _name text := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, full_name, display_name)
  values (new.id, _name, split_part(_name, ' ', 1));

  insert into public.user_roles (user_id, role) values (new.id, 'user');

  insert into public.organizations (name, kind, created_by)
  values (coalesce(_name, 'Pessoal'), 'personal', new.id)
  returning id into _org;
  insert into public.organization_members (organization_id, user_id, role)
  values (_org, new.id, 'owner');

  insert into public.user_modules (user_id, module_key)
  select new.id, pm.module_key
    from public.plan_modules pm
    join public.plans p on p.id = pm.plan_id
   where p.key = 'gratuito';

  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- Funções chamáveis pelo app (RPC)
-- ---------------------------------------------------------------------

-- Usuário se cadastra como profissional (fica pendente de aprovação).
create or replace function public.become_professional(
  _public_name text, _council text default null, _registration text default null,
  _specialty_ids uuid[] default '{}'
) returns void language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid());
begin
  if _uid is null then raise exception 'Não autenticado'; end if;
  insert into public.user_roles (user_id, role) values (_uid, 'professional')
    on conflict do nothing;
  insert into public.professional_profiles (user_id, public_name, council, registration_number)
  values (_uid, _public_name, _council, _registration)
  on conflict (user_id) do update
    set public_name = excluded.public_name,
        council = excluded.council,
        registration_number = excluded.registration_number;
  delete from public.professional_specialties where professional_id = _uid;
  insert into public.professional_specialties (professional_id, specialty_id)
  select _uid, s from unnest(_specialty_ids) s;
end $$;

-- Admin concede/retira papéis (inclusive admin). Nunca o próprio admin.
create or replace function public.admin_set_role(_user uuid, _role public.app_role, _grant boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  if _user = (select auth.uid()) and _role = 'admin' and not _grant then
    raise exception 'Um administrador não pode remover o próprio acesso';
  end if;
  if _grant then
    insert into public.user_roles (user_id, role, granted_by)
    values (_user, _role, (select auth.uid())) on conflict do nothing;
  else
    delete from public.user_roles where user_id = _user and role = _role;
  end if;
end $$;

-- Admin aprova ou suspende profissional.
create or replace function public.admin_approve_professional(_user uuid, _approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  update public.professional_profiles
     set approved_at = case when _approve then now() end,
         approved_by = case when _approve then (select auth.uid()) end,
         is_public = case when _approve then is_public else false end
   where user_id = _user;
end $$;

-- Lista para o painel admin: dados cadastrais apenas, nunca conteúdo.
create or replace function public.admin_list_users()
returns table (
  id uuid, email text, full_name text, roles public.app_role[],
  created_at timestamptz, last_sign_in_at timestamptz,
  professional_approved boolean
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
    select u.id, u.email::text, p.full_name,
           coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}'),
           u.created_at, u.last_sign_in_at,
           (pp.approved_at is not null)
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.user_roles r on r.user_id = u.id
      left join public.professional_profiles pp on pp.user_id = u.id
     group by u.id, u.email, p.full_name, u.created_at, u.last_sign_in_at, pp.approved_at
     order by u.created_at desc;
end $$;

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
    'consentimentos_ativos', (select count(*) from public.consent_grants where revoked_at is null)
  );
end $$;

-- Profissional convida cliente existente pelo e-mail.
create or replace function public.invite_client(_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid()); _client uuid; _link uuid;
begin
  if not private.is_approved_professional(_uid) then
    raise exception 'Somente profissionais aprovados podem convidar clientes';
  end if;
  select id into _client from auth.users where lower(email) = lower(trim(_email));
  if _client is null then
    raise exception 'Nenhuma conta encontrada com este e-mail';
  end if;
  insert into public.professional_client_links (professional_id, client_id, invited_by)
  values (_uid, _client, _uid)
  on conflict (professional_id, client_id) do nothing
  returning id into _link;
  if _link is null then
    raise exception 'Já existe um vínculo com este cliente';
  end if;
  return _link;
end $$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function public.become_professional, public.admin_set_role,
  public.admin_approve_professional, public.admin_list_users, public.admin_stats,
  public.invite_client from public, anon;
grant execute on function public.become_professional, public.admin_set_role,
  public.admin_approve_professional, public.admin_list_users, public.admin_stats,
  public.invite_client to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.modules enable row level security;
alter table public.specialties enable row level security;
alter table public.plans enable row level security;
alter table public.plan_modules enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.professional_profiles enable row level security;
alter table public.professional_specialties enable row level security;
alter table public.professional_client_links enable row level security;
alter table public.consent_grants enable row level security;
alter table public.user_modules enable row level security;
alter table public.whatsapp_identities enable row level security;
alter table public.audit_logs enable row level security;

-- Catálogos
create policy "catalogo: leitura publica" on public.modules for select to anon, authenticated using (true);
create policy "catalogo: admin escreve" on public.modules for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "catalogo: leitura publica" on public.specialties for select to anon, authenticated using (true);
create policy "catalogo: admin escreve" on public.specialties for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "catalogo: leitura publica" on public.plans for select to anon, authenticated using (true);
create policy "catalogo: admin escreve" on public.plans for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "catalogo: leitura publica" on public.plan_modules for select to anon, authenticated using (true);
create policy "catalogo: admin escreve" on public.plan_modules for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- Perfis
create policy "perfil: dono, vinculados e admin leem" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_admin()) or private.is_linked(id));
create policy "perfil: dono edita" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Papéis: leitura própria ou admin; escrita só por funções.
create policy "papeis: dono e admin leem" on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- Organizações
create policy "org: membros e admin leem" on public.organizations for select to authenticated
  using (private.org_role(id) is not null or (select private.is_admin()));
create policy "org: usuario cria" on public.organizations for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "org: dono/admin da org edita" on public.organizations for update to authenticated
  using (private.org_role(id) in ('owner', 'admin'))
  with check (private.org_role(id) in ('owner', 'admin'));

create policy "membros: membros da org leem" on public.organization_members for select to authenticated
  using (private.org_role(organization_id) is not null or (select private.is_admin()));
create policy "membros: dono/admin da org gerencia" on public.organization_members for insert to authenticated
  with check (
    private.org_role(organization_id) in ('owner', 'admin')
    or (private.org_creator(organization_id) = (select auth.uid())
        and user_id = (select auth.uid()))
  );
create policy "membros: dono/admin da org altera" on public.organization_members for update to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin'))
  with check (private.org_role(organization_id) in ('owner', 'admin'));
create policy "membros: dono/admin da org remove" on public.organization_members for delete to authenticated
  using (private.org_role(organization_id) in ('owner', 'admin') or user_id = (select auth.uid()));

-- Profissionais
create policy "prof: catalogo publico" on public.professional_profiles for select to anon, authenticated
  using (is_public and approved_at is not null);
create policy "prof: dono, vinculados e admin leem" on public.professional_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()) or private.is_linked(user_id));
create policy "prof: dono edita" on public.professional_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "prof: admin edita" on public.professional_profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "prof_esp: leitura de aprovados e propria" on public.professional_specialties for select to anon, authenticated
  using (
    professional_id = (select auth.uid())
    or exists (select 1 from public.professional_profiles pp
               where pp.user_id = professional_id and pp.is_public and pp.approved_at is not null)
    or (select private.is_admin())
  );
create policy "prof_esp: dono gerencia" on public.professional_specialties for insert to authenticated
  with check (professional_id = (select auth.uid()));
create policy "prof_esp: dono remove" on public.professional_specialties for delete to authenticated
  using (professional_id = (select auth.uid()));

-- Vínculos (criação via invite_client; atualização pelas partes)
create policy "vinculo: partes leem" on public.professional_client_links for select to authenticated
  using (professional_id = (select auth.uid()) or client_id = (select auth.uid()));
create policy "vinculo: partes atualizam" on public.professional_client_links for update to authenticated
  using (professional_id = (select auth.uid()) or client_id = (select auth.uid()))
  with check (professional_id = (select auth.uid()) or client_id = (select auth.uid()));

-- Consentimentos: só o cliente concede/revoga; profissional apenas lê.
create policy "consent: partes leem" on public.consent_grants for select to authenticated
  using (client_id = (select auth.uid()) or professional_id = (select auth.uid()));
create policy "consent: cliente concede" on public.consent_grants for insert to authenticated
  with check (
    client_id = (select auth.uid())
    and exists (select 1 from public.professional_client_links l
                where l.client_id = (select auth.uid())
                  and l.professional_id = consent_grants.professional_id
                  and l.status = 'active')
  );
create policy "consent: cliente revoga" on public.consent_grants for update to authenticated
  using (client_id = (select auth.uid())) with check (client_id = (select auth.uid()));

-- Módulos do usuário
create policy "user_modules: dono e admin leem" on public.user_modules for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "user_modules: admin gerencia" on public.user_modules for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- WhatsApp
create policy "whatsapp: dono le" on public.whatsapp_identities for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "whatsapp: dono cadastra" on public.whatsapp_identities for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "whatsapp: dono remove" on public.whatsapp_identities for delete to authenticated
  using (user_id = (select auth.uid()));

-- Auditoria: titular vê o que aconteceu com seus dados; admin vê tudo.
create policy "auditoria: titular e admin leem" on public.audit_logs for select to authenticated
  using (subject_id = (select auth.uid()) or (select private.is_admin()));

revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;
revoke insert, delete on public.professional_client_links from anon, authenticated;
revoke delete on public.consent_grants from anon, authenticated;
