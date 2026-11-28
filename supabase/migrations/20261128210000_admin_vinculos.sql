-- Administrador vincula profissional e paciente diretamente (sem convite por e-mail).
-- O vínculo já nasce ativo; o paciente continua decidindo quais módulos o
-- profissional pode ver (consent_grants). O admin não ganha acesso a conteúdo.

-- O admin também pode ativar um convite pendente.
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
    if _uid <> old.client_id and not private.is_admin() then
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

create or replace function public.admin_link_client(_professional uuid, _client uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare _link uuid;
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  if _professional = _client then raise exception 'Escolha pessoas diferentes'; end if;
  if not exists (select 1 from public.user_roles where user_id = _professional and role = 'professional') then
    raise exception 'A conta escolhida como profissional não é profissional';
  end if;
  if not exists (select 1 from auth.users where id = _client) then raise exception 'Paciente não encontrado'; end if;
  -- Vínculo encerrado antes: começa um novo.
  delete from public.professional_client_links where professional_id = _professional and client_id = _client and status = 'ended';
  insert into public.professional_client_links (professional_id, client_id, invited_by, status, accepted_at)
  values (_professional, _client, (select auth.uid()), 'active', now())
  on conflict (professional_id, client_id) do update set status = 'active'
    where public.professional_client_links.status = 'invited'
  returning id into _link;
  if _link is null then raise exception 'Este paciente já está vinculado a este profissional'; end if;
  -- Paciente sem assinatura passa a ser patrocinado pelo profissional.
  if not private.has_active_subscription(_client) then
    insert into public.subscriptions (user_id, plan_id, status, source, sponsor_id, started_at, created_by)
    select _client, p.id, 'active', 'professional', _professional, now(), (select auth.uid()) from public.plans p where p.key = 'individual';
  end if;
  return _link;
end $$;

create or replace function public.admin_end_link(_link uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  update public.professional_client_links set status = 'ended' where id = _link and status <> 'ended';
  if not found then raise exception 'Vínculo não encontrado ou já encerrado'; end if;
end $$;

-- Lista de vínculos para o admin: quem é quem e QUAIS módulos foram liberados (nunca o conteúdo).
create or replace function public.admin_list_links()
returns table (
  id uuid, professional_id uuid, professional_name text, professional_email text,
  client_id uuid, client_name text, client_email text, status public.link_status,
  created_at timestamptz, accepted_at timestamptz, shared_modules text[]
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Acesso negado'; end if;
  return query
    select l.id, l.professional_id, coalesce(pp.public_name, pf.full_name), pu.email::text,
           l.client_id, cf.full_name, cu.email::text, l.status, l.created_at, l.accepted_at,
           coalesce((select array_agg(c.module_key order by c.module_key) from public.consent_grants c
                      where c.client_id = l.client_id and c.professional_id = l.professional_id and c.revoked_at is null
                        and (c.expires_at is null or c.expires_at > now())), '{}')
      from public.professional_client_links l
      join auth.users pu on pu.id = l.professional_id
      join auth.users cu on cu.id = l.client_id
      left join public.professional_profiles pp on pp.user_id = l.professional_id
      left join public.profiles pf on pf.id = l.professional_id
      left join public.profiles cf on cf.id = l.client_id
     order by (l.status = 'ended'), l.created_at desc;
end $$;

revoke execute on function public.admin_link_client, public.admin_end_link, public.admin_list_links from public, anon;
grant execute on function public.admin_link_client, public.admin_end_link, public.admin_list_links to authenticated;
