-- =====================================================================
-- Compartilhamento de receitas
--  * Link público: share_token na receita (quem tem o link vê; nada mais).
--  * Envio para pessoa vinculada (cliente <-> profissional).
--  * Quem recebe pode salvar uma cópia nas próprias receitas.
-- =====================================================================

alter table public.recipes add column share_token text unique check (share_token is null or length(share_token) >= 20);
alter table public.recipes add column source_note text;

create table public.recipe_shares (
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  shared_with uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (recipe_id, shared_with),
  check (owner_id <> shared_with)
);
create index recipe_shares_with_idx on public.recipe_shares(shared_with, created_at desc);

create or replace function private.recipe_shared_with_me(_recipe uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.recipe_shares where recipe_id = _recipe and shared_with = (select auth.uid()));
$$;

-- Só compartilha receita própria e com quem tem vínculo (cliente/profissional).
create or replace function private.guard_recipe_share()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.recipes where id = new.recipe_id and owner_id = new.owner_id) then
    raise exception 'Receita não encontrada';
  end if;
  if not exists (
    select 1 from public.professional_client_links
     where status in ('invited', 'active')
       and ((professional_id = new.owner_id and client_id = new.shared_with)
         or (client_id = new.owner_id and professional_id = new.shared_with))
  ) then
    raise exception 'Só é possível enviar para seus clientes ou profissionais';
  end if;
  return new;
end $$;
create trigger guard_recipe_share before insert or update on public.recipe_shares
  for each row execute function private.guard_recipe_share();

alter table public.recipe_shares enable row level security;
revoke all on public.recipe_shares from anon;
create policy "envio: autor e destinatario leem" on public.recipe_shares for select to authenticated
  using (owner_id = (select auth.uid()) or shared_with = (select auth.uid()));
create policy "envio: autor cria" on public.recipe_shares for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "envio: autor ou destinatario remove" on public.recipe_shares for delete to authenticated
  using (owner_id = (select auth.uid()) or shared_with = (select auth.uid()));

-- Destinatário enxerga a receita e os ingredientes enviados a ele.
create policy "destinatario le receita enviada" on public.recipes for select to authenticated
  using (private.recipe_shared_with_me(id));
create policy "destinatario le ingredientes enviados" on public.recipe_ingredients for select to authenticated
  using (private.recipe_shared_with_me(recipe_id));

-- Nomes de quem enviou/recebe (perfil mínimo de pessoas vinculadas já é visível por RLS).

-- Página pública: devolve só a receita do link, sem dados do autor.
create or replace function public.get_shared_recipe(_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', r.title, 'meal_types', r.meal_types, 'servings', r.servings, 'prep_minutes', r.prep_minutes,
    'instructions', r.instructions,
    'ingredients', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit', i.unit) order by i.position)
                               from public.recipe_ingredients i where i.recipe_id = r.id), '[]'::jsonb))
    from public.recipes r
   where _token is not null and length(_token) >= 20 and r.share_token = _token;
$$;
revoke execute on function public.get_shared_recipe(text) from public;
grant execute on function public.get_shared_recipe(text) to anon, authenticated;

-- Copia uma receita (enviada a mim ou por link) para as minhas receitas.
create or replace function public.copy_recipe(_recipe_id uuid default null, _token text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare _uid uuid := (select auth.uid()); _src public.recipes; _new uuid;
begin
  if _uid is null then raise exception 'Entre na sua conta para salvar a receita'; end if;
  if _token is not null then
    select * into _src from public.recipes where share_token = _token and length(_token) >= 20;
  else
    select * into _src from public.recipes r
     where r.id = _recipe_id
       and (r.owner_id = _uid or exists (select 1 from public.recipe_shares s where s.recipe_id = r.id and s.shared_with = _uid));
  end if;
  if not found then raise exception 'Receita não encontrada'; end if;

  insert into public.recipes (owner_id, title, meal_types, servings, prep_minutes, instructions, source_note)
  values (_uid, _src.title, _src.meal_types, _src.servings, _src.prep_minutes, _src.instructions,
          case when _src.owner_id = _uid then null else 'Receita compartilhada' end)
  returning id into _new;
  insert into public.recipe_ingredients (recipe_id, owner_id, position, name, quantity, unit)
  select _new, _uid, position, name, quantity, unit from public.recipe_ingredients where recipe_id = _src.id;
  return _new;
end $$;
revoke execute on function public.copy_recipe(uuid, text) from public, anon;
grant execute on function public.copy_recipe(uuid, text) to authenticated;

revoke execute on function private.recipe_shared_with_me, private.guard_recipe_share from public, anon;
grant execute on function private.recipe_shared_with_me to authenticated, service_role;
