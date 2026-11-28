import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, Clock, Heart, Send, Stethoscope, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { BarChart, useShown } from '../wellness/charts'
import { SCALES, SPECIALTIES, SPECIALTY_FROM_PROFILE, TONE, bandOf, optionsFor, type ModuleKey, type Scale, type ScaleKey } from './catalog'

interface Response {
  id: string; owner_id: string; scale_key: ScaleKey; module_key: ModuleKey; answers: number[]; score: number; severity: string; alert: boolean
  filled_role: 'paciente' | 'profissional'; assignment_id: string | null; created_at: string
}
interface Assignment {
  id: string; owner_id: string; assigned_by: string; scale_key: ScaleKey; module_key: ModuleKey; specialty: string | null; note: string | null
  status: 'pendente' | 'respondida' | 'cancelada'; created_at: string; answered_at: string | null
}
const fmtDate = (iso: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

// ------------------------------------------------------------------ barra do resultado (faixas coloridas + marcador animado)
export function ScoreBands({ scale, score }: { scale: Scale; score: number }) {
  const shown = useShown(100)
  const max = scale.max
  let prev = -1
  const segs = scale.bands.map((b) => { const from = prev + 1; prev = b.upTo; return { ...b, from, w: ((b.upTo - from + 1) / (max + 1)) * 100 } })
  const pos = ((score + 0.5) / (max + 1)) * 100
  return (
    <div className="relative pb-5 pt-2">
      <div className="flex h-3 overflow-hidden rounded-full">
        {segs.map((s, i) => (
          <div key={s.key} className={`${TONE[s.tone].bg} h-full origin-left transition-transform duration-500 ${shown ? 'scale-x-100' : 'scale-x-0'}`}
            style={{ width: `${s.w}%`, transitionDelay: `${i * 90}ms`, opacity: scale.bands.find((b) => score <= b.upTo)?.key === s.key ? 1 : 0.35 }} title={s.label} />
        ))}
      </div>
      <div className="absolute top-0 -translate-x-1/2 transition-[left] duration-[1100ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none" style={{ left: `${shown ? pos : 0}%` }}>
        <span className="block size-7 rounded-full border-4 border-white bg-stone-900 shadow dark:border-stone-900 dark:bg-white" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-stone-400"><span>0</span><span>{max}</span></div>
    </div>
  )
}

function SafetyNote() {
  return (
    <div className="flex gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <Heart className="mt-0.5 size-4 shrink-0" />
      <div>
        Você indicou pensamentos de se ferir ou de que seria melhor não estar aqui. Você não precisa passar por isso sozinho(a):
        converse com alguém de confiança ou com seu profissional. O <b>CVV</b> atende 24 horas, de graça, pelo telefone <b>188</b> ou em cvv.org.br.
        Em emergência, ligue <b>192</b> (SAMU).
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ responder
function ScaleForm({ scale, owner, module, assignment, filledByPro, onClose, onDone }: {
  scale: Scale; owner: string; module: ModuleKey; assignment?: Assignment | null; filledByPro: boolean; onClose: () => void; onDone: () => void
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => scale.questions.map(() => null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Response | null>(null)
  const done = answers.filter((a) => a != null).length
  const set = (i: number, v: number) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))

  async function submit() {
    if (answers.some((a) => a == null)) return setError('Responda todas as perguntas.')
    setBusy(true); setError('')
    const { data, error } = await supabase.from('scale_responses')
      .insert({ owner_id: owner, scale_key: scale.key, module_key: assignment?.module_key ?? module, answers, assignment_id: assignment?.id ?? null })
      .select('*').single()
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setResult(data as Response)
  }

  const band = result ? bandOf(scale, result.severity) : null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{scale.title}</h2>
          <button className="btn-ghost !p-2" onClick={result ? onDone : onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        {filledByPro && !result && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Aplicando junto com o paciente: marque as respostas dele(a).</p>}

        {!result ? (
          <>
            <p className="mb-3 text-sm text-stone-500">{scale.about}</p>
            <div className="sticky top-0 z-10 -mx-5 mb-3 bg-white/95 px-5 py-2 backdrop-blur dark:bg-stone-900/95">
              <div className="flex items-center justify-between text-xs text-stone-500"><span>{scale.stem ?? ''}</span><span>{done}/{scale.questions.length}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${(done / scale.questions.length) * 100}%` }} />
              </div>
            </div>
            <ol className="space-y-4">
              {scale.questions.map((q, i) => (
                <li key={i}>
                  <p className="mb-2 text-[15px] font-medium">{scale.questions.length > 1 && <span className="text-stone-400">{i + 1}. </span>}{q.text}</p>
                  <div className={`grid gap-1.5 ${optionsFor(scale, i).length > 6 ? 'grid-cols-6 sm:grid-cols-11' : 'sm:grid-cols-2'}`}>
                    {optionsFor(scale, i).map((o) => (
                      <button key={o.label} type="button" onClick={() => set(i, o.value)}
                        className={`rounded-xl border px-3 py-2 text-left text-sm transition ${answers[i] === o.value
                          ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-200 hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800'} ${optionsFor(scale, i).length > 6 ? '!text-center' : ''}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
            {error && <div className="mt-3"><Alert>{error}</Alert></div>}
            <div className="mt-5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-stone-400">{scale.source}</span>
              <button className="btn-primary" onClick={() => void submit()} disabled={busy || done < scale.questions.length}>{busy && <Spinner />} Ver resultado</button>
            </div>
          </>
        ) : (
          <div className="space-y-4 motion-safe:animate-[fadein_.35s_ease-out]">
            <div className="text-center">
              <div className="font-display text-5xl font-semibold tabular-nums">{result.score}<span className="text-lg text-stone-400"> / {scale.max}</span></div>
              <div className={`mt-1 text-lg font-semibold ${TONE[band!.tone].text}`}>{band!.label}</div>
            </div>
            <ScoreBands scale={scale} score={result.score} />
            {scale.detail?.[result.severity] && <p className="text-sm text-stone-600 dark:text-stone-300">{scale.detail[result.severity]}</p>}
            {result.alert && <SafetyNote />}
            <p className="text-xs text-stone-500">Escala de rastreio: não é diagnóstico. O resultado fica no seu histórico{filledByPro ? '' : ' e, se você autorizou, visível para seu profissional'}.</p>
            <div className="flex justify-end"><button className="btn-primary" onClick={onDone}>Concluir</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ histórico de uma escala
function History({ scale, rows, canDelete, onDelete }: { scale: Scale; rows: Response[]; canDelete: boolean; onDelete: (id: string) => void }) {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return (
    <div className="mt-3 space-y-3 motion-safe:animate-[fadein_.3s_ease-out]">
      {sorted.length > 1 && (
        <BarChart data={sorted.map((r) => ({ key: r.id, label: fmtDate(r.created_at).slice(0, 5), a: r.score }))} aLabel={scale.name} unit="pontos" height={140} aClass="fill-brand-600" />
      )}
      <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
        {[...sorted].reverse().map((r) => {
          const b = bandOf(scale, r.severity)
          return (
            <li key={r.id} className="flex items-center gap-2 py-2">
              <span className="w-16 text-xs text-stone-500">{fmtDate(r.created_at)}</span>
              <b className="w-10 tabular-nums">{r.score}</b>
              <span className={`badge ${TONE[b.tone].badge}`}>{b.label}</span>
              {r.alert && <span className="badge bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"><AlertTriangle className="size-3" /> atenção</span>}
              <span className="ml-auto text-xs text-stone-400">{r.filled_role === 'profissional' ? 'aplicada pelo profissional' : 'respondida pelo paciente'}</span>
              {canDelete && <button className="btn-ghost !p-1 text-stone-400" onClick={() => onDelete(r.id)} aria-label="Apagar"><Trash2 className="size-3.5" /></button>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ painel
/**
 * mode 'escalas': escalas do módulo (ex.: Psicologia).
 * mode 'especialidades': escolhe a especialidade e mostra as escalas pertinentes.
 * Paciente responde; profissional (com autorização) libera o pedido ou aplica junto.
 */
export function ScalesPanel({ owner, module, mode }: { owner: string; module: ModuleKey; mode: 'escalas' | 'especialidades' }) {
  const { session } = useAuth()
  const me = session!.user.id
  const isPro = me !== owner
  const [responses, setResponses] = useState<Response[] | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [proNames, setProNames] = useState<Record<string, string>>({})
  const [specialty, setSpecialty] = useState<string>(() => (module === 'psicanalise' ? 'psicologia' : 'clinica_geral'))
  const [form, setForm] = useState<{ scale: Scale; assignment?: Assignment } | null>(null)
  const [open, setOpen] = useState<ScaleKey | null>(null)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = useCallback(async () => {
    const [{ data: r }, { data: a }] = await Promise.all([
      supabase.from('scale_responses').select('*').eq('owner_id', owner).eq('module_key', module).order('created_at', { ascending: false }),
      supabase.from('scale_assignments').select('*').eq('owner_id', owner).eq('module_key', module).order('created_at', { ascending: false }).limit(50),
    ])
    setResponses((r ?? []) as Response[])
    const as = (a ?? []) as Assignment[]
    setAssignments(as)
    const ids = [...new Set(as.map((x) => x.assigned_by))]
    if (ids.length) {
      const { data: p } = await supabase.from('professional_profiles').select('user_id, public_name').in('user_id', ids)
      setProNames(Object.fromEntries((p ?? []).map((x) => [x.user_id, x.public_name])))
    }
  }, [owner, module])
  useEffect(() => { void load() }, [load])

  // Especialidade inicial: a do cadastro do profissional.
  useEffect(() => {
    if (!isPro || mode !== 'especialidades') return
    supabase.from('professional_specialties').select('specialties(key)').eq('professional_id', me).then(({ data }) => {
      const k = (data ?? []).map((d) => (d.specialties as unknown as { key: string } | null)?.key).find((x) => x && SPECIALTY_FROM_PROFILE[x])
      if (k) setSpecialty(SPECIALTY_FROM_PROFILE[k])
    })
  }, [isPro, mode, me])

  const scaleKeys: ScaleKey[] = useMemo(() => {
    const keys = mode === 'escalas' ? (['gad7', 'phq9', 'who5'] as ScaleKey[]) : SPECIALTIES.find((s) => s.key === specialty)?.scales ?? []
    return keys.filter((k) => SCALES[k].modules.includes(module))
  }, [mode, specialty, module])

  const pending = assignments.filter((a) => a.status === 'pendente')
  const byScale = (k: ScaleKey) => (responses ?? []).filter((r) => r.scale_key === k)

  async function assign(k: ScaleKey) {
    setMsg(null)
    const { error } = await supabase.from('scale_assignments').insert({ owner_id: owner, scale_key: k, module_key: module, specialty: mode === 'especialidades' ? specialty : module })
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setMsg({ kind: 'success', text: `${SCALES[k].name} liberada. O paciente verá o pedido na aba ${module === 'saude' ? 'Saúde → Especialidades' : 'Psicologia → Escalas'}.` })
    void load()
  }
  async function cancel(a: Assignment) {
    if (!confirm('Cancelar este pedido?')) return
    const { error } = await supabase.from('scale_assignments').update({ status: 'cancelada' }).eq('id', a.id)
    if (error) setMsg({ kind: 'error', text: errorMessage(error) }); else void load()
  }
  async function remove(id: string) {
    if (!confirm('Apagar este resultado do histórico?')) return
    const { error } = await supabase.from('scale_responses').delete().eq('id', id)
    if (error) setMsg({ kind: 'error', text: errorMessage(error) }); else void load()
  }

  if (!responses) return <Spinner className="size-6" />
  return (
    <div className="space-y-4">
      {/* Pedidos pendentes */}
      {pending.length > 0 && (
        <section className="rounded-2xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900 dark:bg-sky-950/20">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-sky-600" /> {isPro ? 'Pedidos aguardando o paciente' : 'Pedidos do seu profissional'}</h3>
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm dark:bg-stone-900">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{SCALES[a.scale_key].title}</div>
                  <div className="text-xs text-stone-500"><Clock className="mr-1 inline size-3" />pedido em {fmtDate(a.created_at)}{proNames[a.assigned_by] ? ` por ${proNames[a.assigned_by]}` : ''}</div>
                </div>
                {!isPro && <button className="btn-primary !px-3 !py-1.5" onClick={() => setForm({ scale: SCALES[a.scale_key], assignment: a })}>Responder ({SCALES[a.scale_key].minutes} min)</button>}
                {isPro && a.assigned_by === me && <>
                  <button className="btn-outline !px-3 !py-1.5" onClick={() => setForm({ scale: SCALES[a.scale_key], assignment: a })}>Aplicar agora</button>
                  <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => void cancel(a)}>Cancelar</button>
                </>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mode === 'especialidades' && (
        <label className="block">
          <span className="label flex items-center gap-1.5"><Stethoscope className="size-4" /> Especialidade</span>
          <select className="input" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            {SPECIALTIES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {scaleKeys.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="Nenhuma escala para esta especialidade aqui">Novas escalas serão adicionadas aos poucos.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {scaleKeys.map((k) => {
            const s = SCALES[k]
            const hist = byScale(k)
            const last = hist[0]
            const b = last ? bandOf(s, last.severity) : null
            return (
              <li key={k} className="card !p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{s.title}</div>
                    <div className="text-xs text-stone-500">{s.about} · {s.questions.length} pergunta{s.questions.length > 1 ? 's' : ''} · ~{s.minutes} min</div>
                  </div>
                  {last && b && (
                    <div className="text-right">
                      <div className="font-display text-2xl font-semibold tabular-nums">{last.score}</div>
                      <span className={`badge ${TONE[b.tone].badge}`}>{b.label}</span>
                    </div>
                  )}
                </div>
                {last && <div className="mt-2"><ScoreBands scale={s} score={last.score} /></div>}
                {last?.alert && <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-400"><AlertTriangle className="size-3.5" /> A última resposta pede atenção (pergunta 9).</div>}
                <div className="flex flex-wrap items-center gap-2">
                  {!isPro && <button className="btn-primary !px-3 !py-1.5" onClick={() => setForm({ scale: s })}>{last ? 'Responder de novo' : 'Responder'}</button>}
                  {isPro && <>
                    <button className="btn-primary !px-3 !py-1.5" onClick={() => void assign(k)}><Send className="size-4" /> Liberar para o paciente</button>
                    <button className="btn-outline !px-3 !py-1.5" onClick={() => setForm({ scale: s })}>Aplicar agora</button>
                  </>}
                  {hist.length > 0 && (
                    <button className="btn-ghost ml-auto !px-2 !py-1.5 text-xs" onClick={() => setOpen((o) => (o === k ? null : k))}>
                      {open === k ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />} Histórico ({hist.length})
                    </button>
                  )}
                </div>
                {open === k && <History scale={s} rows={hist} canDelete={!isPro} onDelete={(id) => void remove(id)} />}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-stone-400">Escalas de rastreio validadas, de uso livre. Não substituem avaliação clínica.</p>

      {form && <ScaleForm scale={form.scale} owner={owner} module={module} assignment={form.assignment ?? null} filledByPro={isPro}
        onClose={() => setForm(null)} onDone={() => { setForm(null); void load() }} />}
    </div>
  )
}
