import { ChevronLeft, ChevronRight, Inbox, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { MODULE_ICONS } from '../components/AppLayout'
import { Alert, EmptyState, PageHeader, Spinner, Stat } from '../components/ui'
import { errorMessage, supabase } from '../lib/supabase'
import { money, type Field, type ModuleConfig, type Row } from './config'

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const pad = (n: number) => String(n).padStart(2, '0')

function monthRange(y: number, m: number) {
  const start = `${y}-${pad(m + 1)}-01`
  const ny = m === 11 ? y + 1 : y
  const nm = m === 11 ? 0 : m + 1
  const end = `${ny}-${pad(nm + 1)}-01`
  return { start, end }
}

/** ISO (UTC) -> "YYYY-MM-DDTHH:mm" no fuso de São Paulo, para <input type=datetime-local>. */
function isoToLocal(iso: unknown) {
  if (typeof iso !== 'string') return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  const g = (t: string) => p.find((x) => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}
const dayKey = (r: Row, c: ModuleConfig) => (c.dateIsTimestamp ? isoToLocal(r[c.dateKey]).slice(0, 10) : String(r[c.dateKey] ?? ''))
const dayLabel = (d: string) => {
  if (!d) return '—'
  const dt = new Date(`${d}T12:00:00-03:00`)
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'America/Sao_Paulo' }).format(dt)
}

function toForm(fields: Field[], r: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...r }
  for (const f of fields) {
    const v = r[f.key]
    if (f.type === 'money') out[f.key] = v == null || v === '' ? '' : (Number(v) / 100).toFixed(2).replace('.', ',')
    else if (f.type === 'datetime') out[f.key] = typeof v === 'string' && v.length > 16 ? isoToLocal(v) : (v ?? '')
    else if (f.type === 'tags') out[f.key] = Array.isArray(v) ? v.join(', ') : (v ?? '')
    else if (f.type === 'time') out[f.key] = typeof v === 'string' ? v.slice(0, 5) : ''
    else if (f.type === 'checkbox') out[f.key] = Boolean(v)
    else out[f.key] = v ?? ''
  }
  return out
}

function fromForm(fields: Field[], form: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const v = form[f.key]
    if (f.type === 'checkbox') { out[f.key] = Boolean(v); continue }
    const s = typeof v === 'string' ? v.trim() : v
    if (s === '' || s == null) { out[f.key] = null; continue }
    if (f.type === 'money') out[f.key] = Math.round(Number(String(s).replace(/\./g, '').replace(',', '.')) * 100)
    else if (f.type === 'number') out[f.key] = Number(String(s).replace(',', '.'))
    else if (f.type === 'datetime') out[f.key] = new Date(`${s}:00-03:00`).toISOString()
    else if (f.type === 'tags') out[f.key] = String(s).split(',').map((x) => x.trim()).filter(Boolean)
    else out[f.key] = s
  }
  return out
}

