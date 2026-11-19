import { BadgeCheck, CircleDashed, ScrollText, Search, ShieldPlus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner, Stat } from '../../components/ui'
import { formatDate, formatDateTime, roleLabel } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'
import type { AdminUser, AuditLog, Module, Plan } from '../../lib/types'

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
        </div>
      )}
      <p className="mt-6 text-sm text-stone-500">Receita, assinaturas e mensagens processadas entram com as Fases 2 e 3.</p>
    </div>
  )
}

export function AdminUsersPage() {
  const { session } = useAuth()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const load = useCallback(() => supabase.rpc('admin_list_users').then(({ data, error }) => error ? setError(errorMessage(error)) : setUsers(data as AdminUser[])), [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => (users ?? []).filter((u) => `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())), [users, q])

  async function run(p: PromiseLike<{ error: unknown }>) {
    setError('')
    const { error } = await p
    if (error) setError(errorMessage(error))
    void load()
  }

  return (
    <div>
      <PageHeader title="Usuários" subtitle="Aprove profissionais e gerencie administradores. Toda ação fica na auditoria." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" />
        <input className="input pl-9" placeholder="Buscar por nome ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!users ? <Spinner className="size-6" /> : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
              <tr><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Papéis</th><th className="px-4 py-3">Cadastro</th><th className="px-4 py-3 text-right">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {filtered.map((u) => {
                const isPro = u.roles.includes('professional')
                const isAdmin = u.roles.includes('admin')
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-3"><div className="font-medium">{u.full_name ?? '—'}</div><div className="text-xs text-stone-500">{u.email}</div></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => <span key={r} className="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300">{roleLabel[r]}</span>)}
                        {isPro && !u.professional_approved && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">pendente</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-stone-500 tabular-nums">{formatDate(u.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {isPro && (u.professional_approved
                          ? <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => void run(supabase.rpc('admin_approve_professional', { _user: u.id, _approve: false }))}><CircleDashed className="size-3.5" /> Suspender</button>
                          : <button className="btn-outline !px-2.5 !py-1.5 text-xs" onClick={() => void run(supabase.rpc('admin_approve_professional', { _user: u.id, _approve: true }))}><BadgeCheck className="size-3.5" /> Aprovar</button>)}
                        {!isAdmin && <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => confirm(`Tornar ${u.email} administrador?`) && void run(supabase.rpc('admin_set_role', { _user: u.id, _role: 'admin', _grant: true }))}><ShieldPlus className="size-3.5" /> Admin</button>}
                        {isAdmin && u.id !== session!.user.id && <button className="btn-danger !px-2.5 !py-1.5 text-xs" onClick={() => confirm(`Remover acesso de admin de ${u.email}?`) && void run(supabase.rpc('admin_set_role', { _user: u.id, _role: 'admin', _grant: false }))}>Remover admin</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export function AdminCatalogPage() {
  const [modules, setModules] = useState<Module[]>([])
  const [plans, setPlans] = useState<(Plan & { plan_modules: { module_key: string }[] })[]>([])
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('plans').select('*, plan_modules(module_key)').order('sort_order'),
    ])
    setModules((m.data ?? []) as Module[]); setPlans((p.data ?? []) as never)
  }, [])
  useEffect(() => { void load() }, [load])

  async function toggle(planId: string, moduleKey: string, on: boolean) {
    setError('')
    const { error } = on
      ? await supabase.from('plan_modules').delete().eq('plan_id', planId).eq('module_key', moduleKey)
      : await supabase.from('plan_modules').insert({ plan_id: planId, module_key: moduleKey })
    if (error) setError(errorMessage(error))
    void load()
  }

  return (
    <div>
      <PageHeader title="Módulos e planos" subtitle="Defina quais módulos cada plano libera. Preços serão definidos com o gateway de pagamento (Fase 3)." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500 dark:border-stone-800">
            <tr><th className="px-4 py-3">Módulo</th>{plans.map((p) => <th key={p.id} className="px-4 py-3 text-center">{p.name}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {modules.map((m) => (
              <tr key={m.key}>
                <td className="px-4 py-3"><div className="font-medium">{m.name}</div>{m.is_sensitive && <div className="text-xs text-stone-500">Dado sensível (LGPD art. 11)</div>}</td>
                {plans.map((p) => {
                  const on = p.plan_modules.some((x) => x.module_key === m.key)
                  return <td key={p.id} className="px-4 py-3 text-center"><input type="checkbox" className="size-4 accent-brand-700" checked={on} onChange={() => void toggle(p.id, m.key, on)} aria-label={`${m.name} no plano ${p.name}`} /></td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-stone-500">A mudança vale para novos cadastros. Ajuste de módulos de quem já assinou será automático quando as assinaturas estiverem ativas.</p>
    </div>
  )
}

export function AdminIntegrationsPage() {
  const items = [
    { name: 'Supabase (banco, login, arquivos)', status: 'Conectado', ok: true, note: 'Projeto em São Paulo (sa-east-1).' },
    { name: 'Login com Google', status: 'Não configurado', ok: false, note: 'Requer projeto no Google Cloud e ativação em Authentication › Providers.' },
    { name: 'WhatsApp Cloud API (Meta)', status: 'Não configurado', ok: false, note: 'Fase 2. Requer Meta Business verificado e número dedicado.' },
    { name: 'Provedor de IA', status: 'Não configurado', ok: false, note: 'Fase 2. Chave ficará só no servidor (Edge Functions).' },
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
