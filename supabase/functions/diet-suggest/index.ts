// Sugere um cardápio de um dia que bate com as metas do usuário (calorias e
// macronutrientes), respeitando o objetivo e as preferências/restrições.
// Grava a sugestão em wellness_goals.diet_suggestion. É uma SUGESTÃO, não prescrição.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('DIET_MODEL') ?? 'claude-sonnet-5-5'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['meals', 'tips'],
  properties: {
    meals: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['meal', 'time', 'items'],
        properties: {
          meal: { type: 'string', enum: ['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'] },
          time: { type: 'string', description: 'Horário sugerido HH:MM' },
          items: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['food', 'portion', 'kcal', 'protein_g', 'carbs_g', 'fat_g'],
              properties: {
                food: { type: 'string' }, portion: { type: 'string', description: 'Medida caseira e gramas, ex.: "4 colheres de sopa (100 g)"' },
                kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' },
              },
            },
          },
        },
      },
    },
    tips: { type: 'array', items: { type: 'string' }, description: '2 a 4 dicas práticas curtas ligadas ao objetivo.' },
  },
}
const GOAL_LABEL: Record<string, string> = {
  perder_gordura: 'perder gordura preservando massa muscular', perder_peso: 'perder peso', ganhar_massa: 'ganhar massa muscular',
  recomposicao: 'recomposição corporal', manter: 'manter o peso com alimentação saudável', condicionamento: 'melhorar o condicionamento físico',
}
const r1 = (n: number) => Math.round((Number(n) || 0) * 10) / 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: auth } = await db.auth.getUser(token)
  const user = auth?.user
  if (!user) return json({ error: 'Não autenticado' }, 401)
  const { count: active } = await db.from('subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'active')
  if (!active) return json({ error: 'Sua assinatura não está ativa.' }, 402)

  const { data: g } = await db.from('wellness_goals').select('*').eq('owner_id', user.id).maybeSingle()
  if (!g?.kcal_day) return json({ error: 'Defina suas metas primeiro (botão Metas).' }, 400)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'IA não configurada' }, 503)

  const prompt = [
    `Objetivo: ${GOAL_LABEL[g.goal_type] ?? 'alimentação saudável'}.`,
    `Meta diária: ${g.kcal_day} kcal; proteína ${g.protein_g_day ?? '-'} g; carboidratos ${g.carbs_g_day ?? '-'} g; gorduras ${g.fat_g_day ?? '-'} g.`,
    g.weight_kg ? `Peso: ${g.weight_kg} kg.` : '',
    g.diet_preferences ? `Preferências e restrições (respeite à risca): ${g.diet_preferences}` : 'Sem restrições informadas.',
  ].filter(Boolean).join('\n')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 6000,
      system: `Você monta cardápios de exemplo para brasileiros, com comida de verdade, simples e acessível (arroz, feijão, ovos, frango, frutas, legumes, pão, iogurte etc.), usando a tabela TACO para os valores.
Regras: 4 a 6 refeições; somar perto da meta (±5% nas calorias, ±10% em cada macronutriente); porções em medida caseira com gramas; respeitar preferências, restrições e alergias informadas; nada de suplementos ou medicamentos; sem promessas. É um exemplo de um dia, não uma prescrição.`,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const body = await res.json()
  if (!res.ok) { console.error('diet-suggest', res.status, body?.error?.message); return json({ error: 'Não consegui montar a sugestão agora. Tente de novo.' }, 502) }
  let out
  try { out = JSON.parse(body.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '') } catch { return json({ error: 'Resposta inválida da IA.' }, 502) }

  type Item = { food: string; portion: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
  const meals = (out.meals ?? []).map((m: { meal: string; time: string; items: Item[] }) => {
    const items = (m.items ?? []).map((i) => ({ food: String(i.food), portion: String(i.portion), kcal: r1(i.kcal), protein_g: r1(i.protein_g), carbs_g: r1(i.carbs_g), fat_g: r1(i.fat_g) }))
    const sum = (k: keyof Omit<Item, 'food' | 'portion'>) => r1(items.reduce((s, i) => s + i[k], 0))
    return { meal: m.meal, time: m.time, items, kcal: sum('kcal'), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') }
  })
  const total = (k: string) => r1(meals.reduce((s: number, m: Record<string, number>) => s + m[k], 0))
  const suggestion = {
    meals, tips: (out.tips ?? []).slice(0, 4),
    totals: { kcal: total('kcal'), protein_g: total('protein_g'), carbs_g: total('carbs_g'), fat_g: total('fat_g') },
    goal: { kcal: g.kcal_day, protein_g: g.protein_g_day, carbs_g: g.carbs_g_day, fat_g: g.fat_g_day, goal_type: g.goal_type },
  }
  await db.from('wellness_goals').update({ diet_suggestion: suggestion, diet_generated_at: new Date().toISOString() }).eq('owner_id', user.id)
  return json(suggestion)
})
