import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'

// ------------------------------------------------------------------ metas
export interface Goals {
  owner_id?: string; weight_kg: number | null; kcal_day: number | null; protein_g_day: number | null; carbs_g_day: number | null
  fat_g_day: number | null; water_ml_day: number | null; exercise_minutes_month: number | null; exercise_days_month: number | null
  exercise_kcal_month: number | null
  sex?: 'feminino' | 'masculino' | null; birth_year?: number | null; height_cm?: number | null; activity_level?: string | null
  goal_type?: string | null; target_weight_kg?: number | null; target_date?: string | null; plan_notes?: string | null
  diet_preferences?: string | null; diet_suggestion?: unknown; diet_generated_at?: string | null
}
// Metas compartilhadas: todas as telas (Registros, Dieta, Exercícios…) leem a MESMA
// cópia. Quando uma tela salva e recarrega, todas as outras se atualizam juntas.
const goalsCache = new Map<string, Goals | null>()
const goalsListeners = new Map<string, Set<(g: Goals | null) => void>>()
async function fetchGoals(owner: string) {
  const { data } = await supabase.from('wellness_goals').select('*').eq('owner_id', owner).maybeSingle()
  const g = (data as Goals | null) ?? null
  goalsCache.set(owner, g)
  goalsListeners.get(owner)?.forEach((fn) => fn(g))
  return g
}
export function useGoals(owner: string) {
  const [goals, setGoals] = useState<Goals | null | undefined>(() => goalsCache.get(owner))
  useEffect(() => {
    const set = goalsListeners.get(owner) ?? new Set()
    goalsListeners.set(owner, set)
    set.add(setGoals)
    setGoals(goalsCache.get(owner))
    void fetchGoals(owner)
    return () => { set.delete(setGoals) }
  }, [owner])
  const load = useCallback(() => fetchGoals(owner), [owner])
  return { goals, reload: load }
}

// ------------------------------------------------------------------ animação
/** Liga depois de montar, para as transições CSS partirem do zero. */
export function useShown(delay = 60) {
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShown(true), delay); return () => clearTimeout(t) }, [delay])
  return shown
}
/** Número que "sobe" até o valor. */
export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now(), a = from.current
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); from.current = target; return }
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - p, 3)
      setV(a + (target - a) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
export const fmtInt = (n: number) => Math.round(n).toLocaleString('pt-BR')

// ------------------------------------------------------------------ anel de progresso
export function Ring({ value, goal, size = 148, stroke = 14, color = 'text-emerald-500', label, unit, children }: {
  value: number; goal: number | null; size?: number; stroke?: number; color?: string; label: string; unit: string; children?: ReactNode
}) {
  const shown = useShown()
  const shownValue = useCountUp(value)
  const r = (size - stroke) / 2, c = 2 * Math.PI * r
  const pct = goal ? value / goal : 0
  const over = goal != null && pct > 1
  const fill = goal ? Math.min(1, pct) : 0
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" className="stroke-stone-200 dark:stroke-stone-800" />
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" strokeLinecap="round"
            className={`${over ? 'text-amber-500' : color} stroke-current transition-[stroke-dashoffset] duration-[1200ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none`}
            strokeDasharray={c} strokeDashoffset={shown ? c * (1 - fill) : c} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-2xl font-semibold tabular-nums leading-none">{fmtInt(shownValue)}</span>
          <span className="mt-0.5 text-[11px] text-stone-500">{goal ? `de ${fmtInt(goal)} ${unit}` : unit}</span>
          {goal != null && <span className={`mt-1 text-xs font-semibold ${over ? 'text-amber-600' : 'text-stone-700 dark:text-stone-300'}`}>{Math.round(pct * 100)}%</span>}
        </div>
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
      {children}
    </div>
  )
}

