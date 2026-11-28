-- Testes de isolamento da Fase 1.
-- Personagens: Ana (cliente), Bruno (profissional), Carla (admin), Davi (estranho).
-- Rodar após 00_supabase_shim.sql e as migrations, num banco descartável.
\set ON_ERROR_STOP 1

create schema if not exists test;
create or replace function test.ok(_cond boolean, _name text) returns void language plpgsql as $$
begin
  if _cond is not true then raise exception 'FALHOU: %', _name; end if;
  raise notice 'ok - %', _name;
end $$;
-- Executa SQL como um usuário e confirma que dá erro.
create or replace function test.fails(_sql text, _name text) returns void language plpgsql as $$
begin
  begin
    execute _sql;
  exception when others then
    raise notice 'ok - % (bloqueado: %)', _name, sqlerrm;
    return;
  end;
  raise exception 'FALHOU: % (deveria ter sido bloqueado)', _name;
end $$;
grant usage on schema test to anon, authenticated;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@teste.com',   '{"full_name":"Ana Souza"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bruno@teste.com', '{"full_name":"Bruno Lima"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carla@teste.com', '{"full_name":"Carla Admin"}'),
  ('00000000-0000-0000-0000-00000000000d', 'davi@teste.com',  '{"full_name":"Davi Costa"}');
-- Primeiro admin é criado diretamente pelo servidor (bootstrap).
insert into public.user_roles (user_id, role) values ('00000000-0000-0000-0000-00000000000c', 'admin');

select test.ok((select count(*) from public.profiles) = 4, 'cadastro cria perfil automaticamente');
select test.ok((select count(*) from public.organizations where kind = 'personal') = 4, 'cadastro cria organização pessoal');
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-00000000000a' and enabled) = 0, 'Sem assinatura, nenhum módulo liberado');
-- Assinaturas de teste (como faria o servidor/admin): Ana individual; Bruno e Davi profissionais.
insert into public.subscriptions (user_id, plan_id, status, source) select '00000000-0000-0000-0000-00000000000a', id, 'active', 'admin' from public.plans where key = 'individual';
insert into public.subscriptions (user_id, plan_id, status, source, pro_modules) select '00000000-0000-0000-0000-00000000000b', id, 'active', 'admin', '{saude,agenda}' from public.plans where key = 'pro_10';
insert into public.subscriptions (user_id, plan_id, status, source, pro_modules) select '00000000-0000-0000-0000-00000000000d', id, 'active', 'admin', '{exercicios}' from public.plans where key = 'pro_10';
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-00000000000a' and enabled) = 8, 'Assinatura ativa libera os 8 módulos');

-- ------------------------------------------------------------- Ana
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.ok((select count(*) from public.profiles) = 1, 'Ana vê só o próprio perfil');
select test.ok((select count(*) from public.user_roles) = 1, 'Ana vê só os próprios papéis');
select test.fails($$insert into public.user_roles values ('00000000-0000-0000-0000-00000000000a','admin')$$, 'Ana não se torna admin');
select test.fails($$select public.admin_stats()$$, 'Ana não acessa estatísticas do admin');
select test.fails($$select public.admin_set_role('00000000-0000-0000-0000-00000000000a','admin',true)$$, 'Ana não concede papel admin');
update public.profiles set full_name = 'Ana S.' where id = '00000000-0000-0000-0000-00000000000b';
select test.ok((select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Ana Souza', 'Ana não altera perfil alheio');
insert into public.whatsapp_identities (user_id, phone_e164, verified_at) values ('00000000-0000-0000-0000-00000000000a', '+5565999990000', now());
select test.ok((select verified_at is null from public.whatsapp_identities), 'Ana não marca o próprio WhatsApp como verificado');
select test.fails($$insert into public.whatsapp_identities (user_id, phone_e164) values ('00000000-0000-0000-0000-00000000000d', '+5565999991111')$$, 'Ana não cadastra número em nome de outro');
commit;

-- ------------------------------------------------------------- Bruno vira profissional
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.become_professional('Dr. Bruno Lima', 'CRM', '12345',
  array(select id from public.specialties where key = 'medicina'));
select test.ok((select approved_at is null from public.professional_profiles), 'Profissional nasce pendente de aprovação');
select test.fails($$update public.professional_profiles set approved_at = now()$$, 'Profissional não se auto-aprova');
select test.fails($$select public.invite_client('ana@teste.com')$$, 'Profissional não aprovado não convida');
commit;

-- Catálogo público não mostra profissional pendente
begin;
set local role anon;
select test.ok((select count(*) from public.professional_profiles) = 0, 'Visitante não vê profissional pendente');
select test.ok((select count(*) from public.modules) = 8, 'Visitante vê catálogo de módulos');
select test.ok((select count(*) from public.profiles) = 0, 'Visitante não vê perfis');
commit;

-- ------------------------------------------------------------- Carla (admin) aprova
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.admin_approve_professional('00000000-0000-0000-0000-00000000000b', true);
select test.ok((select (public.admin_stats() ->> 'usuarios')::int) = 4, 'Admin vê estatísticas');
select test.ok((select count(*) from public.admin_list_users()) = 4, 'Admin lista usuários');
select test.fails($$select public.admin_set_role('00000000-0000-0000-0000-00000000000c','admin',false)$$, 'Admin não remove o próprio acesso');
commit;

-- ------------------------------------------------------------- Bruno convida Ana
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.invite_client('ana@teste.com');
select test.ok((select count(*) from public.profiles) = 2, 'Profissional vê o perfil do cliente convidado');
select test.fails($$update public.professional_client_links set status = 'active'$$, 'Profissional não aceita convite pelo cliente');
select test.fails($$insert into public.consent_grants (client_id, professional_id, module_key, purpose) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','saude','x')$$, 'Profissional não concede consentimento a si mesmo');
commit;

-- ------------------------------------------------------------- Ana aceita e consente
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.fails($$insert into public.consent_grants (client_id, professional_id, module_key, purpose) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','saude','Acompanhamento')$$, 'Consentimento exige vínculo aceito');
update public.professional_client_links set status = 'active';
insert into public.consent_grants (client_id, professional_id, module_key, purpose)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'saude', 'Acompanhamento clínico');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.ok(private.has_consent('00000000-0000-0000-0000-00000000000a', 'saude'), 'Bruno acessa Saúde da Ana com consentimento');
select test.ok(not private.has_consent('00000000-0000-0000-0000-00000000000a', 'financas'), 'Bruno não acessa Finanças sem consentimento');
update public.consent_grants set expires_at = now() + interval '10 years';
select test.ok((select expires_at is null from public.consent_grants), 'Profissional não altera consentimento');
commit;

-- ------------------------------------------------------------- Davi (estranho)
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.profiles) = 1, 'Estranho não vê perfis alheios');
select test.ok((select count(*) from public.professional_client_links) = 0, 'Estranho não vê vínculos alheios');
select test.ok((select count(*) from public.consent_grants) = 0, 'Estranho não vê consentimentos alheios');
select test.ok((select count(*) from public.whatsapp_identities) = 0, 'Estranho não vê WhatsApp alheio');
select test.ok((select count(*) from public.audit_logs where subject_id <> '00000000-0000-0000-0000-00000000000d') = 0, 'Estranho não vê auditoria alheia');
select test.ok(not private.has_consent('00000000-0000-0000-0000-00000000000a', 'saude'), 'Estranho não tem acesso a Saúde da Ana');
select test.fails($$insert into public.consent_grants (client_id, professional_id, module_key, purpose) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000d','saude','x')$$, 'Estranho não cria consentimento em nome da Ana');
commit;

-- ------------------------------------------------------------- Ana revoga e encerra
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.ok((select count(*) from public.audit_logs) > 0, 'Ana vê o histórico de acessos aos próprios dados');
update public.consent_grants set revoked_at = now();
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.ok(not private.has_consent('00000000-0000-0000-0000-00000000000a', 'saude'), 'Revogação corta o acesso na hora');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.consent_grants (client_id, professional_id, module_key, purpose)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', 'saude', 'Novo acompanhamento');
update public.professional_client_links set status = 'ended';
select test.ok((select count(*) from public.consent_grants where revoked_at is null) = 0, 'Encerrar vínculo revoga todos os consentimentos');
select test.fails($$update public.professional_client_links set status = 'active'$$, 'Vínculo encerrado não reabre');
commit;

-- Auditoria é imutável
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.fails($$delete from public.audit_logs$$, 'Nem o admin apaga auditoria');
select test.fails($$update public.audit_logs set action = 'x'$$, 'Nem o admin edita auditoria');
commit;

-- ============================================================ Fase 2: assistente
-- O servidor (Edge Function) grava a mensagem e os rascunhos.
insert into public.assistant_messages (id, owner_id, content_text, status, intent)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
        'Paguei R$ 120 na academia e fiz 40 min de musculação', 'processed', 'registro');
insert into public.assistant_drafts (id, owner_id, message_id, module_key, kind, title, data, confidence) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'financas', 'despesa', 'Academia', '{"valor":120}', 0.95),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'exercicios', 'exercicio', 'Musculação', '{"minutos":40}', 0.9);

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.ok((select count(*) from public.assistant_drafts) = 2, 'Ana vê os próprios rascunhos');
select test.fails($$insert into public.assistant_messages (owner_id, content_text) values ('00000000-0000-0000-0000-00000000000a', 'x')$$, 'Usuário não grava mensagem direto (só pelo servidor)');
select test.fails($$insert into public.assistant_drafts (owner_id, message_id, kind, title) values ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', 'x', 'x')$$, 'Usuário não cria rascunho direto');
update public.assistant_drafts set data = '{"valor":125}', status = 'confirmed' where id = '20000000-0000-0000-0000-000000000001';
select test.ok((select decided_at is not null from public.assistant_drafts where id = '20000000-0000-0000-0000-000000000001'), 'Ana corrige e confirma rascunho');
select test.fails($$update public.assistant_drafts set status = 'rejected' where id = '20000000-0000-0000-0000-000000000001'$$, 'Rascunho decidido não muda mais');
select test.fails($$update public.assistant_drafts set owner_id = '00000000-0000-0000-0000-00000000000d' where id = '20000000-0000-0000-0000-000000000002'$$, 'Rascunho não muda de dono');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.assistant_messages) = 0, 'Estranho não vê mensagens alheias');
select test.ok((select count(*) from public.assistant_drafts) = 0, 'Estranho não vê rascunhos alheios');
update public.assistant_drafts set status = 'rejected';
commit;
select test.ok((select status from public.assistant_drafts where id = '20000000-0000-0000-0000-000000000002') = 'pending', 'Estranho não decide rascunho alheio');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.ok((select count(*) from public.assistant_messages) = 0, 'Profissional não vê mensagens do cliente');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.assistant_messages) = 0, 'Admin não lê conteúdo das mensagens');
select test.ok((select count(*) from public.assistant_drafts) = 0, 'Admin não lê rascunhos');
select test.ok((select (public.admin_stats() ->> 'mensagens_mes')::int) = 1, 'Admin vê só a contagem de mensagens');
commit;

