-- Calorias e nutrientes (estimados pela IA ou informados à mão) nas refeições,
-- gasto calórico nos treinos e metas pessoais (diárias de nutrição, mensais de treino).
-- O cálculo roda sozinho: ao registrar/alterar, o banco pede a estimativa à
-- Edge Function nutrition-estimate (via pg_net, quando disponível).

alter table public.food_logs
  add column kcal numeric(7, 1) check (kcal >= 0),
  add column protein_g numeric(6, 1) check (protein_g >= 0),
  add column carbs_g numeric(6, 1) check (carbs_g >= 0),
  add column fat_g numeric(6, 1) check (fat_g >= 0),
  add column fiber_g numeric(6, 1) check (fiber_g >= 0),
  add column nutrition_items jsonb,
  add column nutrition_status text check (nutrition_status in ('pendente', 'estimado', 'manual', 'falhou'));

alter table public.exercise_logs
  add column intensity text check (intensity in ('leve', 'moderada', 'intensa')),
  add column met numeric(4, 1) check (met > 0),
  add column kcal numeric(7, 1) check (kcal >= 0),
  add column kcal_status text check (kcal_status in ('pendente', 'estimado', 'manual', 'falhou', 'sem_duracao'));

create table public.wellness_goals (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  weight_kg numeric(5, 1) check (weight_kg between 20 and 400),
  kcal_day int check (kcal_day between 500 and 10000),
  protein_g_day int check (protein_g_day between 0 and 1000),
  carbs_g_day int check (carbs_g_day between 0 and 2000),
  fat_g_day int check (fat_g_day between 0 and 1000),
  water_ml_day int check (water_ml_day between 0 and 20000),
  exercise_minutes_month int check (exercise_minutes_month between 0 and 50000),
  exercise_days_month int check (exercise_days_month between 0 and 31),
  exercise_kcal_month int check (exercise_kcal_month between 0 and 500000),
  updated_at timestamptz not null default now()
);
create trigger wellness_goals_updated_at before update on public.wellness_goals for each row execute function private.set_updated_at();
alter table public.wellness_goals enable row level security;
revoke all on public.wellness_goals from anon;
create policy "metas: dono e profissional autorizado leem" on public.wellness_goals for select to authenticated
  using (owner_id = (select auth.uid()) or private.has_consent(owner_id, 'nutricao') or private.has_consent(owner_id, 'exercicios'));
create policy "metas: dono cria" on public.wellness_goals for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "metas: dono edita" on public.wellness_goals for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "metas: dono apaga" on public.wellness_goals for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- configuração interna
create table if not exists private.app_config (key text primary key, value text not null);
insert into private.app_config (key, value) values
  ('functions_url', 'https://lehjyixgezjrhkuzusci.supabase.co/functions/v1'),
  ('estimate_key', md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
on conflict (key) do nothing;

create or replace function public.check_internal_key(_key text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from private.app_config where key = 'estimate_key' and value = _key)
$$;
revoke execute on function public.check_internal_key from public, anon, authenticated;
grant execute on function public.check_internal_key to service_role;

-- Pede a estimativa à Edge Function (sem esperar a resposta). Sem pg_net, não faz nada.
create or replace function private.request_estimate(_kind text, _id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare url text; k text;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select value into url from private.app_config where key = 'functions_url';
  select value into k from private.app_config where key = 'estimate_key';
  if url is null or k is null then return; end if;
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 30000)'
    using url || '/nutrition-estimate',
          jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', k),
          jsonb_build_object('kind', _kind, 'id', _id);
end $$;
revoke execute on function private.request_estimate from public, anon, authenticated;

-- ---------------------------------------------------------------- refeições
create or replace function private.food_nutrition_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'agua' then
    new.nutrition_status := null; return new;
  end if;
  if tg_op = 'INSERT' then
    new.nutrition_status := case when new.kcal is not null then 'manual' else 'pendente' end;
  elsif new.nutrition_status is distinct from old.nutrition_status then
    null; -- quem alterou definiu o status (ex.: a própria estimativa)
  elsif new.kcal is distinct from old.kcal or new.protein_g is distinct from old.protein_g
     or new.carbs_g is distinct from old.carbs_g or new.fat_g is distinct from old.fat_g then
    new.nutrition_status := 'manual';
  elsif new.items is distinct from old.items or new.meal is distinct from old.meal or new.notes is distinct from old.notes then
    new.nutrition_status := 'pendente';
  end if;
  return new;
end $$;
create trigger food_nutrition_status before insert or update on public.food_logs
  for each row execute function private.food_nutrition_status();

create or replace function private.food_request_estimate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.nutrition_status = 'pendente' and (tg_op = 'INSERT' or old.nutrition_status is distinct from 'pendente'
     or new.items is distinct from old.items or new.meal is distinct from old.meal) then
    perform private.request_estimate('food', new.id);
  end if;
  return null;
end $$;
create trigger food_request_estimate after insert or update on public.food_logs
  for each row execute function private.food_request_estimate();

-- ---------------------------------------------------------------- treinos
create or replace function private.exercise_kcal_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.kcal_status := case when new.kcal is not null then 'manual'
                            when coalesce(new.duration_min, 0) = 0 then 'sem_duracao' else 'pendente' end;
  elsif new.kcal_status is distinct from old.kcal_status then
    null;
  elsif new.kcal is distinct from old.kcal then
    new.kcal_status := 'manual';
  elsif new.activity is distinct from old.activity or new.duration_min is distinct from old.duration_min
     or new.intensity is distinct from old.intensity or new.distance_km is distinct from old.distance_km
     or new.load_kg is distinct from old.load_kg then
    new.kcal_status := case when coalesce(new.duration_min, 0) = 0 then 'sem_duracao' else 'pendente' end;
  end if;
  return new;
end $$;
create trigger exercise_kcal_status before insert or update on public.exercise_logs
  for each row execute function private.exercise_kcal_status();

create or replace function private.exercise_request_estimate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kcal_status = 'pendente' and (tg_op = 'INSERT' or old.kcal_status is distinct from 'pendente'
     or new.duration_min is distinct from old.duration_min or new.activity is distinct from old.activity) then
    perform private.request_estimate('exercise', new.id);
  end if;
  return null;
end $$;
create trigger exercise_request_estimate after insert or update on public.exercise_logs
  for each row execute function private.exercise_request_estimate();

-- Peso novo: recalcula os treinos do mês que foram estimados.
create or replace function private.goals_weight_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.weight_kg is distinct from old.weight_kg then
    update public.exercise_logs set kcal_status = 'pendente'
     where owner_id = new.owner_id and kcal_status in ('estimado', 'falhou')
       and performed_on >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  end if;
  return null;
end $$;
create trigger goals_weight_changed after insert or update on public.wellness_goals
  for each row execute function private.goals_weight_changed();

revoke execute on function private.food_nutrition_status, private.food_request_estimate, private.exercise_kcal_status,
  private.exercise_request_estimate, private.goals_weight_changed from public, anon;
