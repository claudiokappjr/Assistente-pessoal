-- Psicologia e Psicanálise: sonhos com motivos (temas) e interpretação.
-- Escalas clínicas de rastreio (GAD-7, PHQ-9, WHO-5, AUDIT-C, FINDRISC, EVA de dor):
-- o paciente responde sozinho, o profissional libera um pedido ou aplica junto.
-- A pontuação é calculada no banco (não dá para gravar um resultado "inventado").

update public.modules set name = 'Psicologia e Psicanálise', description = 'Sonhos, escalas, insights e sessões'
 where key = 'psicanalise';

alter table public.psy_entries
  add column themes text[] not null default '{}',
  add column interpretation text;
create index psy_entries_themes_idx on public.psy_entries using gin (themes);

-- ---------------------------------------------------------------- catálogo e pontuação
-- Em que módulo cada escala pode ser registrada (define quem pode ver, via consentimento).
create or replace function private.scale_allowed(_key text, _module text)
returns boolean language sql immutable set search_path = '' as $$
  select case _module
    when 'psicanalise' then _key in ('gad7', 'phq9', 'who5')
    when 'saude' then _key in ('gad7', 'phq9', 'who5', 'auditc', 'findrisc', 'eva_dor')
    else false end
$$;

create or replace function private.score_scale(_key text, _a int[], out score int, out severity text, out alert boolean)
language plpgsql immutable set search_path = '' as $$
declare mx int[]; s int; i int;
begin
  alert := false;
  mx := case _key
    when 'gad7' then array_fill(3, array[7])
    when 'phq9' then array_fill(3, array[9])
    when 'who5' then array_fill(5, array[5])
    when 'auditc' then array[4, 4, 4]
    when 'findrisc' then array[4, 3, 4, 2, 1, 2, 5, 5]
    when 'eva_dor' then array[10]
  end;
  if mx is null then raise exception 'Escala desconhecida'; end if;
  if coalesce(array_length(_a, 1), 0) <> array_length(mx, 1) then raise exception 'Responda todas as perguntas'; end if;
  for i in 1 .. array_length(mx, 1) loop
    if _a[i] is null or _a[i] < 0 or _a[i] > mx[i] then raise exception 'Resposta inválida na pergunta %', i; end if;
  end loop;
  select sum(x) into s from unnest(_a) x;

  if _key = 'gad7' then
    score := s; severity := case when s < 5 then 'minimo' when s < 10 then 'leve' when s < 15 then 'moderado' else 'grave' end;
  elsif _key = 'phq9' then
    score := s; severity := case when s < 5 then 'minimo' when s < 10 then 'leve' when s < 15 then 'moderado' when s < 20 then 'moderadamente_grave' else 'grave' end;
    alert := _a[9] > 0;
  elsif _key = 'who5' then
    score := s * 4; severity := case when score <= 28 then 'muito_baixo' when score <= 50 then 'baixo' else 'adequado' end;
  elsif _key = 'auditc' then
    score := s; severity := case when s < 3 then 'baixo' when s = 3 then 'atencao' else 'positivo' end;
  elsif _key = 'findrisc' then
    score := s; severity := case when s < 7 then 'baixo' when s <= 11 then 'levemente_elevado' when s <= 14 then 'moderado' when s <= 20 then 'alto' else 'muito_alto' end;
  elsif _key = 'eva_dor' then
    score := s; severity := case when s = 0 then 'sem_dor' when s <= 3 then 'leve' when s <= 6 then 'moderada' else 'intensa' end;
  end if;
end $$;

-- ---------------------------------------------------------------- pedidos do profissional
create table public.scale_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scale_key text not null,
  module_key text not null references public.modules(key),
  specialty text,
  note text,
  status text not null default 'pendente' check (status in ('pendente', 'respondida', 'cancelada')),
  response_id uuid,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check (private.scale_allowed(scale_key, module_key))
);
create index scale_assignments_owner_idx on public.scale_assignments(owner_id, status, created_at desc);

