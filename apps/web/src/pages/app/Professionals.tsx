import { Check, ShieldCheck, ShieldOff, UserX, Users, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'
import type { Consent, Link, Module, ProfessionalProfile } from '../../lib/types'
import { ClientAccessRequests, type AccessRequest } from '../../components/AccessRequests'

type LinkRow = Link & { pro?: ProfessionalProfile }

/** Cliente vê convites, aceita/recusa, e concede/revoga acesso por módulo. */
export function MyProfessionalsPage() {
  const { session } = useAuth()
  const uid = session!.user.id
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [consents, setConsents] = useState<Consent[]>([])
  const [modules, setModules] = useState<Module[]>([])
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [l, c, m, r] = await Promise.all([
      supabase.from('professional_client_links').select('*').eq('client_id', uid).neq('status', 'ended').order('created_at', { ascending: false }),
      supabase.from('consent_grants').select('*').eq('client_id', uid).is('revoked_at', null),
      supabase.from('modules').select('*').eq('is_active', true).order('sort_order'),
      supabase.from('consent_requests').select('*').eq('client_id', uid).eq('status', 'pendente'),
    ])
    setRequests(((r.data ?? []) as AccessRequest[]))
    const rows = (l.data ?? []) as Link[]
    const ids = rows.map((r) => r.professional_id)
    const pros = ids.length ? ((await supabase.from('professional_profiles').select('*').in('user_id', ids)).data ?? []) as ProfessionalProfile[] : []
    setLinks(rows.map((r) => ({ ...r, pro: pros.find((p) => p.user_id === r.professional_id) })))
    setConsents((c.data ?? []) as Consent[])
    setModules((m.data ?? []) as Module[])
  }, [uid])
  useEffect(() => { void load() }, [load])

  async function act(fn: () => PromiseLike<{ error: unknown }>) {
    setError('')
    const { error } = await fn()
    if (error) setError(errorMessage(error))
    await load()
  }

  const setStatus = (id: string, status: 'active' | 'ended') => act(() => supabase.from('professional_client_links').update({ status }).eq('id', id))
  const grant = (pro: string, module: string, moduleName: string) => act(() =>
    supabase.from('consent_grants').insert({ client_id: uid, professional_id: pro, module_key: module, purpose: `Acompanhamento profissional — ${moduleName}` }))
  const revoke = (id: string) => act(() => supabase.from('consent_grants').update({ revoked_at: new Date().toISOString() }).eq('id', id))

  return (
    <div>
      <PageHeader title="Meus profissionais" subtitle="Você decide, módulo por módulo, o que cada profissional pode ver. Revogar corta o acesso na hora." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {links === null && <Spinner className="size-6" />}
      {links?.length === 0 && (
        <EmptyState icon={Users} title="Nenhum profissional vinculado">
          Quando um profissional convidar você pelo seu e-mail, o convite aparecerá aqui.
        </EmptyState>
      )}
      <div className="space-y-4">
        {links?.map((l) => (
          <div key={l.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-display text-lg font-semibold">{l.pro?.public_name ?? 'Profissional'}</div>
                <div className="text-sm text-stone-500">
                  {l.pro?.council && `${l.pro.council} ${l.pro.registration_number ?? ''} · `}
                  {l.status === 'invited' ? `Convite recebido em ${formatDate(l.created_at)}` : `Vinculado desde ${formatDate(l.accepted_at)}`}
                </div>
              </div>
              {l.status === 'invited' ? (
                <div className="flex gap-2">
                  <button className="btn-primary" onClick={() => void setStatus(l.id, 'active')}><Check className="size-4" /> Aceitar</button>
                  <button className="btn-ghost" onClick={() => void setStatus(l.id, 'ended')}><X className="size-4" /> Recusar</button>
                </div>
              ) : (
                <button className="btn-danger" onClick={() => confirm('Encerrar o vínculo? Todas as autorizações serão revogadas.') && void setStatus(l.id, 'ended')}>
                  <UserX className="size-4" /> Encerrar vínculo
                </button>
              )}
            </div>

            {l.status === 'invited' && requests.some((r) => r.professional_id === l.professional_id) && (
              <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                Este profissional pediu para ver: <strong>{requests.filter((r) => r.professional_id === l.professional_id).map((r) => modules.find((m) => m.key === r.module_key)?.name ?? r.module_key).join(', ')}</strong>. Aceite o convite e depois escolha o que liberar.
              </div>
            )}
            {l.status === 'active' && (
              <ClientAccessRequests requests={requests.filter((r) => r.professional_id === l.professional_id)} modules={modules} onChanged={() => void load()} />
            )}
            {l.status === 'active' && (
              <div className="mt-5">
                <div className="mb-2 text-sm font-medium">O que este profissional pode ver</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {modules.map((m) => {
                    const c = consents.find((x) => x.professional_id === l.professional_id && x.module_key === m.key)
                    return (
                      <div key={m.key} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${c ? 'border-brand-300 bg-brand-50/60 dark:border-brand-800 dark:bg-brand-900/20' : 'border-stone-200 dark:border-stone-800'}`}>
                        <div>
                          <div className="text-sm font-medium">{m.name}</div>
                          <div className="text-xs text-stone-500">{c ? `Autorizado em ${formatDate(c.granted_at)}` : 'Sem acesso'}</div>
                        </div>
                        {c ? (
                          <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => void revoke(c.id)}><ShieldOff className="size-3.5" /> Revogar</button>
                        ) : (
                          <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => void grant(l.professional_id, m.key, m.name)}><ShieldCheck className="size-3.5" /> Autorizar</button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
