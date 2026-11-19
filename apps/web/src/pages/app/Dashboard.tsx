import { ArrowRight, Inbox, MessageCircle, ShieldCheck, Sparkles, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { MODULE_ICONS } from '../../components/AppLayout'
import { PageHeader } from '../../components/ui'
import { greeting } from '../../lib/format'
import { supabase } from '../../lib/supabase'

// Fase em que cada módulo ganha funcionalidade real (para não exibir dados fictícios).
const PHASE: Record<string, number> = { agenda: 3, financas: 3, saude: 4, psicanalise: 4, nutricao: 5, exercicios: 5, ciclo: 5, memorias: 6 }

export function DashboardPage() {
  const { profile, modules, session } = useAuth()
  const [pendingInvites, setPendingInvites] = useState(0)
  const [hasWhatsapp, setHasWhatsapp] = useState<boolean | null>(null)
  const [pendingDrafts, setPendingDrafts] = useState(0)

  useEffect(() => {
    const uid = session!.user.id
    supabase.from('professional_client_links').select('id', { count: 'exact', head: true })
      .eq('client_id', uid).eq('status', 'invited')
      .then(({ count }) => setPendingInvites(count ?? 0))
    supabase.from('whatsapp_identities').select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .then(({ count }) => setHasWhatsapp((count ?? 0) > 0))
    supabase.from('assistant_drafts').select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingDrafts(count ?? 0))
  }, [session])

  return (
    <div>
      <PageHeader title={`${greeting()}, ${profile?.display_name ?? ''}`} subtitle="Este é o seu painel. Os módulos ganham vida conforme as fases de desenvolvimento." />

      <Link to="/app/assistente" className="card mb-3 flex items-center gap-3 !border-brand-700 !bg-brand-700 text-white dark:!bg-brand-800">
        <Sparkles className="size-5" />
        <span className="flex-1 text-sm">Registre algo em uma frase — gasto, treino, compromisso, ideia…</span>
        <ArrowRight className="size-4" />
      </Link>
      <div className="space-y-3">
        {pendingInvites > 0 && (
          <Link to="/app/profissionais" className="card flex items-center gap-3 !border-brand-300 !bg-brand-50 dark:!border-brand-800 dark:!bg-brand-900/30">
            <Users className="size-5 text-brand-700 dark:text-brand-300" />
            <span className="flex-1 text-sm"><strong>{pendingInvites}</strong> convite{pendingInvites > 1 && 's'} de profissional aguardando sua resposta.</span>
            <ArrowRight className="size-4" />
          </Link>
        )}
        {hasWhatsapp === false && (
          <Link to="/app/configuracoes" className="card flex items-center gap-3">
            <MessageCircle className="size-5 text-brand-600" />
            <span className="flex-1 text-sm">Cadastre seu número de WhatsApp para registrar tudo por mensagem quando o canal for ativado.</span>
            <ArrowRight className="size-4" />
          </Link>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wide text-stone-500">Seus módulos</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Link to="/app/caixa-de-entrada" className="card group !p-4 transition hover:border-brand-300">
          <Inbox className="size-5 text-brand-600 dark:text-brand-400" />
          <div className="mt-3 font-medium">Caixa de entrada</div>
          <div className="mt-0.5 text-xs text-stone-500">{pendingDrafts ? `${pendingDrafts} para confirmar` : 'Tudo em dia'}</div>
        </Link>
        {modules.map((m) => {
          const Icon = MODULE_ICONS[m.key]
          return (
            <Link key={m.key} to={`/app/${m.key}`} className="card group !p-4 transition hover:border-brand-300">
              <div className="flex items-start justify-between">
                <Icon className="size-5 text-brand-600 dark:text-brand-400" />
                {m.is_sensitive && <ShieldCheck className="size-4 text-stone-400" aria-label="Dado sensível" />}
              </div>
              <div className="mt-3 font-medium">{m.name}</div>
              <div className="mt-0.5 text-xs text-stone-500">Fase {PHASE[m.key]} · em construção</div>
            </Link>
          )
        })}
      </div>
      {modules.length < 8 && (
        <p className="mt-4 text-sm text-stone-500">Seu plano libera {modules.length} de 8 módulos. Planos pagos chegam com o módulo de assinaturas (Fase 3).</p>
      )}
    </div>
  )
}

