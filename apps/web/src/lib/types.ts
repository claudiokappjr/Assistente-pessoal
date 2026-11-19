// Tipos espelhando o banco (Fase 1). Para regenerar automaticamente:
// npx supabase gen types typescript --project-id lehjyixgezjrhkuzusci > src/lib/database.types.ts

export type AppRole = 'user' | 'professional' | 'admin'
export type LinkStatus = 'invited' | 'active' | 'ended'

export interface Profile {
  id: string
  full_name: string | null
  display_name: string | null
  avatar_url: string | null
  timezone: string
  locale: string
  onboarded_at: string | null
  created_at: string
}

export interface Module {
  key: string
  name: string
  description: string | null
  is_sensitive: boolean
  sort_order: number
  is_active: boolean
  pro_addon_price_cents?: number | null
}

export interface Specialty {
  id: string
  key: string
  name: string
  council: string | null
  module_keys: string[]
}

export interface Plan {
  id: string
  key: string
  name: string
  audience: 'individual' | 'professional'
  price_monthly_cents: number | null
  price_yearly_cents: number | null
  limits: Record<string, number>
  is_active: boolean
  sort_order: number
}

export const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  pending_payment: 'Aguardando pagamento', active: 'Ativa', past_due: 'Pagamento atrasado', canceled: 'Cancelada',
}

export interface ProfessionalProfile {
  user_id: string
  public_name: string
  bio: string | null
  council: string | null
  registration_number: string | null
  slug: string | null
  is_public: boolean
  approved_at: string | null
}

export interface Link {
  id: string
  professional_id: string
  client_id: string
  status: LinkStatus
  invited_by: string
  accepted_at: string | null
  ended_at: string | null
  created_at: string
}

export interface Consent {
  id: string
  client_id: string
  professional_id: string
  module_key: string
  purpose: string
  granted_at: string
  expires_at: string | null
  revoked_at: string | null
}

export interface WhatsappIdentity {
  id: string
  user_id: string
  phone_e164: string
  verified_at: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  occurred_at: string
  actor_id: string | null
  subject_id: string | null
  action: string
  table_name: string
  record_id: string | null
  changes: Record<string, unknown> | null
}

export type SubscriptionStatus = 'pending_payment' | 'active' | 'past_due' | 'canceled'

export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  roles: AppRole[]
  created_at: string
  last_sign_in_at: string | null
  professional_approved: boolean
  plan_key: string | null
  plan_name: string | null
  subscription_status: SubscriptionStatus | null
  subscription_source: 'payment' | 'admin' | 'professional' | null
  pro_modules: string[] | null
  seats: number | null
  seats_used: number
}

export interface Subscription {
  id: string
  user_id: string
  status: SubscriptionStatus
  source: 'payment' | 'admin' | 'professional'
  sponsor_id: string | null
  pro_modules: string[]
  seats: number | null
  plans: { key: string; name: string; audience: 'individual' | 'professional'; limits: Record<string, number> }
}

export interface ProPlan {
  plan_key: string
  plan_name: string
  seats: number
  seats_used: number
  pro_modules: string[]
  status: SubscriptionStatus
}
