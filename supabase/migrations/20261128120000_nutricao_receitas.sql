-- =====================================================================
-- Nutrição: receitas, cardápio da semana e lista de compras.
-- Mesma regra dos módulos: dono faz tudo; nutricionista com plano +
-- consentimento do módulo 'nutricao' apenas lê; admin sem acesso.
-- =====================================================================

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  meal_types text[] not null default '{}' check (meal_types <@ array['cafe', 'lanche', 'almoco', 'jantar']),
  servings numeric(6, 2) not null default 1 check (servings > 0),
  prep_minutes int check (prep_minutes >= 0),
  instructions text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_owner_idx on public.recipes(owner_id, title);

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position int not null default 0,
  name text not null check (length(trim(name)) > 0),
  quantity numeric(10, 3) check (quantity > 0),
  unit text check (unit in ('g', 'kg', 'ml', 'l', 'unid', 'colher_sopa', 'colher_cha', 'xicara', 'pitada', 'a_gosto')),
  created_at timestamptz not null default now()
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients(recipe_id, position);
create index recipe_ingredients_owner_idx on public.recipe_ingredients(owner_id);

create table public.meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_date date not null,
  meal_type text not null check (meal_type in ('cafe', 'lanche', 'almoco', 'jantar')),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  servings numeric(6, 2) not null default 1 check (servings > 0),
  logged_food_id uuid references public.food_logs(id) on delete set null,
  created_at timestamptz not null default now()
);
create index meal_plan_items_owner_idx on public.meal_plan_items(owner_id, plan_date);
create index meal_plan_items_recipe_idx on public.meal_plan_items(recipe_id);

-- Itens marcados na lista de compras de cada semana (a lista em si é
-- calculada a partir do cardápio).
create table public.shopping_checks (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  item_key text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, week_start, item_key)
);

-- Ingrediente e item do cardápio devem pertencer ao dono da receita.
create or replace function private.guard_recipe_child()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.owner_id = new.owner_id) then
    raise exception 'Receita não encontrada';
  end if;
  return new;
end $$;
create trigger guard_recipe_ingredient before insert or update on public.recipe_ingredients
  for each row execute function private.guard_recipe_child();
create trigger guard_meal_plan_item before insert or update on public.meal_plan_items
  for each row execute function private.guard_recipe_child();
revoke execute on function private.guard_recipe_child from public, anon;

create trigger recipes_updated_at before update on public.recipes
  for each row execute function private.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['recipes', 'recipe_ingredients', 'meal_plan_items', 'shopping_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format($p$create policy "dono e nutricionista autorizado leem" on public.%I for select to authenticated
      using (owner_id = (select auth.uid()) or private.has_consent(owner_id, 'nutricao'))$p$, t);
    execute format($p$create policy "dono cria" on public.%I for insert to authenticated
      with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono edita" on public.%I for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono apaga" on public.%I for delete to authenticated
      using (owner_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
