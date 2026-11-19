import { AlertTriangle, Check, CircleHelp, Inbox, Pencil, RotateCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { MODULE_ICONS } from '../../components/AppLayout'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'

interface Draft {
  id: string
  message_id: string
  module_key: string | null
  kind: string
  title: string
  data: Record<string, unknown>
  confidence: number | null
  ambiguity: string | null
  status: 'pending' | 'confirmed' | 'rejected'
  decided_at: string | null
  created_at: string
}
interface Message {
  id: string
  content_text: string | null
  status: 'received' | 'processing' | 'processed' | 'failed' | 'ignored'
  intent: string | null
  reply_text: string | null
  error: string | null
  created_at: string
  assistant_drafts: Draft[]
}

const KIND_LABEL: Record<string, string> = {
  despesa: 'Despesa', receita: 'Receita', conta_a_pagar: 'Conta a pagar', conta_a_receber: 'Conta a receber',
  compromisso: 'Compromisso', lembrete: 'Lembrete', sintoma: 'Sintoma', medicamento: 'Medicamento', consulta: 'Consulta', exame: 'Exame',
  sonho: 'Sonho', insight: 'Insight', refeicao: 'Refeição', agua: 'Água', treino: 'Treino', menstruacao: 'Menstruação',
  sintoma_ciclo: 'Sintoma do ciclo', nota: 'Nota', ideia: 'Ideia', acontecimento: 'Acontecimento',
}
const FIELD_LABEL: Record<string, string> = {
  valor_centavos: 'Valor', data: 'Data', descricao: 'Descrição', categoria: 'Categoria', forma_pagamento: 'Pagamento',
  vencimento: 'Vencimento', parcelas: 'Parcelas', atividade: 'Atividade', duracao_min: 'Duração (min)', series: 'Séries',
  repeticoes: 'Repetições', carga_kg: 'Carga (kg)', distancia_km: 'Distância (km)', titulo: 'Título', horario: 'Horário',
  local: 'Local', com_quem: 'Com quem', intensidade: 'Intensidade', medicamento: 'Medicamento', dose: 'Dose', relato: 'Relato',
  emocoes: 'Emoções', refeicao: 'Refeição', alimentos: 'Alimentos', quantidade_ml: 'Quantidade (ml)', data_inicio: 'Início',
  fluxo: 'Fluxo', sintomas: 'Sintomas', texto: 'Texto', tags: 'Tags',
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
function fieldValue(key: string, v: unknown): string {
  if (v == null || v === '') return '—'
  if (key === 'valor_centavos' && typeof v === 'number') return brl.format(v / 100)
  if ((key === 'data' || key === 'vencimento' || key === 'data_inicio') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-'); return `${d}/${m}/${y}`
  }
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function Composer({ onSent, autoFocus }: { onSent?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null)

  async function send(e?: FormEvent) {
    e?.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.functions.invoke('assistant-process', { body: { text } })
    setBusy(false)
    if (error) {
      let detail = errorMessage(error)
      try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail } catch { /* corpo não JSON */ }
      setMsg({ kind: 'error', text: detail })
      onSent?.()
      return
    }
    setText('')
    setMsg({ kind: 'success', text: data?.reply ?? 'Mensagem processada.' })
    onSent?.()
  }

  return (
    <form onSubmit={send} className="card !p-3">
      <textarea
        className="w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-stone-400"
        rows={3}
        maxLength={4000}
        autoFocus={autoFocus}
        placeholder='Ex.: "Paguei R$ 120 na academia e fiz 40 minutos de musculação"'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
      />
      <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2 dark:border-stone-800">
        <span className="px-2 text-xs text-stone-400">A IA propõe; você confirma.</span>
        <button className="btn-primary !py-2" disabled={busy || !text.trim()}>
          {busy ? <><Spinner /> Organizando…</> : <><Send className="size-4" /> Enviar</>}
        </button>
      </div>
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
    </form>
  )
}

function DraftCard({ d, onChange, moduleName }: { d: Draft; onChange: () => void; moduleName?: string }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(d.title)
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(d.data).map(([k, v]) => [k, k === 'valor_centavos' && typeof v === 'number' ? (v / 100).toFixed(2).replace('.', ',') : Array.isArray(v) ? v.join(', ') : v == null ? '' : String(v)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const Icon = (d.module_key && MODULE_ICONS[d.module_key]) || CircleHelp
  const lowConfidence = (d.confidence ?? 0) < 0.7

  function parsedData(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [k, raw] of Object.entries(fields)) {
      const orig = d.data[k]
      if (k === 'valor_centavos') out[k] = Math.round(Number(raw.replace(/\./g, '').replace(',', '.')) * 100) || 0
      else if (typeof orig === 'number') out[k] = Number(raw.replace(',', '.'))
      else if (Array.isArray(orig)) out[k] = raw.split(',').map((s) => s.trim()).filter(Boolean)
      else out[k] = raw
    }
    return out
  }

  async function decide(status: 'confirmed' | 'rejected') {
    setBusy(true); setError('')
    const patch: Record<string, unknown> = { status }
    if (editing && status === 'confirmed') { patch.title = title; patch.data = parsedData() }
    const { error } = await supabase.from('assistant_drafts').update(patch).eq('id', d.id)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onChange()
  }

  const entries = Object.entries(d.data)
  return (
    <div className={`rounded-xl border p-3 ${d.status === 'confirmed' ? 'border-brand-200 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-900/10' : d.status === 'rejected' ? 'border-stone-200 opacity-60 dark:border-stone-800' : 'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'}`}>
      <div className="flex items-start gap-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-sand-200 text-brand-700 dark:bg-stone-800 dark:text-brand-300"><Icon className="size-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-stone-500">{moduleName ?? 'Sem destino'} · {KIND_LABEL[d.kind] ?? d.kind}</div>
          {editing ? <input className="input mt-1 !py-1.5" value={title} onChange={(e) => setTitle(e.target.value)} /> : <div className="font-medium">{d.title}</div>}
        </div>
        {d.status === 'pending' && lowConfidence && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Revisar</span>}
        {d.status === 'confirmed' && <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200"><Check className="size-3" /> Confirmado</span>}
        {d.status === 'rejected' && <span className="badge bg-stone-100 text-stone-600 dark:bg-stone-800">Descartado</span>}
      </div>

      {entries.length > 0 && (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
          {entries.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-stone-500">{FIELD_LABEL[k] ?? k}</dt>
              {editing
                ? <dd><input className="input !px-2 !py-1 text-sm" value={fields[k] ?? ''} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} /></dd>
                : <dd className="truncate">{fieldValue(k, v)}</dd>}
            </div>
          ))}
        </dl>
      )}

      {d.ambiguity && d.status === 'pending' && (
        <div className="mt-2.5 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {d.ambiguity}</div>
      )}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}

      {d.status === 'pending' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary !px-3 !py-1.5" disabled={busy || !d.module_key} onClick={() => void decide('confirmed')} title={!d.module_key ? 'Sem módulo de destino' : undefined}>
            <Check className="size-4" /> {editing ? 'Salvar e confirmar' : 'Confirmar'}
          </button>
          {editing
            ? <button className="btn-ghost !px-3 !py-1.5" onClick={() => setEditing(false)}><X className="size-4" /> Cancelar edição</button>
            : <button className="btn-outline !px-3 !py-1.5" onClick={() => setEditing(true)}><Pencil className="size-4" /> Corrigir</button>}
          <button className="btn-danger !px-3 !py-1.5" disabled={busy} onClick={() => void decide('rejected')}><Trash2 className="size-4" /> Descartar</button>
        </div>
      )}
    </div>
  )
}

