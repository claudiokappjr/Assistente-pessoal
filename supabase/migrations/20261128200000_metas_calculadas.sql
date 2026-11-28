-- Dados para calcular as metas automaticamente (gasto energético e objetivo).
alter table public.wellness_goals
  add column sex text check (sex in ('feminino', 'masculino')),
  add column birth_year int check (birth_year between 1900 and 2100),
  add column height_cm numeric(5, 1) check (height_cm between 80 and 250),
  add column activity_level text check (activity_level in ('sedentario', 'leve', 'moderado', 'alto', 'muito_alto')),
  add column goal_type text check (goal_type in ('perder_gordura', 'perder_peso', 'ganhar_massa', 'recomposicao', 'manter', 'condicionamento')),
  add column target_weight_kg numeric(5, 1) check (target_weight_kg between 20 and 400),
  add column target_date date,
  add column plan_notes text;