-- ============================================================ Módulos v1
-- Rascunho já confirmado pela Ana (financas) virou lançamento.
select test.ok((select count(*) from public.finance_transactions where source_draft_id = '20000000-0000-0000-0000-000000000001') = 1, 'Rascunho confirmado vira lançamento em Finanças');
select test.ok(private.try_time('14h30') = '14:30'::time and private.try_time('9h') = '09:00'::time and private.try_date('25/12/2026') = '2026-12-25', 'Conversões de hora e data');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.assistant_drafts set status = 'confirmed' where id = '20000000-0000-0000-0000-000000000002';
select test.ok((select count(*) from public.exercise_logs) = 1, 'Treino confirmado aparece em Exercícios');
insert into public.health_entries (kind, description, intensity) values ('sintoma', 'Dor de cabeça', 4);
select test.ok((select owner_id from public.health_entries) = '00000000-0000-0000-0000-00000000000a', 'Registro manual assume o dono automaticamente');
select test.fails($$insert into public.finance_transactions (owner_id, kind, amount_cents, description) values ('00000000-0000-0000-0000-00000000000d', 'despesa', 100, 'x')$$, 'Não grava registro em nome de outro');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.finance_transactions) = 0, 'Estranho não vê finanças alheias');
select test.ok((select count(*) from public.health_entries) = 0, 'Estranho não vê saúde alheia');
update public.health_entries set description = 'hack';
delete from public.exercise_logs;
commit;
select test.ok((select description from public.health_entries) = 'Dor de cabeça' and (select count(*) from public.exercise_logs) = 1, 'Estranho não altera nem apaga dados alheios');

