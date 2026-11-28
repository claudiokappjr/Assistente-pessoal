-- Ferramenta interna de configuração (ex.: diagnóstico do WhatsApp).
-- Acesso por token de uso único com validade curta, consultado só pelo servidor.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
end $$;

create table if not exists private.setup_tokens (
  token text primary key,
  purpose text not null,
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create or replace function public.check_setup_token(_token text, _purpose text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from private.setup_tokens where token = _token and purpose = _purpose and expires_at > now())
$$;
revoke execute on function public.check_setup_token from public, anon, authenticated;
grant execute on function public.check_setup_token to service_role;
