// Receptor do WhatsApp (Meta Cloud API).
// - GET: verificação do webhook pela Meta (hub.verify_token).
// - POST: mensagens recebidas. A assinatura da Meta é conferida com o
//   segredo do app. Só números verificados no app viram registros.
//
// Segredos (Supabase → Edge Functions → Secrets; nunca no frontend):
//   WHATSAPP_TOKEN            token de acesso da Meta
//   WHATSAPP_PHONE_NUMBER_ID  id do número que envia (de teste ou definitivo)
//   WHATSAPP_APP_SECRET       "Chave secreta do app" (Configurações do app → Básico)
//   WHATSAPP_VERIFY_TOKEN     senha combinada para ligar o webhook
//   SITE_URL                  endereço do app (para os links)
import { createClient } from 'npm:@supabase/supabase-js@2'
import { MAX_TEXT, processMessage } from '../_shared/assistant.ts'

const GRAPH = `https://graph.facebook.com/${Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0'}`
const SITE = Deno.env.get('SITE_URL') ?? 'https://assistente-pessoal-pink.vercel.app'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

// ------------------------------------------------------------------ assinatura da Meta
async function validSignature(raw: string, header: string | null) {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET')
  if (!secret || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  const got = header.slice(7)
  if (got.length !== hex.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

// ------------------------------------------------------------------ envio
async function send(to: string, payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/${Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
  })
  if (!res.ok) console.error('whatsapp send', res.status, (await res.text()).slice(0, 300))
}
const sendText = (to: string, body: string) => send(to, { type: 'text', text: { body: body.slice(0, 4000), preview_url: false } })
const sendButtons = (to: string, body: string, buttons: { id: string; title: string }[]) =>
  send(to, {
    type: 'interactive',
    interactive: { type: 'button', body: { text: body.slice(0, 1000) }, action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) } },
  })

// ------------------------------------------------------------------ número → usuário
/** Celulares do Brasil às vezes chegam sem o 9 (55 + DDD + 8 dígitos). Testa as duas formas. */
function phoneVariants(waId: string) {
  const d = waId.replace(/\D/g, '')
  const out = new Set([`+${d}`])
  const br = d.match(/^55(\d{2})(\d{8,9})$/)
  if (br) {
    const [, ddd, n] = br
    if (n.length === 8) out.add(`+55${ddd}9${n}`)
    if (n.length === 9 && n.startsWith('9')) out.add(`+55${ddd}${n.slice(1)}`)
  }
  return [...out]
}

interface Identity { id: string; user_id: string; verified_at: string | null; verify_code: string | null; verify_expires_at: string | null }
async function findIdentity(waId: string) {
  const { data } = await db.from('whatsapp_identities').select('id, user_id, verified_at, verify_code, verify_expires_at').in('phone_e164', phoneVariants(waId))
  const list = (data ?? []) as Identity[]
  return list.find((i) => i.verified_at) ?? list[0] ?? null
}

// ------------------------------------------------------------------ tratamento de cada mensagem
interface WaMessage {
  from: string; id: string; type: string
  text?: { body: string }
  interactive?: { type: string; button_reply?: { id: string; title: string } }
  button?: { payload: string; text: string }
}

