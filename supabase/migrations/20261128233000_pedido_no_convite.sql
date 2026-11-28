-- O pedido de acesso pode acompanhar o convite (vínculo ainda pendente).
-- Mesmo aprovado, nada aparece ao profissional enquanto o convite não for aceito
-- (has_consent exige vínculo ativo).
drop policy "pedidos de acesso: profissional pede" on public.consent_requests;
create policy "pedidos de acesso: profissional pede" on public.consent_requests for insert to authenticated
  with check (
    professional_id = (select auth.uid()) and status = 'pendente'
    and exists (select 1 from public.professional_client_links l where l.professional_id = (select auth.uid())
                  and l.client_id = consent_requests.client_id and l.status in ('invited', 'active'))
    and exists (select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id
                 where s.user_id = (select auth.uid()) and s.status = 'active' and p.audience = 'professional'
                   and consent_requests.module_key = any (s.pro_modules)));
