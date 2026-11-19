import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { AppRole, Module, Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  loading: boolean
  profile: Profile | null
  roles: AppRole[]
  /** Módulos liberados para o usuário (plano + habilitação). */
  modules: Module[]
  hasRole: (r: AppRole) => boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [modules, setModules] = useState<Module[]>([])

  const load = useCallback(async (s: Session | null) => {
    if (!s) {
      setProfile(null); setRoles([]); setModules([])
      return
    }
    const uid = s.user.id
    const [p, r, m] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('user_modules').select('enabled, modules(*)').eq('user_id', uid).eq('enabled', true),
    ])
    setProfile((p.data as Profile) ?? null)
    setRoles(((r.data ?? []) as { role: AppRole }[]).map((x) => x.role))
    const mods = ((m.data ?? []) as unknown as { modules: Module }[])
      .map((x) => x.modules)
      .filter((x) => x?.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
    setModules(mods)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await load(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      // Evita chamadas ao banco dentro do callback (recomendação do Supabase).
      setTimeout(() => { void load(s) }, 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [load])

  const value: AuthState = {
    session,
    loading,
    profile,
    roles,
    modules,
    hasRole: (r) => roles.includes(r),
    refresh: () => load(session),
    signOut: async () => { await supabase.auth.signOut() },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return ctx
}