-- Davi vira profissional aprovado, Ana autoriza só Exercícios.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select public.become_professional('Davi Personal', 'CREF', '999', array(select id from public.specialties where key = 'educacao_fisica'));
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.admin_approve_professional('00000000-0000-0000-0000-00000000000d', true);
select test.ok((select count(*) from public.finance_transactions) = 0 and (select count(*) from public.health_entries) = 0, 'Admin não vê conteúdo dos módulos');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select public.invite_client('ana@teste.com');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.professional_client_links set status = 'active' where professional_id = '00000000-0000-0000-0000-00000000000d';
insert into public.consent_grants (client_id, professional_id, module_key, purpose)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'exercicios', 'Acompanhamento de treino');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.exercise_logs) = 1, 'Profissional autorizado vê Exercícios do cliente');
select test.ok((select count(*) from public.finance_transactions) = 0 and (select count(*) from public.health_entries) = 0, 'Profissional não vê módulos não autorizados');
update public.exercise_logs set activity = 'alterado';
commit;
select test.ok((select activity from public.exercise_logs) <> 'alterado', 'Profissional só lê, não altera');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.consent_grants set revoked_at = now() where professional_id = '00000000-0000-0000-0000-00000000000d' and revoked_at is null;
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.exercise_logs) = 0, 'Revogar autorização some com os dados para o profissional');
commit;

