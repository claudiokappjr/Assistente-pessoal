-- =====================================================================
-- Modelo comercial: sem plano gratuito.
--   * Individual: usuário final, 8 módulos.
--   * Profissional: faixas por número de clientes (10/30/100) + módulos
--     de gestão escolhidos (cada módulo encarece o plano).
--   * Cliente cadastrado pelo profissional: acesso patrocinado (8 módulos).
--   * Admin: cria contas ativas sem cobrança (cortesia).
-- O acesso aos módulos pessoais vem de uma assinatura ativa.
-- =====================================================================

create type public.subscription_status as enum ('pending_payment', 'active', 'past_due', 'canceled');
create type public.subscription_source as enum ('payment', 'admin', 'professional');

alter table public.modules add column pro_addon_price_cents bigint check (pro_addon_price_cents >= 0);
comment on column public.modules.pro_addon_price_cents is 'Preço mensal adicional para o profissional gerenciar este módulo nos clientes.';

-- Planos novos; os antigos ficam inativos (histórico).
update public.plans set is_active = false where key in ('gratuito', 'completo', 'profissional');
insert into public.plans (key, name, audience, sort_order, limits) values
  ('individual', 'Individual', 'individual', 10, '{"mensagens_ia_mes": 1000}'),
  ('pro_10', 'Essencial', 'professional', 20, '{"clientes": 10, "mensagens_ia_mes": 1000}'),
  ('pro_30', 'Profissional', 'professional', 30, '{"clientes": 30, "mensagens_ia_mes": 1000}'),
  ('pro_100', 'Clínica', 'professional', 40, '{"clientes": 100, "mensagens_ia_mes": 2000}');
insert into public.plan_modules (plan_id, module_key)
select p.id, m.key from public.plans p cross join public.modules m where p.key in ('individual', 'pro_10', 'pro_30', 'pro_100');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status public.subscription_status not null default 'pending_payment',
  source public.subscription_source not null default 'payment',
  sponsor_id uuid references auth.users(id) on delete set null,
  pro_modules text[] not null default '{}',
  seats int check (seats > 0),
  started_at timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'professional' or sponsor_id is not null)
);
comment on column public.subscriptions.pro_modules is 'Módulos que o profissional contratou para gerenciar clientes.';
comment on column public.subscriptions.seats is 'Vagas de clientes; se nulo, vale limits.clientes do plano.';
create index subscriptions_user_idx on public.subscriptions(user_id, status);
create index subscriptions_sponsor_idx on public.subscriptions(sponsor_id) where sponsor_id is not null;
create index subscriptions_plan_idx on public.subscriptions(plan_id);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger audit_subscriptions after insert or update or delete on public.subscriptions
  for each row execute function private.audit_row('user_id');

alter table public.subscriptions enable row level security;
create policy "assinatura: titular, patrocinador e admin leem" on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or sponsor_id = (select auth.uid()) or (select private.is_admin()));
revoke insert, update, delete on public.subscriptions from anon, authenticated;
revoke all on public.subscriptions from anon;

-- ---------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------
create or replace function private.has_active_subscription(_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subscriptions where user_id = _user and status = 'active');
$$;

-- Assinatura profissional ativa (a mais recente).
create or replace function private.pro_subscription(_user uuid)
returns table (subscription_id uuid, plan_key text, seats int, pro_modules text[])
language sql stable security definer set search_path = '' as $$
  select s.id, p.key, coalesce(s.seats, (p.limits ->> 'clientes')::int), s.pro_modules
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = _user and s.status = 'active' and p.audience = 'professional'
   order by s.created_at desc limit 1;
$$;