function RecordForm({ config, initial, onClose, onSaved }: { config: ModuleConfig; initial: Row | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, unknown>>(() => toForm(config.fields, initial ?? config.defaults()))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const payload = fromForm(config.fields, form)
    for (const f of config.fields) {
      if (f.required && (payload[f.key] == null) && (!f.showIf || f.showIf(form as Row))) {
        setBusy(false)
        return setError(`Preencha: ${f.label}`)
      }
      if (f.type === 'money' && payload[f.key] != null && !Number.isFinite(payload[f.key] as number)) {
        setBusy(false)
        return setError('Valor inválido. Use o formato 120,50')
      }
    }
    const q = initial
      ? supabase.from(config.table).update(payload).eq('id', initial.id)
      : supabase.from(config.table).insert(payload)
    const { error } = await q
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }

  const visible = config.fields.filter((f) => !f.showIf || f.showIf(form as Row))
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{initial ? 'Editar registro' : `Novo registro — ${config.title}`}</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {visible.map((f) => (
            <div key={f.key} className={f.half ? 'col-span-1' : 'col-span-2'}>
              {f.type === 'checkbox' ? (
                <label className="flex items-center gap-2.5 py-2 text-sm">
                  <input type="checkbox" className="size-4 accent-brand-700" checked={Boolean(form[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
                  {f.label}
                </label>
              ) : (
                <>
                  <label className="label" htmlFor={`f-${f.key}`}>{f.label}{f.required && <span className="text-red-600"> *</span>}</label>
                  {f.type === 'select' ? (
                    <select id={`f-${f.key}`} className="input" value={String(form[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea id={`f-${f.key}`} rows={3} className="input" value={String(form[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} />
                  ) : (
                    <input
                      id={`f-${f.key}`}
                      className="input"
                      type={f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : f.type === 'datetime' ? 'datetime-local' : 'text'}
                      inputMode={f.type === 'money' || f.type === 'number' ? 'decimal' : undefined}
                      placeholder={f.type === 'money' ? '0,00' : f.placeholder}
                      value={String(form[f.key] ?? '')}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        <div className="mt-5 flex gap-2">
          <button className="btn-primary flex-1" disabled={busy}>{busy && <Spinner />} Salvar</button>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </form>
    </div>
  )
}

const TONE = {
  green: 'text-brand-700 dark:text-brand-300', red: 'text-red-700 dark:text-red-400', stone: 'text-stone-600 dark:text-stone-300',
}
const BADGE = {
  green: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200', red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', stone: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
}

function Summary({ config, rows }: { config: ModuleConfig; rows: Row[] }) {
  if (config.key === 'financas') {
    const sum = (kind: string, status: string) => rows.filter((r) => r.kind === kind && r.status === status).reduce((s, r) => s + Number(r.amount_cents ?? 0), 0)
    const rec = sum('receita', 'realizado'), des = sum('despesa', 'realizado')
    const aPagar = sum('despesa', 'previsto'), aReceber = sum('receita', 'previsto')
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Receitas" value={<span className="text-brand-700 dark:text-brand-300">{money(rec)}</span>} />
        <Stat label="Despesas" value={<span className="text-red-700 dark:text-red-400">{money(des)}</span>} />
        <Stat label="Saldo do mês" value={money(rec - des)} />
        <Stat label="Previstos" value={money(aReceber - aPagar)} hint={`${money(aReceber)} a receber · ${money(aPagar)} a pagar`} />
      </div>
    )
  }
  const stats: { label: string; value: string | number }[] = [{ label: 'Registros no mês', value: rows.length }]
  if (config.key === 'exercicios') {
    stats.push({ label: 'Minutos de treino', value: rows.reduce((s, r) => s + Number(r.duration_min ?? 0), 0) })
    stats.push({ label: 'Dias com treino', value: new Set(rows.map((r) => r.performed_on)).size })
  }
  if (config.key === 'nutricao') {
    stats.push({ label: 'Refeições', value: rows.filter((r) => r.kind === 'refeicao').length })
    stats.push({ label: 'Água (litros)', value: (rows.reduce((s, r) => s + Number(r.water_ml ?? 0), 0) / 1000).toFixed(1).replace('.', ',') })
  }
  if (config.key === 'agenda') {
    const now = Date.now()
    stats.push({ label: 'Próximos', value: rows.filter((r) => !r.done && new Date(String(r.starts_at)).getTime() >= now).length })
  }
  if (config.key === 'saude') stats.push({ label: 'Sintomas', value: rows.filter((r) => r.kind === 'sintoma').length })
  if (config.key === 'psicanalise') stats.push({ label: 'Sonhos', value: rows.filter((r) => r.kind === 'sonho').length })
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{stats.map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}</div>
}

/**
 * Tela genérica de módulo. Sem ownerId: dados do próprio usuário (editáveis).
 * Com ownerId: visão do profissional sobre um cliente (somente leitura; o
 * banco só devolve dados se houver consentimento ativo).
 */
export function ModulePage({ config, ownerId, embedded = false }: { config: ModuleConfig; ownerId?: string; embedded?: boolean }) {
  const { session } = useAuth()
  const readOnly = Boolean(ownerId && ownerId !== session?.user.id)
  const owner = ownerId ?? session!.user.id
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | 'new' | null>(null)
  const [error, setError] = useState('')
  const Icon = MODULE_ICONS[config.key]

  const load = useCallback(async () => {
    setRows(null)
    const { start, end } = monthRange(ym.y, ym.m)
    const from = config.dateIsTimestamp ? new Date(`${start}T00:00:00-03:00`).toISOString() : start
    const to = config.dateIsTimestamp ? new Date(`${end}T00:00:00-03:00`).toISOString() : end
    const { data, error } = await supabase.from(config.table).select('*')
      .eq('owner_id', owner).gte(config.dateKey, from).lt(config.dateKey, to)
      .order(config.dateKey, { ascending: !!config.ascending }).order('created_at', { ascending: false }).limit(500)
    if (error) setError(errorMessage(error))
    setRows((data ?? []) as Row[])
  }, [config, owner, ym])
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const g = new Map<string, Row[]>()
    const sorted = [...(rows ?? [])].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    for (const r of sorted) {
      const k = r.pinned ? 'Fixados' : dayKey(r, config)
      g.set(k, [...(g.get(k) ?? []), r])
    }
    return [...g.entries()]
  }, [rows, config])

  async function remove(r: Row) {
    if (!confirm('Excluir este registro?')) return
    const { error } = await supabase.from(config.table).delete().eq('id', r.id)
    if (error) return setError(errorMessage(error))
    void load()
  }

  const shift = (d: number) => setYm(({ y, m }) => { const t = m + d; return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 } })

  return (
    <div>
      {!embedded && (
        <PageHeader
          title={config.title}
          subtitle={config.subtitle}
          actions={!readOnly && (
            <div className="flex gap-2">
              <Link to="/app/assistente" className="btn-outline"><Sparkles className="size-4" /> Pelo assistente</Link>
              <button className="btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" /> Adicionar</button>
            </div>
          )}
        />
      )}

      <div className="mb-4 flex items-center justify-between">
        <button className="btn-ghost !p-2" onClick={() => shift(-1)} aria-label="Mês anterior"><ChevronLeft className="size-5" /></button>
        <div className="font-medium capitalize">{MONTHS[ym.m]} de {ym.y}</div>
        <button className="btn-ghost !p-2" onClick={() => shift(1)} aria-label="Próximo mês"><ChevronRight className="size-5" /></button>
      </div>

      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {rows === null ? <Spinner className="size-6" /> : (
        <>
          <Summary config={config} rows={rows} />
          <div className="mt-6 space-y-6">
            {rows.length === 0 && (
              <EmptyState icon={Icon ?? Inbox} title="Nada registrado neste mês">
                {readOnly ? 'O cliente ainda não tem registros neste período.' : 'Adicione manualmente ou mande uma frase para o assistente.'}
              </EmptyState>
            )}
            {groups.map(([day, items]) => (
              <section key={day}>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">{day === 'Fixados' ? day : dayLabel(day)}</h3>
                <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
                  {items.map((r) => {
                    const amount = config.amount?.(r)
                    const badge = config.badge?.(r)
                    return (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{config.primary(r)}</span>
                            {badge?.text && <span className={`badge shrink-0 ${BADGE[badge.tone]}`}>{badge.text}</span>}
                          </div>
                          {config.secondary(r) && <div className="truncate text-xs text-stone-500">{config.secondary(r)}</div>}
                        </div>
                        {amount && <span className={`shrink-0 font-medium tabular-nums ${TONE[amount.tone]}`}>{amount.text}</span>}
                        {!readOnly && (
                          <div className="flex shrink-0">
                            <button className="btn-ghost !p-1.5" onClick={() => setEditing(r)} aria-label="Editar"><Pencil className="size-4" /></button>
                            <button className="btn-ghost !p-1.5 text-stone-400 hover:text-red-600" onClick={() => void remove(r)} aria-label="Excluir"><Trash2 className="size-4" /></button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {config.note && !embedded && <p className="mt-8 text-xs text-stone-500">{config.note}</p>}
      {!readOnly && editing && (
        <RecordForm config={config} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </div>
  )
}
