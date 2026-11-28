import { BadgeCheck, CircleDashed, CreditCard, ScrollText, Search, ShieldPlus, UserPlus, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner, Stat } from '../../components/ui'
import { formatDate, formatDateTime, roleLabel } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'
import { AccessLink, AccessLinkButton, ProPlanPicker } from '../../components/plans'
import { STATUS_LABEL, type AdminUser, type AuditLog, type Module, type Plan, type SubscriptionStatus } from '../../lib/types'

export function AdminDashboardPage() {
  const [stats, setStats] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    supabase.rpc('admin_stats').then(({ data, error }) => error ? setError(errorMessage(error)) : setStats(data as Record<string, number>))
  }, [])
  return (
    <div>
      <PageHeader title="Indicadores" subtitle="Dados cadastrais e operacionais. O administrador não tem acesso a conteúdo clínico ou pessoal." />
      {error && <Alert>{error}</Alert>}
      {!stats ? <Spinner className="size-6" /> : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Usuários" value={stats.usuarios} />
          <Stat label="Novos (7 dias)" value={stats.novos_7_dias} />
          <Stat label="Profissionais" value={stats.profissionais} />
          <Stat label="Aguardando aprovação" value={stats.profissionais_pendentes} />
          <Stat label="Vínculos ativos" value={stats.vinculos_ativos} />
          <Stat label="Autorizações ativas" value={stats.consentimentos_ativos} />
          <Stat label="Mensagens no mês" value={stats.mensagens_mes ?? 0} hint="Só a contagem; o conteúdo é privado" />
          <Stat label="Falhas no mês" value={stats.mensagens_falha_mes ?? 0} />
        </div>
      )}
      <p className="mt-6 text-sm text-stone-500">Receita e assinaturas entram com a Fase 3.</p>
    </div>
  )
}

function SubscriptionEditor({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
  const isPro = user.roles.includes('professional') || (user.plan_key ?? '').startsWith('pro_')
  const [kind, setKind] = useState<'individual' | 'professional'>(isPro ? 'professional' : 'individual')
  const [planKey, setPlanKey] = useState(user.plan_key?.startsWith('pro_') ? user.plan_key : 'pro_10')
  const [mods, setMods] = useState<string[]>(user.pro_modules ?? [])
  const [status, setStatus] = useState<SubscriptionStatus>(user.subscription_status === 'canceled' || !user.subscription_status ? 'active' : user.subscription_status)
  const [seats, setSeats] = useState(user.seats && user.plan_key?.startsWith('pro_') ? String(user.seats) : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('admin_set_subscription', {
      _user: user.id, _plan_key: kind === 'professional' ? planKey : 'individual', _status: status,
      _pro_modules: kind === 'professional' ? mods : [], _seats: kind === 'professional' && seats ? Number(seats) : null,
      _notes: user.subscription_source === 'payment' && status === 'active' ? 'Ativado pelo admin' : null,
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <div><h2 className="font-display text-xl font-semibold">Plano de {user.full_name ?? user.email}</h2><p className="text-xs text-stone-500">{user.email}</p></div>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['individual', 'professional'] as const).map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-xl border px-3 py-2 text-sm font-medium ${kind === k ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'border-stone-300 dark:border-stone-700'}`}>
                {k === 'individual' ? 'Usuário final' : 'Profissional'}
              </button>
            ))}
          </div>
          {kind === 'professional' && (
            <>
              <ProPlanPicker planKey={planKey} setPlanKey={setPlanKey} selected={mods} setSelected={setMods} />
              <div><label className="label" htmlFor="seats">Vagas personalizadas (opcional)</label><input id="seats" className="input" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} placeholder="Usa o padrão do plano" /></div>
            </>
          )}
          <div>
            <label className="label" htmlFor="st">Situação</label>
            <select id="st" className="input" value={status} onChange={(e) => setStatus(e.target.value as SubscriptionStatus)}>
              {(Object.keys(STATUS_LABEL) as SubscriptionStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
            <p className="mt-1 text-xs text-stone-500">"Ativa" pelo admin funciona como cortesia, sem cobrança.</p>
          </div>
          {error && <Alert>{error}</Alert>}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Salvar plano</button>
        </div>
      </form>
    </div>
  )
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [kind, setKind] = useState<'user' | 'professional'>('user')
  const [planKey, setPlanKey] = useState('pro_10')
  const [mods, setMods] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { data, error } = await supabase.functions.invoke('manage-users', {
      body: { mode: 'admin', email, full_name: name, account_type: kind, plan_key: planKey, pro_modules: mods },
    })
    setBusy(false)
    if (error) {
      let detail = errorMessage(error)
      try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail } catch { /* sem corpo */ }
      return setError(detail)
    }
    setLink(data.action_link)
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl dark:bg-stone-900">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">Criar usuário (cortesia)</h2>
          <button type="button" className="btn-ghost !p-2" onClick={onClose} aria-label="Fechar"><X className="size-5" /></button>
        </div>
        {link ? <AccessLink link={link} name={name} /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {(['user', 'professional'] as const).map((k) => (
                <button type="button" key={k} onClick={() => setKind(k)} className={`rounded-xl border px-3 py-2 text-sm font-medium ${kind === k ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/30' : 'border-stone-300 dark:border-stone-700'}`}>
                  {k === 'user' ? 'Usuário final' : 'Profissional da saúde'}
                </button>
              ))}
            </div>
            <div><label className="label" htmlFor="nm">Nome completo</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="label" htmlFor="em">E-mail</label><input id="em" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            {kind === 'professional' && <ProPlanPicker planKey={planKey} setPlanKey={setPlanKey} selected={mods} setSelected={setMods} />}
            <p className="text-xs text-stone-500">A conta já nasce ativa, sem cobrança. Você recebe um link de primeiro acesso para enviar à pessoa.</p>
            {error && <Alert>{error}</Alert>}
            <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Criar conta</button>
          </div>
        )}
      </form>
    </div>
  )
}

