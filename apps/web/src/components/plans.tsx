import { Check, Copy, KeyRound, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage, supabase } from '../lib/supabase'
import type { Module, Plan } from '../lib/types'
import { money } from '../modules/config'

export function usePlansAndModules() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [modules, setModules] = useState<Module[]>([])
  useEffect(() => {
    supabase.from('plans').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setPlans((data ?? []) as Plan[]))
    supabase.from('modules').select('*').eq('is_active', true).order('sort_order').then(({ data }) => setModules((data ?? []) as Module[]))
  }, [])
  return { plans, modules }
}

const price = (cents: number | null | undefined) => (cents == null ? 'valor a definir' : `${money(cents)}/mês`)

/** Escolha da faixa de clientes e dos módulos de gestão do profissional. */
export function ProPlanPicker({ planKey, setPlanKey, selected, setSelected }: {
  planKey: string; setPlanKey: (k: string) => void; selected: string[]; setSelected: (m: string[]) => void
}) {
  const { plans, modules } = usePlansAndModules()
  const proPlans = plans.filter((p) => p.audience === 'professional')
  const plan = proPlans.find((p) => p.key === planKey)
  const priced = plan?.price_monthly_cents != null && selected.every((k) => modules.find((m) => m.key === k)?.pro_addon_price_cents != null)
  const total = (plan?.price_monthly_cents ?? 0) + selected.reduce((s, k) => s + (modules.find((m) => m.key === k)?.pro_addon_price_cents ?? 0), 0)

  return (
    <div className="space-y-4">
      <div>
        <span className="label">Quantos clientes você vai acompanhar?</span>
        <div className="grid grid-cols-3 gap-2">
          {proPlans.map((p) => (
            <button type="button" key={p.key} onClick={() => setPlanKey(p.key)}
              className={`rounded-xl border p-3 text-left transition ${planKey === p.key ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-600/20 dark:bg-brand-900/30' : 'border-stone-300 dark:border-stone-700'}`}>
              <div className="font-medium">{p.name}</div>
              <div className="text-xs text-stone-500">até {p.limits?.clientes} clientes</div>
              <div className="mt-1 text-xs text-stone-500">{price(p.price_monthly_cents)}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">Módulos que você quer gerenciar nos clientes</span>
        <p className="mb-2 text-xs text-stone-500">Seus clientes usam todos os módulos. Estes são os que você terá acesso (com autorização de cada cliente).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {modules.map((m) => {
            const on = selected.includes(m.key)
            return (
              <label key={m.key} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 ${on ? 'border-brand-600 bg-brand-50/60 dark:bg-brand-900/20' : 'border-stone-200 dark:border-stone-700'}`}>
                <input type="checkbox" className="size-4 accent-brand-700" checked={on} onChange={() => setSelected(on ? selected.filter((x) => x !== m.key) : [...selected, m.key])} />
                <span className="flex-1 text-sm font-medium">{m.name}</span>
                <span className="text-xs text-stone-500">{m.pro_addon_price_cents == null ? '' : `+ ${money(m.pro_addon_price_cents)}`}</span>
              </label>
            )
          })}
        </div>
      </div>
      <div className="rounded-xl bg-sand-200/60 px-3 py-2.5 text-sm dark:bg-stone-800">
        {priced ? <>Total estimado: <strong>{money(total)}/mês</strong></> : 'Os valores serão informados antes da cobrança.'}
      </div>
    </div>
  )
}

/** Mostra o link de primeiro acesso com botões de copiar e enviar por WhatsApp. */
export function AccessLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false)
  const text = `Olá, ${name.split(' ')[0]}! Sua conta no Assistente Pessoal está pronta. Toque no link para criar sua senha: ${link}`
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-900 dark:bg-brand-900/20">
      <p className="text-sm font-medium">Conta criada. Envie o link de primeiro acesso:</p>
      <p className="mt-1 break-all text-xs text-stone-500">{link}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a className="btn-primary !py-2" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> Enviar por WhatsApp</a>
        <button type="button" className="btn-outline !py-2" onClick={() => { void navigator.clipboard.writeText(link); setCopied(true) }}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copiado' : 'Copiar link'}
        </button>
      </div>
      <p className="mt-2 text-xs text-stone-500">O link funciona uma única vez e expira. Se expirar, a pessoa entra na tela de login, toca em "Esqueci a senha" e usa este mesmo e-mail.</p>
    </div>
  )
}

/** Gera link de primeiro acesso para conta que ainda não entrou (sem depender de e-mail). */
export function AccessLinkButton({ userId, name, className = 'btn-outline !px-2.5 !py-1.5 text-xs' }: { userId: string; name: string; className?: string }) {
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')
  const [error, setError] = useState('')
  async function generate() {
    setBusy(true); setError(''); setLink('')
    const { data, error } = await supabase.functions.invoke('manage-users', { body: { mode: 'access_link', user_id: userId } })
    setBusy(false)
    if (error) {
      let detail = errorMessage(error)
      try { detail = (await (error as { context?: Response }).context?.json())?.error ?? detail } catch { /* sem corpo */ }
      return setError(detail)
    }
    setLink(data.action_link)
  }
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => void generate()}><KeyRound className="size-3.5" /> Link de acesso</button>
      {(link || error) && (
        <div className="basis-full">
          {error ? <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p> : <div className="mt-2"><AccessLink link={link} name={name} /></div>}
        </div>
      )}
    </>
  )
}
