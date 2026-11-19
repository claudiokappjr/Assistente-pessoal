import { Lock, MessageCircle, ShieldCheck, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MODULE_ICONS } from '../../components/AppLayout'
import { Logo, ThemeToggle } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import type { Module, ProfessionalProfile } from '../../lib/types'

function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
      <Link to="/"><Logo /></Link>
      <nav className="flex items-center gap-1">
        <Link to="/profissionais" className="btn-ghost hidden sm:inline-flex">Profissionais</Link>
        <ThemeToggle />
        <Link to="/entrar" className="btn-ghost">Entrar</Link>
        <Link to="/cadastro" className="btn-primary">Criar conta</Link>
      </nav>
    </header>
  )
}

export function LandingPage() {
  const [modules, setModules] = useState<Module[]>([])
  useEffect(() => {
    supabase.from('modules').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setModules((data ?? []) as Module[]))
  }, [])

  return (
    <div>
      <PublicHeader />
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-10 md:pt-20">
        <p className="badge bg-sand-200 text-brand-800 dark:bg-stone-800 dark:text-brand-300">Dados armazenados no Brasil</p>
        <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl">
          Finanças, saúde e agenda.<br /><span className="text-brand-600 dark:text-brand-400">Organizados por você.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg text-stone-600 dark:text-stone-400">
          Registre pelo app — e em breve pelo WhatsApp. Compartilhe com seus profissionais só o que quiser, pelo tempo que quiser.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/cadastro" className="btn-primary !px-6 !py-3">Começar grátis</Link>
          <Link to="/profissionais" className="btn-outline !px-6 !py-3">Sou profissional</Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {modules.map((m) => {
            const Icon = MODULE_ICONS[m.key] ?? Users
            return (
              <div key={m.key} className="card !p-4">
                <Icon className="size-5 text-brand-600 dark:text-brand-400" />
                <div className="mt-3 font-medium">{m.name}</div>
                <div className="mt-0.5 text-xs text-stone-500">{m.description}</div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="border-t border-stone-200 bg-white py-16 dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 md:grid-cols-3">
          {[
            { icon: ShieldCheck, t: 'Você decide quem vê', d: 'Cada profissional só acessa os módulos que você autorizar. Revogue quando quiser.' },
            { icon: Lock, t: 'Privacidade de verdade', d: 'Nem o administrador da plataforma lê seus dados de saúde. Tudo fica registrado em auditoria.' },
            { icon: MessageCircle, t: 'Registro sem esforço', d: 'Mande uma mensagem ou áudio e o assistente organiza no lugar certo — sempre com sua confirmação.' },
          ].map((f) => (
            <div key={f.t}>
              <f.icon className="size-6 text-brand-600 dark:text-brand-400" />
              <h3 className="mt-3 font-display text-lg font-semibold">{f.t}</h3>
              <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">{f.d}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-5 py-8 text-sm text-stone-500">
        <span>© 2026 Assistente Pessoal</span>
        <span className="flex gap-4"><Link to="/privacidade">Privacidade</Link><Link to="/termos">Termos</Link></span>
      </footer>
    </div>
  )
}

export function ProfessionalsCatalogPage() {
  const [pros, setPros] = useState<(ProfessionalProfile & { professional_specialties: { specialties: { name: string } }[] })[] | null>(null)
  useEffect(() => {
    supabase.from('professional_profiles')
      .select('*, professional_specialties(specialties(name))')
      .eq('is_public', true).not('approved_at', 'is', null)
      .order('public_name')
      .then(({ data }) => setPros((data ?? []) as never))
  }, [])

  return (
    <div>
      <PublicHeader />
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="font-display text-3xl font-semibold">Profissionais</h1>
        <p className="mt-1 text-stone-500">Profissionais verificados que atendem pela plataforma. Agendamento online chega na Fase 3.</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pros === null && <p className="text-sm text-stone-500">Carregando…</p>}
          {pros?.length === 0 && (
            <div className="card md:col-span-3">
              <p className="font-medium">Nenhum profissional publicado ainda.</p>
              <p className="mt-1 text-sm text-stone-500">É profissional? <Link to="/cadastro" className="text-brand-700 underline dark:text-brand-300">Crie sua conta</Link> e solicite a verificação.</p>
            </div>
          )}
          {pros?.map((p) => (
            <div key={p.user_id} className="card">
              <div className="font-display text-lg font-semibold">{p.public_name}</div>
              <div className="text-sm text-stone-500">{p.professional_specialties.map((s) => s.specialties.name).join(' · ')}</div>
              {p.council && <div className="mt-1 text-xs text-stone-500">{p.council} {p.registration_number}</div>}
              {p.bio && <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">{p.bio}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export function LegalPage({ kind }: { kind: 'privacidade' | 'termos' }) {
  return (
    <div>
      <PublicHeader />
      <article className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-display text-3xl font-semibold">{kind === 'privacidade' ? 'Política de privacidade' : 'Termos de uso'}</h1>
        <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Documento em elaboração. O texto definitivo será redigido com apoio jurídico (LGPD, dados sensíveis de saúde) antes do lançamento comercial.
        </div>
      </article>
    </div>
  )
}
