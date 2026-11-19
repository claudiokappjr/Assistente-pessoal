-- Catálogos iniciais: módulos, especialidades e planos.
-- Preços ficam nulos até a definição comercial (não inventar valores).

insert into public.modules (key, name, description, is_sensitive, sort_order) values
  ('agenda',      'Agenda',              'Compromissos, consultas e lembretes',                 false, 10),
  ('financas',    'Finanças',            'Lançamentos, contas, fluxo de caixa e patrimônio',    false, 20),
  ('saude',       'Saúde',               'Exames, consultas, prontuário e medicamentos',        true,  30),
  ('psicanalise', 'Psicanálise',         'Sonhos, insights e sessões',                          true,  40),
  ('nutricao',    'Nutrição',            'Planos alimentares e registro de refeições',          true,  50),
  ('exercicios',  'Exercícios',          'Treinos, cargas e medidas corporais',                 true,  60),
  ('ciclo',       'Ciclo menstrual',     'Calendário de ciclos e sintomas',                     true,  70),
  ('memorias',    'Insights e memórias', 'Ideias, pensamentos e linha do tempo pessoal',        true,  80);

insert into public.specialties (key, name, council, module_keys) values
  ('psicanalise',   'Psicanálise',         null,     '{psicanalise,agenda}'),
  ('psicologia',    'Psicologia',          'CRP',    '{psicanalise,agenda}'),
  ('medicina',      'Medicina',            'CRM',    '{saude,agenda,nutricao,exercicios,ciclo}'),
  ('nutricao',      'Nutrição',            'CRN',    '{nutricao,saude,agenda}'),
  ('educacao_fisica','Educação física',    'CREF',   '{exercicios,agenda}'),
  ('financas',      'Consultoria financeira', null,  '{financas,agenda}');

insert into public.plans (key, name, audience, sort_order, limits) values
  ('gratuito',     'Gratuito',     'individual',   10, '{"mensagens_ia_mes": 50}'),
  ('completo',     'Completo',     'individual',   20, '{"mensagens_ia_mes": 1000}'),
  ('profissional', 'Profissional', 'professional', 30, '{"clientes_ativos": 30}');

insert into public.plan_modules (plan_id, module_key)
select p.id, m.key from public.plans p cross join public.modules m
where (p.key = 'gratuito' and m.key in ('agenda', 'financas', 'memorias'))
   or (p.key in ('completo', 'profissional'));
