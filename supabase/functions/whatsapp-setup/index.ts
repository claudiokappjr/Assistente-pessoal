// Ferramenta interna: diagnostica e ajusta a ligação da conta do WhatsApp
// com o app na Meta (para onde os avisos de mensagens são enviados).
// Protegida por token de uso único (private.setup_tokens), criado pelo
// administrador do sistema. Não devolve o token de acesso da Meta.
import { createClient } from 'npm:@supabase/supabase-js@2'

const GRAPH = `https://graph.facebook.com/${Deno.env.get('WHATSAPP_GRAPH_VERSION') ?? 'v25.0'}`
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } })

async function graph(path: string, method = 'GET', body?: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data: unknown
  try { data = await res.json() } catch { data = null }
  return { status: res.status, data }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: ok } = await db.rpc('check_setup_token', { _token: req.headers.get('x-setup-token') ?? '', _purpose: 'whatsapp' })
  if (ok !== true) return json({ error: 'Não autorizado' }, 401)

  let b: { action?: string; waba_id?: string } = {}
  try { b = await req.json() } catch { /* vazio */ }
  const phone = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
  const waba = b.waba_id
  const callback = `${Deno.env.get('SUPABASE_URL')}/functions/v1/whatsapp-webhook`

  const out: Record<string, unknown> = {
    secrets: {
      token: Boolean(Deno.env.get('WHATSAPP_TOKEN')), phone_number_id: phone ?? null,
      app_secret: Boolean(Deno.env.get('WHATSAPP_APP_SECRET')), verify_token: Boolean(Deno.env.get('WHATSAPP_VERIFY_TOKEN')),
    },
  }
  out.me = await graph('/me?fields=id,name')
  if (phone) out.phone = await graph(`/${phone}?fields=display_phone_number,verified_name,status,quality_rating,webhook_configuration`)
  if (waba) out.subscribed_apps_before = await graph(`/${waba}/subscribed_apps`)

  if (waba && b.action === 'subscribe') out.subscribe = await graph(`/${waba}/subscribed_apps`, 'POST')
  if (waba && b.action === 'override') {
    out.override = await graph(`/${waba}/subscribed_apps`, 'POST', {
      override_callback_uri: callback, verify_token: Deno.env.get('WHATSAPP_VERIFY_TOKEN'),
    })
  }
  if (waba && b.action) out.subscribed_apps_after = await graph(`/${waba}/subscribed_apps`)
  return json(out)
})
