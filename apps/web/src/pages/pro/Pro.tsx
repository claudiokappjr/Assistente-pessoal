import { Clock, MailPlus, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner, Stat } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'
import type { Consent, Link, Module, ProfessionalProfile, Profile, Specialty } from '../../lib/types'

function useProfessional() {
  const { session } = useAuth()
  const [pro, setPro] = useState<ProfessionalProfile | null | undefined>(undefined)
  const reload = useCallback(() => supabase.from('professional_profiles').select('*').eq('user_id', session!.user.id).maybeSingle()
    .then(({ data }) => setPro(data as ProfessionalProfile | null)), [session])
  useEffect(() => { void reload() }, [reload])
  return { pro, reload }
}

function PendingApproval() {
  return (
    <Alert kind="info">
      <strong>Cadastro em análise.</strong> Um administrador vai conferir seu registro profissional. Enquanto isso você pode completar o perfil público, mas ainda não pode convidar clientes nem aparecer no catálogo.
    </Alert>
  )
}

/** Usuário comum solicita o perfil profissional. */
export function BecomeProfessionalPage() {
  const { refresh, profile } = useAuth()
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const [name, setName] = useState(profile?.full_name ?? '')
  const [council, setCouncil] = useState('')
  const [registration, setRegistration] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    supabase.from('specialties').select('*').eq('is_active', true).order('name').then(({ data }) => setSpecialties((data ?? []) as Specialty[]))
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!selected.length) return setError('Escolha pelo menos uma especialidade.')
    setBusy(true); setError('')
    const { error } = await supabase.rpc('become_professional', {
      _public_name: name.trim(), _council: council.trim() || null, _registration: registration.trim() || null, _specialty_ids: selected,
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    await refresh()
    navigate('/pro')
  }

  return (
    <div className="max-w-xl">
      <PageHeader title="Sou profissional" subtitle="Atenda seus clientes pela plataforma. Seu cadastro passa por verificação antes de ser liberado." />
      <form onSubmit={submit} className="card space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="pn">Nome profissional</label>
          <input id="pn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Dra. Ana Souza" required />
        </div>
        <div>
          <span className="label">Especialidades</span>
          <div className="flex flex-wrap gap-2">
            {specialties.map((s) => {
              const on = selected.includes(s.id)
              return (
                <button type="button" key={s.id} onClick={() => setSelected((x) => on ? x.filter((i) => i !== s.id) : [...x, s.id])}
                  className={`badge !px-3 !py-1.5 border ${on ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>
                  {s.name}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div>
            <label className="label" htmlFor="co">Conselho</label>
            <input id="co" className="input" value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="CRM, CRP…" />
          </div>
          <div>
            <label className="label" htmlFor="rg">Número de registro</label>
            <input id="rg" className="input" value={registration} onChange={(e) => setRegistration(e.target.value)} placeholder="Ex.: 12345/MT" />
          </div>
        </div>
        <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Solicitar verificação</button>
      </form>
    </div>
  )
}

export function ProDashboardPage() {
  const { session } = useAuth()
  const { pro } = useProfessional()
  const [counts, setCounts] = useState({ active: 0, invited: 0, consents: 0 })

  useEffect(() => {
    const uid = session!.user.id
    Promise.all([
      supabase.from('professional_client_links').select('status').eq('professional_id', uid),
      supabase.from('consent_grants').select('id', { count: 'exact', head: true }).eq('professional_id', uid).is('revoked_at', null),
    ]).then(([l, c]) => {
      const rows = (l.data ?? []) as { status: string }[]
      setCounts({ active: rows.filter((r) => r.status === 'active').length, invited: rows.filter((r) => r.status === 'invited').length, consents: c.count ?? 0 })
    })
  }, [session])

  if (pro === undefined) return <Spinner className="size-6" />
  return (
    <div>
      <PageHeader title={pro?.public_name ?? 'Painel profissional'} subtitle="Seus clientes e autorizações." />
      {!pro?.approved_at && <div className="mb-6"><PendingApproval /></div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Clientes ativos" value={counts.active} />
        <Stat label="Convites pendentes" value={counts.invited} />
        <Stat label="Autorizações recebidas" value={counts.consents} hint="Módulos liberados pelos clientes" />
      </div>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <EmptyState icon={Clock} title="Agenda de atendimentos — Fase 3">Horários, valores e agendamento online pelos clientes.</EmptyState>
        <EmptyState icon={Clock} title="Revisão de itens da IA — Fase 4">Resumos e registros sugeridos pela IA aguardando sua aprovação.</EmptyState>
      </div>
    </div>
  )
}

type ClientRow = Link & { profile?: Pick<Profile, 'id' | 'full_name'>; consents: Consent[] }

export function ProClientsPage() {
  const { session } = useAuth()
  const uid = session!.user.id
  const { pro } = useProfessional()
  const [rows, setRows] = useState<ClientRow[] | null>(null)
  const [modules, setModules] = useState<Module[]>([])
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [l, c, m] = await Promise.all([
      supabase.from('professional_client_links').select('*').eq('professional_id', uid).order('created_at', { ascending: false }),
      supabase.from('consent_grants').select('*').eq('professional_id', uid).is('revoked_at', null),
      supabase.from('modules').select('*'),
    ])
    const links = (l.data ?? []) as Link[]
    const ids = links.map((x) => x.client_id)
    const profiles = ids.length ? ((await supabase.from('profiles').select('id, full_name').in('id', ids)).data ?? []) : []
    const consents = (c.data ?? []) as Consent[]
    setModules((m.data ?? []) as Module[])
    setRows(links.map((x) => ({ ...x, profile: profiles.find((p) => p.id === x.client_id), consents: consents.filter((k) => k.client_id === x.client_id) })))
  }, [uid])
  useEffect(() => { void load() }, [load])

  async function invite(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.rpc('invite_client', { _email: email })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setEmail('')
    setMsg({ kind: 'success', text: 'Convite enviado. O cliente verá o convite ao entrar na plataforma.' })
    void load()
  }

  const statusBadge = (s: string) => ({
    invited: <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">Convite pendente</span>,
    active: <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200">Ativo</span>,
    ended: <span className="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400">Encerrado</span>,
  })[s]

  return (
    <div>
      <PageHeader title="Clientes" subtitle="Você só vê os módulos que cada cliente autorizou." />
      {pro && !pro.approved_at ? <PendingApproval /> : (
        <form onSubmit={invite} className="card mb-6">
          <label className="label" htmlFor="ie">Convidar cliente pelo e-mail</label>
          <div className="flex flex-wrap gap-2">
            <input id="ie" type="email" className="input max-w-sm flex-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" required />
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : <MailPlus className="size-4" />} Convidar</button>
          </div>
          <p className="mt-2 text-xs text-stone-500">O cliente precisa ter conta na plataforma. Convite por e-mail para quem ainda não tem conta chega com o serviço de e-mail transacional.</p>
          {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
        </form>
      )}

      {rows?.length === 0 && <EmptyState icon={Users} title="Nenhum cliente ainda">Convide seu primeiro cliente pelo e-mail.</EmptyState>}
      <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        {rows?.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b border-stone-100 px-4 py-3 last:border-0 dark:border-stone-800">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{r.profile?.full_name ?? 'Cliente'}</div>
              <div className="text-xs text-stone-500">
                {r.consents.length ? `Acesso a: ${r.consents.map((c) => modules.find((m) => m.key === c.module_key)?.name ?? c.module_key).join(', ')}` : 'Nenhum módulo autorizado'}
                {' · '}desde {formatDate(r.created_at)}
              </div>
            </div>
            {statusBadge(r.status)}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProProfilePage() {
  const { pro, reload } = useProfessional()
  const [form, setForm] = useState<Partial<ProfessionalProfile>>({})
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (pro) setForm(pro) }, [pro])

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('professional_profiles').update({
      public_name: form.public_name, bio: form.bio || null, council: form.council || null,
      registration_number: form.registration_number || null, slug: form.slug || null, is_public: !!form.is_public,
    }).eq('user_id', pro!.user_id)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setMsg({ kind: 'success', text: 'Perfil salvo.' })
    void reload()
  }

  if (pro === undefined) return <Spinner className="size-6" />
  if (pro === null) return <Alert>Perfil profissional não encontrado.</Alert>
  const set = (k: keyof ProfessionalProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="max-w-xl">
      <PageHeader title="Perfil público" subtitle="Como você aparece no catálogo de profissionais." />
      {!pro.approved_at && <div className="mb-4"><PendingApproval /></div>}
      <form onSubmit={save} className="card space-y-4">
        <div><label className="label" htmlFor="pn">Nome profissional</label><input id="pn" className="input" value={form.public_name ?? ''} onChange={set('public_name')} required /></div>
        <div><label className="label" htmlFor="bio">Apresentação</label><textarea id="bio" rows={4} className="input" value={form.bio ?? ''} onChange={set('bio')} /></div>
        <div className="grid grid-cols-[120px_1fr] gap-3">
          <div><label className="label" htmlFor="co">Conselho</label><input id="co" className="input" value={form.council ?? ''} onChange={set('council')} /></div>
          <div><label className="label" htmlFor="rg">Registro</label><input id="rg" className="input" value={form.registration_number ?? ''} onChange={set('registration_number')} /></div>
        </div>
        <div><label className="label" htmlFor="sl">Endereço da página (opcional)</label><input id="sl" className="input" value={form.slug ?? ''} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} placeholder="dra-ana-souza" /></div>
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" className="size-4 accent-brand-700" checked={!!form.is_public} onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))} disabled={!pro.approved_at} />
          Aparecer no catálogo público {!pro.approved_at && <span className="text-stone-400">(após aprovação)</span>}
        </label>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Salvar</button>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        </div>
      </form>
    </div>
  )
}
