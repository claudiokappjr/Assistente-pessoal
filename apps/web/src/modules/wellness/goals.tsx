import { AlertTriangle, ArrowLeft, Calculator, Dumbbell, RefreshCw, Sparkles, Target, Utensils, X } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Alert, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { todayISO } from '../config'
import { MeterBar, fmtInt, useCountUp, useShown, type Goals } from './charts'
import { ACTIVITY, GOALS, calculate, type Activity, type CalcResult, type GoalType, type Sex } from './goalCalc'

export function GoalsButton({ onClick }: { onClick: () => void }) {
  return <button className="btn-outline" onClick={onClick}><Target className="size-4" /> Metas</button>
}

const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const br = (iso: string) => iso.split('-').reverse().join('/')
const num = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null }

/** Plano de treino sugerido para cada objetivo. */
export const TRAINING_PLAN: Record<GoalType, string[]> = {
  perder_gordura: ['3× musculação por semana (corpo todo), para preservar músculo', '2 a 3× aeróbico moderado de 30–40 min (caminhada rápida, bike, elíptico)', 'Passos: tente 8 a 10 mil por dia'],
  perder_peso: ['3× aeróbico moderado de 40 min', '2× musculação leve a moderada', 'Mais movimento no dia a dia (escadas, caminhadas curtas)'],
  ganhar_massa: ['4× musculação por semana (divisão A/B), com aumento progressivo de carga', '8 a 12 repetições, 3 a 4 séries por exercício', '1× aeróbico leve de 20–30 min; durma 7 a 9 h'],
  recomposicao: ['3 a 4× musculação com progressão de carga', '1 a 2× aeróbico moderado de 30 min', 'Proteína alta todos os dias'],
  manter: ['150 min por semana de atividade moderada (OMS)', '2× fortalecimento muscular por semana', 'Escolha o que der prazer: constância vale mais'],
  condicionamento: ['3× aeróbico (1 longo leve, 1 intervalado, 1 moderado)', '2× musculação/funcional', 'Aumente o volume aos poucos (~10% por semana)'],
}

// ------------------------------------------------------------------ projeção do peso
function Projection({ r, weight }: { r: CalcResult; weight: number }) {
  const shown = useShown(150)
  if (r.projection.length < 2) return null
  const W = 600, H = 150, L = 34, R = 12, T = 12, B = 22
  const ws = r.projection.map((p) => p.weight)
  const lo = Math.min(...ws, weight) - 1, hi = Math.max(...ws, weight) + 1
  const last = r.projection[r.projection.length - 1].week || 1
  const x = (w: number) => L + (w / last) * (W - L - R)
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B)
  const path = r.projection.map((p, i) => `${i ? 'L' : 'M'}${x(p.week).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ')
  const end = r.projection[r.projection.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projeção do peso">
      <line x1={L} x2={W - R} y1={y(weight)} y2={y(weight)} className="stroke-stone-200 dark:stroke-stone-800" />
      <path d={path} fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-violet-500" strokeDasharray={1500} strokeDashoffset={shown ? 0 : 1500} style={{ transition: 'stroke-dashoffset 1.4s ease-out' }} />
      <circle cx={x(0)} cy={y(weight)} r={5} className="fill-stone-700 dark:fill-stone-200" />
      <circle cx={x(end.week)} cy={y(end.weight)} r={6} className={`fill-violet-500 transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'}`} style={{ transitionDelay: '1.2s' }} />
      <text x={x(0)} y={y(weight) - 9} className="fill-stone-600 text-[12px] dark:fill-stone-300">{String(weight).replace('.', ',')} kg</text>
      <text x={x(end.week)} y={y(end.weight) - 10} textAnchor="end" className="fill-violet-600 text-[12px] font-semibold">{String(end.weight).replace('.', ',')} kg</text>
      <text x={L} y={H - 4} className="fill-stone-500 text-[11px]">hoje</text>
      <text x={W - R} y={H - 4} textAnchor="end" className="fill-stone-500 text-[11px]">{end.week} semanas</text>
    </svg>
  )
}

function Big({ label, value, unit, delay = 0 }: { label: string; value: number; unit: string; delay?: number }) {
  const v = useCountUp(value, 900 + delay)
  return (
    <div className="rounded-2xl bg-stone-50 p-3 text-center dark:bg-stone-800/60">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="font-display text-2xl font-semibold tabular-nums">{fmtInt(v)}</div>
      <div className="text-[11px] text-stone-500">{unit}</div>
    </div>
  )
}

