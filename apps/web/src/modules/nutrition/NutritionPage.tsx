import {
  Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Copy, MessageCircle, Pencil, Plus,
  ShoppingCart, Sparkles, Trash2, UtensilsCrossed, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { MODULES, todayISO } from '../config'
import { ModulePage } from '../ModulePage'

// ------------------------------------------------------------------ tipos e rótulos
export type MealType = 'cafe' | 'lanche' | 'almoco' | 'jantar'
export const MEALS: { key: MealType; label: string }[] = [
  { key: 'cafe', label: 'Café da manhã' }, { key: 'lanche', label: 'Lanche' },
  { key: 'almoco', label: 'Almoço' }, { key: 'jantar', label: 'Janta' },
]
const MEAL_LABEL = Object.fromEntries(MEALS.map((m) => [m.key, m.label])) as Record<MealType, string>
const UNITS: { key: string; label: string }[] = [
  { key: 'unid', label: 'unid.' }, { key: 'g', label: 'g' }, { key: 'kg', label: 'kg' }, { key: 'ml', label: 'ml' },
  { key: 'l', label: 'L' }, { key: 'colher_sopa', label: 'colher (sopa)' }, { key: 'colher_cha', label: 'colher (chá)' },
  { key: 'xicara', label: 'xícara' }, { key: 'pitada', label: 'pitada' }, { key: 'a_gosto', label: 'a gosto' },
]
const UNIT_LABEL = Object.fromEntries(UNITS.map((u) => [u.key, u.label])) as Record<string, string>

interface Ingredient { id?: string; name: string; quantity: number | null; unit: string | null; position: number }
interface Recipe {
  id: string; owner_id: string; title: string; meal_types: MealType[]; servings: number; prep_minutes: number | null
  instructions: string | null; notes: string | null; recipe_ingredients: Ingredient[]
}
interface PlanItem { id: string; plan_date: string; meal_type: MealType; recipe_id: string; servings: number; logged_food_id: string | null }

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, '').replace('.', ','))
const parseNum = (s: string) => { const n = Number(String(s).replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null }

// ------------------------------------------------------------------ datas (fuso de São Paulo)
const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const mondayOf = (iso: string) => { const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); return addDays(iso, dow === 0 ? -6 : 1 - dow) }
const dayName = (iso: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
const shortDate = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/')

// ------------------------------------------------------------------ dados
function useNutrition(owner: string) {
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const loadRecipes = useCallback(async () => {
    const { data } = await supabase.from('recipes').select('*, recipe_ingredients(*)').eq('owner_id', owner).order('title')
    setRecipes(((data ?? []) as Recipe[]).map((r) => ({ ...r, recipe_ingredients: [...r.recipe_ingredients].sort((a, b) => a.position - b.position) })))
  }, [owner])
  useEffect(() => { void loadRecipes() }, [loadRecipes])
  return { recipes, loadRecipes }
}

// ------------------------------------------------------------------ formulário de receita
function RecipeForm({ initial, onClose, onSaved }: { initial: Recipe | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [meals, setMeals] = useState<MealType[]>(initial?.meal_types ?? [])
  const [servings, setServings] = useState(String(initial?.servings ?? 1).replace('.', ','))
  const [prep, setPrep] = useState(initial?.prep_minutes != null ? String(initial.prep_minutes) : '')
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [rows, setRows] = useState<{ name: string; quantity: string; unit: string }[]>(
    initial?.recipe_ingredients.length
      ? initial.recipe_ingredients.map((i) => ({ name: i.name, quantity: i.quantity != null ? fmtNum(Number(i.quantity)) : '', unit: i.unit ?? 'unid' }))
      : [{ name: '', quantity: '', unit: 'unid' }],
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const setRow = (i: number, k: 'name' | 'quantity' | 'unit', v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Dê um nome para a receita.')
    if (!meals.length) return setError('Escolha pelo menos uma refeição (café, lanche, almoço ou janta).')
    const srv = parseNum(servings)
    if (!srv) return setError('Informe quantas porções a receita rende.')
    const ingredients = rows.filter((r) => r.name.trim()).map((r, i) => ({
      name: r.name.trim(), unit: r.unit, position: i,
      quantity: r.unit === 'a_gosto' ? null : parseNum(r.quantity),
    }))
    if (!ingredients.length) return setError('Adicione pelo menos um ingrediente.')
    setBusy(true); setError('')
    const payload = { title: title.trim(), meal_types: meals, servings: srv, prep_minutes: prep ? Number(prep) : null, instructions: instructions.trim() || null }
    let recipeId = initial?.id
    if (recipeId) {
      const { error } = await supabase.from('recipes').update(payload).eq('id', recipeId)
      if (error) { setBusy(false); return setError(errorMessage(error)) }
      const { error: delErr } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
      if (delErr) { setBusy(false); return setError(errorMessage(delErr)) }
    } else {
      const { data, error } = await supabase.from('recipes').insert(payload).select('id').single()
      if (error) { setBusy(false); return setError(errorMessage(error)) }
      recipeId = data.id
    }
    const { error: insErr } = await supabase.from('recipe_ingredients').insert(ingredients.map((i) => ({ ...i, recipe_id: recipeId })))
    setBusy(false)
    if (insErr) return setError(errorMessage(insErr))
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? 'Editar receita' : 'Nova receita'}</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="label" htmlFor="rt">Nome da receita</label><input id="rt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Omelete de legumes" /></div>
          <div>
            <span className="label">Serve para</span>
            <div className="flex flex-wrap gap-2">
              {MEALS.map((m) => {
                const on = meals.includes(m.key)
                return (
                  <button type="button" key={m.key} onClick={() => setMeals((x) => (on ? x.filter((k) => k !== m.key) : [...x, m.key]))}
                    className={`badge border !px-3 !py-1.5 ${on ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>{m.label}</button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label" htmlFor="rs">Rende (porções)</label><input id="rs" className="input" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} /></div>
            <div><label className="label" htmlFor="rp">Preparo (min)</label><input id="rp" className="input" inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value.replace(/\D/g, ''))} /></div>
          </div>
          <div>
            <span className="label">Ingredientes</span>
            <div className="space-y-2">
              {rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[72px_110px_1fr_auto] gap-1.5">
                  <input className="input !px-2" inputMode="decimal" placeholder="Qtd" value={r.quantity} disabled={r.unit === 'a_gosto'} onChange={(e) => setRow(i, 'quantity', e.target.value)} aria-label="Quantidade" />
                  <select className="input !px-2" value={r.unit} onChange={(e) => setRow(i, 'unit', e.target.value)} aria-label="Unidade">
                    {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                  </select>
                  <input className="input !px-2" placeholder="Ingrediente" value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} aria-label="Ingrediente" />
                  <button type="button" className="btn-ghost !p-2 text-stone-400" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Remover ingrediente"><X className="size-4" /></button>
                </div>
              ))}
            </div>
            <button type="button" className="btn-ghost mt-2 !px-2 text-sm" onClick={() => setRows((x) => [...x, { name: '', quantity: '', unit: 'unid' }])}><Plus className="size-4" /> Ingrediente</button>
          </div>
          <div><label className="label" htmlFor="ri">Modo de preparo</label><textarea id="ri" rows={4} className="input" value={instructions} onChange={(e) => setInstructions(e.target.value)} /></div>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} Salvar receita</button>
            <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ------------------------------------------------------------------ aba Receitas
function RecipesTab({ recipes, reload, readOnly }: { recipes: Recipe[]; reload: () => void; readOnly: boolean }) {
  const [filter, setFilter] = useState<MealType | 'todas'>('todas')
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Recipe | 'new' | null>(null)
  const [error, setError] = useState('')
  const shown = recipes.filter((r) => filter === 'todas' || r.meal_types.includes(filter))

  async function remove(r: Recipe) {
    if (!confirm(`Excluir a receita "${r.title}"? Ela também sai do cardápio.`)) return
    const { error } = await supabase.from('recipes').delete().eq('id', r.id)
    if (error) return setError(errorMessage(error))
    reload()
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {([['todas', 'Todas'], ...MEALS.map((m) => [m.key, m.label])] as [string, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k as MealType | 'todas')} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === k ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800'}`}>{l}</button>
          ))}
        </div>
        {!readOnly && <button className="btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" /> Nova receita</button>}
      </div>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {shown.length === 0 && (
        <EmptyState icon={ChefHat} title={recipes.length ? 'Nenhuma receita nesta refeição' : 'Nenhuma receita ainda'}>
          {readOnly ? 'O cliente ainda não cadastrou receitas.' : 'Cadastre suas receitas com ingredientes e porções. Depois é só montar a semana.'}
        </EmptyState>
      )}
      <div className="space-y-2">
        {shown.map((r) => {
          const isOpen = open === r.id
          return (
            <div key={r.id} className="card !p-0">
              <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(isOpen ? null : r.id)}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-stone-500">
                    {r.meal_types.map((m) => MEAL_LABEL[m]).join(' · ')} · rende {fmtNum(Number(r.servings))} porç{Number(r.servings) === 1 ? 'ão' : 'ões'}
                    {r.prep_minutes ? ` · ${r.prep_minutes} min` : ''} · {r.recipe_ingredients.length} ingrediente(s)
                  </div>
                </div>
                <ChevronDown className={`size-4 shrink-0 text-stone-400 transition ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="border-t border-stone-100 px-4 py-3 text-sm dark:border-stone-800">
                  <ul className="space-y-1">
                    {r.recipe_ingredients.map((i, k) => (
                      <li key={k} className="flex gap-2"><span className="w-28 shrink-0 text-stone-500">{i.quantity != null ? `${fmtNum(Number(i.quantity))} ${UNIT_LABEL[i.unit ?? ''] ?? ''}` : UNIT_LABEL[i.unit ?? ''] ?? ''}</span><span>{i.name}</span></li>
                    ))}
                  </ul>
                  {r.instructions && <p className="mt-3 whitespace-pre-wrap text-stone-600 dark:text-stone-300">{r.instructions}</p>}
                  {!readOnly && (
                    <div className="mt-3 flex gap-2">
                      <button className="btn-outline !px-3 !py-1.5" onClick={() => setEditing(r)}><Pencil className="size-4" /> Editar</button>
                      <button className="btn-danger !px-3 !py-1.5" onClick={() => void remove(r)}><Trash2 className="size-4" /> Excluir</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {editing && <RecipeForm initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

// ------------------------------------------------------------------ cardápio da semana (compartilhado entre abas)
function useWeek(owner: string) {
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayISO()))
  const [items, setItems] = useState<PlanItem[] | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('meal_plan_items').select('*').eq('owner_id', owner)
      .gte('plan_date', weekStart).lte('plan_date', addDays(weekStart, 6)).order('created_at')
    setItems((data ?? []) as PlanItem[])
  }, [owner, weekStart])
  useEffect(() => { setItems(null); void load() }, [load])
  return { weekStart, setWeekStart, items, reload: load }
}

function WeekNav({ weekStart, setWeekStart }: { weekStart: string; setWeekStart: (s: string) => void }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <button className="btn-ghost !p-2" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Semana anterior"><ChevronLeft className="size-5" /></button>
      <div className="text-center">
        <div className="font-medium">Semana de {shortDate(weekStart)} a {shortDate(addDays(weekStart, 6))}</div>
        {weekStart !== mondayOf(todayISO()) && <button className="text-xs text-brand-700 underline dark:text-brand-300" onClick={() => setWeekStart(mondayOf(todayISO()))}>voltar para esta semana</button>}
      </div>
      <button className="btn-ghost !p-2" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Próxima semana"><ChevronRight className="size-5" /></button>
    </div>
  )
}

function AddToPlan({ date, meal, recipes, onAdded, onCancel }: { date: string; meal: MealType; recipes: Recipe[]; onAdded: () => void; onCancel: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const options = recipes.filter((r) => showAll || r.meal_types.includes(meal))
  const [recipeId, setRecipeId] = useState(options[0]?.id ?? '')
  const [servings, setServings] = useState('1')
  const [error, setError] = useState('')
  useEffect(() => { if (!options.some((o) => o.id === recipeId)) setRecipeId(options[0]?.id ?? '') }, [options, recipeId])

  async function add() {
    const srv = parseNum(servings)
    if (!recipeId || !srv) return setError('Escolha a receita e as porções.')
    const { error } = await supabase.from('meal_plan_items').insert({ plan_date: date, meal_type: meal, recipe_id: recipeId, servings: srv })
    if (error) return setError(errorMessage(error))
    onAdded()
  }

  return (
    <div className="mt-2 rounded-xl border border-stone-200 bg-sand-100 p-2.5 dark:border-stone-700 dark:bg-stone-800/50">
      {options.length === 0 ? (
        <p className="text-sm text-stone-500">Nenhuma receita marcada para {MEAL_LABEL[meal].toLowerCase()}. <button className="underline" onClick={() => setShowAll(true)}>Ver todas</button></p>
      ) : (
        <div className="grid grid-cols-[1fr_70px] gap-1.5">
          <select className="input !py-2" value={recipeId} onChange={(e) => setRecipeId(e.target.value)} aria-label="Receita">
            {options.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <input className="input !px-2 !py-2" inputMode="decimal" value={servings} onChange={(e) => setServings(e.target.value)} aria-label="Porções" title="Porções" />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button className="btn-primary !px-3 !py-1.5 text-sm" disabled={!options.length} onClick={() => void add()}><Plus className="size-4" /> Adicionar</button>
        <button className="btn-ghost !px-3 !py-1.5 text-sm" onClick={onCancel}>Cancelar</button>
        {!showAll && options.length > 0 && <button className="ml-auto text-xs text-stone-500 underline" onClick={() => setShowAll(true)}>todas as receitas</button>}
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  )
}

function WeekTab({ recipes, week, readOnly }: { recipes: Recipe[]; week: ReturnType<typeof useWeek>; readOnly: boolean }) {
  const { weekStart, setWeekStart, items, reload } = week
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState('')
  const byId = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes])
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = todayISO()

  async function remove(id: string) {
    const { error } = await supabase.from('meal_plan_items').delete().eq('id', id)
    if (error) return setError(errorMessage(error))
    void reload()
  }
  // Marca como consumido: cria o registro em Nutrição a partir da receita.
  async function logMeal(it: PlanItem) {
    const r = byId[it.recipe_id]
    if (!r) return
    const { data, error } = await supabase.from('food_logs').insert({
      kind: 'refeicao', meal: MEAL_LABEL[it.meal_type], items: [r.title, ...r.recipe_ingredients.map((i) => i.name)],
      logged_on: it.plan_date, notes: `Do cardápio: ${r.title} (${fmtNum(Number(it.servings))} porção/ões)`,
    }).select('id').single()
    if (error) return setError(errorMessage(error))
    await supabase.from('meal_plan_items').update({ logged_food_id: data.id }).eq('id', it.id)
    void reload()
  }

  return (
    <div>
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {!readOnly && recipes.length === 0 && <div className="mb-4"><Alert kind="info">Cadastre receitas na aba Receitas para montar o cardápio.</Alert></div>}
      {items === null ? <Spinner className="size-6" /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {days.map((d) => (
            <section key={d} className={`card !p-4 ${d === today ? '!border-brand-300 dark:!border-brand-800' : ''}`}>
              <h3 className="mb-2 font-medium capitalize">{dayName(d)}{d === today && <span className="badge ml-2 bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200">hoje</span>}</h3>
              <div className="space-y-2.5">
                {MEALS.map((m) => {
                  const slot = items.filter((it) => it.plan_date === d && it.meal_type === m.key)
                  const key = `${d}|${m.key}`
                  return (
                    <div key={m.key}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{m.label}</span>
                        {!readOnly && recipes.length > 0 && adding !== key && (
                          <button className="btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => setAdding(key)}><Plus className="size-3.5" /> receita</button>
                        )}
                      </div>
                      {slot.length === 0 && adding !== key && <div className="text-sm text-stone-400">—</div>}
                      {slot.map((it) => (
                        <div key={it.id} className="mt-1 flex items-center gap-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{byId[it.recipe_id]?.title ?? 'Receita removida'} <span className="text-stone-400">· {fmtNum(Number(it.servings))} porç.</span></span>
                          {it.logged_food_id
                            ? <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200"><Check className="size-3" /> comido</span>
                            : !readOnly && d <= today && <button className="btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => void logMeal(it)} title="Registrar que comeu"><Check className="size-3.5" /> comi</button>}
                          {!readOnly && <button className="btn-ghost !p-1 text-stone-400 hover:text-red-600" onClick={() => void remove(it.id)} aria-label="Tirar do cardápio"><X className="size-3.5" /></button>}
                        </div>
                      ))}
                      {adding === key && <AddToPlan date={d} meal={m.key} recipes={recipes} onCancel={() => setAdding(null)} onAdded={() => { setAdding(null); void reload() }} />}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ lista de compras
interface ShopItem { key: string; name: string; quantity: number | null; unit: string | null; recipes: string[] }

/** Soma os ingredientes do cardápio da semana, ajustando pelas porções. */
function buildShoppingList(items: PlanItem[], recipes: Record<string, Recipe>): ShopItem[] {
  const map = new Map<string, ShopItem>()
  for (const it of items) {
    const r = recipes[it.recipe_id]
    if (!r) continue
    const factor = Number(it.servings) / Number(r.servings || 1)
    for (const ing of r.recipe_ingredients) {
      let unit = ing.unit
      let qty = ing.quantity != null ? Number(ing.quantity) * factor : null
      if (unit === 'kg' && qty != null) { unit = 'g'; qty *= 1000 }
      if (unit === 'l' && qty != null) { unit = 'ml'; qty *= 1000 }
      const noQty = qty == null || unit === 'a_gosto' || unit === 'pitada'
      const norm = ing.name.trim().toLowerCase()
      const key = `${norm}|${noQty ? 'avulso' : unit}`
      const cur = map.get(key)
      if (cur) {
        if (!noQty && qty != null) cur.quantity = (cur.quantity ?? 0) + qty
        if (!cur.recipes.includes(r.title)) cur.recipes.push(r.title)
      } else {
        map.set(key, { key, name: ing.name.trim(), quantity: noQty ? null : qty, unit: noQty ? (unit === 'pitada' ? 'a_gosto' : unit) : unit, recipes: [r.title] })
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

function qtyLabel(i: ShopItem) {
  if (i.quantity == null) return 'a gosto'
  if (i.unit === 'g' && i.quantity >= 1000) return `${fmtNum(i.quantity / 1000)} kg`
  if (i.unit === 'ml' && i.quantity >= 1000) return `${fmtNum(i.quantity / 1000)} L`
  if (i.unit === 'unid') return `${fmtNum(Math.ceil(i.quantity * 10) / 10)} unid.`
  return `${fmtNum(i.quantity)} ${UNIT_LABEL[i.unit ?? ''] ?? ''}`.trim()
}

function ShoppingTab({ recipes, week, owner, readOnly }: { recipes: Recipe[]; week: ReturnType<typeof useWeek>; owner: string; readOnly: boolean }) {
  const { weekStart, setWeekStart, items } = week
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [copied, setCopied] = useState(false)
  const byId = useMemo(() => Object.fromEntries(recipes.map((r) => [r.id, r])), [recipes])
  const list = useMemo(() => buildShoppingList(items ?? [], byId), [items, byId])

  useEffect(() => {
    supabase.from('shopping_checks').select('item_key').eq('owner_id', owner).eq('week_start', weekStart)
      .then(({ data }) => setChecked(new Set((data ?? []).map((x) => x.item_key))))
  }, [owner, weekStart])

  async function toggle(key: string) {
    if (readOnly) return
    const on = checked.has(key)
    setChecked((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n })
    if (on) await supabase.from('shopping_checks').delete().eq('owner_id', owner).eq('week_start', weekStart).eq('item_key', key)
    else await supabase.from('shopping_checks').insert({ week_start: weekStart, item_key: key })
  }

  const pending = list.filter((i) => !checked.has(i.key))
  const done = list.filter((i) => checked.has(i.key))
  const text = `Lista de compras — semana de ${shortDate(weekStart)} a ${shortDate(addDays(weekStart, 6))}\n` + pending.map((i) => `• ${i.name}: ${qtyLabel(i)}`).join('\n')

  return (
    <div>
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
      {items === null ? <Spinner className="size-6" /> : list.length === 0 ? (
        <EmptyState icon={ShoppingCart} title="Lista vazia">A lista é montada automaticamente com as receitas do cardápio desta semana.</EmptyState>
      ) : (
        <>
          {!readOnly && pending.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              <a className="btn-primary" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> Enviar por WhatsApp</a>
              <button className="btn-outline" onClick={() => { void navigator.clipboard.writeText(text); setCopied(true) }}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copiada' : 'Copiar lista'}</button>
            </div>
          )}
          <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
            {[...pending, ...done].map((i) => {
              const on = checked.has(i.key)
              return (
                <li key={i.key}>
                  <label className={`flex items-center gap-3 px-4 py-3 ${readOnly ? '' : 'cursor-pointer'}`}>
                    <input type="checkbox" className="size-5 accent-brand-700" checked={on} disabled={readOnly} onChange={() => void toggle(i.key)} />
                    <div className={`min-w-0 flex-1 ${on ? 'text-stone-400 line-through' : ''}`}>
                      <div className="font-medium">{i.name}</div>
                      <div className="truncate text-xs text-stone-500">{i.recipes.join(', ')}</div>
                    </div>
                    <span className={`shrink-0 tabular-nums ${on ? 'text-stone-400' : 'font-medium'}`}>{qtyLabel(i)}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="mt-3 text-xs text-stone-500">{pending.length} item(ns) para comprar. Quantidades somadas pelas porções do cardápio; confira o que você já tem em casa.</p>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ página
type Tab = 'registros' | 'receitas' | 'semana' | 'compras'
const TABS: { key: Tab; label: string; icon: typeof ChefHat }[] = [
  { key: 'registros', label: 'Registros', icon: ClipboardList },
  { key: 'receitas', label: 'Receitas', icon: ChefHat },
  { key: 'semana', label: 'Semana', icon: UtensilsCrossed },
  { key: 'compras', label: 'Compras', icon: ShoppingCart },
]

export function NutritionPage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean }) {
  const { session } = useAuth()
  const owner = ownerId ?? session!.user.id
  const readOnly = owner !== session?.user.id
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('aba') as Tab) || 'registros')
  const { recipes, loadRecipes } = useNutrition(owner)
  const week = useWeek(owner)

  return (
    <div>
      {!embedded && (
        <PageHeader title="Nutrição" subtitle="Refeições, receitas, cardápio da semana e lista de compras."
          actions={!readOnly && <Link to="/app/assistente" className="btn-outline"><Sparkles className="size-4" /> Pelo assistente</Link>} />
      )}
      <div className="mb-5 grid grid-cols-4 gap-1 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium transition sm:flex-row sm:justify-center sm:gap-1.5 sm:text-sm ${tab === t.key ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50' : 'text-stone-600 dark:text-stone-400'}`}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'registros' && <ModulePage config={MODULES.nutricao} ownerId={ownerId} embedded />}
      {tab !== 'registros' && recipes === null && <Spinner className="size-6" />}
      {tab === 'receitas' && recipes && <RecipesTab recipes={recipes} reload={() => void loadRecipes()} readOnly={readOnly} />}
      {tab === 'semana' && recipes && <WeekTab recipes={recipes} week={week} readOnly={readOnly} />}
      {tab === 'compras' && recipes && <ShoppingTab recipes={recipes} week={week} owner={owner} readOnly={readOnly} />}
    </div>
  )
}
