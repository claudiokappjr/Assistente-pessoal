// Lê o texto de uma receita colada pelo usuário e devolve a receita
// estruturada (título, refeições, porções, tempo, ingredientes, preparo).
// Não grava nada: o app abre o formulário preenchido para o usuário conferir.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('RECIPE_MODEL') ?? 'claude-haiku-5-5'
const MAX_TEXT = 12000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UNITS = ['g', 'kg', 'ml', 'l', 'unid', 'colher_sopa', 'colher_cha', 'xicara', 'pitada', 'a_gosto']

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_recipe', 'title', 'meal_types', 'servings', 'prep_minutes', 'ingredients', 'instructions'],
  properties: {
    is_recipe: { type: 'boolean', description: 'false se o texto não for uma receita.' },
    title: { type: 'string' },
    meal_types: { type: 'array', items: { type: 'string', enum: ['cafe', 'lanche', 'almoco', 'jantar'] } },
    servings: { type: 'number', description: 'Porções que a receita rende; 1 se não informado.' },
    prep_minutes: { type: 'integer', description: 'Tempo total em minutos; 0 se não informado.' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['quantity', 'unit', 'name'],
        properties: {
          quantity: { type: 'number', description: 'Quantidade numérica; 0 quando "a gosto" ou não informada.' },
          unit: { type: 'string', enum: UNITS },
          name: { type: 'string', description: 'Ingrediente, sem a quantidade. Ex.: "farinha de trigo".' },
        },
      },
    },
    instructions: { type: 'string', description: 'Modo de preparo em passos numerados, um por linha.' },
  },
}

const SYSTEM = `Você extrai receitas culinárias de textos em português (copiados de sites, mensagens ou livros) para um formato estruturado.
Regras:
- Mantenha o conteúdo do autor; não invente ingredientes, quantidades nem passos.
- Frações viram decimais (1/2 = 0.5; 1 e 1/2 = 1.5).
- Unidades: g, kg, ml, l, unid (ovos, unidades, dentes, fatias, folhas), colher_sopa, colher_cha, xicara, pitada, a_gosto. Converta "colher de sopa/sobremesa" em colher_sopa, "colher de chá/café" em colher_cha, "copo americano" em ml (190 ml por copo), "lata" em unid. "Sal a gosto" = a_gosto com quantidade 0.
- meal_types: refeições adequadas (cafe, lanche, almoco, jantar) segundo o tipo de prato; pode ser mais de uma.
- Instruções: passos curtos e numerados ("1. ...").
- Se o texto não for uma receita, is_recipe = false e o restante vazio.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: auth } = await db.auth.getUser(token ?? '')
  const user = auth?.user
  if (!user) return json({ error: 'Não autenticado' }, 401)

  const { count: active } = await db.from('subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active')
  if (!active) return json({ error: 'Sua assinatura não está ativa.' }, 402)

  let text = ''
  try { text = String((await req.json()).text ?? '').trim() } catch { return json({ error: 'Corpo inválido' }, 400) }
  if (text.length < 20) return json({ error: 'Cole o texto completo da receita.' }, 400)
  if (text.length > MAX_TEXT) return json({ error: 'Texto muito longo. Cole só a parte da receita.' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'IA não configurada' }, 503)

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: text }],
    }),
  })
  const body = await res.json()
  if (!res.ok) {
    console.error('recipe-parse', res.status, body?.error?.message)
    return json({ error: 'Não consegui ler a receita agora. Tente de novo em instantes.' }, 502)
  }
  const block = body.content?.find((c: { type: string }) => c.type === 'text')
  let recipe
  try { recipe = JSON.parse(block?.text ?? '') } catch { return json({ error: 'Não consegui entender o texto.' }, 502) }
  if (!recipe.is_recipe) return json({ error: 'Não encontrei uma receita nesse texto.' }, 422)

  recipe.ingredients = (recipe.ingredients ?? [])
    .filter((i: { name: string }) => String(i.name ?? '').trim())
    .map((i: { quantity: number; unit: string; name: string }) => ({
      name: String(i.name).trim(),
      unit: UNITS.includes(i.unit) ? i.unit : 'unid',
      quantity: i.unit === 'a_gosto' || !(Number(i.quantity) > 0) ? null : Number(i.quantity),
    }))
  recipe.servings = Number(recipe.servings) > 0 ? Number(recipe.servings) : 1
  recipe.prep_minutes = Number(recipe.prep_minutes) > 0 ? Math.round(Number(recipe.prep_minutes)) : null
  return json({ recipe, usage: body.usage })
})
