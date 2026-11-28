import { BookOpen, ClipboardCheck, Moon, NotebookPen, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { PendingDrafts } from '../../components/PendingDrafts'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { MODULES, todayISO } from '../config'
import { ModulePage } from '../ModulePage'
import { ScalesPanel } from '../scales/ScalesPanel'
import { BarChart, useShown } from '../wellness/charts'

/** Motivos frequentes em relatos de sonhos (o usuário pode criar outros). */
export const DREAM_THEMES = [
  'queda', 'perseguição', 'voar', 'água', 'morte', 'família', 'mãe', 'pai', 'filhos', 'relacionamento', 'ex', 'trabalho',
  'escola / prova', 'atraso', 'dentes', 'nudez / exposição', 'casa', 'animais', 'viagem', 'infância', 'perda', 'violência',
  'doença', 'dinheiro', 'pessoa desconhecida', 'lugar desconhecido',
]
const EMOTIONS = ['medo', 'angústia', 'tristeza', 'raiva', 'culpa', 'vergonha', 'alegria', 'alívio', 'saudade', 'confusão', 'calma', 'excitação']

interface Dream {
  id: string; owner_id: string; kind: 'sonho' | 'insight'; content: string; emotions: string[] | null; themes: string[]
  interpretation: string | null; notes: string | null; occurred_on: string
  symbols: string[]; ai_status: 'pendente' | 'pronto' | 'falhou' | null; ai_summary: string | null; ai_interpretation: string | null; ai_questions: string[]
}
const br = (iso: string) => iso.split('-').reverse().join('/')
const addMonths = (iso: string, m: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10) }

