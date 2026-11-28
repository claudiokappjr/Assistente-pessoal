import { Check, KeyRound, Send, ShieldCheck, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { errorMessage, supabase } from '../lib/supabase'
import type { Module } from '../lib/types'
import { Alert, Spinner } from './ui'

export interface AccessRequest {
  id: string; professional_id: string; client_id: string; module_key: string; note: string | null
  status: 'pendente' | 'aprovado' | 'recusado' | 'cancelado'; created_at: string; decided_at: string | null
}
export const notifyAccessChanged = () => window.dispatchEvent(new Event('drafts-changed'))

/**
 * Profissional: escolhe os módulos (do próprio plano) que quer acompanhar e
 * envia o pedido. O cliente aprova ou recusa em "Meus profissionais".
 */
export function ProAccessRequest({ clientId, proId, contracted, consented, modules, onChanged }: {
  clientId: string; proId: string; contracted: string[]; consented: string[]; modules: Module[]; onChanged: () => void
}) {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [pick, setPick] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('consent_requests').select('*').eq('professional_id', proId).eq('client_id', clientId).order('created_at', { ascending: false })
    setRequests((data ?? []) as AccessRequest[])
  }, [proId, clientId])
  useEffect(() => { void load() }, [load])

  const pending = new Set(requests.filter((r) => r.status === 'pendente').map((r) => r.module_key))
  const refused = new Set(requests.filter((r) => r.status === 'recusado').map((r) => r.module_key))
  const available = modules.filter((m) => contracted.includes(m.key))
  const toRequest = available.filter((m) => !consented.includes(m.key) && !pending.has(m.key))

  async function send() {
    if (!pick.length) return setMsg({ kind: 'error', text: 'Escolha pelo menos um módulo.' })
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('consent_requests').insert(pick.map((m) => ({ client_id: clientId, module_key: m, note: note.trim() || null })))
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setMsg({ kind: 'success', text: 'Pedido enviado. O cliente vai ver em "Meus profissionais" e decidir o que liberar.' })
    setPick([]); setNote(''); void load(); onChanged()
  }
  async function cancel(r: AccessRequest) {
    const { error } = await supabase.from('consent_requests').update({ status: 'cancelado' }).eq('id', r.id)
    if (error) setMsg({ kind: 'error', text: errorMessage(error) }); else void load()
  }

  if (!available.length) return <Alert kind="info">Seu plano profissional não tem módulos de acompanhamento. Fale com o suporte para incluir.</Alert>
  return (
    <section className="card mb-5">
      <h3 className="mb-1 flex items-center gap-2 font-medium"><KeyRound className="size-4 text-brand-600" /> Acesso aos módulos</h3>
      <p className="mb-3 text-xs text-stone-500">Peça acesso ao que você precisa acompanhar. Só o cliente libera, e ele pode revogar quando quiser.</p>
      <div className="flex flex-wrap gap-1.5">
        {available.map((m) => {
          const ok = consented.includes(m.key)
          const wait = pending.has(m.key)
          const on = pick.includes(m.key)
          if (ok) return <span key={m.key} className="badge bg-brand-100 !px-2.5 !py-1 text-brand-800 dark:bg-brand-900 dark:text-brand-200"><ShieldCheck className="size-3.5" /> {m.name}</span>
          if (wait) {
            const r = requests.find((x) => x.status === 'pendente' && x.module_key === m.key)!
            return (
              <span key={m.key} className="badge bg-amber-100 !px-2.5 !py-1 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                ⏳ {m.name} <button className="ml-1 underline" onClick={() => void cancel(r)} title="Cancelar pedido">cancelar</button>
              </span>
            )
          }
          return (
            <button key={m.key} type="button" onClick={() => setPick((p) => (on ? p.filter((x) => x !== m.key) : [...p, m.key]))}
              className={`badge border !px-2.5 !py-1 ${on ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>
              {on && <Check className="size-3.5" />} {m.name}{refused.has(m.key) ? ' (recusado antes)' : ''}
            </button>
          )
        })}
      </div>
      {toRequest.length > 0 && (
        <div className="mt-3 space-y-2">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Mensagem para o cliente (opcional). Ex.: para acompanhar seus exames e escalas." />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setPick(toRequest.map((m) => m.key))}>Selecionar todos</button>
            <button className="btn-primary" onClick={() => void send()} disabled={busy || !pick.length}>{busy ? <Spinner /> : <Send className="size-4" />} Pedir acesso{pick.length ? ` (${pick.length})` : ''}</button>
          </div>
        </div>
      )}
      <div className="mt-2 text-[11px] text-stone-400"><ShieldCheck className="inline size-3" /> liberado · ⏳ aguardando o cliente</div>
      {msg && <div className="mt-2"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
    </section>
  )
}

/** Cliente: pedidos pendentes de um profissional, para aprovar ou recusar. */
export function ClientAccessRequests({ requests, modules, onChanged }: { requests: AccessRequest[]; modules: Module[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = requests.filter((r) => r.status === 'pendente')
  if (!pending.length) return null
  const name = (k: string) => modules.find((m) => m.key === k)?.name ?? k
  async function decide(ids: string[], status: 'aprovado' | 'recusado') {
    setBusy(true); setError('')
    const { error } = await supabase.from('consent_requests').update({ status }).in('id', ids)
    setBusy(false)
    if (error) return setError(errorMessage(error))
    notifyAccessChanged(); onChanged()
  }
  const note = pending.find((r) => r.note)?.note
  return (
    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="mb-2 text-sm font-medium">Pediu acesso a {pending.length === 1 ? 'um módulo' : `${pending.length} módulos`}</div>
      {note && <p className="mb-2 text-sm italic text-stone-600 dark:text-stone-300">“{note}”</p>}
      <ul className="space-y-1.5">
        {pending.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm dark:bg-stone-900">
            <span className="font-medium">{name(r.module_key)}</span>
            <span className="flex gap-1">
              <button className="btn-primary !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => void decide([r.id], 'aprovado')}><Check className="size-3.5" /> Liberar</button>
              <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy} onClick={() => void decide([r.id], 'recusado')}><X className="size-3.5" /> Recusar</button>
            </span>
          </li>
        ))}
      </ul>
      {pending.length > 1 && (
        <div className="mt-2 flex justify-end gap-2">
          <button className="btn-ghost !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => void decide(pending.map((r) => r.id), 'recusado')}>Recusar todos</button>
          <button className="btn-primary !px-3 !py-1.5" disabled={busy} onClick={() => void decide(pending.map((r) => r.id), 'aprovado')}>{busy && <Spinner />} Liberar todos</button>
        </div>
      )}
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <p className="mt-2 text-[11px] text-stone-500">Você pode revogar qualquer liberação depois, aqui mesmo.</p>
    </div>
  )
}
