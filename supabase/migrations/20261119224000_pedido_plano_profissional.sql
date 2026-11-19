-- Usuário já cadastrado que quer virar profissional escolhe faixa e módulos.
-- Cria assinatura aguardando pagamento (ativação: pagamento ou admin).
create or replace function public.request_pro_subscription(_plan_key text, _pro_modules text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid()); _plan public.plans; _sub uuid; _mods text[];
begin
  if _uid is null then raise exception 'Não autenticado'; end if;
  select * into _plan from public.plans where key = _plan_key and is_active and audience = 'professional';
  if not found then raise exception 'Plano profissional inválido'; end if;
  select coalesce(array_agg(key), '{}') into _mods from public.modules where is_active and key = any(_pro_modules);

  select s.id into _sub from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.user_id = _uid and p.audience = 'professional' and s.status <> 'canceled' limit 1;
  if _sub is not null then
    -- Só ajusta pedido ainda não pago; plano ativo muda via pagamento/admin.
    update public.subscriptions set plan_id = _plan.id, pro_modules = _mods
     where id = _sub and status = 'pending_payment';
    return _sub;
  end if;
  insert into public.subscriptions (user_id, plan_id, status, source, pro_modules)
  values (_uid, _plan.id, 'pending_payment', 'payment', _mods) returning id into _sub;
  return _sub;
end $$;
revoke execute on function public.request_pro_subscription(text, text[]) from public, anon;
grant execute on function public.request_pro_subscription(text, text[]) to authenticated;
