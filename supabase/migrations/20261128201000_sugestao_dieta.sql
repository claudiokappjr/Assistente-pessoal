-- Sugestão de cardápio gerada pela IA a partir das metas, e preferências alimentares.
alter table public.wellness_goals
  add column diet_preferences text check (length(diet_preferences) <= 1000),
  add column diet_suggestion jsonb,
  add column diet_generated_at timestamptz;