-- ============================================================ Assinaturas
-- Cadastro pelo site com plano escolhido: nasce pendente, sem módulos.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'eva@teste.com', '{"full_name":"Eva Individual","plan_key":"individual"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'fabio@teste.com', '{"full_name":"Fábio Nutri","plan_key":"pro_10","public_name":"Fábio Nutricionista","council":"CRN","registration":"123","specialties":["nutricao"],"pro_modules":["nutricao","inexistente"]}');
select test.ok((select status from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000e1') = 'pending_payment', 'Cadastro pelo site nasce aguardando pagamento');
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-0000000000e1' and enabled) = 0, 'Assinatura pendente não libera módulos');
select test.ok(exists (select 1 from public.user_roles where user_id = '00000000-0000-0000-0000-0000000000f1' and role = 'professional')
  and (select pro_modules from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000f1') = '{nutricao}', 'Cadastro de profissional guarda módulos válidos do plano');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select test.fails($$insert into public.subscriptions (user_id, plan_id, status) select '00000000-0000-0000-0000-0000000000e1', id, 'active' from public.plans where key = 'individual'$$, 'Usuário não se dá assinatura ativa');
select test.fails($$update public.subscriptions set status = 'active'$$, 'Usuário não ativa a própria assinatura');
select test.fails($$select public.admin_set_subscription('00000000-0000-0000-0000-0000000000e1', 'individual', 'active')$$, 'Só admin concede cortesia');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.admin_set_subscription('00000000-0000-0000-0000-0000000000e1', 'individual', 'active', '{}', null, 'Cortesia');
select public.admin_set_subscription('00000000-0000-0000-0000-0000000000f1', 'pro_10', 'active', '{nutricao}', 1);
commit;
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-0000000000e1' and enabled) = 8, 'Cortesia do admin libera os módulos');
select test.ok((select count(*) from public.subscriptions where user_id = '00000000-0000-0000-0000-0000000000e1') = 1, 'Ativar não duplica assinatura');

-- Vagas: Fábio tem 1 vaga.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select test.ok((select seats from public.my_pro_plan()) = 1, 'Profissional vê o próprio plano e vagas');
select public.invite_client('eva@teste.com');
select test.fails($$select public.invite_client('ana@teste.com')$$, 'Sem vaga, não convida mais clientes');
commit;

-- Eva aceita e libera Nutrição e Finanças; Fábio só contratou Nutrição.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
update public.professional_client_links set status = 'active';
insert into public.consent_grants (client_id, professional_id, module_key, purpose) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'nutricao', 'Plano alimentar'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'financas', 'Teste');
insert into public.food_logs (meal, items) values ('almoço', '{arroz}');
insert into public.finance_transactions (kind, amount_cents, description) values ('despesa', 1000, 'Mercado');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select test.ok((select count(*) from public.food_logs) = 1, 'Profissional vê módulo contratado e autorizado');
select test.ok((select count(*) from public.finance_transactions) = 0, 'Profissional não vê módulo fora do plano, mesmo autorizado');
commit;

-- Cliente patrocinado: Gil entra pelo convite do Bruno e ganha acesso; ao encerrar, perde.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000a1', 'gil@teste.com', '{"full_name":"Gil"}');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.invite_client('gil@teste.com');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
update public.professional_client_links set status = 'active';
commit;
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-0000000000a1' and enabled) = 8, 'Cliente do profissional ganha os 8 módulos');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.ok((select count(*) from public.subscriptions where sponsor_id = '00000000-0000-0000-0000-00000000000b') = 1, 'Profissional vê as assinaturas que patrocina');
update public.professional_client_links set status = 'ended' where client_id = '00000000-0000-0000-0000-0000000000a1';
commit;
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-0000000000a1' and enabled) = 0, 'Encerrar vínculo encerra o acesso patrocinado');

-- Usuário existente pede plano profissional: fica pendente e não ganha acesso extra.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select public.request_pro_subscription('pro_30', '{saude,inexistente}');
select test.ok((select status from public.subscriptions s join public.plans p on p.id = s.plan_id where p.key = 'pro_30') = 'pending_payment', 'Pedido de plano profissional fica aguardando pagamento');
select test.ok((select pro_modules from public.subscriptions s join public.plans p on p.id = s.plan_id where p.key = 'pro_30') = '{saude}', 'Pedido guarda só módulos válidos');
commit;
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-0000000000a1' and enabled) = 0, 'Pedido pendente não libera módulos');

-- ============================================================ Nutrição: receitas e cardápio
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
insert into public.recipes (id, title, meal_types, servings) values ('30000000-0000-0000-0000-000000000001', 'Omelete', '{cafe,jantar}', 2);
insert into public.recipe_ingredients (recipe_id, name, quantity, unit) values
  ('30000000-0000-0000-0000-000000000001', 'Ovo', 4, 'unid'), ('30000000-0000-0000-0000-000000000001', 'Sal', null, 'a_gosto');
insert into public.meal_plan_items (plan_date, meal_type, recipe_id, servings) values ('2026-11-30', 'cafe', '30000000-0000-0000-0000-000000000001', 1);
insert into public.shopping_checks (week_start, item_key) values ('2026-11-30', 'ovo|unid');
select test.ok((select count(*) from public.recipe_ingredients) = 2 and (select count(*) from public.meal_plan_items) = 1, 'Eva cria receita, ingredientes e cardápio');
select test.fails($$insert into public.recipes (title, meal_types) values ('X', '{brunch}')$$, 'Tipo de refeição inválido é recusado');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.recipes) = 0 and (select count(*) from public.meal_plan_items) = 0, 'Estranho não vê receitas nem cardápio alheios');
select test.fails($$insert into public.recipe_ingredients (recipe_id, name) values ('30000000-0000-0000-0000-000000000001', 'veneno')$$, 'Não adiciona ingrediente em receita alheia');
select test.fails($$insert into public.meal_plan_items (plan_date, meal_type, recipe_id) values ('2026-11-30', 'cafe', '30000000-0000-0000-0000-000000000001')$$, 'Não usa receita alheia no próprio cardápio');
commit;

-- Fábio (nutricionista com Nutrição no plano, autorizado pela Eva) só lê.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
select test.ok((select count(*) from public.recipes) = 1 and (select count(*) from public.meal_plan_items) = 1, 'Nutricionista autorizado vê receitas e cardápio do cliente');
update public.recipes set title = 'alterado';
delete from public.meal_plan_items;
commit;
select test.ok((select title from public.recipes where id = '30000000-0000-0000-0000-000000000001') = 'Omelete'
  and (select count(*) from public.meal_plan_items) = 1, 'Nutricionista não altera receitas nem cardápio do cliente');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.recipes) = 0, 'Admin não vê receitas');