// ------------------------------------------------------------------ barra horizontal
export function MeterBar({ label, value, goal, unit, color, delay = 0 }: { label: string; value: number; goal: number | null; unit: string; color: string; delay?: number }) {
  const shown = useShown(80 + delay)
  const pct = goal ? value / goal : 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-stone-500"><b className="text-stone-900 dark:text-stone-100">{fmtInt(value)}</b>{goal ? ` / ${fmtInt(goal)}` : ''} {unit}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
        <div className={`h-full rounded-full ${pct > 1 ? 'bg-amber-500' : color} transition-[width] duration-1000 ease-out motion-reduce:transition-none`}
          style={{ width: shown ? `${goal ? Math.min(100, pct * 100) : value > 0 ? 100 : 0}%` : '0%' }} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ gráfico de barras interativo
export interface BarDatum { key: string; label: string; a: number; b?: number }
export function BarChart({ data, goal, aLabel, bLabel, unit, selected, onSelect, aClass = 'fill-emerald-500', bClass = 'fill-orange-400', height = 180 }: {
  data: BarDatum[]; goal?: number | null; aLabel: string; bLabel?: string; unit: string; selected?: string; onSelect?: (key: string) => void
  aClass?: string; bClass?: string; height?: number
}) {
  const shown = useShown()
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = height, L = 8, R = 8, T = 16, B = 24
  const max = Math.max(1, ...data.map((d) => Math.max(d.a, d.b ?? 0)), goal ?? 0) * 1.12
  const slot = (W - L - R) / data.length
  const bw = Math.min(28, slot * (data.some((d) => d.b != null) ? 0.34 : 0.6))
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const h = hover != null ? data[hover] : null
  const every = Math.ceil(data.length / 10)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" role="img" aria-label={aLabel} onPointerLeave={() => setHover(null)}>
        {goal ? (
          <g>
            <line x1={L} x2={W - R} y1={y(goal)} y2={y(goal)} className="stroke-stone-400" strokeDasharray="5 4" />
            <text x={W - R} y={y(goal) - 4} textAnchor="end" className="fill-stone-500 text-[11px]">meta {fmtInt(goal)}</text>
          </g>
        ) : null}
        {data.map((d, i) => {
          const cx = L + slot * i + slot / 2
          const two = d.b != null
          const xa = two ? cx - bw - 1 : cx - bw / 2
          const sel = selected === d.key
          return (
            <g key={d.key} onPointerEnter={() => setHover(i)} onClick={() => onSelect?.(d.key)} className={onSelect ? 'cursor-pointer' : ''}>
              <rect x={L + slot * i} y={T} width={slot} height={H - T - B} className={sel ? 'fill-stone-200/70 dark:fill-stone-800/70' : 'fill-transparent'} rx={6} />
              <rect x={xa} width={bw} rx={4} className={`${aClass} transition-all duration-700 ease-out motion-reduce:transition-none`}
                style={{ transitionDelay: `${i * 30}ms` }} y={shown ? y(d.a) : H - B} height={shown ? Math.max(0, H - B - y(d.a)) : 0} />
              {two && <rect x={cx + 1} width={bw} rx={4} className={`${bClass} transition-all duration-700 ease-out motion-reduce:transition-none`}
                style={{ transitionDelay: `${i * 30 + 120}ms` }} y={shown ? y(d.b!) : H - B} height={shown ? Math.max(0, H - B - y(d.b!)) : 0} />}
              {(i % every === 0 || sel) && <text x={cx} y={H - 6} textAnchor="middle" className={`text-[11px] ${sel ? 'fill-stone-900 font-semibold dark:fill-stone-100' : 'fill-stone-500'}`}>{d.label}</text>}
            </g>
          )
        })}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-0 z-10 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs text-white shadow dark:bg-stone-100 dark:text-stone-900"
          style={{ left: `${Math.min(70, Math.max(0, ((L + slot * hover) / W) * 100 - 6))}%` }}>
          <div className="font-semibold">{h.label}</div>
          <div>{aLabel}: <b className="tabular-nums">{fmtInt(h.a)}</b> {unit}</div>
          {h.b != null && bLabel && <div>{bLabel}: <b className="tabular-nums">{fmtInt(h.b)}</b> {unit}</div>}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ progresso acumulado do mês
export function CumulativeChart({ values, goal, unit, today }: { values: number[]; goal: number | null; unit: string; today: number }) {
  const shown = useShown()
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 200, L = 36, R = 12, T = 14, B = 24
  const n = values.length
  const cum: number[] = []
  values.forEach((v, i) => cum.push((cum[i - 1] ?? 0) + v))
  const upto = cum.slice(0, today)
  const max = Math.max(1, goal ?? 0, ...cum) * 1.1
  const x = (i: number) => L + (i / Math.max(1, n - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const path = upto.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = upto.length ? `${path} L${x(upto.length - 1)},${H - B} L${x(0)},${H - B} Z` : ''
  const len = 2000
  const h = hover != null && hover < upto.length ? hover : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="img" aria-label={`Acumulado do mês em ${unit}`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))))
        }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(max * f / 1.1)} y2={y(max * f / 1.1)} className="stroke-stone-200 dark:stroke-stone-800" />
            <text x={L - 6} y={y(max * f / 1.1) + 4} textAnchor="end" className="fill-stone-500 text-[10px] tabular-nums">{fmtInt(max * f / 1.1)}</text>
          </g>
        ))}
        {goal ? <line x1={x(0)} y1={y(0)} x2={x(n - 1)} y2={y(goal)} className="stroke-stone-400" strokeDasharray="5 4" /> : null}
        {goal ? <text x={x(n - 1)} y={y(goal) - 6} textAnchor="end" className="fill-stone-500 text-[11px]">ritmo da meta</text> : null}
        {area && <path d={area} className={`fill-emerald-500/15 transition-opacity duration-700 ${shown ? 'opacity-100' : 'opacity-0'}`} />}
        {path && <path d={path} fill="none" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={len} strokeDashoffset={shown ? 0 : len} style={{ transition: 'stroke-dashoffset 1.4s ease-out' }} />}
        {upto.length > 0 && <circle cx={x(upto.length - 1)} cy={y(upto[upto.length - 1])} r={5} className="fill-emerald-600 stroke-white dark:stroke-stone-900" strokeWidth={2} />}
        {h != null && <line x1={x(h)} x2={x(h)} y1={T} y2={H - B} className="stroke-stone-400" strokeDasharray="3 3" />}
        <text x={x(0)} y={H - 6} className="fill-stone-500 text-[11px]">dia 1</text>
        <text x={x(n - 1)} y={H - 6} textAnchor="end" className="fill-stone-500 text-[11px]">dia {n}</text>
      </svg>
      {h != null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs text-white shadow dark:bg-stone-100 dark:text-stone-900"
          style={{ left: `${Math.min(72, Math.max(0, (x(h) / W) * 100 - 8))}%` }}>
          Dia {h + 1}: <b className="tabular-nums">{fmtInt(cum[h])}</b> {unit}
          {goal ? <> · meta até aqui {fmtInt(goal * (h + 1) / n)}</> : null}
        </div>
      )}
    </div>
  )
}
