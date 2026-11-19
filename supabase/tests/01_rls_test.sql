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
select test.ok((select count(*) from public.user_modules where user_id = '00000000-0000-0000-0000-00000000000a') = 3, 'plano gratuito libera 3 módulos');

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

\echo 'TODOS OS TESTES PASSARAM'
