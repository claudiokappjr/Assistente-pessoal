import {
  Activity, CalendarClock, Check, ChevronLeft, FileText, FlaskConical, LineChart, NotebookPen, Paperclip, Pencil, Pill, Plus,
  Sparkles, Stethoscope, Trash2, Upload, X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { MODULES, todayISO } from '../config'
import { ModulePage } from '../ModulePage'

// ------------------------------------------------------------------ tipos
type Flag = 'baixo' | 'normal' | 'alto' | 'alterado'
interface LabResult {
  id?: string; exam_id?: string; position: number; marker: string; marker_key?: string; category: string | null
  value: number | null; value_text: string | null; unit: string | null
  ref_low: number | null; ref_high: number | null; ref_text: string | null; flag: Flag | null
  is_previous?: boolean; measured_on?: string | null
}
interface LabExam {
  id: string; owner_id: string; collected_on: string; lab_name: string | null; title: string | null; file_path: string | null
  status: 'processando' | 'revisar' | 'conferido' | 'falhou'; error: string | null; notes: string | null; lab_results: LabResult[]
}
interface Medication {
  id: string; name: string; dose: string | null; frequency: string | null; route: string | null; reason: string | null
  prescriber: string | null; started_on: string; ended_on: string | null; prescription_path: string | null; notes: string | null
}
interface Consultation {
  id: string; consulted_on: string; specialty: string; professional_name: string | null; location: string | null
  reason: string | null; summary: string | null; conduct: string | null; next_return_on: string | null
  attachment_path: string | null; notes: string | null
}

const BUCKET = 'health-files'
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp'

// ------------------------------------------------------------------ utilitários
const br = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '')
const addDays = (iso: string, d: number) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }
const fmt = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const parseDec = (s: string) => { const t = s.trim().replace(/\s/g, '').replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null }
const autoFlag = (v: number | null, lo: number | null, hi: number | null, current: Flag | null): Flag | null => {
  if (v == null || (lo == null && hi == null)) return current
  if (lo != null && v < lo) return 'baixo'
  if (hi != null && v > hi) return 'alto'
  return 'normal'
}
const FLAG_STYLE: Record<Flag, string> = {
  baixo: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  alto: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  alterado: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  normal: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200',
}
const FLAG_LABEL: Record<Flag, string> = { baixo: 'Abaixo', alto: 'Acima', alterado: 'Alterado', normal: 'Na referência' }
/** Situação do resultado: calculada pela faixa quando há números; senão, a do laudo. */
const effFlag = (r: Pick<LabResult, 'value' | 'ref_low' | 'ref_high' | 'flag'>): Flag | null =>
  r.flag === 'alterado' && r.value == null ? r.flag : autoFlag(r.value, r.ref_low, r.ref_high, r.flag)
const current = (e: LabExam) => e.lab_results.filter((r) => !r.is_previous)
const previousOf = (e: LabExam, r: LabResult) =>
  e.lab_results.filter((p) => p.is_previous && (p.marker_key ?? p.marker.toLowerCase()) === (r.marker_key ?? r.marker.toLowerCase()) && p.measured_on)
    .sort((a, b) => a.measured_on!.localeCompare(b.measured_on!))
const refLabel = (r: Pick<LabResult, 'ref_low' | 'ref_high' | 'ref_text'>) =>
  r.ref_low != null && r.ref_high != null ? `${fmt(r.ref_low)} a ${fmt(r.ref_high)}`
    : r.ref_high != null ? `até ${fmt(r.ref_high)}` : r.ref_low != null ? `acima de ${fmt(r.ref_low)}` : r.ref_text ?? ''

async function fnError(error: unknown) {
  let detail = errorMessage(error)
  try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail } catch { /* sem corpo */ }
  return detail
}

