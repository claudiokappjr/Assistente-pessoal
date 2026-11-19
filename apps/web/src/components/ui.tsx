import { AlertCircle, CheckCircle2, Construction, Moon, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300',
    success: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-200',
    info: 'border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300',
  }[kind]
  const Icon = kind === 'success' ? CheckCircle2 : AlertCircle
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 px-6 py-10 text-center dark:border-stone-700">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-sand-200 text-brand-700 dark:bg-stone-800 dark:text-brand-300">
        <Icon className="size-5" />
      </div>
      <h3 className="font-medium">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** Indica com clareza que um módulo ainda não foi construído (sem dados simulados). */
export function ComingSoon({ title, phase, children }: { title: string; phase: number; children?: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={`Em construção — Fase ${phase}`}>
        {children ?? 'Este módulo ainda não está disponível. Nenhum dado é exibido aqui até que ele esteja pronto.'}
      </EmptyState>
    </div>
  )
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('tema', dark ? 'escuro' : 'claro') } catch { /* sem armazenamento */ }
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme()
  return (
    <button onClick={toggle} className="btn-ghost !p-2" aria-label={dark ? 'Usar modo claro' : 'Usar modo escuro'} title={dark ? 'Modo claro' : 'Modo escuro'}>
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <img src="/icon.svg" alt="" className="size-8 rounded-lg" />
      {!compact && <span className="font-display text-lg font-semibold tracking-tight text-stone-900 dark:text-stone-50">Assistente Pessoal</span>}
    </span>
  )
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <div className="text-sm text-stone-500 dark:text-stone-400">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}
    </div>
  )
}