async function handle(m: WaMessage) {
  const to = m.from
  const identity = await findIdentity(m.from)
  const text = m.text?.body?.trim() ?? ''

  // 1) Código de verificação enviado pelo próprio dono do número.
  const code = text.match(/\b(\d{6})\b/)?.[1]
  if (identity && !identity.verified_at) {
    if (code && identity.verify_code === code && identity.verify_expires_at && new Date(identity.verify_expires_at) > new Date()) {
      await db.from('whatsapp_identities').update({ verified_at: new Date().toISOString(), verify_code: null, verify_expires_at: null }).eq('id', identity.id)
      return sendText(to, '✅ Número confirmado! A partir de agora é só me mandar o que quiser registrar. Ex.: "almocei arroz, feijão e frango" ou "paguei 80 reais de farmácia".')
    }
    return sendText(to, `Para ligar este número à sua conta, abra o app em Configurações → WhatsApp, toque em "Verificar" e me envie o código de 6 dígitos.\n${SITE}/app/configuracoes`)
  }
  if (!identity) {
    return sendText(to, `Olá! Este número ainda não está ligado a uma conta do Assistente Pessoal. Cadastre-o no app em Configurações → WhatsApp.\n${SITE}/app/configuracoes`)
  }
  const userId = identity.user_id

  // 2) Botões "Confirmar" / "Descartar".
  const buttonId = m.interactive?.button_reply?.id ?? m.button?.payload
  if (buttonId) {
    const [action, messageId] = buttonId.split(':')
    if (!messageId) return
    const { data: drafts } = await db.from('assistant_drafts').select('id, module_key, title')
      .eq('owner_id', userId).eq('message_id', messageId).eq('status', 'pending')
    if (!drafts?.length) return sendText(to, 'Esses registros já foram decididos.')
    if (action === 'ok') {
      const ok = drafts.filter((d) => d.module_key)
      if (ok.length) {
        const { error } = await db.from('assistant_drafts').update({ status: 'confirmed', decided_at: new Date().toISOString() }).in('id', ok.map((d) => d.id))
        if (error) { console.error('confirm', error.message); return sendText(to, 'Não consegui salvar agora. Confira na Caixa de entrada do app.') }
      }
      const left = drafts.length - ok.length
      return sendText(to, `✅ Salvo: ${ok.map((d) => d.title).join('; ') || 'nada'}.${left ? `\n${left} item(ns) sem destino ficaram na Caixa de entrada: ${SITE}/app/caixa-de-entrada` : ''}`)
    }
    if (action === 'no') {
      await db.from('assistant_drafts').update({ status: 'rejected', decided_at: new Date().toISOString() }).in('id', drafts.map((d) => d.id))
      return sendText(to, '🗑️ Descartado. Pode mandar de novo do jeito certo.')
    }
    return
  }

  // 3) Por enquanto o canal entende só texto (sem fingir que leu áudio ou foto).
  if (m.type !== 'text' || !text) {
    return sendText(to, 'Por enquanto eu entendo só mensagens de texto por aqui. Áudios, fotos e PDFs: use o app (exames e receitas vão na aba Saúde).')
  }
  if (text.length > MAX_TEXT) return sendText(to, `Mensagem muito longa. Mande em partes de até ${MAX_TEXT} caracteres.`)

  const r = await processMessage(db, userId, { text, channel: 'whatsapp', externalId: m.id })
  if (r.body.duplicate) return
  if (r.status !== 200) return sendText(to, String(r.body.error ?? 'Não consegui processar agora. Tente de novo em instantes.'))

  const reply = String(r.body.reply ?? 'Entendi.')
  const confirmable = Number(r.body.confirmable ?? 0)
  if (confirmable > 0) {
    return sendButtons(to, `${reply}\n\nPosso salvar?`, [
      { id: `ok:${r.body.message_id}`, title: 'Confirmar' },
      { id: `no:${r.body.message_id}`, title: 'Descartar' },
    ])
  }
  if (Number(r.body.drafts ?? 0) > 0) return sendText(to, `${reply}\n\nRevise na Caixa de entrada: ${SITE}/app/caixa-de-entrada`)
  return sendText(to, reply)
}

// ------------------------------------------------------------------ servidor
Deno.serve(async (req) => {
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe'
      && Deno.env.get('WHATSAPP_VERIFY_TOKEN')
      && url.searchParams.get('hub.verify_token') === Deno.env.get('WHATSAPP_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) {
    console.warn('whatsapp-webhook: assinatura inválida')
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: { entry?: { changes?: { value?: { messages?: WaMessage[] } }[] }[] }
  try { payload = JSON.parse(raw) } catch { return new Response('Bad request', { status: 400 }) }
  const messages = (payload.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((c) => c.value?.messages ?? [])

  // Responde rápido para a Meta e processa em segundo plano.
  const work = Promise.all(messages.map((m) => handle(m).catch((e) => console.error('whatsapp handle', e instanceof Error ? e.message : e))))
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime
  if (rt?.waitUntil) rt.waitUntil(work)
  else await work
  return new Response('ok', { status: 200 })
})
