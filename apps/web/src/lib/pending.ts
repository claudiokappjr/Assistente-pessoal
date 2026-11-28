import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabase'

/** Avisa as telas (menu, caixa de entrada, módulos) que um registro do assistente foi decidido. */
export const notifyDraftsChanged = () => window.dispatchEvent(new Event('drafts-changed'))

/** Quantos registros do assistente aguardam aprovação, por módulo e no total. */
export function usePendingCounts(enabled = true) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const location = useLocation()
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const { data } = await supabase.from('assistant_drafts').select('module_key').eq('status', 'pending').limit(1000)
      if (!alive) return
      const c: Record<string, number> = { total: 0 }
      for (const d of (data ?? []) as { module_key: string | null }[]) {
        c.total++
        if (d.module_key) c[d.module_key] = (c[d.module_key] ?? 0) + 1
      }
      setCounts(c)
    }
    void load()
    const t = setInterval(load, 30000)
    window.addEventListener('drafts-changed', load)
    return () => { alive = false; clearInterval(t); window.removeEventListener('drafts-changed', load) }
  }, [enabled, location.pathname])
  return counts
}
