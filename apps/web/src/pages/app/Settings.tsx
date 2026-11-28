import { Download, KeyRound, MessageCircle, ScrollText, Trash2, User } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, EmptyState, PageHeader, Spinner } from '../../components/ui'
import { formatDateTime, formatPhone, toE164 } from '../../lib/format'
import { errorMessage, supabase } from '../../lib/supabase'
import type { AuditLog, WhatsappIdentity } from '../../lib/types'

const TABLE_LABEL: Record<string, string> = {
  user_roles: 'Papel de acesso', consent_grants: 'Autorização de profissional', professional_client_links: 'Vínculo com profissional',
  professional_profiles: 'Perfil profissional', whatsapp_identities: 'Número de WhatsApp', user_modules: 'Módulos habilitados',
  subscriptions: 'Assinatura', assistant_drafts: 'Registro do assistente', 'auth.users': 'Link de acesso/senha',
}
const ACTION_LABEL: Record<string, string> = { insert: 'criado', update: 'alterado', delete: 'removido', access_link: 'gerado' }

export function SettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Configurações" subtitle="Seu perfil, canais e privacidade." />
      <ProfileSection />
      <PasswordSection />
      <WhatsappSection />
      <PrivacySection />
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold"><Icon className="size-5 text-brand-600" /> {title}</h2>
      {children}
    </section>
  )
}

function ProfileSection() {
  const { profile, refresh, session } = useAuth()
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), display_name: displayName.trim() || null }).eq('id', session!.user.id)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    await refresh()
    setMsg({ kind: 'success', text: 'Perfil atualizado.' })
  }

  return (
    <Section icon={User} title="Perfil">
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="fn">Nome completo</label>
          <input id="fn" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="dn">Como prefere ser chamado</label>
          <input id="dn" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">E-mail</label>
          <input className="input opacity-70" value={session?.user.email ?? ''} disabled />
        </div>
        <div className="flex items-center gap-3 md:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Salvar</button>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        </div>
      </form>
    </Section>
  )
}

function PasswordSection() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setMsg({ kind: 'error', text: 'A senha precisa ter pelo menos 8 caracteres.' })
    if (pw !== pw2) return setMsg({ kind: 'error', text: 'As duas senhas não são iguais.' })
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: errorMessage(error) })
    setPw(''); setPw2('')
    setMsg({ kind: 'success', text: 'Senha alterada.' })
  }
  return (
    <Section icon={KeyRound} title="Alterar senha">
      <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
        <input type="password" className="input" placeholder="Nova senha" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={pw} onChange={(e) => setPw(e.target.value)} />
        <input type="password" className="input" placeholder="Repita a nova senha" autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        <div className="flex items-center gap-3 md:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />} Alterar senha</button>
          {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        </div>
      </form>
    </Section>
  )
}

/** Número do assistente no WhatsApp (configurado no Vercel quando o canal é ligado). */
const BOT_NUMBER = ((import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined) ?? '').replace(/\D/g, '')

