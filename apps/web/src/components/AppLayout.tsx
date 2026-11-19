import {
  Activity, Apple, BarChart3, Brain, Briefcase, CalendarDays, CircleUser, Dumbbell, HeartPulse, Home, Inbox,
  LayoutGrid, LogOut, Menu, MessageCircle, Moon, ScrollText, Settings, Shield, Sparkles, UserPlus, Users, Wallet, X,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { STATUS_LABEL } from '../lib/types'
import { Logo, ThemeToggle } from './ui'

type Area = 'app' | 'pro' | 'admin'
interface Item { to: string; label: string; icon: LucideIcon; module?: string; end?: boolean }

export const MODULE_ICONS: Record<string, LucideIcon> = {
  agenda: CalendarDays, financas: Wallet, saude: HeartPulse, psicanalise: Moon,
  nutricao: Apple, exercicios: Dumbbell, ciclo: Activity, memorias: Sparkles,
}

const NAV: Record<Area, Item[]> = {
  app: [
    { to: '/app', label: 'Início', icon: Home, end: true },
    { to: '/app/caixa-de-entrada', label: 'Caixa de entrada', icon: Inbox },
    { to: '/app/agenda', label: 'Agenda', icon: CalendarDays, module: 'agenda' },
    { to: '/app/financas', label: 'Finanças', icon: Wallet, module: 'financas' },
    { to: '/app/saude', label: 'Saúde', icon: HeartPulse, module: 'saude' },
    { to: '/app/psicanalise', label: 'Psicanálise', icon: Moon, module: 'psicanalise' },
    { to: '/app/nutricao', label: 'Nutrição', icon: Apple, module: 'nutricao' },
    { to: '/app/exercicios', label: 'Exercícios', icon: Dumbbell, module: 'exercicios' },
    { to: '/app/ciclo', label: 'Ciclo', icon: Activity, module: 'ciclo' },
    { to: '/app/memorias', label: 'Memórias', icon: Sparkles, module: 'memorias' },
    { to: '/app/profissionais', label: 'Meus profissionais', icon: Users },
    { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
  ],
  pro: [
    { to: '/pro', label: 'Painel', icon: LayoutGrid, end: true },
    { to: '/pro/clientes', label: 'Clientes', icon: Users },
    { to: '/pro/agenda', label: 'Agenda profissional', icon: CalendarDays },
    { to: '/pro/perfil', label: 'Perfil público', icon: CircleUser },
  ],
  admin: [
    { to: '/admin', label: 'Indicadores', icon: BarChart3, end: true },
    { to: '/admin/usuarios', label: 'Usuários', icon: Users },
    { to: '/admin/catalogo', label: 'Planos e preços', icon: Briefcase },
    { to: '/admin/integracoes', label: 'Integrações', icon: MessageCircle },
    { to: '/admin/auditoria', label: 'Auditoria', icon: ScrollText },
  ],
}

// Atalhos da barra inferior no celular.
const MOBILE: Record<Area, string[]> = {
  app: ['/app', '/app/caixa-de-entrada', '/app/agenda', '/app/configuracoes'],
  pro: ['/pro', '/pro/clientes', '/pro/agenda', '/pro/perfil'],
  admin: ['/admin', '/admin/usuarios', '/admin/catalogo', '/admin/auditoria'],
}

const AREA_LABEL: Record<Area, string> = { app: 'Pessoal', pro: 'Profissional', admin: 'Administração' }

function linkClass(isActive: boolean) {
  return `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
    isActive
      ? 'bg-brand-700 text-white dark:bg-brand-600'
      : 'text-stone-600 hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800'
  }`
}

export function AppLayout({ area }: { area: Area }) {
  const { profile, modules, hasRole, signOut, session, hasActiveSubscription, subscriptions, accountLoaded } = useAuth()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const enabled = new Set(modules.map((m) => m.key))
  const items = NAV[area].filter((i) => !i.module || enabled.has(i.module))
  const mobileItems = MOBILE[area].map((to) => NAV[area].find((i) => i.to === to)!).filter(Boolean)

  const areas: { key: Area; to: string; icon: LucideIcon; show: boolean }[] = [
    { key: 'app', to: '/app', icon: Home, show: true },
    { key: 'pro', to: '/pro', icon: Briefcase, show: hasRole('professional') },
    { key: 'admin', to: '/admin', icon: Shield, show: hasRole('admin') },
  ]
  const visibleAreas = areas.filter((a) => a.show)

  const sidebar = (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between px-2 pt-1">
        <Logo />
        <button className="btn-ghost !p-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X className="size-5" /></button>
      </div>

      {visibleAreas.length > 1 && (
        <div className="grid grid-flow-col gap-1 rounded-xl bg-stone-200/60 p-1 dark:bg-stone-800">
          {visibleAreas.map((a) => (
            <button
              key={a.key}
              onClick={() => { navigate(a.to); setOpen(false) }}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                area === a.key ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50' : 'text-stone-600 dark:text-stone-400'
              }`}
            >
              <a.icon className="size-3.5" /> {AREA_LABEL[a.key]}
            </button>
          ))}
        </div>
      )}

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)} className={({ isActive }) => linkClass(isActive)}>
            <i.icon className="size-[18px]" /> {i.label}
          </NavLink>
        ))}
        {area === 'app' && !hasRole('professional') && (
          <NavLink to="/app/sou-profissional" onClick={() => setOpen(false)} className={({ isActive }) => linkClass(isActive)}>
            <UserPlus className="size-[18px]" /> Sou profissional
          </NavLink>
        )}
      </nav>

      <div className="flex items-center gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-sand-300 text-sm font-semibold text-brand-800 dark:bg-stone-800 dark:text-brand-300">
          {(profile?.display_name ?? session?.user.email ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{profile?.full_name ?? '—'}</div>
          <div className="truncate text-xs text-stone-500">{session?.user.email}</div>
        </div>
        <ThemeToggle />
        <button className="btn-ghost !p-2" onClick={() => void signOut()} aria-label="Sair" title="Sair"><LogOut className="size-5" /></button>
      </div>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-dvh border-r border-stone-200 bg-sand-100 p-4 lg:block dark:border-stone-800 dark:bg-stone-950">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-sand-100 p-4 shadow-xl dark:bg-stone-950">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-stone-200 bg-sand-100/90 px-4 py-3 backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/90">
          <button className="btn-ghost !p-2" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu className="size-5" /></button>
          <Logo compact />
          <span className="text-xs font-medium text-stone-500">{AREA_LABEL[area]}</span>
        </header>

        <main key={location.pathname} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-6 md:px-8 lg:pb-12 lg:pt-10">
          {area === 'app' && accountLoaded && !hasActiveSubscription && !OPEN_WITHOUT_PLAN.includes(location.pathname)
            ? <PendingSubscription subscriptions={subscriptions} />
            : <Outlet />}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-900/95">
          {mobileItems.slice(0, 2).map((i) => <MobileLink key={i.to} item={i} />)}
          <NavLink to="/app/assistente" className="flex flex-col items-center justify-center">
            <span className="-mt-5 grid size-12 place-items-center rounded-full bg-brand-700 text-white shadow-lg ring-4 ring-sand-100 dark:ring-stone-950">
              <Brain className="size-5" />
            </span>
            <span className="mt-0.5 text-[10px] text-stone-500">Assistente</span>
          </NavLink>
          {mobileItems.slice(2, 4).map((i) => <MobileLink key={i.to} item={i} />)}
        </nav>
      </div>
    </div>
  )
}

// Telas acessíveis mesmo sem assinatura ativa (aceitar convite, ver dados da conta).
const OPEN_WITHOUT_PLAN = ['/app/configuracoes', '/app/profissionais']

function PendingSubscription({ subscriptions }: { subscriptions: ReturnType<typeof useAuth>['subscriptions'] }) {
  return (
    <div className="mx-auto max-w-lg py-6 text-center">
      <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"><Shield className="size-6" /></div>
      <h1 className="font-display text-2xl font-semibold">Assinatura aguardando ativação</h1>
      {subscriptions.length > 0 ? (
        <div className="mt-4 space-y-2">
          {subscriptions.map((s) => (
            <div key={s.id} className="card flex items-center justify-between !py-3 text-left">
              <div>
                <div className="font-medium">Plano {s.plans.name}</div>
                {s.plans.audience === 'professional' && <div className="text-xs text-stone-500">até {s.seats ?? s.plans.limits?.clientes} clientes · {s.pro_modules.length} módulo(s) de gestão</div>}
              </div>
              <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">{STATUS_LABEL[s.status]}</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-3 text-sm text-stone-500">Sua conta ainda não tem um plano.</p>}
      <p className="mt-5 text-sm text-stone-600 dark:text-stone-400">O pagamento online estará disponível em breve. Enquanto isso, nossa equipe libera o acesso manualmente — você será avisado.</p>
      <p className="mt-2 text-sm text-stone-500">Se um profissional te convidou, aceite o convite em <NavLink to="/app/profissionais" className="text-brand-700 underline dark:text-brand-300">Meus profissionais</NavLink>.</p>
    </div>
  )
}

function MobileLink({ item }: { item: Item }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2.5 text-[10px] ${isActive ? 'text-brand-700 dark:text-brand-300' : 'text-stone-500'}`}>
      <item.icon className="size-5" />
      <span className="max-w-full truncate px-1">{item.label}</span>
    </NavLink>
  )
}
