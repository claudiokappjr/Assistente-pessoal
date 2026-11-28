import { CheckCheck, ChevronDown, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DraftCard, type Draft } from '../pages/app/Inbox'
import { notifyDraftsChanged } from '../lib/pending'
import { errorMessage, supabase } from '../lib/supabase'
import { Alert, Spinner } from './ui'

/**
 * Registros que o assistente (app ou WhatsApp) propôs para ESTE módulo e ainda
 * aguardam aprovação. Aprovar aqui ou na Caixa de entrada é a mesma coisa:
 * some dos dois lugares e o registro entra no módulo.
 */
export function PendingDrafts({ moduleKey, moduleName, onDecided }: { moduleKey: string; moduleName: string; onDecided?: () => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('assistant_drafts').select('*').eq('module_key', moduleKey).eq('status', 'pending').order('created_at')
    setDrafts((data ?? []) as Draft[])
  }, [moduleKey])
  useEffect(() => {
    void load()
    const h = () => void load()
    window.addEventListener('drafts-changed', h)
    return () => window.removeEventListener('drafts-changed', h)
  }, [load])

  async function approveAll() {
    if (!drafts?.length || !confirm(`Aprovar os ${drafts.length} registros como estão?`)) return
    setBusy(true); setError('')
    const { error } = await supabase.from('assistant_drafts').update({ status: 'confirmed' }).in('id', drafts.map((d) => d.id)).eq('status', 'pending')
    setBusy(false)
    if (error) return setError(errorMessage(error))
    notifyDraftsChanged()
    onDecided?.()
  }

  if (!drafts?.length) return null
  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Sparkles className="size-4 text-amber-600" />
          <span className="font-medium">Do assistente para aprovar</span>
          <span className="rounded-full bg-amber-500 px-2 text-xs font-semibold leading-5 text-white">{drafts.length}</span>
          <ChevronDown className={`size-4 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {drafts.length > 1 && (
          <button className="btn-primary !px-3 !py-1.5" onClick={() => void approveAll()} disabled={busy}>
            {busy ? <Spinner /> : <CheckCheck className="size-4" />} Aprovar todos
          </button>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      {open && (
        <div className="mt-3 space-y-2">
          {drafts.map((d) => <DraftCard key={d.id} d={d} moduleName={moduleName} onChange={() => { void load(); onDecided?.() }} />)}
        </div>
      )}
    </section>
  )
}