commit;

-- ============================================================ Receitas compartilhadas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';
insert into public.recipes (id, title, meal_types, servings, share_token) values ('30000000-0000-0000-0000-000000000002', 'Salada da nutri', '{almoco}', 1, 'token-publico-receita-12345');
insert into public.recipe_ingredients (recipe_id, name, quantity, unit) values ('30000000-0000-0000-0000-000000000002', 'Alface', 100, 'g');
insert into public.recipe_shares (recipe_id, shared_with) values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000e1');
select test.fails($$insert into public.recipe_shares (recipe_id, shared_with) values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000d')$$, 'Só envia receita para cliente/profissional vinculado');
select test.fails($$insert into public.recipe_shares (recipe_id, shared_with) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1')$$, 'Não envia receita de outra pessoa');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select test.ok((select count(*) from public.recipes where id = '30000000-0000-0000-0000-000000000002') = 1
  and (select count(*) from public.recipe_ingredients where recipe_id = '30000000-0000-0000-0000-000000000002') = 1, 'Cliente vê receita e ingredientes enviados pelo profissional');
update public.recipes set title = 'alterada' where id = '30000000-0000-0000-0000-000000000002';
select public.copy_recipe('30000000-0000-0000-0000-000000000002');
select test.ok((select count(*) from public.recipes where owner_id = '00000000-0000-0000-0000-0000000000e1' and title = 'Salada da nutri') = 1, 'Cliente salva cópia nas próprias receitas');
commit;
select test.ok((select title from public.recipes where id = '30000000-0000-0000-0000-000000000002') = 'Salada da nutri', 'Destinatário não altera a receita original');

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.recipes where id = '30000000-0000-0000-0000-000000000002') = 0, 'Estranho não vê receita enviada a outra pessoa');
select test.fails($$select public.copy_recipe('30000000-0000-0000-0000-000000000002')$$, 'Estranho não copia receita sem acesso');
select public.copy_recipe(null, 'token-publico-receita-12345');
select test.ok((select count(*) from public.recipes where owner_id = '00000000-0000-0000-0000-00000000000d') = 1, 'Quem tem o link salva a receita');
commit;

begin;
set local role anon;
select test.ok((public.get_shared_recipe('token-publico-receita-12345') ->> 'title') = 'Salada da nutri', 'Link público mostra a receita');
select test.ok(public.get_shared_recipe('token-errado-0000000000000') is null, 'Link inválido não mostra nada');
select test.ok((public.get_shared_recipe('token-publico-receita-12345') ? 'owner_id') = false, 'Link público não expõe o autor');
commit;