// ------------------------------------------------------------------ assistente de metas
export function GoalsModal({ owner, goals, focus, onClose, onSaved }: { owner: string; goals: Goals | null; focus: 'nutri' | 'treino'; onClose: () => void; onSaved: () => void }) {
  const year = Number(todayISO().slice(0, 4))
  const [step, setStep] = useState<'dados' | 'objetivo' | 'resultado' | 'manual'>(goals?.goal_type ? 'objetivo' : 'dados')
  const [sex, setSex] = useState<Sex | ''>(goals?.sex ?? '')
  const [age, setAge] = useState(goals?.birth_year ? String(year - goals.birth_year) : '')
  const [weight, setWeight] = useState(goals?.weight_kg ? String(goals.weight_kg).replace('.', ',') : '')
  const [height, setHeight] = useState(goals?.height_cm ? String(goals.height_cm).replace('.', ',') : '')
  const [activity, setActivity] = useState<Activity>((goals?.activity_level as Activity) ?? 'leve')
  const [goal, setGoal] = useState<GoalType>((goals?.goal_type as GoalType) ?? 'perder_gordura')
  const [target, setTarget] = useState(goals?.target_weight_kg ? String(goals.target_weight_kg).replace('.', ',') : '')
  const [months, setMonths] = useState<number | null>(goals?.target_date ? Math.max(1, Math.round((new Date(goals.target_date).getTime() - Date.now()) / 2.63e9)) : 3)
  const [result, setResult] = useState<CalcResult | null>(null)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function next(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!sex || !num(age) || !num(weight) || !num(height)) return setError('Preencha sexo, idade, peso e altura.')
    if (Number(age) < 16) return setError('O cálculo automático é para maiores de 16 anos. Para adolescentes, procure um nutricionista.')
    setStep('objetivo')
  }
  function calc(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!sex || !num(age) || !num(weight) || !num(height)) { setStep('dados'); return }
    const usesTarget = ['perder_gordura', 'perder_peso', 'ganhar_massa'].includes(goal)
    const r = calculate({ sex, age: Number(age), weight: num(weight)!, height: num(height)!, activity, goal,
      targetWeight: usesTarget ? num(target) : null, weeks: usesTarget && months ? Math.round(months * 4.33) : null })
    setResult(r)
    setManual({ kcal_day: String(r.kcal), protein_g_day: String(r.protein), carbs_g_day: String(r.carbs), fat_g_day: String(r.fat), water_ml_day: String(r.water),
      exercise_minutes_month: String(r.minutesMonth), exercise_days_month: String(r.daysMonth), exercise_kcal_month: String(r.kcalMonth) })
    setStep('resultado')
  }
  async function save(values: Record<string, string>) {
    setBusy(true); setError('')
    const int = (k: string) => (values[k] ? Math.round(Number(values[k].replace(',', '.'))) || null : null)
    const row = {
      owner_id: owner, sex: sex || null, birth_year: num(age) ? year - Number(age) : null, weight_kg: num(weight), height_cm: num(height),
      activity_level: activity, goal_type: goal, target_weight_kg: result?.targetWeight ?? null,
      target_date: result?.weeks ? addDays(todayISO(), result.weeks * 7) : null, plan_notes: result?.summary ?? goals?.plan_notes ?? null,
      kcal_day: int('kcal_day'), protein_g_day: int('protein_g_day'), carbs_g_day: int('carbs_g_day'), fat_g_day: int('fat_g_day'), water_ml_day: int('water_ml_day'),
      exercise_minutes_month: int('exercise_minutes_month'), exercise_days_month: int('exercise_days_month'), exercise_kcal_month: int('exercise_kcal_month'),
    }
    const { error } = await supabase.from('wellness_goals').upsert(row)
    setBusy(false)
    if (error) return setError(/check/i.test(error.message) ? 'Algum valor está fora do esperado. Confira os números.' : errorMessage(error))
    onSaved()
  }

  const shell = (title: string, children: ReactNode, back?: () => void) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center gap-2">
          {back && <button className="btn-ghost !p-2" onClick={back} aria-label="Voltar"><ArrowLeft className="size-5" /></button>}
          <h2 className="flex-1 font-display text-xl font-semibold">{title}</h2>
          <button className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        {children}
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </div>
    </div>
  )
  const seg = <T extends string>(opts: { key: T; label: string }[], v: T | '', set: (x: T) => void) => (
    <div className="flex gap-1 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
      {opts.map((o) => <button key={o.key} type="button" onClick={() => set(o.key)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${v === o.key ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'}`}>{o.label}</button>)}
    </div>
  )

  if (step === 'dados') return shell('Seus dados', (
    <form onSubmit={next} className="space-y-4">
      <p className="text-sm text-stone-500">Com estes dados o sistema calcula seu gasto de energia e as metas de alimentação e treino para o seu objetivo.</p>
      <div><span className="label">Sexo (para o cálculo do metabolismo)</span>{seg([{ key: 'feminino', label: 'Feminino' }, { key: 'masculino', label: 'Masculino' }], sex, setSex)}</div>
      <div className="grid grid-cols-3 gap-3">
        <label><span className="label">Idade</span><input className="input" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="35" /></label>
        <label><span className="label">Peso (kg)</span><input className="input" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="75" /></label>
        <label><span className="label">Altura (cm)</span><input className="input" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="170" /></label>
      </div>
      <div>
        <span className="label">Nível de atividade hoje</span>
        <div className="space-y-1.5">
          {ACTIVITY.map((a) => (
            <button key={a.key} type="button" onClick={() => setActivity(a.key)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm ${activity === a.key ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'border-stone-200 dark:border-stone-700'}`}>
              <span className="font-medium">{a.label}</span><span className="text-xs text-stone-500">{a.hint}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <button type="button" className="btn-ghost text-xs" onClick={() => setStep('manual')}>Prefiro digitar as metas</button>
        <button className="btn-primary">Continuar</button>
      </div>
    </form>
  ))

  if (step === 'objetivo') {
    const usesTarget = ['perder_gordura', 'perder_peso', 'ganhar_massa'].includes(goal)
    return shell('Seu objetivo', (
      <form onSubmit={calc} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {GOALS.map((g) => (
            <button key={g.key} type="button" onClick={() => setGoal(g.key)} className={`rounded-2xl border p-3 text-left transition ${goal === g.key ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/30 dark:bg-brand-900/30' : 'border-stone-200 dark:border-stone-700'}`}>
              <div className="text-xl">{g.emoji}</div><div className="mt-1 text-sm font-semibold">{g.label}</div><div className="text-xs text-stone-500">{g.hint}</div>
            </button>
          ))}
        </div>
        {usesTarget && (
          <div className="grid grid-cols-2 gap-3">
            <label><span className="label">Peso desejado (kg)</span><input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="opcional" /></label>
            <label><span className="label">Em quanto tempo</span>
              <select className="input" value={months ?? ''} onChange={(e) => setMonths(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Sem prazo</option>{[1, 2, 3, 4, 6, 9, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mês' : 'meses'}</option>)}
              </select></label>
          </div>
        )}
        <div className="flex justify-end"><button className="btn-primary"><Calculator className="size-4" /> Calcular minhas metas</button></div>
      </form>
    ), () => setStep('dados'))
  }

  if (step === 'resultado' && result) {
    const w = num(weight)!
    return shell('Seu plano', (
      <div className="space-y-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">{result.summary}.</p>
        {result.warnings.map((m) => <div key={m} className="flex gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="size-4 shrink-0" /> {m}</div>)}
        <div className="grid grid-cols-3 gap-2">
          <Big label="Calorias/dia" value={result.kcal} unit="kcal" />
          <Big label="Gasto diário" value={result.tdee} unit="kcal estimadas" delay={100} />
          <Big label="IMC" value={result.bmi} unit="kg/m²" delay={200} />
        </div>
        <div className="space-y-2">
          <MeterBar label="Proteína" value={result.protein} goal={null} unit="g/dia" color="bg-sky-500" />
          <MeterBar label="Carboidratos" value={result.carbs} goal={null} unit="g/dia" color="bg-amber-400" delay={100} />
          <MeterBar label="Gorduras" value={result.fat} goal={null} unit="g/dia" color="bg-rose-400" delay={200} />
          <MeterBar label="Água" value={result.water} goal={null} unit="ml/dia" color="bg-cyan-500" delay={300} />
        </div>
        {result.ratePerWeek !== 0 && (
          <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
            <div className="mb-1 text-sm font-semibold">Projeção do peso</div>
            <Projection r={result} weight={w} />
          </div>
        )}
        <div className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
          <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Dumbbell className="size-4" /> Treino: {result.weeklyMinutes} min/semana em {result.daysPerWeek} dias</div>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-stone-600 dark:text-stone-300">{TRAINING_PLAN[goal].map((t) => <li key={t}>{t}</li>)}</ul>
          <div className="mt-2 text-xs text-stone-500">Meta do mês: {result.minutesMonth} min · {result.daysMonth} dias · ~{fmtInt(result.kcalMonth)} kcal gastas</div>
        </div>
        <p className="text-[11px] text-stone-400">Cálculo pela equação de Mifflin-St Jeor e recomendações gerais (OMS). É um ponto de partida — com nutricionista ou educador físico, use as metas que eles definirem.</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button className="btn-ghost text-xs" onClick={() => setStep('manual')}>Ajustar valores</button>
          <button className="btn-primary" disabled={busy} onClick={() => void save(manual)}>{busy && <Spinner />} Usar este plano</button>
        </div>
      </div>
    ), () => setStep('objetivo'))
  }

  // Edição manual
  const fields: [string, string, string][] = [
    ['kcal_day', 'Calorias por dia', 'kcal'], ['protein_g_day', 'Proteína por dia', 'g'], ['carbs_g_day', 'Carboidratos por dia', 'g'], ['fat_g_day', 'Gorduras por dia', 'g'],
    ['water_ml_day', 'Água por dia', 'ml'], ['exercise_minutes_month', 'Minutos de treino no mês', 'min'], ['exercise_days_month', 'Dias de treino no mês', 'dias'], ['exercise_kcal_month', 'Calorias de treino no mês', 'kcal'],
  ]
  const vals = Object.keys(manual).length ? manual : Object.fromEntries(fields.map(([k]) => [k, goals?.[k as keyof Goals] != null ? String(goals[k as keyof Goals]) : '']))
  const order = focus === 'treino' ? [...fields.slice(5), ...fields.slice(0, 5)] : fields
  return shell('Ajustar metas', (
    <form onSubmit={(e) => { e.preventDefault(); void save(vals) }} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {order.map(([k, l, u]) => (
          <label key={k}><span className="label">{l}</span>
            <div className="relative"><input className="input pr-12" inputMode="decimal" value={vals[k] ?? ''} onChange={(e) => setManual({ ...vals, [k]: e.target.value })} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-stone-400">{u}</span></div>
          </label>
        ))}
      </div>
      <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Salvar metas</button></div>
    </form>
  ), result ? () => setStep('resultado') : () => setStep('dados'))
}

// ------------------------------------------------------------------ resumo do plano (Nutrição e Exercícios)
export function PlanCard({ goals, focus, onEdit }: { goals: Goals | null; focus: 'nutri' | 'treino'; onEdit?: () => void }) {
  if (!goals?.goal_type) return null
  const g = GOALS.find((x) => x.key === goals.goal_type)
  const plan = TRAINING_PLAN[goals.goal_type as GoalType] ?? []
  const daysLeft = goals.target_date ? Math.round((new Date(`${goals.target_date}T12:00:00Z`).getTime() - Date.now()) / 864e5) : null
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/20">
      <div className="text-2xl">{g?.emoji}</div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-semibold">Objetivo: {g?.label}</div>
        <div className="text-xs text-stone-600 dark:text-stone-300">
          {goals.target_weight_kg && goals.weight_kg ? `${String(goals.weight_kg).replace('.', ',')} → ${String(goals.target_weight_kg).replace('.', ',')} kg` : ''}
          {goals.target_date ? ` · até ${br(goals.target_date)}${daysLeft != null && daysLeft > 0 ? ` (faltam ${daysLeft} dias)` : ''}` : ''}
        </div>
        {focus === 'treino' && plan.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-stone-600 dark:text-stone-300">{plan.map((t) => <li key={t}>{t}</li>)}</ul>}
      </div>
      {onEdit && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onEdit}><RefreshCw className="size-3.5" /> Refazer</button>}
    </div>
  )
}

// ------------------------------------------------------------------ sugestão de cardápio
interface DietItem { food: string; portion: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
interface Diet {
  meals: { meal: string; time: string; items: DietItem[]; kcal: number; protein_g: number; carbs_g: number; fat_g: number }[]
  tips: string[]; totals: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
  goal: { kcal: number; protein_g: number | null; carbs_g: number | null; fat_g: number | null }
}
export function DietPanel({ owner, goals, readOnly, onChanged, onOpenGoals }: { owner: string; goals: Goals | null; readOnly: boolean; onChanged: () => void; onOpenGoals: () => void }) {
  const [prefs, setPrefs] = useState(goals?.diet_preferences ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const diet = (goals?.diet_suggestion ?? null) as Diet | null

  async function generate() {
    setBusy(true); setError('')
    if ((goals?.diet_preferences ?? '') !== prefs) await supabase.from('wellness_goals').update({ diet_preferences: prefs.trim() || null }).eq('owner_id', owner)
    const { error } = await supabase.functions.invoke('diet-suggest', { body: {} })
    setBusy(false)
    if (error) {
      let d = errorMessage(error)
      try { d = (await (error as { context?: Response }).context?.json())?.error ?? d } catch { /* */ }
      return setError(d)
    }
    onChanged()
  }

  if (!goals?.kcal_day) return (
    <div className="card text-center">
      <Utensils className="mx-auto mb-2 size-6 text-brand-600" />
      <p className="text-sm text-stone-600 dark:text-stone-300">{readOnly ? 'O cliente ainda não definiu metas.' : 'Defina seu objetivo para receber uma sugestão de cardápio com as calorias e nutrientes certos.'}</p>
      {!readOnly && <button className="btn-primary mt-3" onClick={onOpenGoals}><Target className="size-4" /> Definir objetivo</button>}
    </div>
  )
  return (
    <div className="space-y-4">
      <PlanCard goals={goals} focus="nutri" onEdit={readOnly ? undefined : onOpenGoals} />
      {!readOnly && (
        <div className="card space-y-2">
          <label className="block"><span className="label">Preferências, restrições ou alergias</span>
            <textarea className="input min-h-16" value={prefs} onChange={(e) => setPrefs(e.target.value)} placeholder="Ex.: sem lactose, não como peixe, gosto de tapioca no café, almoço fora de casa." /></label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-stone-500">Meta: {fmtInt(goals.kcal_day)} kcal · P {goals.protein_g_day ?? '–'} g · C {goals.carbs_g_day ?? '–'} g · G {goals.fat_g_day ?? '–'} g</span>
            <button className="btn-primary" onClick={() => void generate()} disabled={busy}>{busy ? <><Spinner /> Montando…</> : <><Sparkles className="size-4" /> {diet ? 'Gerar outra opção' : 'Sugerir cardápio'}</>}</button>
          </div>
          {error && <Alert>{error}</Alert>}
        </div>
      )}
      {diet && (
        <div key={goals.diet_generated_at ?? ''} className="space-y-3">
          <div className="card grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MeterBar label="Calorias" value={diet.totals.kcal} goal={diet.goal.kcal} unit="kcal" color="bg-emerald-500" />
            <MeterBar label="Proteína" value={diet.totals.protein_g} goal={diet.goal.protein_g} unit="g" color="bg-sky-500" delay={100} />
            <MeterBar label="Carboidratos" value={diet.totals.carbs_g} goal={diet.goal.carbs_g} unit="g" color="bg-amber-400" delay={200} />
            <MeterBar label="Gorduras" value={diet.totals.fat_g} goal={diet.goal.fat_g} unit="g" color="bg-rose-400" delay={300} />
          </div>
          <ul className="space-y-2">
            {diet.meals.map((m) => (
              <li key={m.meal} className="card !p-4">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-medium">{m.meal} <span className="text-xs font-normal text-stone-500">{m.time}</span></span>
                  <span className="text-sm tabular-nums"><b>{fmtInt(m.kcal)}</b> kcal</span>
                </div>
                <ul className="space-y-1 text-sm">
                  {m.items.map((i, k) => (
                    <li key={k} className="flex justify-between gap-2"><span>{i.food} <span className="text-xs text-stone-500">— {i.portion}</span></span><span className="shrink-0 text-xs tabular-nums text-stone-500">{fmtInt(i.kcal)} kcal</span></li>
                  ))}
                </ul>
                <div className="mt-2 text-xs text-stone-500">P {fmtInt(m.protein_g)} g · C {fmtInt(m.carbs_g)} g · G {fmtInt(m.fat_g)} g</div>
              </li>
            ))}
          </ul>
          {diet.tips.length > 0 && <div className="card"><div className="mb-1 text-sm font-semibold">Dicas</div><ul className="list-disc space-y-0.5 pl-5 text-sm text-stone-600 dark:text-stone-300">{diet.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>}
          <p className="text-[11px] text-stone-400">Sugestão de um dia gerada pela IA a partir das suas metas — é um exemplo, não uma prescrição. Para um plano individual, procure um nutricionista.</p>
        </div>
      )}
    </div>
  )
}
