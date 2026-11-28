import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

// Chave pública (publishable). Toda a proteção dos dados está nas regras RLS do banco.
export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Traduz mensagens de erro comuns do Supabase para português. */
export function errorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
  const map: [RegExp, string][] = [
    [/Invalid login credentials/i, 'E-mail ou senha incorretos. Confira se o teclado não colocou letra maiúscula no início.'],
    [/Email not confirmed/i, 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.'],
    [/User already registered/i, 'Já existe uma conta com este e-mail.'],
    [/Password should be at least/i, 'A senha precisa ter pelo menos 8 caracteres.'],
    [/rate limit/i, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    [/duplicate key.*phone_e164/i, 'Este número já está cadastrado em outra conta.'],
    [/violates check constraint.*phone_e164/i, 'Número inválido. Use o formato com DDI e DDD, ex.: +55 65 99999-0000.'],
    [/row-level security/i, 'Você não tem permissão para esta ação.'],
    [/consent_grants_one_active/i, 'Já existe uma autorização ativa para este módulo.'],
    [/should be different from the old password/i, 'Essa já é a sua senha atual. Pode entrar com ela, ou escolha outra.'],
  ]
  for (const [re, msg] of map) if (re.test(raw)) return msg
  return raw
}
