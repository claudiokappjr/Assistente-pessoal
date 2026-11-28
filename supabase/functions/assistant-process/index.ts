// Assistente central (app) — recebe uma mensagem do usuário logado e cria
// rascunhos para confirmação. A lógica fica em _shared/assistant.ts.
//
// Segredos (configurados no Supabase, nunca no frontend):
//   ANTHROPIC_API_KEY  — obrigatório
//   ANTHROPIC_MODEL    — opcional
import { createClient } from 'npm:@supabase/supabase-js@2'
import { processMessage } from '../_shared/assistant.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: auth } = await admin.auth.getUser(token ?? '')
  const user = auth?.user
  if (!user) return json({ error: 'Não autenticado' }, 401)

  let body: { text?: string; reprocess_message_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }

  const r = await processMessage(admin, user.id, { text: body.text, reprocessId: body.reprocess_message_id, channel: 'app' })
  return json(r.body, r.status)
})
