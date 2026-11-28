-- =====================================================================
-- Saúde: exames (com resultados por marcador), medicamentos e consultas.
-- Regras: dono faz tudo; profissional com plano + consentimento 'saude'
-- só lê; admin sem acesso. Arquivos em bucket privado (URLs temporárias).
-- =====================================================================

create table public.lab_exams (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collected_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  lab_name text,
  title text,
  file_path text,
  status text not null default 'revisar' check (status in ('processando', 'revisar', 'conferido', 'falhou')),
  error text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lab_exams_owner_idx on public.lab_exams(owner_id, collected_on desc);

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.lab_exams(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position int not null default 0,
  marker text not null check (length(trim(marker)) > 0),
  marker_key text generated always as (lower(regexp_replace(trim(marker), '\s+', ' ', 'g'))) stored,
  category text,
  value numeric,
  value_text text,
  unit text,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  flag text check (flag in ('baixo', 'normal', 'alto', 'alterado')),
  created_at timestamptz not null default now(),
  check (value is not null or value_text is not null)
);
create index lab_results_exam_idx on public.lab_results(exam_id, position);
create index lab_results_marker_idx on public.lab_results(owner_id, marker_key);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  dose text,
  frequency text,
  route text,
  reason text,
  prescriber text,
  started_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  ended_on date,
  prescription_path text,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);
create index medications_owner_idx on public.medications(owner_id, started_on desc);

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  consulted_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  specialty text not null check (length(trim(specialty)) > 0),
  professional_name text,
  location text,
  reason text,
  summary text,
  conduct text,
  next_return_on date,
  attachment_path text,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index consultations_owner_idx on public.consultations(owner_id, consulted_on desc);

-- Resultado só pode pertencer a exame do próprio dono.
create or replace function private.guard_lab_result()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.lab_exams e where e.id = new.exam_id and e.owner_id = new.owner_id) then
    raise exception 'Exame não encontrado';
  end if;
  return new;
end $$;
create trigger guard_lab_result before insert or update on public.lab_results
  for each row execute function private.guard_lab_result();
revoke execute on function private.guard_lab_result from public, anon;

