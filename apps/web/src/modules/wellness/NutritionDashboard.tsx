import { ChevronDown, ChevronLeft, ChevronRight, Flame, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../config'
import { BarChart, GoalsButton, GoalsModal, MeterBar, Ring, fmtInt, useCountUp, useGoals, useShown } from './charts'

interface FoodItem { name: string; portion: string; grams: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
export interface FoodRow {
  id: string; kind: 'refeicao' | 'agua'; meal: string | null; items: string[] | null; water_ml: number | null; logged_on: string; logged_time: string | null
  kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null
  nutrition_items: FoodItem[] | null; nutrition_status: 'pendente' | 'estimado' | 'manual' | 'falhou' | null
}
interface ExRow { performed_on: string; kcal: number | null }

const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const dayLabel = (iso: string) => {
  const t = todayISO()
  if (iso === t) return 'Hoje'
  if (iso === addDays(t, -1)) return 'Ontem'
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
}
const short = (iso: string) => new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)).replace('.', '')
const n = (v: number | null | undefined) => Number(v ?? 0)

/** Macro em barra empilhada (proteína / carboidrato / gordura), proporcional às calorias de cada um. */
function MacroStack({ p, c, f }: { p: number; c: number; f: number }) {
  const shown = useShown(120)
  const kp = p * 4, kc = c * 4, kf = f * 9, tot = kp + kc + kf || 1
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
      {[[kp, 'bg-sky-500'], [kc, 'bg-amber-400'], [kf, 'bg-rose-400']].map(([v, cls], i) => (
        <div key={i} className={`${cls} h-full transition-[width] duration-700 ease-out`} style={{ width: shown ? `${(Number(v) / tot) * 100}%` : '0%' }} />
      ))}
    </div>
  )
}