type Tab = 'pendentes' | 'todas'

export function InboxPage() {
  const { modules } = useAuth()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [tab, setTab] = useState<Tab>('pendentes')
  const [reprocessing, setReprocessing] = useState<string | null>(null)
  const [allModules, setAllModules] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('assistant_messages')
      .select('id, content_text, status, intent, reply_text, error, created_at, assistant_drafts(*)')
      .order('created_at', { ascending: false }).limit(50)
    setMessages((data ?? []) as Message[])
  }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    supabase.from('modules').select('key, name').then(({ data }) => setAllModules(Object.fromEntries((data ?? []).map((m) => [m.key, m.name]))))
  }, [])

  const pendingCount = useMemo(() => (messages ?? []).reduce((n, m) => n + m.assistant_drafts.filter((d) => d.status === 'pending').length + (m.status === 'failed' ? 1 : 0), 0), [messages])
  const shown = (messages ?? []).filter((m) => tab === 'todas' || m.status === 'failed' || m.status === 'processing' || m.assistant_drafts.some((d) => d.status === 'pending'))

  async function reprocess(id: string) {
    setReprocessing(id)
    await supabase.functions.invoke('assistant-process', { body: { reprocess_message_id: id } })
    setReprocessing(null)
    void load()
  }
  async function remove(id: string) {
    if (!confirm('Apagar esta mensagem e os registros pendentes dela?')) return
    await supabase.from('assistant_messages').delete().eq('id', id)
    void load()
  }

  return (
    <div>
      <PageHeader title="Caixa de entrada" subtitle="Escreva como falaria com alguém. A IA organiza, você confirma." />
      <Composer onSent={() => void load()} />
      <p className="mt-2 text-xs text-stone-500">
        Módulos ativos no seu plano: {modules.map((m) => m.name).join(', ') || '—'}. Cada registro confirmado vai direto para o módulo correspondente.
      </p>

      <div className="mt-8 mb-3 flex items-center gap-1">
        {(['pendentes', 'todas'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900' : 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800'}`}>
            {t === 'pendentes' ? `Pendentes${pendingCount ? ` (${pendingCount})` : ''}` : 'Todas'}
          </button>
        ))}
      </div>

      {messages === null && <Spinner className="size-6" />}
      {messages && shown.length === 0 && (
        <EmptyState icon={tab === 'pendentes' ? Sparkles : Inbox} title={tab === 'pendentes' ? 'Nada pendente' : 'Nenhuma mensagem ainda'}>
          {tab === 'pendentes' ? 'Tudo confirmado. Envie uma nova mensagem acima.' : 'Envie sua primeira mensagem acima.'}
        </EmptyState>
      )}

      <div className="space-y-4">
        {shown.map((m) => (
          <article key={m.id} className="card !p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="whitespace-pre-wrap text-[15px]">“{m.content_text}”</p>
              <button className="btn-ghost !p-1.5 text-stone-400" onClick={() => void remove(m.id)} aria-label="Apagar mensagem"><Trash2 className="size-4" /></button>
            </div>
            <div className="mt-1 text-xs text-stone-500">{formatDateTime(m.created_at)}</div>

            {m.status === 'failed' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Alert>Não foi possível processar{m.error?.includes('não configurada') ? ': o assistente ainda não foi configurado.' : '.'}</Alert>
                <button className="btn-outline !py-1.5" disabled={reprocessing === m.id} onClick={() => void reprocess(m.id)}>
                  {reprocessing === m.id ? <Spinner /> : <RotateCw className="size-4" />} Reprocessar
                </button>
              </div>
            )}
            {m.status === 'processing' && <div className="mt-3 flex items-center gap-2 text-sm text-stone-500"><Spinner /> Processando…</div>}
            {m.reply_text && m.status === 'processed' && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-sand-200/60 px-3 py-2 text-sm dark:bg-stone-800"><Sparkles className="mt-0.5 size-4 shrink-0 text-brand-600" /> {m.reply_text}</div>
            )}
            {m.assistant_drafts.length > 0 && (
              <div className="mt-3 space-y-2">
                {m.assistant_drafts.sort((a, b) => a.created_at.localeCompare(b.created_at)).map((d) => (
                  <DraftCard key={d.id} d={d} onChange={() => void load()} moduleName={d.module_key ? allModules[d.module_key] : undefined} />
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

export function AssistantPage() {
  const [sent, setSent] = useState(0)
  return (
    <div className="max-w-2xl">
      <PageHeader title="Assistente" subtitle="Registre gastos, treinos, compromissos, sintomas, sonhos ou ideias em uma frase." />
      <Composer autoFocus onSent={() => setSent((n) => n + 1)} />
      {sent > 0 && <a href="/app/caixa-de-entrada" className="btn-outline mt-4">Ver na caixa de entrada</a>}
      <div className="mt-8 text-sm text-stone-500">
        <p className="font-medium text-stone-700 dark:text-stone-300">Exemplos</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Almoço no restaurante R$ 58 no débito</li>
          <li>Consulta com dentista sexta às 14h</li>
          <li>Corri 5 km em 32 minutos hoje cedo</li>
          <li>Ideia: organizar as fotos da viagem por mês</li>
        </ul>
      </div>
    </div>
  )
}
