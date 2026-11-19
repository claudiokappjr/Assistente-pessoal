const dt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
const d = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'America/Sao_Paulo' })

export const formatDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—')
export const formatDate = (iso: string | null | undefined) => (iso ? d.format(new Date(iso)) : '—')

export const formatPhone = (e164: string) => {
  const m = e164.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : e164
}

/** Converte o que o usuário digitou em E.164; assume Brasil quando não há DDI. */
export const toE164 = (raw: string) => {
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+')) return `+${digits}`
  return digits.length <= 11 ? `+55${digits}` : `+${digits}`
}

export const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }).format(new Date()))
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'
}

export const roleLabel = { user: 'Usuário', professional: 'Profissional', admin: 'Administrador' } as const