create trigger lab_exams_updated_at before update on public.lab_exams for each row execute function private.set_updated_at();
create trigger medications_updated_at before update on public.medications for each row execute function private.set_updated_at();
create trigger consultations_updated_at before update on public.consultations for each row execute function private.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['lab_exams', 'lab_results', 'medications', 'consultations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format($p$create policy "dono e profissional autorizado leem" on public.%I for select to authenticated
      using (owner_id = (select auth.uid()) or private.has_consent(owner_id, 'saude'))$p$, t);
    execute format($p$create policy "dono cria" on public.%I for insert to authenticated
      with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono edita" on public.%I for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono apaga" on public.%I for delete to authenticated
      using (owner_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Assistente: medicamento e consulta confirmados vão para as novas tabelas.
-- ---------------------------------------------------------------------
create or replace function private.promote_draft(_d public.assistant_drafts)
returns void language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := coalesce(_d.data, '{}'::jsonb);
  dt date := coalesce(private.try_date(d ->> 'data'), private.try_date(d ->> 'data_inicio'),
                      (_d.created_at at time zone 'America/Sao_Paulo')::date);
begin
  if _d.module_key is null then return; end if;

  if _d.module_key = 'financas' and _d.kind in ('despesa', 'receita', 'conta_a_pagar', 'conta_a_receber') then
    insert into public.finance_transactions (owner_id, kind, status, amount_cents, occurred_on, due_on, description,
                                             category, payment_method, installments, source_draft_id)
    values (_d.owner_id,
            case when _d.kind in ('receita', 'conta_a_receber') then 'receita' else 'despesa' end,
            case when _d.kind like 'conta_a_%' then 'previsto' else 'realizado' end,
            coalesce(round(private.try_num(d ->> 'valor_centavos'))::bigint, 0),
            dt, private.try_date(d ->> 'vencimento'),
            coalesce(nullif(d ->> 'descricao', ''), _d.title), d ->> 'categoria', d ->> 'forma_pagamento',
            nullif(round(private.try_num(d ->> 'parcelas')), 0)::int, _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'agenda' then
    insert into public.agenda_events (owner_id, kind, title, starts_at, duration_min, location, with_whom, source_draft_id)
    values (_d.owner_id,
            case when _d.kind = 'lembrete' then 'lembrete' else 'compromisso' end,
            coalesce(nullif(d ->> 'titulo', ''), _d.title),
            (dt + coalesce(private.try_time(d ->> 'horario'), time '09:00')) at time zone 'America/Sao_Paulo',
            round(private.try_num(d ->> 'duracao_min'))::int, d ->> 'local', d ->> 'com_quem', _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'exercicios' then
    insert into public.exercise_logs (owner_id, activity, performed_on, duration_min, sets, reps, load_kg, distance_km, source_draft_id)
    values (_d.owner_id, coalesce(nullif(d ->> 'atividade', ''), _d.title), dt,
            round(private.try_num(d ->> 'duracao_min'))::int, round(private.try_num(d ->> 'series'))::int,
            round(private.try_num(d ->> 'repeticoes'))::int, private.try_num(d ->> 'carga_kg'),
            private.try_num(d ->> 'distancia_km'), _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'nutricao' then
    insert into public.food_logs (owner_id, kind, meal, items, water_ml, logged_on, logged_time, source_draft_id)
    values (_d.owner_id, case when _d.kind = 'agua' then 'agua' else 'refeicao' end,
            coalesce(d ->> 'refeicao', case when _d.kind = 'agua' then null else _d.title end),
            private.json_text_array(d -> 'alimentos'),
            round(private.try_num(d ->> 'quantidade_ml'))::int, dt, private.try_time(d ->> 'horario'), _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'saude' and _d.kind = 'medicamento' then
    insert into public.medications (owner_id, name, dose, frequency, started_on, source_draft_id)
    values (_d.owner_id, coalesce(nullif(d ->> 'medicamento', ''), nullif(d ->> 'descricao', ''), _d.title),
            d ->> 'dose', d ->> 'frequencia', dt, _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'saude' and _d.kind = 'consulta' then
    insert into public.consultations (owner_id, consulted_on, specialty, professional_name, location, summary, source_draft_id)
    values (_d.owner_id, dt, coalesce(nullif(d ->> 'especialidade', ''), 'Não informada'),
            d ->> 'profissional', d ->> 'local', coalesce(nullif(d ->> 'descricao', ''), _d.title), _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'saude' and _d.kind in ('sintoma', 'exame') then
    insert into public.health_entries (owner_id, kind, description, intensity, medication, dose, occurred_on, occurred_time, source_draft_id)
    values (_d.owner_id, _d.kind, coalesce(nullif(d ->> 'descricao', ''), _d.title),
            least(10, greatest(0, round(private.try_num(d ->> 'intensidade'))))::int,
            d ->> 'medicamento', d ->> 'dose', dt, private.try_time(d ->> 'horario'), _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'psicanalise' and _d.kind in ('sonho', 'insight') then
    insert into public.psy_entries (owner_id, kind, content, emotions, occurred_on, source_draft_id)
    values (_d.owner_id, _d.kind, coalesce(nullif(d ->> 'relato', ''), _d.title),
            private.json_text_array(d -> 'emocoes'), dt, _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'ciclo' and _d.kind in ('menstruacao', 'sintoma_ciclo') then
    insert into public.cycle_entries (owner_id, kind, started_on, flow, symptoms, intensity, source_draft_id)
    values (_d.owner_id, _d.kind, dt,
            case lower(coalesce(d ->> 'fluxo', '')) when 'leve' then 'leve' when 'moderado' then 'moderado'
                 when 'intenso' then 'intenso' else null end,
            private.json_text_array(d -> 'sintomas'),
            least(10, greatest(0, round(private.try_num(d ->> 'intensidade'))))::int, _d.id)
    on conflict (source_draft_id) do nothing;

  elsif _d.module_key = 'memorias' then
    insert into public.memory_entries (owner_id, kind, content, tags, occurred_on, source_draft_id)
    values (_d.owner_id,
            case when _d.kind in ('nota', 'ideia', 'acontecimento') then _d.kind else 'nota' end,
            coalesce(nullif(d ->> 'texto', ''), _d.title), private.json_text_array(d -> 'tags'), dt, _d.id)
    on conflict (source_draft_id) do nothing;
  end if;
end $$;
revoke execute on function private.promote_draft from public, anon;