-- ============================================================ Saúde: exames, medicamentos, consultas
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.lab_exams (id, collected_on, lab_name, title) values ('40000000-0000-0000-0000-000000000001', '2026-10-01', 'Lab X', 'Bioquímica');
insert into public.lab_results (exam_id, marker, value, unit, ref_low, ref_high, flag) values
  ('40000000-0000-0000-0000-000000000001', 'Glicose', 105, 'mg/dL', 70, 99, 'alto'),
  ('40000000-0000-0000-0000-000000000001', 'Colesterol  total', 180, 'mg/dL', null, 190, 'normal');
insert into public.medications (name, dose, frequency) values ('Losartana', '50 mg', '1x ao dia');
insert into public.consultations (specialty, professional_name, summary) values ('Cardiologia', 'Dr. Bruno', 'Ajuste de pressão');
select test.ok((select marker_key from public.lab_results where marker like 'Colesterol%') = 'colesterol total', 'Marcador é normalizado para o gráfico');
select test.fails($$insert into public.lab_results (exam_id, marker) values ('40000000-0000-0000-0000-000000000001', 'Vazio')$$, 'Resultado sem valor é recusado');
select test.fails($$insert into public.lab_results (exam_id, marker, value, is_previous) values ('40000000-0000-0000-0000-000000000001', 'Glicose', 90, true)$$, 'Resultado anterior exige a data da medição');
insert into public.lab_results (exam_id, marker, value, is_previous, measured_on) values ('40000000-0000-0000-0000-000000000001', 'Glicose', 90, true, '2025-03-12');
select test.ok((select count(*) from public.lab_results where is_previous and measured_on = '2025-03-12') = 1, 'Resultado anterior do laudo fica guardado com a data');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.lab_exams) + (select count(*) from public.lab_results) + (select count(*) from public.medications where owner_id = '00000000-0000-0000-0000-00000000000a') + (select count(*) from public.consultations) = 0, 'Estranho não vê exames, medicamentos nem consultas');
select test.fails($$insert into public.lab_results (exam_id, marker, value) values ('40000000-0000-0000-0000-000000000001', 'Hack', 1)$$, 'Não adiciona resultado em exame alheio');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.lab_results) = 0 and (select count(*) from public.medications) = 0, 'Admin não vê dados de saúde');
commit;

-- Assistente: medicamento confirmado vai para Medicamentos; consulta para Consultas.
insert into public.assistant_messages (id, owner_id, content_text, status) values ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a', 'x', 'processed');
insert into public.assistant_drafts (id, owner_id, message_id, module_key, kind, title, data) values
  ('20000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000009', 'saude', 'medicamento', 'Dipirona', '{"medicamento":"Dipirona","dose":"500 mg"}'),
  ('20000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000009', 'saude', 'consulta', 'Consulta', '{"especialidade":"Dermatologia","descricao":"Mancha na pele"}');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.assistant_drafts set status = 'confirmed' where message_id = '10000000-0000-0000-0000-000000000009';
select test.ok(exists (select 1 from public.medications where name = 'Dipirona' and dose = '500 mg')
  and exists (select 1 from public.consultations where specialty = 'Dermatologia'), 'Assistente leva medicamento e consulta para as abas certas');
commit;

-- WhatsApp: verificação por código.
insert into public.whatsapp_identities (id, user_id, phone_e164) values ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', '+5565999990001');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.ok(public.whatsapp_start_verification('50000000-0000-0000-0000-000000000001') ~ '^[0-9]{6}$', 'Dono gera código de 6 dígitos para verificar o WhatsApp');
select test.ok((select verified_at from public.whatsapp_identities where id = '50000000-0000-0000-0000-000000000001') is null, 'Gerar código não verifica o número sozinho');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.fails($$select public.whatsapp_start_verification('50000000-0000-0000-0000-000000000001')$$, 'Estranho não gera código para número alheio');
commit;
update public.whatsapp_identities set verified_at = now() where id = '50000000-0000-0000-0000-000000000001';
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.fails($$select public.whatsapp_start_verification('50000000-0000-0000-0000-000000000001')$$, 'Número já verificado não gera novo código');
commit;

-- Ferramenta de configuração: só o servidor consulta o token.
insert into private.setup_tokens (token, purpose) values ('tok-teste', 'whatsapp');
select test.ok(public.check_setup_token('tok-teste', 'whatsapp') and not public.check_setup_token('tok-teste', 'outro'), 'Token de configuração vale só para o propósito certo');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.fails($$select public.check_setup_token('tok-teste', 'whatsapp')$$, 'Usuário logado (mesmo admin) não consulta token de configuração');
commit;

