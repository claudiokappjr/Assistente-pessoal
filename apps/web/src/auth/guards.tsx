import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { AppRole } from '../lib/types'
import { useAuth } from './AuthProvider'

export function FullScreenLoader() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="size-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-label="Carregando" />
    </div>
  )
}

/** Exige login (e opcionalmente um papel). A proteção real está no banco (RLS). */
export function RequireAuth({ role, children }: { role?: AppRole; children: ReactNode }) {
  const { session, loading, roles } = useAuth()
  const location = useLocation()
  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  if (role && roles.length === 0) return <FullScreenLoader />
  if (role && !roles.includes(role)) return <Navigate to="/app" replace />
  return <>{children}</>
}

export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (session) return <Navigate to="/app" replace />
  return <>{children}</>
}
