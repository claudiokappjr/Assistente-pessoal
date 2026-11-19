-- =====================================================================
-- Módulos v1: tabelas próprias para cada módulo pessoal.
-- Regras de acesso iguais em todos:
--   * dono: lê, cria, edita e apaga os próprios registros;
--   * profissional: só lê, e só com vínculo ativo + consentimento vigente
--     para aquele módulo (private.has_consent);
--   * administrador: nenhum acesso ao conteúdo.
-- Rascunho confirmado na caixa de entrada vira registro no módulo
-- automaticamente (gatilho private.promote_draft).
-- =====================================================================

-- Conversões tolerantes (texto vindo da IA pode ter formato inesperado).
create or replace function private.try_date(_v text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if _v is null or _v = '' then return null; end if;
  if _v ~ '^\d{2}/\d{2}/\d{4}$' then return to_date(_v, 'DD/MM/YYYY'); end if;
  return _v::date;
exception when others then return null;
end $$;

create or replace function private.try_time(_v text)
returns time language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  if _v is null or _v = '' then return null; end if;
  m := regexp_match(lower(trim(_v)), '^(\d{1,2})\s*h\s*(\d{2})?$');  -- 14h, 14h30
  if m is not null then return make_time(m[1]::int, coalesce(m[2], '0')::int, 0); end if;
  return _v::time;
exception when others then return null;
end $$;

create or replace function private.try_num(_v text)
returns numeric language plpgsql immutable set search_path = '' as $$
begin
  if _v is null or _v = '' then return null; end if;
  return replace(regexp_replace(_v, '[^0-9,.-]', '', 'g'), ',', '.')::numeric;
exception when others then return null;
end $$;

create or replace function private.json_text_array(_v jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select case
    when _v is null or _v = 'null'::jsonb then null
    when jsonb_typeof(_v) = 'array' then array(select jsonb_array_elements_text(_v))
    else string_to_array(_v #>> '{}', ',')
  end;
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('despesa', 'receita')),
  status text not null default 'realizado' check (status in ('realizado', 'previsto')),
  amount_cents bigint not null check (amount_cents >= 0),
  occurred_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  due_on date,
  description text not null,
  category text,
  payment_method text,
  installments int check (installments > 0),
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index finance_transactions_owner_idx on public.finance_transactions(owner_id, occurred_on desc);

create table public.agenda_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'compromisso' check (kind in ('compromisso', 'lembrete')),
  title text not null,
  starts_at timestamptz not null,
  duration_min int check (duration_min > 0),
  location text,
  with_whom text,
  done boolean not null default false,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agenda_events_owner_idx on public.agenda_events(owner_id, starts_at);

create table public.exercise_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  activity text not null,
  performed_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  duration_min int check (duration_min >= 0),
  sets int, reps int,
  load_kg numeric(7, 2),
  distance_km numeric(7, 2),
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exercise_logs_owner_idx on public.exercise_logs(owner_id, performed_on desc);

create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'refeicao' check (kind in ('refeicao', 'agua')),
  meal text,
  items text[],
  water_ml int check (water_ml >= 0),
  logged_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  logged_time time,
  is_estimate boolean not null default true,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_logs_owner_idx on public.food_logs(owner_id, logged_on desc);

create table public.health_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sintoma', 'medicamento', 'consulta', 'exame')),
  description text not null,
  intensity int check (intensity between 0 and 10),
  medication text,
  dose text,
  occurred_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  occurred_time time,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index health_entries_owner_idx on public.health_entries(owner_id, occurred_on desc);

create table public.psy_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('sonho', 'insight')),
  content text not null,
  emotions text[],
  occurred_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index psy_entries_owner_idx on public.psy_entries(owner_id, occurred_on desc);

create table public.cycle_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('menstruacao', 'sintoma_ciclo')),
  started_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  ended_on date,
  flow text check (flow in ('leve', 'moderado', 'intenso')),
  symptoms text[],
  intensity int check (intensity between 0 and 10),
  notes text,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);
create index cycle_entries_owner_idx on public.cycle_entries(owner_id, started_on desc);

create table public.memory_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null default 'nota' check (kind in ('nota', 'ideia', 'acontecimento')),
  content text not null,
  tags text[],
  occurred_on date not null default (now() at time zone 'America/Sao_Paulo')::date,
  pinned boolean not null default false,
  source_draft_id uuid unique references public.assistant_drafts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memory_entries_owner_idx on public.memory_entries(owner_id, occurred_on desc);

-- ---------------------------------------------------------------------
-- updated_at, RLS e políticas padronizadas
-- ---------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select * from (values
    ('finance_transactions', 'financas'),
    ('agenda_events', 'agenda'),
    ('exercise_logs', 'exercicios'),
    ('food_logs', 'nutricao'),
    ('health_entries', 'saude'),
    ('psy_entries', 'psicanalise'),
    ('cycle_entries', 'ciclo'),
    ('memory_entries', 'memorias')
  ) as x(tbl, module) loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t.tbl || '_updated_at', t.tbl);
    execute format('alter table public.%I enable row level security', t.tbl);
    execute format('revoke all on public.%I from anon', t.tbl);
    execute format($p$create policy "dono e profissional autorizado leem" on public.%I for select to authenticated
      using (owner_id = (select auth.uid()) or private.has_consent(owner_id, %L))$p$, t.tbl, t.module);
    execute format($p$create policy "dono cria" on public.%I for insert to authenticated
      with check (owner_id = (select auth.uid()))$p$, t.tbl);
    execute format($p$create policy "dono edita" on public.%I for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))$p$, t.tbl);
    execute format($p$create policy "dono apaga" on public.%I for delete to authenticated
      using (owner_id = (select auth.uid()))$p$, t.tbl);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Rascunho confirmado -> registro no módulo
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

  elsif _d.module_key = 'saude' and _d.kind in ('sintoma', 'medicamento', 'consulta', 'exame') then
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

create or replace function private.on_draft_confirmed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    perform private.promote_draft(new);
  end if;
  return new;
end $$;
create trigger promote_on_confirm after update on public.assistant_drafts
  for each row execute function private.on_draft_confirmed();

revoke execute on function private.try_date, private.try_time, private.try_num, private.json_text_array,
  private.promote_draft, private.on_draft_confirmed from public, anon;

-- Leva para os módulos o que já tinha sido confirmado antes desta versão.
select private.promote_draft(d) from public.assistant_drafts d where d.status = 'confirmed';
