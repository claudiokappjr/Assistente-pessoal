-- Usada só pelo servidor (Edge Function manage-users) para saber se um
-- e-mail já tem conta. Não exposta a usuários (evita descobrir quem usa o app).
create or replace function public.find_user_id_by_email(_email text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(trim(_email)) limit 1;
$$;
revoke execute on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