-- Calorias, gasto nos treinos e metas.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.food_logs (id, kind, meal, items) values ('60000000-0000-0000-0000-000000000001', 'refeicao', 'almoço', '{arroz,feijão}');
insert into public.food_logs (id, kind, meal, items, kcal) values ('60000000-0000-0000-0000-000000000002', 'refeicao', 'jantar', '{sopa}', 300);
insert into public.food_logs (id, kind, water_ml) values ('60000000-0000-0000-0000-000000000003', 'agua', 500);
select test.ok((select nutrition_status from public.food_logs where id = '60000000-0000-0000-0000-000000000001') = 'pendente', 'Refeição sem calorias fica pendente de estimativa');
select test.ok((select nutrition_status from public.food_logs where id = '60000000-0000-0000-0000-000000000002') = 'manual', 'Refeição com calorias informadas é manual');
select test.ok((select nutrition_status from public.food_logs where id = '60000000-0000-0000-0000-000000000003') is null, 'Água não tem estimativa de calorias');
update public.food_logs set kcal = 700 where id = '60000000-0000-0000-0000-000000000001';
select test.ok((select nutrition_status from public.food_logs where id = '60000000-0000-0000-0000-000000000001') = 'manual', 'Corrigir calorias à mão vira manual');
update public.food_logs set items = '{arroz,feijão,bife}' where id = '60000000-0000-0000-0000-000000000001';
select test.ok((select nutrition_status from public.food_logs where id = '60000000-0000-0000-0000-000000000001') = 'pendente', 'Mudar alimentos pede nova estimativa');
insert into public.exercise_logs (id, activity, duration_min) values ('60000000-0000-0000-0000-000000000004', 'Corrida', 30);
insert into public.exercise_logs (id, activity) values ('60000000-0000-0000-0000-000000000005', 'Yoga');
select test.ok((select kcal_status from public.exercise_logs where id = '60000000-0000-0000-0000-000000000004') = 'pendente'
  and (select kcal_status from public.exercise_logs where id = '60000000-0000-0000-0000-000000000005') = 'sem_duracao', 'Treino com duração é estimado; sem duração aguarda');
insert into public.wellness_goals (weight_kg, kcal_day, exercise_minutes_month) values (80, 2200, 600);
select test.ok((select kcal_day from public.wellness_goals) = 2200, 'Dono define as próprias metas');
select test.fails($$insert into public.wellness_goals (owner_id, kcal_day) values ('00000000-0000-0000-0000-00000000000d', 2000)$$, 'Não cria metas em nome de outro');
select test.fails($$select public.check_internal_key('x')$$, 'Usuário não consulta a chave interna de estimativa');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select count(*) from public.wellness_goals) = 0, 'Estranho não vê metas alheias');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.wellness_goals) = 0 and (select count(*) from public.food_logs) = 0, 'Admin não vê metas nem refeições');
commit;

