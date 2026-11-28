import { ChevronLeft, ChevronRight, Flame, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { PageHeader, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { MODULES } from '../config'
import { ModulePage } from '../ModulePage'
import { BarChart, CumulativeChart, GoalsButton, GoalsModal, Ring, fmtInt, useCountUp, useGoals, useShown } from './charts'

interface ExRow {
  id: string; activity: string; performed_on: string; duration_min: number | null; kcal: number | null; met: number | null
  intensity: string | null; kcal_status: string | null
}
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const pad = (v: number) => String(v).padStart(2, '0')
const n = (v: number | null | undefined) => Number(v ?? 0)

function Contribution({ rows, goalMin, goalKcal, consumed }: { rows: ExRow[]; goalMin: number | null; goalKcal: number | null; consumed: number }) {
  const shown = useShown(150)
  const burned = rows.reduce((s, r) => s + n(r.kcal), 0)
  const shownBurned = useCountUp(burned)
  const max = Math.max(1, ...rows.map((r) => n(r.kcal)))
  return (
    <section className="card">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Flame className="size-4 text-orange-500" /> Quanto os treinos ajudaram</h3>
      <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
        Seus treinos gastaram <b className="tabular-nums text-orange-600">{fmtInt(shownBurned)} kcal</b> neste mês
        {consumed > 0 && <> — o equivalente a <b>{Math.round((burned / consumed) * 100)}%</b> do que você comeu ({fmtInt(consumed)} kcal)</>}.
      </p>
      {rows.length === 0 ? <p className="text-sm text-stone-500">Nenhum treino neste mês.</p> : (
        <ul className="space-y-2.5">
          {[...rows].sort((a, b) => n(b.kcal) - n(a.kcal)).slice(0, 8).map((r, i) => (
            <li key={r.id}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate"><b className="font-medium">{r.activity}</b> <span className="text-xs text-stone-500">{r.performed_on.split('-').reverse().slice(0, 2).join('/')} · {r.duration_min ?? '?'} min</span></span>
                <span className="shrink-0 text-xs tabular-nums text-stone-500">
                  {r.kcal_status === 'pendente' ? 'calculando…' : r.kcal != null ? `${fmtInt(n(r.kcal))} kcal` : 'sem duração'}
                  {goalMin && r.duration_min ? ` · ${Math.round((r.duration_min / goalMin) * 100)}% da meta` : ''}
                  {!goalMin && goalKcal && r.kcal ? ` · ${Math.round((n(r.kcal) / goalKcal) * 100)}% da meta` : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-rose-500 transition-[width] duration-700 ease-out" style={{ width: shown ? `${(n(r.kcal) / max) * 100}%` : '0%', transitionDelay: `${i * 70}ms` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ExercisePage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean }) {
  const { session } = useAuth()
  const owner = ownerId ?? session!.user.id
  const readOnly = owner !== session?.user.id
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [rows, setRows] = useState<ExRow[] | null>(null)
  const [consumed, setConsumed] = useState(0)
  const [metric, setMetric] = useState<'min' | 'kcal'>('min')
  const [editGoals, setEditGoals] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const { goals, reload: reloadGoals } = useGoals(owner)

  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const start = `${ym.y}-${pad(ym.m + 1)}-01`
  const end = `${ym.y}-${pad(ym.m + 1)}-${pad(daysInMonth)}`
  const isCurrent = ym.y === now.getFullYear() && ym.m === now.getMonth()
  const isPast = ym.y < now.getFullYear() || (ym.y === now.getFullYear() && ym.m < now.getMonth())
  const elapsed = isCurrent ? now.getDate() : isPast ? daysInMonth : 0

  const load = useCallback(async () => {
    const [{ data }, { data: f }] = await Promise.all([
      supabase.from('exercise_logs').select('id, activity, performed_on, duration_min, kcal, met, intensity, kcal_status').eq('owner_id', owner).gte('performed_on', start).lte('performed_on', end),
      supabase.from('food_logs').select('kcal').eq('owner_id', owner).gte('logged_on', start).lte('logged_on', end),
    ])
    setRows((data ?? []) as ExRow[])
    setConsumed((f ?? []).reduce((s, r) => s + n((r as { kcal: number | null }).kcal), 0))
  }, [owner, start, end])
  useEffect(() => { void load() }, [load, refresh])
  useEffect(() => {
    if (!rows?.some((r) => r.kcal_status === 'pendente')) return
    const t = setTimeout(() => void load(), 4000)
    return () => clearTimeout(t)
  }, [rows, load])

  const stats = useMemo(() => {
    const list = rows ?? []
    const perDay = Array.from({ length: daysInMonth }, (_, i) => {
      const d = `${ym.y}-${pad(ym.m + 1)}-${pad(i + 1)}`
      const day = list.filter((r) => r.performed_on === d)
      return { key: d, label: String(i + 1), min: day.reduce((s, r) => s + n(r.duration_min), 0), kcal: day.reduce((s, r) => s + n(r.kcal), 0) }
    })
    return {
      perDay,
      minutes: list.reduce((s, r) => s + n(r.duration_min), 0),
      kcal: list.reduce((s, r) => s + n(r.kcal), 0),
      days: new Set(list.map((r) => r.performed_on)).size,
    }
  }, [rows, ym, daysInMonth])

  const shift = (d: number) => setYm(({ y, m }) => { const t = m + d; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })
  const g = goals ?? null
  const pace = (done: number, goal: number | null | undefined) => {
    if (!goal || !elapsed) return null
    const expected = (goal * elapsed) / daysInMonth
    return { diff: done - expected, expected }
  }
  const p = pace(metric === 'min' ? stats.minutes : stats.kcal, metric === 'min' ? g?.exercise_minutes_month : g?.exercise_kcal_month)
  const pending = rows?.some((r) => r.kcal_status === 'pendente')

  async function recalcAll() {
    const ids = (rows ?? []).filter((r) => r.duration_min).map((r) => r.id)
    setRows((rs) => rs?.map((r) => (ids.includes(r.id) ? { ...r, kcal_status: 'pendente' } : r)) ?? null)
    await Promise.all(ids.map((id) => supabase.functions.invoke('nutrition-estimate', { body: { kind: 'exercise', id } })))
    void load()
  }

  return (
    <div>
      {!embedded && (
        <PageHeader title="Exercícios" subtitle="Treinos, gasto calórico e metas do mês."
          actions={!readOnly && (
            <div className="flex gap-2">
              <Link to="/app/assistente" className="btn-outline"><Sparkles className="size-4" /> Pelo assistente</Link>
              <GoalsButton onClick={() => setEditGoals(true)} />
            </div>
          )} />
      )}

      <div className="mb-4 flex items-center justify-between">
        <button className="btn-ghost !p-2" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft className="size-5" /></button>
        <div className="font-medium capitalize">{MONTHS[ym.m]} de {ym.y}</div>
        <button className="btn-ghost !p-2" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight className="size-5" /></button>
      </div>

      {rows === null || goals === undefined ? <Spinner className="size-6" /> : (
        <div className="mb-8 space-y-4">
          {!g?.exercise_minutes_month && !g?.exercise_kcal_month && !g?.exercise_days_month && !readOnly && (
            <button onClick={() => setEditGoals(true)} className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-brand-300 p-3 text-left text-sm text-brand-800 dark:border-brand-800 dark:text-brand-200">
              <Sparkles className="size-4 shrink-0" /> Defina sua meta do mês (minutos, dias de treino ou calorias) e seu peso, para acompanhar o progresso.
            </button>
          )}
          {!g?.weight_kg && stats.kcal > 0 && <p className="text-xs text-stone-500">Gasto estimado com peso padrão de 70 kg. {readOnly ? '' : 'Informe seu peso em Metas para um cálculo mais preciso.'}</p>}

          <div key={`${ym.y}-${ym.m}`} className="card grid grid-cols-3 gap-2">
            <Ring value={stats.minutes} goal={g?.exercise_minutes_month ?? null} label="Minutos" unit="min" size={112} stroke={11} color="text-emerald-500" />
            <Ring value={stats.days} goal={g?.exercise_days_month ?? null} label="Dias" unit="dias" size={112} stroke={11} color="text-sky-500" />
            <Ring value={stats.kcal} goal={g?.exercise_kcal_month ?? null} label="Calorias" unit="kcal" size={112} stroke={11} color="text-orange-500" />
          </div>

          <section className="card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Meta do mês: acumulado x ritmo</h3>
              <div className="flex rounded-lg bg-stone-200/60 p-0.5 text-xs dark:bg-stone-800">
                {(['min', 'kcal'] as const).map((k) => (
                  <button key={k} onClick={() => setMetric(k)} className={`rounded-md px-2.5 py-1 font-medium ${metric === k ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'}`}>{k === 'min' ? 'Minutos' : 'Calorias'}</button>
                ))}
              </div>
            </div>
            {p && (
              <p className={`mb-2 flex items-center gap-1.5 text-sm ${p.diff >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
                {p.diff >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
                {p.diff >= 0 ? `${fmtInt(p.diff)} ${metric === 'min' ? 'min' : 'kcal'} à frente do ritmo da meta` : `${fmtInt(-p.diff)} ${metric === 'min' ? 'min' : 'kcal'} atrás do ritmo — até hoje o ideal seria ${fmtInt(p.expected)}`}
              </p>
            )}
            <CumulativeChart key={metric} values={stats.perDay.map((d) => (metric === 'min' ? d.min : d.kcal))}
              goal={(metric === 'min' ? g?.exercise_minutes_month : g?.exercise_kcal_month) ?? null} unit={metric === 'min' ? 'min' : 'kcal'} today={elapsed} />
          </section>

          <section className="card">
            <h3 className="mb-2 text-sm font-semibold">Treinos por dia</h3>
            <BarChart key={metric} data={stats.perDay.map((d) => ({ key: d.key, label: d.label, a: metric === 'min' ? d.min : d.kcal }))}
              aLabel={metric === 'min' ? 'Minutos' : 'Calorias'} unit={metric === 'min' ? 'min' : 'kcal'}
              aClass={metric === 'min' ? 'fill-emerald-500' : 'fill-orange-400'} height={160} />
          </section>

          <Contribution rows={rows} goalMin={g?.exercise_minutes_month ?? null} goalKcal={g?.exercise_kcal_month ?? null} consumed={consumed} />

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-stone-400">Gasto calórico estimado: MET da atividade × peso × duração. Valores aproximados.</p>
            {!readOnly && rows.length > 0 && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void recalcAll()} disabled={pending}><RefreshCw className="size-3.5" /> Recalcular</button>}
          </div>
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold text-stone-600 dark:text-stone-300">Registros</h3>
      <ModulePage config={MODULES.exercicios} ownerId={ownerId} embedded ym={ym} onChanged={() => setRefresh((x) => x + 1)} hideSummary />

      {editGoals && <GoalsModal owner={owner} goals={g} focus="treino" onClose={() => setEditGoals(false)} onSaved={() => { setEditGoals(false); void reloadGoals(); setRefresh((x) => x + 1) }} />}
    </div>
  )
}
