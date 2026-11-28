-- WhatsApp: o usuário prova que o número é dele enviando, DESSE número,
-- um código gerado no app para o número do assistente.
alter table public.whatsapp_identities
  add column verify_code text,
  add column verify_expires_at timestamptz;

create or replace function public.whatsapp_start_verification(_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not exists (select 1 from public.whatsapp_identities where id = _id and user_id = (select auth.uid())) then
    raise exception 'Número não encontrado';
  end if;
  c := lpad(((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::int & 2147483647) % 1000000)::text, 6, '0');
  update public.whatsapp_identities
     set verify_code = c, verify_expires_at = now() + interval '30 minutes'
   where id = _id and verified_at is null;
  if not found then raise exception 'Este número já está verificado'; end if;
  return c;
end $$;
revoke execute on function public.whatsapp_start_verification from public, anon;
grant execute on function public.whatsapp_start_verification to authenticated;
