import { Briefcase, Eye, EyeOff, MailCheck, User } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ProPlanPicker, usePlansAndModules } from '../../components/plans'
import { money } from '../../modules/config'
import type { Specialty } from '../../lib/types'
import { Alert, Logo, Spinner } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-700 p-12 text-sand-200 lg:flex">
        <Link to="/" className="[&_span]:!text-sand-100"><Logo /></Link>
        <div>
          <p className="font-display text-4xl leading-tight text-sand-100">Sua vida organizada<br />em um só lugar.</p>
          <p className="mt-4 max-w-md text-sand-300/80">Finanças, saúde, agenda e registros pessoais — com você no controle de quem vê cada informação.</p>
        </div>
        <p className="text-sm text-sand-300/60">Dados armazenados no Brasil · LGPD</p>
      </div>
      <div className="flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 inline-block lg:hidden"><Logo /></Link>
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-stone-500">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

function PasswordInput({ value, onChange, autoComplete, id }: { value: string; onChange: (v: string) => void; autoComplete: string; id: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input id={id} type={show ? 'text' : 'password'} className="input pr-11" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required minLength={8} />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-stone-400 hover:text-stone-600" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

async function signInWithGoogle(setError: (e: string) => void) {
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/app` } })
  if (error) setError(errorMessage(error))
}

// Só aparece quando o login Google estiver configurado no Supabase (sem botões de integração fictícia).
const GOOGLE_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === 'true'

function GoogleButton({ onError }: { onError: (e: string) => void }) {
  if (!GOOGLE_ENABLED) return null
  return (
    <>
      <button type="button" className="btn-outline w-full" onClick={() => void signInWithGoogle(onError)}>
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.3 6.6 2.3 12s4.3 9.8 9.7 9.8c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" /></svg>
        Continuar com Google
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-stone-400"><span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />ou<span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" /></div>
    </>
  )
}

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/app'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    navigate(from, { replace: true })
  }

  return (
    <AuthShell title="Entrar" subtitle="Bem-vindo de volta." footer={<>Ainda não tem conta? <Link to="/cadastro" className="font-medium text-brand-700 dark:text-brand-300">Criar conta</Link></>}>
      <GoogleButton onError={setError} />
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="label" htmlFor="password">Senha</label>
            <Link to="/esqueci-a-senha" className="mb-1.5 text-xs text-brand-700 dark:text-brand-300">Esqueci a senha</Link>
          </div>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Entrar</button>
      </form>
    </AuthShell>
  )
}

export function SignupPage() {
  const [params] = useSearchParams()
  const [accountType, setAccountType] = useState<'individual' | 'professional'>(params.get('tipo') === 'profissional' ? 'professional' : 'individual')
  const [planKey, setPlanKey] = useState('pro_10')
  const [proModules, setProModules] = useState<string[]>([])
  const [publicName, setPublicName] = useState('')
  const [council, setCouncil] = useState('')
  const [registration, setRegistration] = useState('')
  const [specialtyKeys, setSpecialtyKeys] = useState<string[]>([])
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const { plans } = usePlansAndModules()
  const individual = plans.find((p) => p.key === 'individual')
  useEffect(() => {
    supabase.from('specialties').select('*').eq('is_active', true).order('name').then(({ data }) => setSpecialties((data ?? []) as Specialty[]))
  }, [])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!accepted) return setError('É preciso aceitar os termos e a política de privacidade.')
    if (accountType === 'professional' && proModules.length === 0) return setError('Escolha pelo menos um módulo para gerenciar.')
    if (accountType === 'professional' && specialtyKeys.length === 0) return setError('Escolha pelo menos uma especialidade.')
    setBusy(true); setError('')
    const meta: Record<string, unknown> = { full_name: name.trim(), plan_key: accountType === 'professional' ? planKey : 'individual' }
    if (accountType === 'professional') Object.assign(meta, { pro_modules: proModules, public_name: publicName.trim() || name.trim(), council: council.trim(), registration: registration.trim(), specialties: specialtyKeys })
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { data: meta, emailRedirectTo: `${location.origin}/app` },
    })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    if (data.session) navigate('/app', { replace: true })
    else setSent(true)
  }

  if (sent) {
    return (
      <AuthShell title="Confirme seu e-mail">
        <div className="card flex flex-col items-center text-center">
          <MailCheck className="size-10 text-brand-600" />
          <p className="mt-3 text-sm">Enviamos um link de confirmação para <strong>{email}</strong>. Abra o e-mail e toque no link para ativar sua conta.</p>
        </div>
        <Link to="/entrar" className="btn-ghost mt-4 w-full">Voltar para o login</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Criar conta" subtitle="Escolha como você vai usar a plataforma." footer={<>Já tem conta? <Link to="/entrar" className="font-medium text-brand-700 dark:text-brand-300">Entrar</Link></>}>
      <GoogleButton onError={setError} />
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-2">
          {([['individual', User, 'Para mim', individual?.price_monthly_cents != null ? `${money(individual.price_monthly_cents)}/mês` : 'Plano Individual'], ['professional', Briefcase, 'Sou profissional da saúde', 'Planos por nº de clientes']] as const).map(([k, Icon, t, d]) => (
            <button type="button" key={k} onClick={() => setAccountType(k)}
              className={`rounded-xl border p-3 text-left transition ${accountType === k ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/20 dark:bg-brand-900/30' : 'border-stone-300 dark:border-stone-700'}`}>
              <Icon className="size-5 text-brand-700 dark:text-brand-300" />
              <div className="mt-1.5 text-sm font-medium">{t}</div>
              <div className="text-xs text-stone-500">{d}</div>
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="name">Nome completo</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
        </div>
        <div>
          <label className="label" htmlFor="email">E-mail</label>
          <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Senha <span className="font-normal text-stone-400">(mín. 8 caracteres)</span></label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        {accountType === 'professional' && (
          <div className="space-y-4 rounded-2xl border border-stone-200 p-4 dark:border-stone-800">
            <div>
              <label className="label" htmlFor="pub">Nome profissional</label>
              <input id="pub" className="input" value={publicName} onChange={(e) => setPublicName(e.target.value)} placeholder="Ex.: Dra. Ana Souza" />
            </div>
            <div>
              <span className="label">Especialidades</span>
              <div className="flex flex-wrap gap-2">
                {specialties.map((s) => {
                  const on = specialtyKeys.includes(s.key)
                  return (
                    <button type="button" key={s.key} onClick={() => setSpecialtyKeys((x) => on ? x.filter((i) => i !== s.key) : [...x, s.key])}
                      className={`badge border !px-3 !py-1.5 ${on ? 'border-brand-600 bg-brand-700 text-white' : 'border-stone-300 text-stone-700 dark:border-stone-700 dark:text-stone-300'}`}>{s.name}</button>
                  )
                })}
              </div>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div><label className="label" htmlFor="co">Conselho</label><input id="co" className="input" value={council} onChange={(e) => setCouncil(e.target.value)} placeholder="CRM, CRN…" /></div>
              <div><label className="label" htmlFor="rg">Nº de registro</label><input id="rg" className="input" value={registration} onChange={(e) => setRegistration(e.target.value)} /></div>
            </div>
            <ProPlanPicker planKey={planKey} setPlanKey={setPlanKey} selected={proModules} setSelected={setProModules} />
          </div>
        )}
        <p className="text-xs text-stone-500">O acesso é liberado após a confirmação do pagamento. O pagamento online estará disponível em breve; até lá, nossa equipe ativa sua conta.</p>
        <label className="flex items-start gap-2.5 text-sm text-stone-600 dark:text-stone-400">
          <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>Li e aceito os <Link to="/termos" className="underline">termos de uso</Link> e a <Link to="/privacidade" className="underline">política de privacidade</Link>.</span>
        </label>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Criar conta</button>
      </form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/nova-senha` })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setDone(true)
  }

  return (
    <AuthShell title="Recuperar senha" subtitle="Enviaremos um link para criar uma nova senha." footer={<Link to="/entrar" className="text-brand-700 dark:text-brand-300">Voltar para o login</Link>}>
      {done ? (
        <Alert kind="success">Se houver uma conta com <strong>{email}</strong>, o link chegará em alguns minutos (confira o spam). Se não chegar, peça ao seu profissional ou ao suporte um novo link de acesso.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Enviar link</button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const welcome = useSearchParams()[0].has('boas-vindas')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    navigate('/app', { replace: true })
  }

  return (
    <AuthShell title={welcome ? 'Bem-vindo! Crie sua senha' : 'Nova senha'} subtitle={welcome ? 'Sua conta já foi criada. Defina uma senha para entrar nas próximas vezes.' : undefined}>
      <form onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <label className="label" htmlFor="password">Nova senha</label>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />} Salvar</button>
      </form>
    </AuthShell>
  )
}