-- Sonhos e escalas. Davi (profissional vinculado à Ana) passa a ter Saúde no plano e autorização da Ana.
update public.subscriptions set pro_modules = '{exercicios,saude}' where user_id = '00000000-0000-0000-0000-00000000000d';
insert into public.consent_grants (client_id, professional_id, module_key, purpose)
values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'saude', 'Escalas');
select test.ok((select name from public.modules where key = 'psicanalise') = 'Psicologia e Psicanálise', 'Módulo renomeado para Psicologia e Psicanálise');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.psy_entries (kind, content, themes, interpretation) values ('sonho', 'Eu caía de um prédio', '{queda,trabalho}', 'Medo de perder o controle');
select test.ok((select themes from public.psy_entries where content like 'Eu caía%') = '{queda,trabalho}', 'Sonho guarda motivos e interpretação');
insert into public.scale_responses (scale_key, module_key, answers, score, severity) values ('gad7', 'psicanalise', '{2,2,2,2,2,2,2}', 0, 'minimo');
select test.ok((select score = 14 and severity = 'moderado' and filled_role = 'paciente' from public.scale_responses where scale_key = 'gad7'), 'GAD-7 é pontuado pelo banco (não aceita resultado inventado)');
select test.fails($$insert into public.scale_responses (scale_key, module_key, answers) values ('gad7', 'psicanalise', '{1,1}')$$, 'Escala incompleta é recusada');
select test.fails($$insert into public.scale_responses (scale_key, module_key, answers) values ('auditc', 'psicanalise', '{1,1,1}')$$, 'Escala fora do módulo é recusada');
insert into public.scale_responses (scale_key, module_key, answers) values ('phq9', 'psicanalise', '{0,0,0,0,0,0,0,0,1}');
select test.ok((select alert from public.scale_responses where scale_key = 'phq9'), 'PHQ-9 sinaliza a pergunta 9 para atenção');
select test.fails($$update public.scale_responses set score = 0$$, 'Resultado de escala não pode ser alterado');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
insert into public.scale_assignments (id, owner_id, scale_key, module_key, specialty) values ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'findrisc', 'saude', 'endocrinologia');
select test.fails($$insert into public.scale_assignments (owner_id, scale_key, module_key) values ('00000000-0000-0000-0000-00000000000a', 'gad7', 'psicanalise')$$, 'Profissional não libera escala em módulo sem autorização');
insert into public.scale_responses (owner_id, scale_key, module_key, answers) values ('00000000-0000-0000-0000-00000000000a', 'eva_dor', 'saude', '{7}');
select test.ok((select filled_role = 'profissional' and severity = 'intensa' from public.scale_responses where scale_key = 'eva_dor'), 'Profissional aplica a escala junto com o paciente');
select test.ok((select count(*) from public.scale_responses where scale_key in ('gad7', 'phq9')) = 0, 'Profissional não vê escalas de módulo não autorizado');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select test.ok((select count(*) from public.scale_assignments where status = 'pendente') = 1, 'Paciente vê o pedido do profissional');
insert into public.scale_responses (scale_key, module_key, answers, assignment_id) values ('findrisc', 'saude', '{2,1,3,0,0,0,0,3}', '70000000-0000-0000-0000-000000000001');
select test.ok((select status from public.scale_assignments where id = '70000000-0000-0000-0000-000000000001') = 'respondida', 'Responder o pedido marca como respondido');
select test.fails($$insert into public.scale_responses (scale_key, module_key, answers, assignment_id) values ('findrisc', 'saude', '{0,0,0,0,0,0,0,0}', '70000000-0000-0000-0000-000000000001')$$, 'Pedido já respondido não aceita outra resposta');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select test.ok((select score from public.scale_responses where scale_key = 'findrisc') = 9, 'Profissional vê o resultado do pedido');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000e1';
select test.ok((select count(*) from public.scale_responses) = 0 and (select count(*) from public.scale_assignments) = 0, 'Estranho não vê escalas nem pedidos');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select test.ok((select count(*) from public.scale_responses) = 0 and (select count(*) from public.psy_entries) = 0, 'Admin não vê escalas nem sonhos');
commit;

-- Metas calculadas: dados do objetivo ficam com o dono.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.wellness_goals set sex = 'feminino', birth_year = 1990, height_cm = 165, activity_level = 'moderado', goal_type = 'perder_gordura', target_weight_kg = 70, target_date = '2027-03-01';
select test.ok((select goal_type from public.wellness_goals) = 'perder_gordura', 'Dono guarda objetivo, altura e prazo');
select test.fails($$update public.wellness_goals set goal_type = 'inventado'$$, 'Objetivo fora da lista é recusado');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.wellness_goals set diet_preferences = 'sem lactose', diet_suggestion = '{"meals":[]}';
select test.ok((select diet_preferences from public.wellness_goals) = 'sem lactose', 'Preferências e sugestão de dieta ficam nas metas do dono');
commit;

-- Admin vincula profissional e paciente direto.
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000b1', 'hugo@teste.com', '{"full_name":"Hugo Paciente"}');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.fails($$select public.admin_link_client('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1')$$, 'Só o admin vincula diretamente');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.admin_link_client('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1');
select test.fails($$select public.admin_link_client('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b')$$, 'Admin só vincula quem é profissional como profissional');
select test.ok((select status from public.admin_list_links() where client_id = '00000000-0000-0000-0000-0000000000b1') = 'active', 'Vínculo feito pelo admin já nasce ativo');
commit;
select test.ok(private.has_active_subscription('00000000-0000-0000-0000-0000000000b1'), 'Paciente vinculado pelo admin ganha acesso patrocinado');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select test.ok((select count(*) from public.health_entries where owner_id = '00000000-0000-0000-0000-0000000000b1') = 0
  and exists (select 1 from public.professional_client_links where client_id = '00000000-0000-0000-0000-0000000000b1' and status = 'active'), 'Profissional vê o vínculo, mas nenhum dado sem a liberação do paciente');
commit;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select public.admin_end_link((select id from public.admin_list_links() where client_id = '00000000-0000-0000-0000-0000000000b1'));
select test.ok((select status from public.admin_list_links() where client_id = '00000000-0000-0000-0000-0000000000b1') = 'ended', 'Admin encerra o vínculo');
select public.admin_link_client('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1');
select test.ok((select status from public.admin_list_links() where client_id = '00000000-0000-0000-0000-0000000000b1') = 'active', 'Admin refaz um vínculo encerrado');
commit;

\echo 'TODOS OS TESTES PASSARAM'