function MealCard({ r, readOnly, onRecalc }: { r: FoodRow; readOnly: boolean; onRecalc: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const pending = r.nutrition_status === 'pendente'
  return (
    <li className="card !p-4">
      <button className="flex w-full items-start gap-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium capitalize">{r.meal || 'Refeição'}</span>
            {r.logged_time && <span className="text-xs text-stone-500">{r.logged_time.slice(0, 5)}</span>}
          </div>
          <div className="truncate text-xs text-stone-500">{(r.items ?? []).join(', ')}</div>
        </div>
        <div className="text-right">
          {pending ? <span className="flex items-center gap-1 text-xs text-stone-500"><Spinner className="size-3" /> calculando…</span>
            : r.kcal != null ? <><div className="font-display text-lg font-semibold tabular-nums">{fmtInt(n(r.kcal))}</div><div className="text-[11px] text-stone-500">kcal</div></>
              : <span className="text-xs text-stone-400">sem estimativa</span>}
        </div>
        <ChevronDown className={`mt-1 size-4 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {r.kcal != null && !pending && (
        <div className="mt-3">
          <MacroStack p={n(r.protein_g)} c={n(r.carbs_g)} f={n(r.fat_g)} />
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-stone-500">
            <span><span className="text-sky-600">●</span> Proteína {fmtInt(n(r.protein_g))} g</span>
            <span><span className="text-amber-500">●</span> Carboidrato {fmtInt(n(r.carbs_g))} g</span>
            <span><span className="text-rose-500">●</span> Gordura {fmtInt(n(r.fat_g))} g</span>
            {r.fiber_g != null && <span>Fibras {fmtInt(n(r.fiber_g))} g</span>}
          </div>
        </div>
      )}
      {open && (
        <div className="mt-3 motion-safe:animate-[fadein_.3s_ease-out]">
          {r.nutrition_items?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-stone-500"><th className="py-1 pr-2 font-medium">Alimento</th><th className="pr-2 font-medium">Porção</th><th className="pr-2 text-right font-medium">kcal</th><th className="pr-2 text-right font-medium">P</th><th className="pr-2 text-right font-medium">C</th><th className="text-right font-medium">G</th></tr></thead>
                <tbody>
                  {r.nutrition_items.map((i, k) => (
                    <tr key={k} className="border-t border-stone-100 dark:border-stone-800">
                      <td className="py-1.5 pr-2">{i.name}</td><td className="pr-2 text-stone-500">{i.portion}{i.grams ? ` (${fmtInt(i.grams)} g)` : ''}</td>
                      <td className="pr-2 text-right tabular-nums">{fmtInt(i.kcal)}</td><td className="pr-2 text-right tabular-nums">{fmtInt(i.protein_g)}</td>
                      <td className="pr-2 text-right tabular-nums">{fmtInt(i.carbs_g)}</td><td className="text-right tabular-nums">{fmtInt(i.fat_g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-stone-500">{r.nutrition_status === 'manual' ? 'Valores informados à mão.' : r.nutrition_status === 'falhou' ? 'Não consegui estimar esta refeição.' : 'Sem detalhes por alimento.'}</p>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-stone-400">{r.nutrition_status === 'estimado' ? 'Estimativa da IA (tabela TACO). Edite o registro para corrigir.' : ''}</span>
            {!readOnly && !pending && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => onRecalc(r.id)}><RefreshCw className="size-3.5" /> Recalcular</button>}
          </div>
        </div>
      )}
    </li>
  )
}

/** Painel do dia: calorias x meta, macros, água, saldo com os treinos e semana. */
export function NutritionDashboard({ owner, readOnly, refreshKey }: { owner: string; readOnly: boolean; refreshKey: number }) {
  const [day, setDay] = useState(todayISO())
  const [food, setFood] = useState<FoodRow[] | null>(null)
  const [ex, setEx] = useState<ExRow[]>([])
  const { goals, reload: reloadGoals } = useGoals(owner)
  const [editGoals, setEditGoals] = useState(false)
  const from = addDays(day, -6)

  const load = useCallback(async () => {
    const [{ data: f }, { data: e }] = await Promise.all([
      supabase.from('food_logs').select('id, kind, meal, items, water_ml, logged_on, logged_time, kcal, protein_g, carbs_g, fat_g, fiber_g, nutrition_items, nutrition_status')
        .eq('owner_id', owner).gte('logged_on', from).lte('logged_on', day).order('logged_time', { ascending: true, nullsFirst: true }),
      supabase.from('exercise_logs').select('performed_on, kcal').eq('owner_id', owner).gte('performed_on', from).lte('performed_on', day),
    ])
    setFood((f ?? []) as FoodRow[]); setEx((e ?? []) as ExRow[])
  }, [owner, from, day])
  useEffect(() => { void load() }, [load, refreshKey])
  // Enquanto a IA calcula, atualiza sozinho.
  useEffect(() => {
    if (!food?.some((r) => r.nutrition_status === 'pendente')) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [food, load])

  async function recalc(id: string) {
    setFood((fs) => fs?.map((r) => (r.id === id ? { ...r, nutrition_status: 'pendente' } : r)) ?? null)
    await supabase.functions.invoke('nutrition-estimate', { body: { kind: 'food', id } })
    void load()
  }

  const today = useMemo(() => {
    const meals = (food ?? []).filter((r) => r.logged_on === day && r.kind === 'refeicao')
    const water = (food ?? []).filter((r) => r.logged_on === day && r.kind === 'agua').reduce((s, r) => s + n(r.water_ml), 0)
    const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g') => meals.reduce((s, r) => s + n(r[k]), 0)
    const burned = ex.filter((e) => e.performed_on === day).reduce((s, e) => s + n(e.kcal), 0)
    return { meals, water, kcal: sum('kcal'), p: sum('protein_g'), c: sum('carbs_g'), f: sum('fat_g'), fiber: sum('fiber_g'), burned }
  }, [food, ex, day])

  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i)
    return {
      key: d, label: short(d),
      a: (food ?? []).filter((r) => r.logged_on === d).reduce((s, r) => s + n(r.kcal), 0),
      b: ex.filter((e) => e.performed_on === d).reduce((s, e) => s + n(e.kcal), 0),
    }
  }), [food, ex, from])

  const balance = useCountUp(today.kcal - today.burned)
  if (food === null || goals === undefined) return <div className="mb-6"><Spinner className="size-6" /></div>
  const g = goals
  const remaining = g?.kcal_day ? g.kcal_day - today.kcal + today.burned : null

  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button className="btn-ghost !p-2" onClick={() => setDay((d) => addDays(d, -1))} aria-label="Dia anterior"><ChevronLeft className="size-5" /></button>
          <span className="min-w-28 text-center font-medium capitalize">{dayLabel(day)}</span>
          <button className="btn-ghost !p-2" onClick={() => setDay((d) => addDays(d, 1))} disabled={day >= todayISO()} aria-label="Próximo dia"><ChevronRight className="size-5" /></button>
        </div>
        {!readOnly && <GoalsButton onClick={() => setEditGoals(true)} />}
      </div>

      {!g?.kcal_day && !readOnly && (
        <button onClick={() => setEditGoals(true)} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-brand-300 p-3 text-left text-sm text-brand-800 dark:border-brand-800 dark:text-brand-200">
          <Sparkles className="size-4 shrink-0" /> Defina suas metas diárias (calorias, proteína…) para ver quanto falta em cada dia.
        </button>
      )}

      <div key={day} className="card grid items-center gap-6 sm:grid-cols-[auto_1fr]">
        <Ring value={today.kcal} goal={g?.kcal_day ?? null} label="Calorias consumidas" unit="kcal" color="text-emerald-500">
          {remaining != null && (
            <span className={`mt-1 text-xs ${remaining < 0 ? 'text-amber-600' : 'text-stone-500'}`}>
              {remaining >= 0 ? `faltam ${fmtInt(remaining)} kcal` : `${fmtInt(-remaining)} kcal acima`}
            </span>
          )}
        </Ring>
        <div className="space-y-3">
          <MeterBar label="Proteína" value={today.p} goal={g?.protein_g_day ?? null} unit="g" color="bg-sky-500" />
          <MeterBar label="Carboidratos" value={today.c} goal={g?.carbs_g_day ?? null} unit="g" color="bg-amber-400" delay={100} />
          <MeterBar label="Gorduras" value={today.f} goal={g?.fat_g_day ?? null} unit="g" color="bg-rose-400" delay={200} />
          <MeterBar label="Água" value={today.water} goal={g?.water_ml_day ?? null} unit="ml" color="bg-cyan-500" delay={300} />
        </div>
      </div>

      <div className="card grid grid-cols-3 gap-2 text-center">
        <div><div className="text-xs text-stone-500">Comeu</div><div className="font-display text-xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{fmtInt(today.kcal)}</div></div>
        <div><div className="flex items-center justify-center gap-1 text-xs text-stone-500"><Flame className="size-3.5 text-orange-500" /> Treinos</div><div className="font-display text-xl font-semibold tabular-nums text-orange-600">−{fmtInt(today.burned)}</div></div>
        <div><div className="text-xs text-stone-500">Saldo do dia</div><div className="font-display text-xl font-semibold tabular-nums">{fmtInt(balance)}</div></div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-600 dark:text-stone-300">Refeições {dayLabel(day).toLowerCase() === 'hoje' ? 'de hoje' : 'do dia'}</h3>
        {today.meals.length === 0 ? <p className="text-sm text-stone-500">Nenhuma refeição registrada neste dia.</p> : (
          <ul className="space-y-2">{today.meals.map((r) => <MealCard key={r.id} r={r} readOnly={readOnly} onRecalc={(id) => void recalc(id)} />)}</ul>
        )}
      </section>

      <section className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Últimos 7 dias</h3>
          <span className="text-xs text-stone-500"><span className="text-emerald-600">■</span> comeu · <span className="text-orange-500">■</span> gastou em treinos · toque num dia para ver</span>
        </div>
        <BarChart data={week} goal={g?.kcal_day} aLabel="Comeu" bLabel="Treinos" unit="kcal" selected={day} onSelect={setDay} />
      </section>
      <p className="text-[11px] text-stone-400">Calorias e nutrientes são estimativas da IA com base na tabela TACO — servem para acompanhar tendências, não substituem orientação profissional.</p>

      {editGoals && <GoalsModal owner={owner} goals={g} focus="nutri" onClose={() => setEditGoals(false)} onSaved={() => { setEditGoals(false); void reloadGoals() }} />}
    </div>
  )
}