export function AdminUsersPage() {
  const { session } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [creating, setCreating] = useState(false)
  const load = useCallback(() => supabase.rpc('admin_list_users').then(({ data, error }) => error ? setError(errorMessage(error)) : setUsers(data as AdminUser[])), [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => (users ?? []).filter((u) => `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())), [users, q])

  async function run(p: PromiseLike<{ error: unknown }>) {
    setError('')
    const { error } = await p
    if (error) setError(errorMessage(error))
    void load()
  }

  const statusTone = (s: SubscriptionStatus | null) => s === 'active' ? 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200' : s === 'pending_payment' || s === 'past_due' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'
  const sourceLabel = { payment: 'pagamento', admin: 'cortesia', professional: 'via profissional' } as const

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Crie contas, ative planos e aprove profissionais. Toda ação fica na auditoria."
        actions={<button className="btn-primary" onClick={() => setCreating(true)}><UserPlus className="size-4" /> Criar usuário</button>} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
        <input className="input pl-9" placeholder="Buscar por nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!users ? <Spinner className="size-6" /> : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const isPro = u.roles.includes('professional')
            const isAdmin = u.roles.includes('admin')
            return (
              <div key={u.id} className="card !p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{u.full_name ?? '—'}</div>
                    <div className="truncate text-xs text-stone-500">{u.email} · desde {formatDate(u.created_at)}{u.last_sign_in_at ? '' : ' · nunca entrou'}</div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.filter((r) => r !== 'user').map((r) => <span key={r} className="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{roleLabel[r]}</span>)}
                    {isPro && !u.professional_approved && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">registro a verificar</span>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {u.plan_name ? (
                    <>
                      <span className="font-medium">Plano {u.plan_name}</span>
                      <span className={`badge ${statusTone(u.subscription_status)}`}>{u.subscription_status ? STATUS_LABEL[u.subscription_status] : ''}</span>
                      {u.subscription_source && <span className="text-xs text-stone-500">{sourceLabel[u.subscription_source]}</span>}
                      {u.plan_key?.startsWith('pro_') && <span className="text-xs text-stone-500">· {u.seats_used}/{u.seats} clientes · {(u.pro_modules ?? []).length} módulo(s)</span>}
                    </>
                  ) : <span className="text-stone-500">Sem plano</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {u.subscription_status !== 'active' && u.plan_key && (
                    <button className="btn-primary !px-2.5 !py-1.5 text-xs" onClick={() => void run(supabase.rpc('admin_set_subscription', { _user: u.id, _plan_key: u.plan_key!, _status: 'active', _pro_modules: u.pro_modules ?? [], _seats: null, _notes: 'Ativado pelo admin' }))}>
                      <BadgeCheck className="size-3.5" /> Ativar (cortesia)
                    </button>
                  )}
                  <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => setEditing(u)}><CreditCard className="size-3.5" /> {u.plan_key ? 'Editar plano' : 'Dar plano'}</button>
                  {!u.last_sign_in_at && <AccessLinkButton userId={u.id} name={u.full_name ?? u.email} />}
                  {isPro && (u.professional_approved
                    ? <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => void run(supabase.rpc('admin_approve_professional', { _user: u.id, _approve: false }))}><CircleDashed className="size-3.5" /> Suspender registro</button>
                    : <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => void run(supabase.rpc('admin_approve_professional', { _user: u.id, _approve: true }))}><BadgeCheck className="size-3.5" /> Aprovar registro</button>)}
                  {!isAdmin && <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => confirm(`Tornar ${u.email} administrador?`) && void run(supabase.rpc('admin_set_role', { _user: u.id, _role: 'admin', _grant: true }))}><ShieldPlus className="size-3.5" /> Admin</button>}
                  {isAdmin && u.id !== session!.user.id && <button className="btn-danger !px-2.5 !py-1.5 text-xs" onClick={() => confirm(`Remover acesso de admin de ${u.email}?`) && void run(supabase.rpc('admin_set_role', { _user: u.id, _role: 'admin', _grant: false }))}>Remover admin</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {editing && <SubscriptionEditor user={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
      {creating && <CreateUserModal onClose={() => setCreating(false)} onCreated={() => void load()} />}
    </div>
  )
}

export function AdminCatalogPage() {
  const [modules, setModules] = useState<Module[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('plans').select('*').eq('is_active', true).order('sort_order'),
    ])
    setModules((m.data ?? []) as Module[]); setPlans((p.data ?? []) as Plan[])
  }, [])
  useEffect(() => { void load() }, [load])

  const toCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(/\./g, '').replace(',', '.')) * 100))
  const fromCents = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','))

  async function savePlan(p: Plan, field: 'price_monthly_cents' | 'clientes' | 'mensagens_ia_mes', raw: string) {
    setMsg(null)
    const patch = field === 'price_monthly_cents'
      ? { price_monthly_cents: toCents(raw) }
      : { limits: { ...p.limits, [field]: raw.trim() === '' ? undefined : Number(raw) } }
    const { error } = await supabase.from('plans').update(patch).eq('id', p.id)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setMsg({ kind: 'success', text: 'Salvo.' }); void load()
  }
  async function saveModule(m: Module, raw: string) {
    setMsg(null)
    const { error } = await supabase.from('modules').update({ pro_addon_price_cents: toCents(raw) }).eq('key', m.key)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setMsg({ kind: 'success', text: 'Salvo.' }); void load()
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Planos e preços" subtitle="Valores mensais em R$. Deixe em branco o que ainda não foi definido. Ficam valendo para novas cobranças quando o pagamento online for ligado." />
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Planos</h2>
        <div className="space-y-2">
          {plans.map((p) => (
            <div key={p.id} className="card grid gap-3 !p-4 sm:grid-cols-4 sm:items-end">
              <div><div className="font-medium">{p.name}</div><div className="text-xs text-stone-500">{p.audience === 'individual' ? 'Usuário final · 8 módulos' : 'Profissional'}</div></div>
              <div><label className="label text-xs">Preço/mês (R$)</label><input className="input" inputMode="decimal" defaultValue={fromCents(p.price_monthly_cents)} onBlur={(e) => void savePlan(p, 'price_monthly_cents', e.target.value)} placeholder="a definir" /></div>
              {p.audience === 'professional'
                ? <div><label className="label text-xs">Nº de clientes</label><input className="input" inputMode="numeric" defaultValue={p.limits?.clientes ?? ''} onBlur={(e) => void savePlan(p, 'clientes', e.target.value)} /></div>
                : <div />}
              <div><label className="label text-xs">Mensagens IA/mês</label><input className="input" inputMode="numeric" defaultValue={p.limits?.mensagens_ia_mes ?? ''} onBlur={(e) => void savePlan(p, 'mensagens_ia_mes', e.target.value)} /></div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-1 font-display text-lg font-semibold">Módulos de gestão do profissional</h2>
        <p className="mb-3 text-sm text-stone-500">Valor somado ao plano do profissional para cada módulo que ele quiser gerenciar nos clientes.</p>
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          {modules.map((m) => (
            <div key={m.key} className="flex items-center gap-3 border-b border-stone-100 px-4 py-2.5 last:border-0 dark:border-stone-800">
              <div className="flex-1"><div className="font-medium">{m.name}</div>{m.is_sensitive && <div className="text-xs text-stone-500">Dado sensível (LGPD)</div>}</div>
              <span className="text-sm text-stone-500">+ R$</span>
              <input className="input !w-28" inputMode="decimal" defaultValue={fromCents(m.pro_addon_price_cents)} onBlur={(e) => void saveModule(m, e.target.value)} placeholder="a definir" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function AdminIntegrationsPage() {
  const items = [
    { name: 'Supabase (banco, login, arquivos)', status: 'Conectado', ok: true, note: 'Projeto em São Paulo (sa-east-1).' },
    { name: 'Login com Google', status: 'Não configurado', ok: false, note: 'Requer projeto no Google Cloud e ativação em Authentication › Providers.' },
    { name: 'WhatsApp Cloud API (Meta)', status: 'Não configurado', ok: false, note: 'Fase 2. Requer Meta Business verificado e número dedicado.' },
    { name: 'IA — Claude (Anthropic)', status: 'Função publicada', ok: true, note: 'Edge Function assistant-process. A chave ANTHROPIC_API_KEY fica só nos Secrets do Supabase; falhas aparecem nos indicadores.' },
    { name: 'Gateway de pagamento', status: 'Não configurado', ok: false, note: 'Fase 3. Cartão recorrente e Pix.' },
    { name: 'Google Agenda', status: 'Não configurado', ok: false, note: 'Fase 3. OAuth por usuário.' },
    { name: 'E-mail transacional', status: 'Padrão do Supabase', ok: false, note: 'Limite baixo de envios. Configurar SMTP próprio antes do lançamento.' },
  ]
  return (
    <div>
      <PageHeader title="Integrações" subtitle="Estado real de cada integração externa." />
      <div className="space-y-2">
        {items.map((i) => (
          <div key={i.name} className="card flex flex-wrap items-center gap-3 !py-4">
            <span className={`size-2.5 rounded-full ${i.ok ? 'bg-brand-500' : 'bg-stone-300 dark:bg-stone-600'}`} />
            <div className="min-w-0 flex-1"><div className="font-medium">{i.name}</div><div className="text-xs text-stone-500">{i.note}</div></div>
            <span className={`badge ${i.ok ? 'bg-brand-100 text-brand-800' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>{i.status}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLog[] | null>(null)
  useEffect(() => {
    supabase.from('audit_logs').select('*').order('occurred_at', { ascending: false }).limit(200).then(({ data }) => setLogs((data ?? []) as AuditLog[]))
  }, [])
  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Últimos 200 eventos. Registros imutáveis." />
      {!logs ? <Spinner className="size-6" /> : logs.length === 0 ? <EmptyState icon={ScrollText} title="Nenhum evento" /> : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
              <tr><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Tabela</th><th className="px-4 py-3">Ação</th><th className="px-4 py-3">Autor</th><th className="px-4 py-3">Titular</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 font-mono text-xs dark:divide-stone-800">
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(l.occurred_at)}</td>
                  <td className="px-4 py-2.5">{l.table_name}</td>
                  <td className="px-4 py-2.5">{l.action}</td>
                  <td className="px-4 py-2.5">{l.actor_id?.slice(0, 8) ?? 'sistema'}</td>
                  <td className="px-4 py-2.5">{l.subject_id?.slice(0, 8) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