function WhatsappSection() {
  const { session } = useAuth()
  const [items, setItems] = useState<WhatsappIdentity[] | null>(null)
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState<{ id: string; code: string } | null>(null)

  const load = () => supabase.from('whatsapp_identities').select('id, user_id, phone_e164, verified_at, created_at').eq('user_id', session!.user.id).order('created_at')
    .then(({ data }) => setItems((data ?? []) as WhatsappIdentity[]))
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Enquanto o código está na tela, confere se a verificação chegou.
  useEffect(() => {
    if (!code) return
    const t = setInterval(() => { void load() }, 4000)
    return () => clearInterval(t)
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (code && items?.find((w) => w.id === code.id)?.verified_at) setCode(null) }, [items, code])

  async function add(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('whatsapp_identities').insert({ user_id: session!.user.id, phone_e164: toE164(phone) })
    setBusy(false)
    if (error) return setError(/duplicate|unique/i.test(error.message) ? 'Este número já está cadastrado em uma conta.' : errorMessage(error))
    setPhone(''); void load()
  }
  async function verify(id: string) {
    setError('')
    const { data, error } = await supabase.rpc('whatsapp_start_verification', { _id: id })
    if (error) return setError(errorMessage(error))
    setCode({ id, code: String(data) })
  }
  async function remove(id: string) {
    if (!confirm('Remover este número?')) return
    const { error } = await supabase.from('whatsapp_identities').delete().eq('id', id)
    if (error) return setError(errorMessage(error))
    void load()
  }

  return (
    <Section icon={MessageCircle} title="WhatsApp">
      {BOT_NUMBER ? (
        <Alert kind="info">
          Mande mensagens para o assistente no WhatsApp <strong>{formatPhone(`+${BOT_NUMBER}`)}</strong>. Antes, cadastre seu número aqui e toque em <strong>Verificar</strong>.
        </Alert>
      ) : (
        <Alert kind="info">
          O canal de WhatsApp ainda <strong>não está ativo</strong>. Cadastre seu número agora; a verificação fica disponível quando o canal for ligado.
        </Alert>
      )}
      <ul className="mt-4 divide-y divide-stone-100 dark:divide-stone-800">
        {items?.map((w) => (
          <li key={w.id} className="py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 font-medium tabular-nums">{formatPhone(w.phone_e164)}</span>
              <span className={`badge ${w.verified_at ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}`}>
                {w.verified_at ? 'Verificado' : 'Aguardando verificação'}
              </span>
              {!w.verified_at && BOT_NUMBER && <button className="btn-outline !px-3 !py-1.5" onClick={() => void verify(w.id)}>Verificar</button>}
              <button className="btn-danger !p-2" onClick={() => void remove(w.id)} aria-label="Remover número"><Trash2 className="size-4" /></button>
            </div>
            {code?.id === w.id && (
              <div className="mt-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 text-sm dark:border-brand-800 dark:bg-brand-900/30">
                <p>Envie este código <strong>do seu WhatsApp {formatPhone(w.phone_e164)}</strong> para o assistente:</p>
                <p className="my-2 font-display text-3xl font-semibold tracking-[0.3em] tabular-nums">{code.code}</p>
                <a className="btn-primary" href={`https://wa.me/${BOT_NUMBER}?text=${encodeURIComponent(`Código ${code.code}`)}`} target="_blank" rel="noreferrer">
                  <MessageCircle className="size-4" /> Abrir WhatsApp com o código
                </a>
                <p className="mt-2 flex items-center gap-2 text-xs text-stone-500"><Spinner className="size-3" /> Esperando a mensagem… vale por 30 minutos.</p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-3 flex flex-wrap gap-2">
        <input className="input max-w-xs flex-1" placeholder="(65) 99999-0000" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <button className="btn-outline" disabled={busy}>{busy && <Spinner />} Adicionar número</button>
      </form>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Section>
  )
}

function PrivacySection() {
  const { session } = useAuth()
  const [logs, setLogs] = useState<AuditLog[] | null>(null)
  const uid = session!.user.id

  useEffect(() => {
    supabase.from('audit_logs').select('*').eq('subject_id', uid).order('occurred_at', { ascending: false }).limit(30)
      .then(({ data }) => setLogs((data ?? []) as AuditLog[]))
  }, [uid])

  async function exportData() {
    const tables = ['profiles', 'user_roles', 'user_modules', 'whatsapp_identities', 'professional_client_links', 'consent_grants', 'audit_logs'] as const
    const out: Record<string, unknown> = { exportado_em: new Date().toISOString(), usuario: session!.user.email }
    for (const t of tables) out[t] = (await supabase.from(t).select('*')).data
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `meus-dados-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
  }

  return (
    <Section icon={ScrollText} title="Privacidade e histórico">
      <p className="text-sm text-stone-600 dark:text-stone-400">Tudo que muda nos seus acessos e autorizações fica registrado aqui. Ninguém, nem o administrador, pode apagar este histórico.</p>
      <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-stone-100 dark:border-stone-800">
        {logs?.length === 0 && <EmptyState icon={ScrollText} title="Nenhum registro ainda" />}
        <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
          {logs?.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 px-3 py-2.5">
              <span>{TABLE_LABEL[l.table_name] ?? l.table_name} {ACTION_LABEL[l.action] ?? l.action}{l.actor_id && l.actor_id !== uid ? ' por outra pessoa' : ''}</span>
              <span className="shrink-0 text-stone-500 tabular-nums">{formatDateTime(l.occurred_at)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button className="btn-outline" onClick={() => void exportData()}><Download className="size-4" /> Exportar meus dados</button>
      </div>
      <p className="mt-3 text-xs text-stone-500">Exclusão de conta: por enquanto, solicite pelo suporte. A exclusão automática com prazo de retenção entra antes do lançamento comercial.</p>
    </Section>
  )
}