-- ---------------------------------------------------------------- respostas
create table public.scale_responses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scale_key text not null,
  module_key text not null references public.modules(key),
  answers int[] not null,
  score int not null,
  severity text not null,
  alert boolean not null default false,
  filled_by uuid references auth.users(id) on delete set null,
  filled_role text not null check (filled_role in ('paciente', 'profissional')),
  assignment_id uuid references public.scale_assignments(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  check (private.scale_allowed(scale_key, module_key))
);
create index scale_responses_owner_idx on public.scale_responses(owner_id, scale_key, created_at desc);
alter table public.scale_assignments add constraint scale_assignments_response_fk
  foreign key (response_id) references public.scale_responses(id) on delete set null;

create or replace function private.scale_response_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; a public.scale_assignments;
begin
  select * into r from private.score_scale(new.scale_key, new.answers);
  new.score := r.score; new.severity := r.severity; new.alert := r.alert;
  new.filled_by := coalesce((select auth.uid()), new.filled_by);
  new.filled_role := case when new.filled_by = new.owner_id then 'paciente' else 'profissional' end;
  new.created_at := now();
  if new.assignment_id is not null then
    select * into a from public.scale_assignments where id = new.assignment_id;
    if a.id is null or a.owner_id <> new.owner_id or a.scale_key <> new.scale_key or a.status <> 'pendente' then
      raise exception 'Pedido de escala inválido ou já respondido';
    end if;
    new.module_key := a.module_key;
  end if;
  return new;
end $$;
create trigger scale_response_before before insert on public.scale_responses
  for each row execute function private.scale_response_before();

create or replace function private.scale_response_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignment_id is not null then
    update public.scale_assignments set status = 'respondida', answered_at = now(), response_id = new.id
     where id = new.assignment_id;
  end if;
  return null;
end $$;
create trigger scale_response_after after insert on public.scale_responses
  for each row execute function private.scale_response_after();

-- Profissional só cancela o próprio pedido; nada mais muda por fora.
create or replace function private.guard_scale_assignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then return new; end if; -- servidor ou outro gatilho
  if new.owner_id <> old.owner_id or new.assigned_by <> old.assigned_by or new.scale_key <> old.scale_key
     or new.module_key <> old.module_key or new.response_id is distinct from old.response_id
     or new.answered_at is distinct from old.answered_at or (new.status <> old.status and new.status <> 'cancelada')
     or old.status <> 'pendente' then
    raise exception 'Alteração não permitida';
  end if;
  return new;
end $$;
create trigger guard_scale_assignment before update on public.scale_assignments
  for each row execute function private.guard_scale_assignment();

revoke execute on function private.score_scale, private.scale_response_before, private.scale_response_after,
  private.guard_scale_assignment from public, anon;
grant execute on function private.scale_allowed to authenticated;

-- ---------------------------------------------------------------- acesso
alter table public.scale_assignments enable row level security;
alter table public.scale_responses enable row level security;
revoke all on public.scale_assignments, public.scale_responses from anon;
revoke update on public.scale_responses from authenticated;

create policy "pedidos: paciente e profissional que pediu leem" on public.scale_assignments for select to authenticated
  using (owner_id = (select auth.uid()) or (assigned_by = (select auth.uid()) and private.has_consent(owner_id, module_key)));
create policy "pedidos: profissional autorizado cria" on public.scale_assignments for insert to authenticated
  with check (assigned_by = (select auth.uid()) and owner_id <> (select auth.uid()) and private.has_consent(owner_id, module_key));
create policy "pedidos: profissional cancela o seu" on public.scale_assignments for update to authenticated
  using (assigned_by = (select auth.uid())) with check (assigned_by = (select auth.uid()));

create policy "escalas: dono e profissional autorizado leem" on public.scale_responses for select to authenticated
  using (owner_id = (select auth.uid()) or private.has_consent(owner_id, module_key));
create policy "escalas: dono ou profissional autorizado registram" on public.scale_responses for insert to authenticated
  with check (owner_id = (select auth.uid()) or private.has_consent(owner_id, module_key));
create policy "escalas: dono apaga" on public.scale_responses for delete to authenticated
  using (owner_id = (select auth.uid()));