create or replace function private.pro_seats_used(_user uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.professional_client_links
   where professional_id = _user and status in ('invited', 'active');
$$;

-- Mantém user_modules coerente com a assinatura: ativa = 8 módulos.
create or replace function private.sync_user_modules(_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.has_active_subscription(_user) then
    insert into public.user_modules (user_id, module_key, enabled)
    select _user, m.key, true from public.modules m where m.is_active
    on conflict (user_id, module_key) do update set enabled = true where public.user_modules.enabled is distinct from true;
  else
    update public.user_modules set enabled = false where user_id = _user and enabled;
  end if;
end $$;

create or replace function private.on_subscription_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sync_user_modules(coalesce(new.user_id, old.user_id));
  return coalesce(new, old);
end $$;
create trigger sync_modules_on_subscription after insert or update or delete on public.subscriptions
  for each row execute function private.on_subscription_change();

-- Consentimento agora exige também que o profissional tenha o módulo no plano.
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
  )
  and exists (
    select 1 from private.pro_subscription((select auth.uid())) ps where _module = any(ps.pro_modules)
  );
$$;

-- ---------------------------------------------------------------------
-- Novo usuário: perfil, papel, organização pessoal e assinatura pendente
-- conforme o plano escolhido no cadastro. Nunca ativa por conta própria:
-- ativação vem do pagamento, do admin ou do profissional (servidor).
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _org uuid;
  _meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  _name text := coalesce(nullif(_meta ->> 'full_name', ''), split_part(new.email, '@', 1));
  _plan public.plans;
  _mods text[];
begin
  insert into public.profiles (id, full_name, display_name)
  values (new.id, _name, split_part(_name, ' ', 1));

  insert into public.user_roles (user_id, role) values (new.id, 'user');

  insert into public.organizations (name, kind, created_by)
  values (coalesce(_name, 'Pessoal'), 'personal', new.id)
  returning id into _org;
  insert into public.organization_members (organization_id, user_id, role)
  values (_org, new.id, 'owner');

  if _meta ? 'plan_key' then
    select * into _plan from public.plans where key = _meta ->> 'plan_key' and is_active;
    if found then
      if _plan.audience = 'professional' then
        select coalesce(array_agg(m.key), '{}') into _mods
          from public.modules m
         where m.is_active and m.key in (select jsonb_array_elements_text(coalesce(_meta -> 'pro_modules', '[]'::jsonb)));
        insert into public.user_roles (user_id, role) values (new.id, 'professional') on conflict do nothing;
        insert into public.professional_profiles (user_id, public_name, council, registration_number)
        values (new.id, coalesce(nullif(_meta ->> 'public_name', ''), _name), nullif(_meta ->> 'council', ''), nullif(_meta ->> 'registration', ''))
        on conflict (user_id) do nothing;
        insert into public.professional_specialties (professional_id, specialty_id)
        select new.id, s.id from public.specialties s
         where s.key in (select jsonb_array_elements_text(coalesce(_meta -> 'specialties', '[]'::jsonb)))
        on conflict do nothing;
      end if;
      insert into public.subscriptions (user_id, plan_id, status, source, pro_modules)
      values (new.id, _plan.id, 'pending_payment', 'payment', coalesce(_mods, '{}'));
    end if;
  end if;
  return new;
end $$;

-- Encerrar vínculo: cancela o acesso patrocinado por aquele profissional.
create or replace function private.end_sponsorship_on_link_end()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ended' and old.status <> 'ended' then
    update public.subscriptions set status = 'canceled', canceled_at = now()
     where user_id = new.client_id and sponsor_id = new.professional_id and status <> 'canceled';
  end if;
  return new;
end $$;
create trigger end_sponsorship_on_link_end after update on public.professional_client_links
  for each row execute function private.end_sponsorship_on_link_end();

-- ---------------------------------------------------------------------
-- Convite de cliente que já tem conta: exige plano profissional ativo e vaga.
-- ---------------------------------------------------------------------
create or replace function public.invite_client(_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid()); _client uuid; _link uuid; _seats int;
begin
  if not private.is_approved_professional(_uid) then
    raise exception 'Somente profissionais aprovados podem convidar clientes';
  end if;
  select seats into _seats from private.pro_subscription(_uid);
  if _seats is null then raise exception 'Seu plano profissional não está ativo'; end if;
  if private.pro_seats_used(_uid) >= _seats then
    raise exception 'Todas as % vagas do seu plano estão em uso', _seats;
  end if;
  select id into _client from auth.users where lower(email) = lower(trim(_email));
  if _client is null then
    raise exception 'Nenhuma conta encontrada com este e-mail';
  end if;
  insert into public.professional_client_links (professional_id, client_id, invited_by)
  values (_uid, _client, _uid)
  on conflict (professional_id, client_id) do nothing
  returning id into _link;
  if _link is null then raise exception 'Já existe um vínculo com este cliente'; end if;
  return _link;
end $$;

-- Ao aceitar o convite, o cliente sem assinatura própria ganha acesso patrocinado.
create or replace function private.sponsor_on_accept()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and old.status = 'invited' and not private.has_active_subscription(new.client_id) then
    insert into public.subscriptions (user_id, plan_id, status, source, sponsor_id, started_at)
    select new.client_id, p.id, 'active', 'professional', new.professional_id, now()
      from public.plans p where p.key = 'individual';
  end if;
  return new;
end $$;
create trigger sponsor_on_accept after update on public.professional_client_links
  for each row execute function private.sponsor_on_accept();

-- ---------------------------------------------------------------------
-- Admin: define/ativa assinatura (cortesia ou ajuste manual).
-- ---------------------------------------------------------------------
create or replace function public.admin_set_subscription(
  _user uuid, _plan_key text, _status public.subscription_status,
  _pro_modules text[] default '{}', _seats int default null, _notes text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare _plan public.plans; _sub uuid;
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  select * into _plan from public.plans where key = _plan_key;
  if not found then raise exception 'Plano inexistente'; end if;

  -- Uma assinatura vigente por público (individual / profissional).
  select s.id into _sub from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = _user and p.audience = _plan.audience and s.status <> 'canceled' and s.source <> 'professional'
   order by s.created_at desc limit 1;

  if _sub is null then
    insert into public.subscriptions (user_id, plan_id, status, source, pro_modules, seats, notes, created_by, started_at)
    values (_user, _plan.id, _status, 'admin', coalesce(_pro_modules, '{}'), _seats, _notes, (select auth.uid()),
            case when _status = 'active' then now() end)
    returning id into _sub;
  else
    update public.subscriptions
       set plan_id = _plan.id, status = _status, source = 'admin', pro_modules = coalesce(_pro_modules, '{}'),
           seats = _seats, notes = coalesce(_notes, notes),
           started_at = case when _status = 'active' then coalesce(started_at, now()) else started_at end,
           canceled_at = case when _status = 'canceled' then now() else null end
     where id = _sub;
  end if;

  if _plan.audience = 'professional' then
    insert into public.user_roles (user_id, role, granted_by) values (_user, 'professional', (select auth.uid())) on conflict do nothing;
    insert into public.professional_profiles (user_id, public_name, approved_at, approved_by)
    select _user, coalesce(p.full_name, 'Profissional'), now(), (select auth.uid()) from public.profiles p where p.id = _user
    on conflict (user_id) do update
      set approved_at = coalesce(public.professional_profiles.approved_at, now()),
          approved_by = coalesce(public.professional_profiles.approved_by, (select auth.uid()));
  end if;
  return _sub;
end $$;

-- Lista de usuários do admin passa a incluir a assinatura.
drop function public.admin_list_users();
create function public.admin_list_users()
returns table (
  id uuid, email text, full_name text, roles public.app_role[],
  created_at timestamptz, last_sign_in_at timestamptz, professional_approved boolean,
  plan_key text, plan_name text, subscription_status public.subscription_status,
  subscription_source public.subscription_source, pro_modules text[], seats int, seats_used int
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
    select u.id, u.email::text, p.full_name,
           coalesce((select array_agg(r.role order by r.role) from public.user_roles r where r.user_id = u.id), '{}'),
           u.created_at, u.last_sign_in_at,
           exists (select 1 from public.professional_profiles pp where pp.user_id = u.id and pp.approved_at is not null),
           s.key, s.name, s.status, s.source, s.pro_modules, s.seats,
           private.pro_seats_used(u.id)
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join lateral (
        select pl.key, pl.name, su.status, su.source, su.pro_modules,
               coalesce(su.seats, (pl.limits ->> 'clientes')::int) as seats
          from public.subscriptions su join public.plans pl on pl.id = su.plan_id
         where su.user_id = u.id and su.status <> 'canceled'
         order by (pl.audience = 'professional') desc, su.created_at desc limit 1
      ) s on true
     order by u.created_at desc;
end $$;

-- Painel do profissional: plano, vagas e módulos contratados.
create or replace function public.my_pro_plan()
returns table (plan_key text, plan_name text, seats int, seats_used int, pro_modules text[], status public.subscription_status)
language sql stable security definer set search_path = '' as $$
  select p.key, p.name, coalesce(s.seats, (p.limits ->> 'clientes')::int), private.pro_seats_used(s.user_id), s.pro_modules, s.status
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = (select auth.uid()) and p.audience = 'professional' and s.status <> 'canceled'
   order by s.created_at desc limit 1;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
revoke execute on function public.admin_set_subscription, public.admin_list_users, public.my_pro_plan from public, anon;
grant execute on function public.admin_set_subscription, public.admin_list_users, public.my_pro_plan to authenticated;

-- ---------------------------------------------------------------------
-- Transição: quem já existe e tinha módulos recebe cortesia Individual,
-- para ninguém perder acesso; o admin ajusta depois.
-- ---------------------------------------------------------------------
insert into public.subscriptions (user_id, plan_id, status, source, started_at, notes)
select distinct um.user_id, p.id, 'active'::public.subscription_status, 'admin'::public.subscription_source, now(), 'Migração: contas criadas antes dos planos'
  from public.user_modules um cross join public.plans p
 where p.key = 'individual' and um.enabled
   and not exists (select 1 from public.subscriptions s where s.user_id = um.user_id);