function Chips({ all, value, onChange, placeholder }: { all: string[]; value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [custom, setCustom] = useState('')
  const options = [...new Set([...all, ...value])]
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((t) => (
          <button key={t} type="button" onClick={() => toggle(t)}
            className={`badge border !px-2.5 !py-1 ${value.includes(t) ? 'border-violet-600 bg-violet-600 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>{t}</button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input className="input !py-1.5" placeholder={placeholder} value={custom} onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const t = custom.trim().toLowerCase(); if (t && !value.includes(t)) onChange([...value, t]); setCustom('') } }} />
        <button type="button" className="btn-outline !py-1.5" onClick={() => { const t = custom.trim().toLowerCase(); if (t && !value.includes(t)) onChange([...value, t]); setCustom('') }}>Incluir</button>
      </div>
    </div>
  )
}

function DreamForm({ dream, owner, onClose, onSaved }: { dream: Dream | null; owner: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    occurred_on: dream?.occurred_on ?? todayISO(), content: dream?.content ?? '', interpretation: dream?.interpretation ?? '', notes: dream?.notes ?? '',
  })
  const [themes, setThemes] = useState<string[]>(dream?.themes ?? [])
  const [emotions, setEmotions] = useState<string[]>(dream?.emotions ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!f.content.trim()) return setError('Escreva o relato do sonho.')
    setBusy(true); setError('')
    const row = { kind: 'sonho', occurred_on: f.occurred_on, content: f.content.trim(), interpretation: f.interpretation.trim() || null, notes: f.notes.trim() || null, themes, emotions }
    const { error } = dream ? await supabase.from('psy_entries').update(row).eq('id', dream.id) : await supabase.from('psy_entries').insert({ ...row, owner_id: owner })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }
  async function remove() {
    if (!dream || !confirm('Apagar este sonho?')) return
    const { error } = await supabase.from('psy_entries').delete().eq('id', dream.id)
    if (error) return setError(errorMessage(error))
    onSaved()
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{dream ? 'Editar sonho' : 'Registrar sonho'}</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        <div className="space-y-4">
          <label className="block"><span className="label">Data</span><input type="date" className="input" value={f.occurred_on} onChange={(e) => setF((x) => ({ ...x, occurred_on: e.target.value }))} /></label>
          <label className="block"><span className="label">Relato do sonho</span>
            <textarea className="input min-h-32" value={f.content} onChange={(e) => setF((x) => ({ ...x, content: e.target.value }))} placeholder="Conte o sonho do jeito que lembrar, com detalhes, pessoas e lugares." /></label>
          <p className="rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200"><Sparkles className="mr-1 inline size-3.5" />Ao salvar, a IA lê o relato, sugere uma interpretação e marca os motivos, emoções e elementos principais. Você pode marcar os seus também.</p>
          <div><span className="label">Motivos principais</span><Chips all={DREAM_THEMES} value={themes} onChange={setThemes} placeholder="Outro motivo…" /></div>
          <div><span className="label">Emoções no sonho / ao acordar</span><Chips all={EMOTIONS} value={emotions} onChange={setEmotions} placeholder="Outra emoção…" /></div>
          <label className="block"><span className="label">Associações (o que lembrou, o que aconteceu no dia)</span>
            <textarea className="input min-h-16" value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} /></label>
          <label className="block"><span className="label">Sua interpretação (ou a da sessão)</span>
            <textarea className="input min-h-20" value={f.interpretation} onChange={(e) => setF((x) => ({ ...x, interpretation: e.target.value }))} placeholder="O que você acha que o sonho diz, ou o que foi trabalhado na sessão." /></label>
          {error && <Alert>{error}</Alert>}
          <div className="flex items-center gap-2">
            {dream && <button type="button" className="btn-danger" onClick={() => void remove()}><Trash2 className="size-4" /> Apagar</button>}
            <button className="btn-primary ml-auto" disabled={busy}>{busy && <Spinner />} Salvar</button>
          </div>
        </div>
      </form>
    </div>
  )
}

function FreqBars({ title, items, active, onPick, color }: { title: string; items: [string, number][]; active: string | null; onPick: (t: string | null) => void; color: string }) {
  const shown = useShown(100)
  const max = Math.max(1, ...items.map(([, n]) => n))
  if (!items.length) return null
  return (
    <section className="card">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-1.5">
        {items.slice(0, 10).map(([t, n], i) => (
          <li key={t}>
            <button className={`w-full text-left ${active && active !== t ? 'opacity-40' : ''}`} onClick={() => onPick(active === t ? null : t)}>
              <div className="mb-0.5 flex justify-between text-sm"><span className="capitalize">{t}</span><span className="tabular-nums text-stone-500">{n}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`} style={{ width: shown ? `${(n / max) * 100}%` : '0%', transitionDelay: `${i * 60}ms` }} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function DreamsTab({ owner, readOnly }: { owner: string; readOnly: boolean }) {
  const [rows, setRows] = useState<Dream[] | null>(null)
  const [period, setPeriod] = useState<3 | 12 | 0>(3)
  const [theme, setTheme] = useState<string | null>(null)
  const [editing, setEditing] = useState<Dream | 'novo' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('psy_entries').select('id, owner_id, kind, content, emotions, themes, interpretation, notes, occurred_on, symbols, ai_status, ai_summary, ai_interpretation, ai_questions')
      .eq('owner_id', owner).eq('kind', 'sonho').order('occurred_on', { ascending: false }).limit(1000)
    setRows((data ?? []) as Dream[])
  }, [owner])
  useEffect(() => { void load() }, [load])
  // Enquanto a IA interpreta, atualiza sozinho a cada 4 s (por até 2 min).
  const pending = (rows ?? []).some((r) => r.ai_status === 'pendente')
  useEffect(() => {
    if (!pending) return
    let n = 0
    const t = setInterval(() => { if (++n > 30) clearInterval(t); else void load() }, 4000)
    return () => clearInterval(t)
  }, [pending, load])
  async function reinterpret(id: string) {
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, ai_status: 'pendente' } : r)) ?? null)
    await supabase.functions.invoke('dream-interpret', { body: { id } })
    void load()
  }

  const inPeriod = useMemo(() => {
    const from = period ? addMonths(todayISO(), -period) : '0000'
    return (rows ?? []).filter((r) => r.occurred_on >= from)
  }, [rows, period])
  const count = (key: 'themes' | 'emotions' | 'symbols') => {
    const m = new Map<string, number>()
    inPeriod.forEach((r) => (r[key] ?? []).forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const themes = count('themes'), emotions = count('emotions'), symbols = count('symbols')
  const months = useMemo(() => {
    const n = period || 12
    return Array.from({ length: n }, (_, i) => {
      const d = addMonths(todayISO(), i - n + 1).slice(0, 7)
      return { key: d, label: new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${d}-15T12:00:00Z`)).replace('.', ''), a: (rows ?? []).filter((r) => r.occurred_on.startsWith(d)).length }
    })
  }, [rows, period])
  const list = inPeriod.filter((r) => !theme || r.themes.includes(theme) || (r.emotions ?? []).includes(theme) || (r.symbols ?? []).includes(theme))

  if (!rows) return <Spinner className="size-6" />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-stone-200/60 p-1 text-sm dark:bg-stone-800">
          {([[3, '3 meses'], [12, '12 meses'], [0, 'Tudo']] as const).map(([p, l]) => (
            <button key={p} onClick={() => setPeriod(p)} className={`rounded-lg px-3 py-1 font-medium ${period === p ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'}`}>{l}</button>
          ))}
        </div>
        {!readOnly && <button className="btn-primary ml-auto" onClick={() => setEditing('novo')}><Plus className="size-4" /> Registrar sonho</button>}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Moon} title="Nenhum sonho registrado">{readOnly ? 'O cliente ainda não registrou sonhos.' : 'Registre ao acordar: o relato, os motivos principais e as emoções. Com o tempo aparecem os temas que se repetem.'}</EmptyState>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FreqBars title={`Motivos mais frequentes (${inPeriod.length} sonhos)`} items={themes} active={theme} onPick={setTheme} color="bg-violet-500" />
            <FreqBars title="Emoções mais frequentes" items={emotions} active={theme} onPick={setTheme} color="bg-rose-400" />
            <FreqBars title="Elementos que se repetem" items={symbols} active={theme} onPick={setTheme} color="bg-sky-500" />
          </div>
          <section className="card">
            <h3 className="mb-2 text-sm font-semibold">Sonhos por mês</h3>
            <BarChart data={months} aLabel="Sonhos" unit="" aClass="fill-violet-500" height={130} />
          </section>
          {theme && <div className="flex items-center gap-2 text-sm">Filtrando por <b className="capitalize">{theme}</b><button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setTheme(null)}>Limpar</button></div>}
          <ul className="space-y-2">
            {list.map((d) => (
              <li key={d.id} className="card !p-4">
                <button className="w-full text-left" onClick={() => setOpenId((o) => (o === d.id ? null : d.id))}>
                  <div className="text-xs text-stone-500">{br(d.occurred_on)}</div>
                  {d.ai_summary && <p className="mt-1 text-sm font-medium text-violet-800 dark:text-violet-300">{d.ai_summary}</p>}
                  <p className={`mt-1 whitespace-pre-line text-[15px] ${openId === d.id ? '' : 'line-clamp-2'}`}>{d.content}</p>
                </button>
                {d.ai_status === 'pendente' && <div className="mt-2 flex items-center gap-2 text-xs text-violet-700 dark:text-violet-300"><Spinner className="size-3.5" /> A IA está interpretando o sonho…</div>}
                {d.ai_status === 'falhou' && <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">Não deu para interpretar agora.{!readOnly && <button className="ml-2 underline" onClick={() => void reinterpret(d.id)}>Tentar de novo</button>}</div>}
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.themes.map((t) => <span key={t} className="badge bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300">{t}</span>)}
                  {(d.emotions ?? []).map((t) => <span key={t} className="badge bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">{t}</span>)}
                  {(d.symbols ?? []).map((t) => <span key={t} className="badge bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">{t}</span>)}
                </div>
                {openId === d.id && (
                  <div className="mt-3 space-y-2 text-sm motion-safe:animate-[fadein_.3s_ease-out]">
                    {d.notes && <p><span className="text-stone-500">Associações:</span> {d.notes}</p>}
                    {d.ai_interpretation && (
                      <div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-900 dark:bg-violet-950/30">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-violet-800 dark:text-violet-300"><Sparkles className="size-3.5" /> Leitura sugerida pela IA</div>
                        <div className="space-y-2 whitespace-pre-line">{d.ai_interpretation}</div>
                        {d.ai_questions.length > 0 && (
                          <div className="mt-3"><div className="text-xs font-semibold text-stone-600 dark:text-stone-400">Para refletir</div>
                            <ul className="mt-1 list-disc space-y-1 pl-5">{d.ai_questions.map((q) => <li key={q}>{q}</li>)}</ul></div>
                        )}
                        <p className="mt-3 text-[11px] text-stone-500">São possibilidades para pensar, não um diagnóstico. Quem dá sentido ao sonho é você (e a conversa com seu profissional).</p>
                      </div>
                    )}
                    {d.interpretation && <p><span className="text-stone-500">Sua interpretação:</span> {d.interpretation}</p>}
                    {!readOnly && (
                      <div className="flex flex-wrap gap-2">
                        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditing(d)}><Pencil className="size-3.5" /> Editar / interpretar</button>
                        {d.ai_status !== 'pendente' && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void reinterpret(d.id)}><Sparkles className="size-3.5" /> Interpretar de novo</button>}
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {editing && <DreamForm dream={editing === 'novo' ? null : editing} owner={owner} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

type Tab = 'sonhos' | 'escalas' | 'diario'
const TABS: { key: Tab; label: string; icon: typeof Moon }[] = [
  { key: 'sonhos', label: 'Sonhos', icon: Moon }, { key: 'escalas', label: 'Escalas', icon: ClipboardCheck }, { key: 'diario', label: 'Diário', icon: NotebookPen },
]

export function PsychPage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean }) {
  const { session } = useAuth()
  const owner = ownerId ?? session!.user.id
  const readOnly = owner !== session?.user.id
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('aba') as Tab) || 'sonhos')
  const [rk, setRk] = useState(0)
  return (
    <div>
      {!embedded && (
        <PageHeader title="Psicologia e Psicanálise" subtitle="Sonhos, escalas e diário — só seus e de quem você autorizar."
          actions={!readOnly && <Link to="/app/assistente" className="btn-outline"><Sparkles className="size-4" /> Pelo assistente</Link>} />
      )}
      {!readOnly && <PendingDrafts moduleKey="psicanalise" moduleName="Psicologia e Psicanálise" onDecided={() => setRk((k) => k + 1)} />}
      <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-xs font-medium transition sm:flex-row sm:justify-center sm:gap-1.5 sm:text-sm ${tab === t.key ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50' : 'text-stone-600 dark:text-stone-400'}`}>
            <t.icon className="size-4" /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'sonhos' && <DreamsTab key={rk} owner={owner} readOnly={readOnly} />}
      {tab === 'escalas' && <ScalesPanel key={rk} owner={owner} module="psicanalise" mode="escalas" />}
      {tab === 'diario' && <ModulePage key={rk} config={MODULES.psicanalise} ownerId={ownerId} embedded />}
      <p className="mt-8 flex items-center gap-1.5 text-xs text-stone-500"><BookOpen className="size-3.5" /> Registro pessoal. Escalas são rastreios, não diagnósticos.</p>
    </div>
  )
}