async function uploadHealthFile(owner: string, folder: string, file: File) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Arquivo maior que 15 MB.')
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) throw new Error('Envie PDF, JPG, PNG ou WEBP. Fotos HEIC do iPhone: tire um print da tela e envie o print.')
  const path = `${owner}/${folder}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined })
  if (error) throw error
  return path
}

/** Abre o arquivo privado com um link temporário (1 minuto). */
async function openFile(path: string) {
  const win = window.open('', '_blank')
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60)
  if (error || !data) { win?.close(); alert('Não consegui abrir o arquivo.'); return }
  if (win) win.location.href = data.signedUrl
  else window.location.href = data.signedUrl
}
const removeFile = (path: string | null) => (path ? supabase.storage.from(BUCKET).remove([path]) : Promise.resolve())

function Modal({ title, onClose, children, onSubmit, wide }: { title: string; onClose: () => void; children: ReactNode; onSubmit?: (e: FormEvent) => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={onSubmit ?? ((e) => e.preventDefault())} onClick={(e) => e.stopPropagation()}
        className={`max-h-[92dvh] w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-3xl dark:bg-stone-900`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        {children}
      </form>
    </div>
  )
}

function Field({ label, children, half }: { label: string; children: ReactNode; half?: boolean }) {
  return <label className={`block ${half ? '' : 'col-span-2'}`}><span className="label">{label}</span>{children}</label>
}

/** Botão que abre o seletor de arquivo. */
function FileButton({ onFile, busy, children, className = 'btn-outline' }: { onFile: (f: File) => void; busy?: boolean; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={ref} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f) }} />
      <button type="button" className={className} disabled={busy} onClick={() => ref.current?.click()}>{busy ? <Spinner /> : <Upload className="size-4" />} {children}</button>
    </>
  )
}

// ================================================================== EXAMES
function useExams(owner: string) {
  const [exams, setExams] = useState<LabExam[] | null>(null)
  const load = useCallback(async () => {
    const { data } = await supabase.from('lab_exams').select('*, lab_results(*)').eq('owner_id', owner).order('collected_on', { ascending: false }).order('created_at', { ascending: false })
    setExams(((data ?? []) as LabExam[]).map((e) => ({ ...e, lab_results: [...e.lab_results].sort((a, b) => a.position - b.position) })))
  }, [owner])
  useEffect(() => { void load() }, [load])
  return { exams, load }
}

const readMsg = (d: { results: number; previous?: number }) =>
  `${d.results} resultados lidos${d.previous ? ` e ${d.previous} resultados anteriores guardados no histórico` : ''}. Confira e marque como conferido.`

const STATUS: Record<LabExam['status'], { text: string; cls: string }> = {
  processando: { text: 'Lendo…', cls: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300' },
  revisar: { text: 'Para conferir', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  conferido: { text: 'Conferido', cls: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200' },
  falhou: { text: 'Não lido', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
}

function ExamsTab({ owner, readOnly }: { owner: string; readOnly: boolean }) {
  const { exams, load } = useExams(owner)
  const [view, setView] = useState<'exames' | 'graficos'>('exames')
  const [editing, setEditing] = useState<LabExam | 'novo' | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  // Enquanto algum exame estiver sendo lido, atualiza a lista.
  useEffect(() => {
    if (!exams?.some((e) => e.status === 'processando')) return
    const t = setTimeout(() => void load(), 5000)
    return () => clearTimeout(t)
  }, [exams, load])

  async function upload(file: File) {
    setBusy(true); setMsg(null)
    try {
      const path = await uploadHealthFile(owner, 'exames', file)
      void load()
      const { data, error } = await supabase.functions.invoke('health-doc-parse', { body: { path, kind: 'exam' } })
      if (error) setMsg({ kind: 'error', text: await fnError(error) })
      else { setMsg({ kind: 'success', text: readMsg(data) }); setViewing(data.exam_id) }
    } catch (e) { setMsg({ kind: 'error', text: errorMessage(e) }) }
    setBusy(false)
    void load()
  }

  async function reread(exam: LabExam) {
    if (!confirm('Ler este exame de novo com a IA? As correções que você fez nele serão substituídas.')) return
    setViewing(null); setBusy(true); setMsg(null)
    void load()
    const { data, error } = await supabase.functions.invoke('health-doc-parse', { body: { exam_id: exam.id } })
    if (error) setMsg({ kind: 'error', text: await fnError(error) })
    else { setMsg({ kind: 'success', text: readMsg(data) }); setViewing(exam.id) }
    setBusy(false)
    void load()
  }

  if (!exams) return <Spinner className="size-6" />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-stone-200/60 p-1 text-sm dark:bg-stone-800">
          {([['exames', 'Exames', FileText], ['graficos', 'Evolução', LineChart]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setView(k)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium ${view === k ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 dark:text-stone-400'}`}><I className="size-4" />{l}</button>
          ))}
        </div>
        {!readOnly && (
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => setEditing('novo')}><Plus className="size-4" /> Digitar</button>
            <FileButton onFile={upload} busy={busy} className="btn-primary">Enviar exame (PDF ou foto)</FileButton>
          </div>
        )}
      </div>
      {busy && <Alert kind="info">Lendo seu exame com a IA… pode levar até 1 minuto. Pode continuar usando o app.</Alert>}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {view === 'exames' && (exams.length === 0 ? (
        <EmptyState icon={FlaskConical} title="Nenhum exame ainda">
          {readOnly ? 'O cliente ainda não registrou exames.' : 'Envie o PDF (ou uma foto) do laudo: a IA lê cada resultado e você confere antes de guardar.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {exams.map((e) => {
            const cur = current(e)
            const altered = cur.filter((r) => { const f = effFlag(r); return f && f !== 'normal' }).length
            return (
              <li key={e.id}>
                <button onClick={() => e.status !== 'processando' && (e.status === 'falhou' && !readOnly ? setEditing(e) : setViewing(e.id))} className="card flex w-full items-center gap-3 !p-4 text-left hover:border-brand-300">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sand-200 text-brand-700 dark:bg-stone-800 dark:text-brand-300"><FlaskConical className="size-5" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{e.title || 'Exame'}</span>
                      <span className={`badge ${STATUS[e.status].cls}`}>{e.status === 'processando' && <Spinner className="size-3" />}{STATUS[e.status].text}</span>
                    </div>
                    <div className="truncate text-xs text-stone-500">
                      {[br(e.collected_on), e.lab_name, cur.length ? `${cur.length} resultados` : null, altered ? `${altered} fora da referência` : null].filter(Boolean).join(' · ')}
                    </div>
                    {e.status === 'falhou' && e.error && <div className="text-xs text-red-700 dark:text-red-400">{e.error}</div>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      ))}
      {view === 'graficos' && <MarkersView exams={exams} />}
      {viewing && exams.find((e) => e.id === viewing) && (
        <ExamView exam={exams.find((e) => e.id === viewing)!} readOnly={readOnly} onClose={() => setViewing(null)}
          onEdit={() => { setEditing(exams.find((e) => e.id === viewing)!); setViewing(null) }}
          onReread={() => void reread(exams.find((e) => e.id === viewing)!)} />
      )}
      {editing && (
        <ExamForm exam={editing === 'novo' ? null : editing} owner={owner} readOnly={readOnly}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />
      )}
    </div>
  )
}

type ResultRow = { marker: string; category: string; value: string; unit: string; ref_low: string; ref_high: string; ref_text: string; flag: Flag | null }
const toRow = (r: LabResult): ResultRow => ({
  marker: r.marker, category: r.category ?? '', value: r.value != null ? fmt(r.value) : r.value_text ?? '', unit: r.unit ?? '',
  ref_low: fmt(r.ref_low), ref_high: fmt(r.ref_high), ref_text: r.ref_text ?? '', flag: r.flag,
})
const emptyRow = (): ResultRow => ({ marker: '', category: '', value: '', unit: '', ref_low: '', ref_high: '', ref_text: '', flag: null })

function ExamForm({ exam, owner, readOnly, onClose, onSaved }: { exam: LabExam | null; owner: string; readOnly: boolean; onClose: () => void; onSaved: () => void }) {
  const [collected, setCollected] = useState(exam?.collected_on ?? todayISO())
  const [title, setTitle] = useState(exam?.title === 'Exame não lido' ? '' : exam?.title ?? '')
  const [lab, setLab] = useState(exam?.lab_name ?? '')
  const [notes, setNotes] = useState(exam?.notes ?? '')
  const [rows, setRows] = useState<ResultRow[]>(exam && current(exam).length ? current(exam).map(toRow) : [emptyRow()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setRow = (i: number, k: keyof ResultRow, v: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  async function save(status: 'revisar' | 'conferido') {
    const clean = rows.filter((r) => r.marker.trim() && r.value.trim())
    if (!clean.length) return setError('Informe pelo menos um resultado (nome e valor).')
    setBusy(true); setError('')
    const header = { collected_on: collected, title: title.trim() || 'Exame laboratorial', lab_name: lab.trim() || null, notes: notes.trim() || null, status, error: null }
    let id = exam?.id
    if (id) {
      const { error } = await supabase.from('lab_exams').update(header).eq('id', id)
      if (error) { setBusy(false); return setError(errorMessage(error)) }
      const { error: delErr } = await supabase.from('lab_results').delete().eq('exam_id', id).eq('is_previous', false)
      if (delErr) { setBusy(false); return setError(errorMessage(delErr)) }
    } else {
      const { data, error } = await supabase.from('lab_exams').insert({ ...header, owner_id: owner }).select('id').single()
      if (error) { setBusy(false); return setError(errorMessage(error)) }
      id = data.id
    }
    const payload = clean.map((r, i) => {
      const v = parseDec(r.value), lo = parseDec(r.ref_low), hi = parseDec(r.ref_high)
      return {
        exam_id: id, owner_id: owner, position: i, marker: r.marker.trim(), category: r.category.trim() || null,
        value: v, value_text: v == null ? r.value.trim() : null, unit: r.unit.trim() || null,
        ref_low: lo, ref_high: hi, ref_text: r.ref_text.trim() || null, flag: autoFlag(v, lo, hi, r.flag),
        is_previous: false, measured_on: collected,
      }
    })
    const { error: insErr } = await supabase.from('lab_results').insert(payload)
    setBusy(false)
    if (insErr) return setError(errorMessage(insErr))
    onSaved()
  }

  async function remove() {
    if (!exam || !confirm('Apagar este exame e todos os resultados?')) return
    setBusy(true)
    await removeFile(exam.file_path)
    const { error } = await supabase.from('lab_exams').delete().eq('id', exam.id)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }

  if (readOnly && exam) {
    return (
      <Modal title={exam.title || 'Exame'} onClose={onClose} wide>
        <p className="mb-3 text-sm text-stone-500">{[br(exam.collected_on), exam.lab_name].filter(Boolean).join(' · ')}</p>
        <ResultsTable results={exam.lab_results} />
        {exam.file_path && <button type="button" className="btn-outline mt-4" onClick={() => void openFile(exam.file_path!)}><Paperclip className="size-4" /> Ver arquivo original</button>}
      </Modal>
    )
  }

  return (
    <Modal title={exam ? 'Conferir exame' : 'Novo exame'} onClose={onClose} wide>
      <div className="space-y-4">
        {exam?.status === 'revisar' && <Alert kind="info">Lido pela IA. Compare com o laudo original e corrija o que for preciso antes de marcar como conferido.</Alert>}
        {exam?.status === 'falhou' && <Alert>{exam.error ?? 'Não foi possível ler o arquivo.'} Você pode digitar os resultados abaixo.</Alert>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Data da coleta" half><input type="date" className="input" value={collected} onChange={(e) => setCollected(e.target.value)} required /></Field>
          <Field label="Laboratório" half><input className="input" value={lab} onChange={(e) => setLab(e.target.value)} /></Field>
          <label className="col-span-2 block sm:col-span-1"><span className="label">Título</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Check-up anual" /></label>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label !mb-0">Resultados</span>
            {exam?.file_path && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void openFile(exam.file_path!)}><Paperclip className="size-3.5" /> Ver original</button>}
          </div>
          <div className="hidden grid-cols-[1.6fr_1fr_0.8fr_0.7fr_0.7fr_auto] gap-2 px-1 pb-1 text-xs text-stone-500 sm:grid">
            <span>Exame</span><span>Resultado</span><span>Unidade</span><span>Ref. mín.</span><span>Ref. máx.</span><span className="w-8" />
          </div>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="grid grid-cols-6 gap-2 rounded-xl border border-stone-200 p-2 sm:grid-cols-[1.6fr_1fr_0.8fr_0.7fr_0.7fr_auto] sm:border-0 sm:p-0 dark:border-stone-800">
                <input className="input col-span-5 sm:col-span-1" placeholder="Ex.: Glicose" value={r.marker} onChange={(e) => setRow(i, 'marker', e.target.value)} aria-label="Exame" />
                <button type="button" className="btn-ghost !p-2 text-stone-500 sm:order-last" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label="Remover linha"><Trash2 className="size-4" /></button>
                <input className="input col-span-3 sm:col-span-1" placeholder="Valor" inputMode="decimal" value={r.value} onChange={(e) => setRow(i, 'value', e.target.value)} aria-label="Resultado" />
                <input className="input col-span-3 sm:col-span-1" placeholder="mg/dL" value={r.unit} onChange={(e) => setRow(i, 'unit', e.target.value)} aria-label="Unidade" />
                <input className="input col-span-3 sm:col-span-1" placeholder="mín." inputMode="decimal" value={r.ref_low} onChange={(e) => setRow(i, 'ref_low', e.target.value)} aria-label="Referência mínima" />
                <input className="input col-span-3 sm:col-span-1" placeholder="máx." inputMode="decimal" value={r.ref_high} onChange={(e) => setRow(i, 'ref_high', e.target.value)} aria-label="Referência máxima" />
                {r.ref_text && !r.ref_low && !r.ref_high && <p className="col-span-6 text-xs text-stone-500 sm:col-span-5">Referência do laudo: {r.ref_text}</p>}
                {exam && (() => {
                  const prev = exam.lab_results.filter((p) => p.is_previous && p.marker.trim().toLowerCase() === r.marker.trim().toLowerCase())
                  return prev.length > 0 && <p className="col-span-6 text-xs text-stone-500 sm:col-span-5">Anteriores no laudo: {prev.map((p) => `${br(p.measured_on)}: ${p.value != null ? fmt(p.value) : p.value_text}`).join(' · ')}</p>
                })()}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-ghost mt-2" onClick={() => setRows((rs) => [...rs, emptyRow()])}><Plus className="size-4" /> Adicionar resultado</button>
        </div>
        <Field label="Observações"><textarea className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-wrap items-center gap-2">
          {exam && <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}><Trash2 className="size-4" /> Apagar</button>}
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn-outline" disabled={busy} onClick={() => void save(exam?.status === 'conferido' ? 'conferido' : 'revisar')}>Salvar</button>
            {exam?.status !== 'conferido' && <button type="button" className="btn-primary" disabled={busy} onClick={() => void save('conferido')}>{busy ? <Spinner /> : <Check className="size-4" />} Salvar e marcar conferido</button>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ResultsTable({ results }: { results: LabResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500 dark:border-stone-800"><th className="py-2 pr-2 font-medium">Exame</th><th className="pr-2 font-medium">Resultado</th><th className="pr-2 font-medium">Referência</th><th /></tr></thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id ?? r.position} className="border-b border-stone-100 dark:border-stone-800/60">
              <td className="py-2 pr-2">{r.marker}</td>
              <td className="pr-2 tabular-nums">{r.value != null ? fmt(r.value) : r.value_text} <span className="text-xs text-stone-500">{r.unit}</span></td>
              <td className="pr-2 text-xs text-stone-500">{refLabel(r)}</td>
              <td>{r.flag && r.flag !== 'normal' && <span className={`badge ${FLAG_STYLE[r.flag]}`}>{FLAG_LABEL[r.flag]}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------ leitura didática do exame
const ZONE = {
  baixo: { bar: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-500', label: 'Abaixo do mínimo' },
  normal: { bar: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', chip: 'bg-emerald-600', label: 'Dentro da faixa' },
  alto: { bar: 'bg-red-500', text: 'text-red-700 dark:text-red-300', chip: 'bg-red-600', label: 'Acima do máximo' },
} as const

/**
 * Régua colorida: amarelo (abaixo), verde (faixa de referência), vermelho (acima).
 * O marcador "anda" até o valor do exame ao aparecer na tela.
 */
function RangeGauge({ value, lo, hi, unit, delay = 0 }: { value: number; lo: number | null; hi: number | null; unit: string | null; delay?: number }) {
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShown(true), 80 + delay); return () => clearTimeout(t) }, [delay])

  let dMin: number, dMax: number
  if (lo != null && hi != null) {
    const span = hi - lo || Math.abs(hi) || 1
    dMin = Math.min(lo - span * 0.6, value - span * 0.15)
    dMax = Math.max(hi + span * 0.6, value + span * 0.15)
    if (lo >= 0 && dMin < 0) dMin = 0
  } else if (hi != null) {
    dMin = Math.min(0, value)
    dMax = Math.max(hi * 1.5, value * 1.15, hi + 1)
  } else {
    dMin = Math.min(0, value)
    dMax = Math.max(lo! * 2, value * 1.15, lo! + 1)
  }
  const pct = (v: number) => Math.min(97, Math.max(3, ((v - dMin) / (dMax - dMin)) * 100))
  const loP = lo != null ? pct(lo) : 0
  const hiP = hi != null ? pct(hi) : 100
  const zone: keyof typeof ZONE = lo != null && value < lo ? 'baixo' : hi != null && value > hi ? 'alto' : 'normal'
  const z = ZONE[zone]
  const pos = pct(value)
  const u = unit ? ` ${unit}` : ''
  const explain = zone === 'alto'
    ? `${fmt(+(value - hi!).toFixed(2))}${u} acima do máximo (${fmt(hi)}) — ${Math.round(((value - hi!) / Math.abs(hi! || 1)) * 100)}% a mais.`
    : zone === 'baixo'
      ? `${fmt(+(lo! - value).toFixed(2))}${u} abaixo do mínimo (${fmt(lo)}) — ${Math.round(((lo! - value) / Math.abs(lo! || 1)) * 100)}% a menos.`
      : lo != null && hi != null
        ? `Entre ${fmt(lo)} e ${fmt(hi)}${u}: ${(() => { const r = (value - lo) / (hi - lo || 1); return r < 0.2 ? 'perto do mínimo' : r > 0.8 ? 'perto do máximo' : 'no meio da faixa' })()}.`
        : hi != null ? `Abaixo do limite de ${fmt(hi)}${u}.` : `Acima do mínimo de ${fmt(lo)}${u}.`

  return (
    <div>
      <div className="relative pt-9 pb-6">
        {/* balão com o valor */}
        <div className="absolute top-0 -translate-x-1/2 transition-[left] duration-[1100ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none"
          style={{ left: `${shown ? pos : 0}%` }}>
          <div className={`whitespace-nowrap rounded-lg px-2 py-0.5 text-xs font-semibold text-white shadow tabular-nums ${z.chip} transition-opacity duration-500 ${shown ? 'opacity-100' : 'opacity-0'}`}>
            {fmt(value)}{u}
          </div>
          <div className={`mx-auto size-0 border-x-[5px] border-t-[6px] border-x-transparent ${zone === 'alto' ? 'border-t-red-600' : zone === 'baixo' ? 'border-t-amber-500' : 'border-t-emerald-600'}`} />
        </div>
        {/* barra em três cores */}
        <div className="relative flex h-3 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
          {lo != null && <div className={`h-full ${ZONE.baixo.bar} origin-left transition-transform duration-700 ${shown ? 'scale-x-100' : 'scale-x-0'} ${zone === 'baixo' ? '' : 'opacity-45'}`} style={{ width: `${loP}%` }} />}
          <div className={`h-full ${ZONE.normal.bar} origin-left transition-transform delay-150 duration-700 ${shown ? 'scale-x-100' : 'scale-x-0'} ${zone === 'normal' ? '' : 'opacity-45'}`} style={{ width: `${hiP - loP}%` }} />
          {hi != null && <div className={`h-full ${ZONE.alto.bar} origin-left transition-transform delay-300 duration-700 ${shown ? 'scale-x-100' : 'scale-x-0'} ${zone === 'alto' ? '' : 'opacity-45'}`} style={{ width: `${100 - hiP}%` }} />}
        </div>
        {/* ponto do valor */}
        <div className="absolute top-9 -translate-x-1/2 transition-[left] duration-[1100ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none" style={{ left: `${shown ? pos : 0}%` }}>
          <span className="relative -mt-1 block size-5">
            {zone !== 'normal' && shown && <span className={`absolute inset-0 rounded-full ${z.chip} opacity-60 motion-safe:animate-ping`} />}
            <span className={`absolute inset-0 rounded-full border-[3px] border-white shadow ${z.chip} dark:border-stone-900`} />
          </span>
        </div>
        {/* mínimo e máximo */}
        {lo != null && <span className="absolute bottom-0 -translate-x-1/2 text-[11px] text-stone-500 tabular-nums" style={{ left: `${loP}%` }}>mín {fmt(lo)}</span>}
        {hi != null && <span className="absolute bottom-0 -translate-x-1/2 text-[11px] text-stone-500 tabular-nums" style={{ left: `${hiP}%` }}>máx {fmt(hi)}</span>}
      </div>
      <p className="mt-1 text-sm"><b className={z.text}>{z.label}.</b> <span className="text-stone-600 dark:text-stone-400">{explain}</span></p>
    </div>
  )
}

function ResultCard({ r, previous, delay }: { r: LabResult; previous: LabResult[]; delay: number }) {
  const flag = effFlag(r)
  const hasRange = r.value != null && (r.ref_low != null || r.ref_high != null)
  const prevNum = previous.filter((p) => p.value != null)
  const last = prevNum[prevNum.length - 1]
  const diff = r.value != null && last?.value != null ? r.value - last.value : null
  const series = r.value != null ? [...prevNum.map((p) => Number(p.value)), r.value] : []
  return (
    <li className="card !p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{r.marker}</div>
          {!hasRange && <div className="text-xs text-stone-500">{r.ref_text ? `Referência: ${r.ref_text}` : 'Sem faixa de referência no laudo'}</div>}
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-semibold tabular-nums">{r.value != null ? fmt(r.value) : r.value_text}</div>
          <div className="text-xs text-stone-500">{r.unit}</div>
        </div>
      </div>
      {hasRange && <div className="mt-1"><RangeGauge value={r.value!} lo={r.ref_low} hi={r.ref_high} unit={r.unit} delay={delay} /></div>}
      {!hasRange && flag && flag !== 'normal' && <span className={`badge mt-2 ${FLAG_STYLE[flag]}`}>{FLAG_LABEL[flag]}</span>}
      {previous.length > 0 && (
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60">
          {series.length > 1 && <Sparkline values={series} />}
          <div className="min-w-0 flex-1">
            <div className="text-stone-500">Anteriores: {previous.slice(-4).map((p) => `${br(p.measured_on)} → ${p.value != null ? fmt(p.value) : p.value_text}`).join(' · ')}</div>
            {diff != null && diff !== 0 && (
              <div className="font-medium text-stone-700 dark:text-stone-300">{diff > 0 ? '▲ Subiu' : '▼ Desceu'} {fmt(+Math.abs(diff).toFixed(2))}{r.unit ? ` ${r.unit}` : ''} desde {br(last.measured_on)}</div>
            )}
            {diff === 0 && <div className="font-medium text-stone-700 dark:text-stone-300">= Igual ao de {br(last.measured_on)}</div>}
          </div>
        </div>
      )}
    </li>
  )
}

function ExamView({ exam, readOnly, onClose, onEdit, onReread }: { exam: LabExam; readOnly: boolean; onClose: () => void; onEdit: () => void; onReread: () => void }) {
  const [onlyOut, setOnlyOut] = useState(false)
  const cur = current(exam)
  const counts = { normal: 0, alto: 0, baixo: 0, alterado: 0 }
  cur.forEach((r) => { const f = effFlag(r); if (f) counts[f]++ })
  const out = (r: LabResult) => { const f = effFlag(r); return f != null && f !== 'normal' }
  const shown = onlyOut ? cur.filter(out) : cur
  const groups = new Map<string, LabResult[]>()
  shown.forEach((r) => { const g = r.category || 'Resultados'; groups.set(g, [...(groups.get(g) ?? []), r]) })
  let i = 0

  return (
    <Modal title={exam.title || 'Exame'} onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-stone-500">{[br(exam.collected_on), exam.lab_name].filter(Boolean).join(' · ')}</p>
      {exam.status === 'revisar' && !readOnly && <div className="mb-4"><Alert kind="info">Lido pela IA e ainda não conferido. Compare com o laudo e toque em "Conferir e corrigir".</Alert></div>}

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {([['normal', 'Dentro da faixa'], ['alto', 'Acima'], ['baixo', 'Abaixo']] as const).map(([k, l]) => (
          <div key={k} className="rounded-2xl border border-stone-200 p-3 dark:border-stone-800">
            <div className={`font-display text-2xl font-semibold tabular-nums ${ZONE[k].text}`}>{counts[k] + (k === 'alto' ? counts.alterado : 0)}</div>
            <div className="flex items-center justify-center gap-1.5 text-xs text-stone-500"><span className={`size-2 rounded-full ${ZONE[k].bar}`} />{l}</div>
          </div>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyOut} onChange={(e) => setOnlyOut(e.target.checked)} /> Mostrar só os fora da faixa</label>
        <span className="text-xs text-stone-500"><span className="text-amber-600">■</span> abaixo · <span className="text-emerald-600">■</span> faixa normal do laboratório · <span className="text-red-600">■</span> acima</span>
      </div>

      {shown.length === 0 ? <p className="text-sm text-stone-500">Nenhum resultado fora da faixa. 🎉</p> : (
        <div className="space-y-5">
          {[...groups.entries()].map(([g, rs]) => (
            <section key={g}>
              {groups.size > 1 && <h3 className="mb-2 text-sm font-semibold text-stone-500">{g}</h3>}
              <ul className="space-y-2">{rs.map((r) => <ResultCard key={r.id ?? r.position} r={r} previous={previousOf(exam, r)} delay={Math.min(i++, 8) * 90} />)}</ul>
            </section>
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {exam.file_path && <button type="button" className="btn-outline" onClick={() => void openFile(exam.file_path!)}><Paperclip className="size-4" /> Ver laudo original</button>}
        {!readOnly && exam.file_path && <button type="button" className="btn-ghost" onClick={onReread}><Sparkles className="size-4" /> Ler de novo</button>}
        {!readOnly && <button type="button" className="btn-primary ml-auto" onClick={onEdit}><Pencil className="size-4" /> {exam.status === 'conferido' ? 'Editar' : 'Conferir e corrigir'}</button>}
      </div>
      <p className="mt-4 text-xs text-stone-500">A faixa de referência é a que o laboratório considera normal. Estar fora dela não é diagnóstico: converse com seu médico.</p>
    </Modal>
  )
}

// ------------------------------------------------------------------ evolução por marcador
interface Point { date: string; value: number; unit: string | null; ref_low: number | null; ref_high: number | null; flag: Flag | null; checked: boolean; previous: boolean }

function MarkersView({ exams }: { exams: LabExam[] }) {
  const markers = useMemo(() => {
    const map = new Map<string, { name: string; points: Point[] }>()
    for (const e of exams) {
      if (e.status === 'falhou' || e.status === 'processando') continue
      for (const r of e.lab_results) {
        if (r.value == null) continue
        const key = r.marker_key ?? r.marker.trim().toLowerCase()
        const m = map.get(key) ?? { name: r.marker, points: [] }
        const date = r.is_previous ? r.measured_on! : e.collected_on
        m.points.push({ date, value: Number(r.value), unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high, flag: r.is_previous ? null : effFlag(r), checked: e.status === 'conferido', previous: Boolean(r.is_previous) })
        if (!r.is_previous) m.name = r.marker
        map.set(key, m)
      }
    }
    return [...map.entries()].map(([key, m]) => {
      // Mesma data em dois exames: vale o resultado do próprio exame, não o "anterior" copiado de outro laudo.
      const byDate = new Map<string, Point>()
      for (const p of m.points) { const o = byDate.get(p.date); if (!o || (o.previous && !p.previous)) byDate.set(p.date, p) }
      const points = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      const lo = [...points].reverse().find((p) => p.ref_low != null)?.ref_low ?? null
      const hi = [...points].reverse().find((p) => p.ref_high != null)?.ref_high ?? null
      return { key, name: m.name, points: points.map((p) => (p.previous ? { ...p, flag: autoFlag(p.value, lo, hi, null) } : p)) }
    })
      .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name))
  }, [exams])
  const [selected, setSelected] = useState<string | null>(null)
  const [q, setQ] = useState('')

  if (!markers.length) return <EmptyState icon={LineChart} title="Sem valores para mostrar">Os gráficos aparecem quando houver exames com resultados numéricos.</EmptyState>
  const sel = markers.find((m) => m.key === selected)
  if (sel) return <MarkerDetail name={sel.name} points={sel.points} onBack={() => setSelected(null)} />

  const shown = markers.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="space-y-3">
      <input className="input" placeholder="Buscar exame (ex.: glicose, colesterol)" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((m) => {
          const last = m.points[m.points.length - 1]
          return (
            <li key={m.key}>
              <button onClick={() => setSelected(m.key)} className="card flex w-full items-center gap-3 !p-4 text-left hover:border-brand-300">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.name}</div>
                  <div className="text-xs text-stone-500">{m.points.length} {m.points.length === 1 ? 'medição' : 'medições'} · última {br(last.date)}</div>
                </div>
                <div className="text-right">
                  <div className="font-display text-lg font-semibold tabular-nums">{fmt(last.value)}</div>
                  <div className="text-xs text-stone-500">{last.unit}</div>
                </div>
                {m.points.length > 1 && <Sparkline values={m.points.map((p) => p.value)} />}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 60},${22 - ((v - min) / span) * 20}`).join(' ')
  return <svg viewBox="0 0 60 24" className="h-6 w-14 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" /></svg>
}

function MarkerDetail({ name, points, onBack }: { name: string; points: Point[]; onBack: () => void }) {
  // Usa a unidade mais frequente para não misturar escalas diferentes.
  const unitCount = new Map<string, number>()
  points.forEach((p) => unitCount.set(p.unit ?? '', (unitCount.get(p.unit ?? '') ?? 0) + 1))
  const unit = [...unitCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const pts = points.filter((p) => (p.unit ?? '') === unit)
  const hidden = points.length - pts.length
  const last = pts[pts.length - 1]
  const lo = [...pts].reverse().find((p) => p.ref_low != null)?.ref_low ?? null
  const hi = [...pts].reverse().find((p) => p.ref_high != null)?.ref_high ?? null

  return (
    <div className="space-y-4">
      <button className="btn-ghost !px-2" onClick={onBack}><ChevronLeft className="size-4" /> Todos os exames</button>
      <div className="card">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl font-semibold">{name}</h3>
          <span className="text-sm text-stone-500">Última: <b className="tabular-nums text-stone-900 dark:text-stone-100">{fmt(last.value)}</b> {unit} em {br(last.date)}</span>
        </div>
        <p className="mb-3 text-xs text-stone-500">{lo != null || hi != null ? `Faixa de referência (mais recente): ${refLabel({ ref_low: lo, ref_high: hi, ref_text: null })} ${unit}` : 'Sem faixa de referência informada.'}</p>
        {(lo != null || hi != null) && <div className="mb-5"><RangeGauge value={last.value} lo={lo} hi={hi} unit={unit} /></div>}
        <TrendChart points={pts} lo={lo} hi={hi} unit={unit} />
        {hidden > 0 && <p className="mt-2 text-xs text-stone-500">{hidden} medição(ões) em outra unidade não aparecem no gráfico, só na tabela.</p>}
      </div>
      <div className="card !p-0">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500 dark:border-stone-800"><th className="px-4 py-2 font-medium">Data</th><th className="font-medium">Resultado</th><th className="font-medium">Referência</th><th className="pr-4" /></tr></thead>
          <tbody>
            {[...points].reverse().map((p, i) => (
              <tr key={i} className="border-b border-stone-100 last:border-0 dark:border-stone-800/60">
                <td className="px-4 py-2">{br(p.date)}{!p.checked && <span className="ml-1 text-xs text-amber-700" title="Exame ainda não conferido">•</span>}{p.previous && <span className="ml-1 text-xs text-stone-400">(do histórico do laudo)</span>}</td>
                <td className="tabular-nums">{fmt(p.value)} <span className="text-xs text-stone-500">{p.unit}</span></td>
                <td className="text-xs text-stone-500">{p.previous ? '' : refLabel({ ...p, ref_text: null })}</td>
                <td className="pr-4 text-right">{p.flag && p.flag !== 'normal' && <span className={`badge ${FLAG_STYLE[p.flag]}`}>{FLAG_LABEL[p.flag]}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {points.some((p) => !p.checked) && <p className="px-4 py-2 text-xs text-stone-500"><span className="text-amber-700">•</span> exame ainda não conferido por você.</p>}
      </div>
    </div>
  )
}

function TrendChart({ points, lo, hi, unit }: { points: Point[]; lo: number | null; hi: number | null; unit: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640, H = 240, L = 44, R = 16, T = 14, B = 30
  const times = points.map((p) => new Date(`${p.date}T12:00:00Z`).getTime())
  const t0 = Math.min(...times), t1 = Math.max(...times)
  const vals = points.map((p) => p.value).concat([lo, hi].filter((v): v is number => v != null))
  let vMin = Math.min(...vals), vMax = Math.max(...vals)
  const pad = (vMax - vMin || Math.abs(vMax) || 1) * 0.15
  vMin -= pad; vMax += pad
  if (Math.min(...points.map((p) => p.value)) >= 0 && vMin < 0) vMin = 0
  const x = (t: number) => (t1 === t0 ? L + (W - L - R) / 2 : L + ((t - t0) / (t1 - t0)) * (W - L - R))
  const y = (v: number) => T + (1 - (v - vMin) / (vMax - vMin)) * (H - T - B)
  const ticks = Array.from({ length: 4 }, (_, i) => vMin + ((vMax - vMin) * i) / 3)
  const nice = (v: number) => (Math.abs(vMax - vMin) < 10 ? v.toFixed(1) : Math.round(v).toString()).replace('.', ',')
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const bandTop = y(hi ?? vMax), bandBottom = y(lo ?? vMin)
  const h = hover != null ? points[hover] : null

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none" role="img" aria-label={`Evolução de ${unit}`}
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          let best = 0
          times.forEach((t, i) => { if (Math.abs(x(t) - px) < Math.abs(x(times[best]) - px)) best = i })
          setHover(best)
        }}>
        {(lo != null || hi != null) && <rect x={L} width={W - L - R} y={bandTop} height={Math.max(0, bandBottom - bandTop)} className="fill-brand-500/10" />}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-stone-200 dark:stroke-stone-800" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" className="fill-stone-500 text-[11px] tabular-nums">{nice(v)}</text>
          </g>
        ))}
        {[0, points.length - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={x(times[i])} y={H - 8} textAnchor={points.length === 1 ? 'middle' : i === 0 ? 'start' : 'end'} className="fill-stone-500 text-[11px]">{br(points[i].date)}</text>
        ))}
        <path d={path} fill="none" className="stroke-brand-600 dark:stroke-brand-400" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => {
          const out = p.flag && p.flag !== 'normal'
          return <circle key={i} cx={x(times[i])} cy={y(p.value)} r={hover === i ? 6 : 4.5} strokeWidth="2"
            className={`${out ? 'fill-red-500' : 'fill-brand-600 dark:fill-brand-400'} stroke-white dark:stroke-stone-900`} />
        })}
        {h && hover != null && <line x1={x(times[hover])} x2={x(times[hover])} y1={T} y2={H - B} className="stroke-stone-400" strokeDasharray="3 3" />}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs text-white shadow dark:bg-stone-100 dark:text-stone-900"
          style={{ left: `${Math.min(80, Math.max(0, (x(times[hover]) / W) * 100 - 8))}%` }}>
          <b className="tabular-nums">{fmt(h.value)}</b> {unit} · {br(h.date)}
        </div>
      )}
    </div>
  )
}

// ================================================================== MEDICAMENTOS
interface MedDraft { name: string; dose: string; frequency: string; route: string; reason: string; prescriber: string; started_on: string; ended_on: string; notes: string; prescription_path: string | null }
const medToDraft = (m: Medication | null): MedDraft => ({
  name: m?.name ?? '', dose: m?.dose ?? '', frequency: m?.frequency ?? '', route: m?.route ?? '', reason: m?.reason ?? '',
  prescriber: m?.prescriber ?? '', started_on: m?.started_on ?? todayISO(), ended_on: m?.ended_on ?? '', notes: m?.notes ?? '',
  prescription_path: m?.prescription_path ?? null,
})
const draftPayload = (d: MedDraft) => ({
  name: d.name.trim(), dose: d.dose.trim() || null, frequency: d.frequency.trim() || null, route: d.route.trim() || null,
  reason: d.reason.trim() || null, prescriber: d.prescriber.trim() || null, started_on: d.started_on, ended_on: d.ended_on || null,
  notes: d.notes.trim() || null, prescription_path: d.prescription_path,
})
const isCurrent = (m: Medication, today: string) => !m.ended_on || m.ended_on >= today

function MedsTab({ owner, readOnly }: { owner: string; readOnly: boolean }) {
  const [meds, setMeds] = useState<Medication[] | null>(null)
  const [editing, setEditing] = useState<Medication | 'novo' | null>(null)
  const [rx, setRx] = useState<{ path: string; drafts: (MedDraft & { keep: boolean })[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const today = todayISO()

  const load = useCallback(async () => {
    const { data } = await supabase.from('medications').select('*').eq('owner_id', owner).order('started_on', { ascending: false })
    setMeds((data ?? []) as Medication[])
  }, [owner])
  useEffect(() => { void load() }, [load])

  async function readPrescription(file: File) {
    setBusy(true); setError('')
    try {
      const path = await uploadHealthFile(owner, 'receitas', file)
      const { data, error } = await supabase.functions.invoke('health-doc-parse', { body: { path, kind: 'prescription' } })
      if (error) { await removeFile(path); setError(await fnError(error)) }
      else {
        const start = data.prescribed_on ?? today
        type ParsedMed = { name: string; dose: string | null; frequency: string | null; route: string | null; duration_days: number | null; instructions: string | null }
        const drafts = (data.medications as ParsedMed[]).map((m) => ({
          ...medToDraft(null), keep: true, name: m.name, dose: m.dose ?? '', frequency: m.frequency ?? '', route: m.route ?? '',
          prescriber: data.prescriber ?? '', started_on: start, ended_on: m.duration_days ? addDays(start, m.duration_days - 1) : '',
          notes: m.instructions ?? '', prescription_path: path,
        }))
        if (!drafts.length) { await removeFile(path); setError('Não encontrei medicamentos nessa receita.') }
        else setRx({ path, drafts })
      }
    } catch (e) { setError(errorMessage(e)) }
    setBusy(false)
  }

  async function stop(m: Medication) {
    if (!confirm(`Registrar que você parou de tomar ${m.name} hoje?`)) return
    const { error } = await supabase.from('medications').update({ ended_on: today < m.started_on ? m.started_on : today }).eq('id', m.id)
    if (error) setError(errorMessage(error)); else void load()
  }

  if (!meds) return <Spinner className="size-6" />
  const current = meds.filter((m) => isCurrent(m, today))
  const history = meds.filter((m) => !isCurrent(m, today) || from || to)
    .filter((m) => (!to || m.started_on <= to) && (!from || (m.ended_on ?? today) >= from))

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={() => setEditing('novo')}><Plus className="size-4" /> Adicionar</button>
          <FileButton onFile={readPrescription} busy={busy} className="btn-primary">Ler receita (PDF ou foto)</FileButton>
        </div>
      )}
      {busy && <Alert kind="info">Lendo a receita com a IA… pode levar alguns segundos.</Alert>}
      {error && <Alert>{error}</Alert>}

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold">Em uso agora</h3>
        {current.length === 0 ? (
          <EmptyState icon={Pill} title="Nenhum medicamento em uso">{readOnly ? 'O cliente não registrou medicamentos em uso.' : 'Adicione à mão ou envie a receita para a IA preencher.'}</EmptyState>
        ) : (
          <ul className="space-y-2">{current.map((m) => <MedItem key={m.id} m={m} readOnly={readOnly} onEdit={() => setEditing(m)} onStop={() => void stop(m)} />)}</ul>
        )}
      </section>

      <section>
        <h3 className="mb-1 font-display text-lg font-semibold">Histórico</h3>
        <p className="mb-3 text-sm text-stone-500">Escolha um período para ver tudo o que foi tomado nele.</p>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:max-w-md">
          <label><span className="label">De</span><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label><span className="label">Até</span><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {(from || to) && <button className="btn-ghost mb-2 !px-2 !py-1 text-xs" onClick={() => { setFrom(''); setTo('') }}>Limpar período</button>}
        {history.length === 0 ? (
          <p className="text-sm text-stone-500">{from || to ? 'Nada registrado nesse período.' : 'Medicamentos encerrados aparecem aqui.'}</p>
        ) : (
          <ul className="space-y-2">{history.map((m) => <MedItem key={m.id} m={m} readOnly={readOnly} onEdit={() => setEditing(m)} />)}</ul>
        )}
      </section>

      {editing && <MedForm med={editing === 'novo' ? null : editing} owner={owner} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      {rx && <RxReview rx={rx} owner={owner} onClose={async () => { await removeFile(rx.path); setRx(null) }} onSaved={() => { setRx(null); void load() }} />}
    </div>
  )
}

function MedItem({ m, readOnly, onEdit, onStop }: { m: Medication; readOnly: boolean; onEdit: () => void; onStop?: () => void }) {
  const period = m.ended_on ? `${br(m.started_on)} a ${br(m.ended_on)}` : `desde ${br(m.started_on)}`
  return (
    <li className="card flex items-start gap-3 !p-4">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sand-200 text-brand-700 dark:bg-stone-800 dark:text-brand-300"><Pill className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{m.name}{m.dose && <span className="font-normal text-stone-500"> · {m.dose}</span>}</div>
        <div className="text-xs text-stone-500">{[m.frequency, period, m.reason && `para ${m.reason}`, m.prescriber].filter(Boolean).join(' · ')}</div>
        {m.notes && <div className="mt-1 text-xs text-stone-600 dark:text-stone-400">{m.notes}</div>}
        <div className="mt-2 flex flex-wrap gap-1">
          {m.prescription_path && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void openFile(m.prescription_path!)}><Paperclip className="size-3.5" /> Receita</button>}
          {!readOnly && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onEdit}><Pencil className="size-3.5" /> Editar</button>}
          {!readOnly && onStop && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onStop}><Check className="size-3.5" /> Parei de tomar</button>}
        </div>
      </div>
    </li>
  )
}

function MedFields({ d, set }: { d: MedDraft; set: (k: keyof MedDraft, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Medicamento"><input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} required placeholder="Ex.: Losartana" /></Field>
      <Field label="Dose" half><input className="input" value={d.dose} onChange={(e) => set('dose', e.target.value)} placeholder="Ex.: 50 mg" /></Field>
      <Field label="Frequência" half><input className="input" value={d.frequency} onChange={(e) => set('frequency', e.target.value)} placeholder="Ex.: 1x ao dia" /></Field>
      <Field label="Começou em" half><input type="date" className="input" value={d.started_on} onChange={(e) => set('started_on', e.target.value)} required /></Field>
      <Field label="Terminou em (vazio = em uso)" half><input type="date" className="input" value={d.ended_on} min={d.started_on} onChange={(e) => set('ended_on', e.target.value)} /></Field>
      <Field label="Para quê" half><input className="input" value={d.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Ex.: pressão" /></Field>
      <Field label="Quem receitou" half><input className="input" value={d.prescriber} onChange={(e) => set('prescriber', e.target.value)} /></Field>
      <Field label="Observações"><textarea className="input min-h-16" value={d.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </div>
  )
}

function MedForm({ med, owner, onClose, onSaved }: { med: Medication | null; owner: string; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(() => medToDraft(med))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const p = draftPayload(d)
    const { error } = med ? await supabase.from('medications').update(p).eq('id', med.id) : await supabase.from('medications').insert({ ...p, owner_id: owner })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }
  async function remove() {
    if (!med || !confirm(`Apagar ${med.name} do histórico?`)) return
    const { error } = await supabase.from('medications').delete().eq('id', med.id)
    if (error) return setError(errorMessage(error))
    onSaved()
  }
  return (
    <Modal title={med ? 'Editar medicamento' : 'Novo medicamento'} onClose={onClose} onSubmit={save}>
      <MedFields d={d} set={(k, v) => setD((x) => ({ ...x, [k]: v }))} />
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-4 flex items-center gap-2">
        {med && <button type="button" className="btn-danger" onClick={() => void remove()}><Trash2 className="size-4" /> Apagar</button>}
        <button className="btn-primary ml-auto" disabled={busy}>{busy && <Spinner />} Salvar</button>
      </div>
    </Modal>
  )
}

function RxReview({ rx, owner, onClose, onSaved }: { rx: { path: string; drafts: (MedDraft & { keep: boolean })[] }; owner: string; onClose: () => void; onSaved: () => void }) {
  const [drafts, setDrafts] = useState(rx.drafts)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (i: number, k: keyof MedDraft, v: string) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)))
  async function save(e: FormEvent) {
    e.preventDefault()
    const chosen = drafts.filter((d) => d.keep && d.name.trim())
    if (!chosen.length) return setError('Marque pelo menos um medicamento.')
    setBusy(true); setError('')
    const { error } = await supabase.from('medications').insert(chosen.map((d) => ({ ...draftPayload(d), owner_id: owner })))
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }
  return (
    <Modal title="Confira a receita" onClose={onClose} onSubmit={save} wide>
      <div className="space-y-4">
        <Alert kind="info">Lida pela IA. Confira nome, dose e datas com a receita original antes de salvar. <button type="button" className="underline" onClick={() => void openFile(rx.path)}>Ver receita</button></Alert>
        {drafts.map((d, i) => (
          <div key={i} className={`rounded-2xl border p-4 ${d.keep ? 'border-brand-300 dark:border-brand-800' : 'border-stone-200 opacity-60 dark:border-stone-800'}`}>
            <label className="mb-3 flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={d.keep} onChange={(e) => setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} /> Guardar este medicamento
            </label>
            {d.keep && <MedFields d={d} set={(k, v) => set(i, k, v)} />}
          </div>
        ))}
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end"><button className="btn-primary" disabled={busy}>{busy && <Spinner />} Salvar medicamentos</button></div>
      </div>
    </Modal>
  )
}

// ================================================================== CONSULTAS
const SPECIALTIES = [
  'Clínico geral', 'Cardiologia', 'Dermatologia', 'Endocrinologia', 'Gastroenterologia', 'Ginecologia', 'Nutrição', 'Oftalmologia',
  'Ortopedia', 'Otorrinolaringologia', 'Pediatria', 'Psicanálise', 'Psicologia', 'Psiquiatria', 'Urologia', 'Fisioterapia', 'Odontologia', 'Neurologia',
]

function ConsultsTab({ owner, readOnly }: { owner: string; readOnly: boolean }) {
  const [items, setItems] = useState<Consultation[] | null>(null)
  const [editing, setEditing] = useState<Consultation | 'novo' | null>(null)
  const [filter, setFilter] = useState('')
  const load = useCallback(async () => {
    const { data } = await supabase.from('consultations').select('*').eq('owner_id', owner).order('consulted_on', { ascending: false })
    setItems((data ?? []) as Consultation[])
  }, [owner])
  useEffect(() => { void load() }, [load])

  if (!items) return <Spinner className="size-6" />
  const today = todayISO()
  const specialties = [...new Set(items.map((c) => c.specialty))].sort()
  const shown = items.filter((c) => !filter || c.specialty === filter)
  const returns = items.filter((c) => c.next_return_on && c.next_return_on >= today).sort((a, b) => a.next_return_on!.localeCompare(b.next_return_on!))

  return (
    <div className="space-y-4">
      {!readOnly && <div className="flex justify-end"><button className="btn-primary" onClick={() => setEditing('novo')}><Plus className="size-4" /> Registrar consulta</button></div>}
      {returns.length > 0 && (
        <Alert kind="info"><b>Próximos retornos:</b> {returns.map((c) => `${c.specialty} em ${br(c.next_return_on)}`).join(' · ')}</Alert>
      )}
      {specialties.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {['', ...specialties].map((s) => (
            <button key={s || 'todas'} onClick={() => setFilter(s)}
              className={`badge border !px-3 !py-1.5 ${filter === s ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>{s || 'Todas'}</button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState icon={Stethoscope} title="Nenhuma consulta registrada">{readOnly ? 'O cliente ainda não registrou consultas.' : 'Anote a especialidade e o que foi conversado para ter tudo à mão na próxima.'}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {shown.map((c) => (
            <li key={c.id} className="card !p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-sand-200 text-brand-700 dark:bg-stone-800 dark:text-brand-300"><Stethoscope className="size-5" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.specialty}</span>
                    <span className="text-xs text-stone-500">{[br(c.consulted_on), c.professional_name, c.location].filter(Boolean).join(' · ')}</span>
                  </div>
                  {c.reason && <p className="mt-1 text-sm"><span className="text-stone-500">Motivo:</span> {c.reason}</p>}
                  {c.summary && <p className="mt-1 whitespace-pre-line text-sm"><span className="text-stone-500">O que foi abordado:</span> {c.summary}</p>}
                  {c.conduct && <p className="mt-1 whitespace-pre-line text-sm"><span className="text-stone-500">Conduta:</span> {c.conduct}</p>}
                  {c.next_return_on && <p className="mt-1 flex items-center gap-1 text-xs text-stone-500"><CalendarClock className="size-3.5" /> Retorno {br(c.next_return_on)}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.attachment_path && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void openFile(c.attachment_path!)}><Paperclip className="size-3.5" /> Anexo</button>}
                    {!readOnly && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditing(c)}><Pencil className="size-3.5" /> Editar</button>}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <ConsultForm item={editing === 'novo' ? null : editing} owner={owner} known={specialties} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

function ConsultForm({ item, owner, known, onClose, onSaved }: { item: Consultation | null; owner: string; known: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    consulted_on: item?.consulted_on ?? todayISO(), specialty: item?.specialty ?? '', professional_name: item?.professional_name ?? '',
    location: item?.location ?? '', reason: item?.reason ?? '', summary: item?.summary ?? '', conduct: item?.conduct ?? '',
    next_return_on: item?.next_return_on ?? '', notes: item?.notes ?? '',
  })
  const [attachment, setAttachment] = useState(item?.attachment_path ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function attach(file: File) {
    setBusy(true); setError('')
    try {
      const path = await uploadHealthFile(owner, 'consultas', file)
      if (attachment && attachment !== item?.attachment_path) await removeFile(attachment)
      setAttachment(path)
    } catch (e) { setError(errorMessage(e)) }
    setBusy(false)
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!f.specialty.trim()) return setError('Informe a especialidade.')
    setBusy(true); setError('')
    const p = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    const payload = { ...p, specialty: f.specialty.trim(), consulted_on: f.consulted_on, attachment_path: attachment }
    const { error } = item ? await supabase.from('consultations').update(payload).eq('id', item.id) : await supabase.from('consultations').insert({ ...payload, owner_id: owner })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    if (item?.attachment_path && item.attachment_path !== attachment) await removeFile(item.attachment_path)
    onSaved()
  }
  async function remove() {
    if (!item || !confirm('Apagar esta consulta?')) return
    const { error } = await supabase.from('consultations').delete().eq('id', item.id)
    if (error) return setError(errorMessage(error))
    await removeFile(item.attachment_path)
    onSaved()
  }
  return (
    <Modal title={item ? 'Editar consulta' : 'Nova consulta'} onClose={onClose} onSubmit={save}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" half><input type="date" className="input" value={f.consulted_on} onChange={set('consulted_on')} required /></Field>
        <Field label="Especialidade" half>
          <input className="input" list="especialidades" value={f.specialty} onChange={set('specialty')} required placeholder="Ex.: Cardiologia" />
          <datalist id="especialidades">{[...new Set([...known, ...SPECIALTIES])].map((s) => <option key={s} value={s} />)}</datalist>
        </Field>
        <Field label="Profissional" half><input className="input" value={f.professional_name} onChange={set('professional_name')} placeholder="Ex.: Dra. Ana" /></Field>
        <Field label="Local" half><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Motivo da consulta"><input className="input" value={f.reason} onChange={set('reason')} placeholder="Ex.: dor de cabeça frequente" /></Field>
        <Field label="O que foi abordado"><textarea className="input min-h-24" value={f.summary} onChange={set('summary')} placeholder="Resumo do que foi conversado, exames pedidos, explicações…" /></Field>
        <Field label="Conduta / orientações"><textarea className="input min-h-16" value={f.conduct} onChange={set('conduct')} placeholder="Ex.: começar remédio X, repetir exame em 3 meses" /></Field>
        <Field label="Retorno marcado para" half><input type="date" className="input" value={f.next_return_on} onChange={set('next_return_on')} /></Field>
        <div className="flex items-end gap-2">
          {attachment
            ? <><button type="button" className="btn-outline flex-1" onClick={() => void openFile(attachment)}><Paperclip className="size-4" /> Anexo</button><button type="button" className="btn-ghost !p-2" aria-label="Remover anexo" onClick={() => setAttachment(null)}><X className="size-4" /></button></>
            : <FileButton onFile={attach} busy={busy} className="btn-outline w-full">Anexar arquivo</FileButton>}
        </div>
        <Field label="Observações"><textarea className="input min-h-16" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-4 flex items-center gap-2">
        {item && <button type="button" className="btn-danger" onClick={() => void remove()}><Trash2 className="size-4" /> Apagar</button>}
        <button className="btn-primary ml-auto" disabled={busy}>{busy && <Spinner />} Salvar</button>
      </div>
    </Modal>
  )
}

// ================================================================== PÁGINA
type Tab = 'exames' | 'medicamentos' | 'consultas' | 'diario'
const TABS: { key: Tab; label: string; icon: typeof Activity }[] = [
  { key: 'exames', label: 'Exames', icon: FlaskConical }, { key: 'medicamentos', label: 'Remédios', icon: Pill },
  { key: 'consultas', label: 'Consultas', icon: Stethoscope }, { key: 'diario', label: 'Diário', icon: NotebookPen },
]

export function HealthPage({ ownerId, embedded = false }: { ownerId?: string; embedded?: boolean }) {
  const { session } = useAuth()
  const owner = ownerId ?? session!.user.id
  const readOnly = owner !== session?.user.id
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('aba') as Tab) || 'exames')

  return (
    <div>
      {!embedded && (
        <PageHeader title="Saúde" subtitle="Exames, remédios, consultas e diário de sintomas."
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
      {tab === 'exames' && <ExamsTab owner={owner} readOnly={readOnly} />}
      {tab === 'medicamentos' && <MedsTab owner={owner} readOnly={readOnly} />}
      {tab === 'consultas' && <ConsultsTab owner={owner} readOnly={readOnly} />}
      {tab === 'diario' && <ModulePage config={MODULES.saude} ownerId={ownerId} embedded />}
      <p className="mt-8 text-xs text-stone-500">
        Registro pessoal, sem valor de diagnóstico. A leitura por IA pode errar: confira sempre com o documento original e converse com seu médico antes de mudar qualquer tratamento.
      </p>
    </div>
  )
}
