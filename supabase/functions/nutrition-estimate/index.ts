// Estima calorias e nutrientes de uma refeição, ou o gasto calórico de um treino.
// Chamada pelo banco (gatilho com chave interna) logo após o registro, ou pelo
// app (usuário logado, dono do registro) no botão "Recalcular".
// Valores são ESTIMATIVAS e ficam marcados assim no app.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('NUTRITION_MODEL') ?? 'claude-haiku-5-5'
const DEFAULT_WEIGHT = 70

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const FOOD_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'portion', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'],
        properties: {
          name: { type: 'string' },
          portion: { type: 'string', description: 'Porção considerada, ex.: "4 colheres de sopa", "1 filé médio". Se o usuário não disse, use uma porção média e escreva "porção média".' },
          grams: { type: 'number' },
          kcal: { type: 'number' }, protein_g: { type: 'number' }, carbs_g: { type: 'number' }, fat_g: { type: 'number' }, fiber_g: { type: 'number' },
        },
      },
    },
  },
}
const FOOD_SYSTEM = `Você estima a composição nutricional de refeições brasileiras, usando como referência a Tabela Brasileira de Composição de Alimentos (TACO/TBCA).
Regras:
- Um item por alimento citado. Respeite quantidades ditas pelo usuário (ex.: "6 panquecas" = 6 unidades).
- Sem quantidade, use a porção caseira média brasileira de um adulto e indique "porção média".
- Preparações (lasanha, panqueca com carne, feijoada): estime a preparação típica, não só o ingrediente principal.
- Números realistas, com 1 casa decimal no máximo. Não invente alimentos que não foram citados.`

const EX_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['met', 'intensity'],
  properties: {
    met: { type: 'number', description: 'Equivalente metabólico (MET) da atividade, segundo o Compendium of Physical Activities.' },
    intensity: { type: 'string', enum: ['leve', 'moderada', 'intensa'] },
  },
}
const EX_SYSTEM = `Você classifica atividades físicas pelo Compendium of Physical Activities (Ainsworth).
Devolva o MET médio da atividade descrita, considerando a intensidade informada (ou a típica, se não informada), distância/tempo (para estimar ritmo) e carga quando houver.`

async function claude(system: string, schema: unknown, text: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '', 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, output_config: { format: { type: 'json_schema', schema } }, messages: [{ role: 'user', content: text }] }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body?.error?.message ?? ''}`)
  return JSON.parse(body.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '{}')
}

const r1 = (n: number) => Math.round(Math.max(0, Number(n) || 0) * 10) / 10

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let b: { kind?: string; id?: string } = {}
  try { b = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }
  const kind = b.kind === 'exercise' ? 'exercise' : b.kind === 'food' ? 'food' : null
  if (!kind || !b.id) return json({ error: 'Parâmetros inválidos' }, 400)
  const table = kind === 'food' ? 'food_logs' : 'exercise_logs'

  // Quem pode pedir: o próprio banco (chave interna) ou o dono do registro.
  const internal = req.headers.get('x-internal-key')
  let ownerCheck: string | null = null
  if (internal) {
    const { data: ok } = await db.rpc('check_internal_key', { _key: internal })
    if (ok !== true) return json({ error: 'Não autorizado' }, 401)
  } else {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: auth } = await db.auth.getUser(token)
    if (!auth?.user) return json({ error: 'Não autenticado' }, 401)
    ownerCheck = auth.user.id
  }

  const { data: row } = await db.from(table).select('*').eq('id', b.id).maybeSingle()
  if (!row || (ownerCheck && row.owner_id !== ownerCheck)) return json({ error: 'Registro não encontrado' }, 404)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'IA não configurada' }, 503)

  try {
    if (kind === 'food') {
      if (row.kind === 'agua') return json({ skipped: true })
      const desc = [row.meal && `Refeição: ${row.meal}`, row.items?.length && `Alimentos: ${row.items.join(', ')}`, row.notes && `Observações: ${row.notes}`].filter(Boolean).join('\n')
      if (!desc) return json({ skipped: true })
      const out = await claude(FOOD_SYSTEM, FOOD_SCHEMA, desc)
      const items = (out.items ?? []).map((i: Record<string, number | string>) => ({
        name: String(i.name), portion: String(i.portion ?? ''), grams: r1(Number(i.grams)),
        kcal: r1(Number(i.kcal)), protein_g: r1(Number(i.protein_g)), carbs_g: r1(Number(i.carbs_g)), fat_g: r1(Number(i.fat_g)), fiber_g: r1(Number(i.fiber_g)),
      }))
      const sum = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g') => r1(items.reduce((s: number, i: Record<string, number>) => s + i[k], 0))
      const upd = { kcal: sum('kcal'), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g'), fiber_g: sum('fiber_g'), nutrition_items: items, nutrition_status: 'estimado' }
      await db.from('food_logs').update(upd).eq('id', row.id)
      return json(upd)
    }

    if (!row.duration_min) {
      await db.from('exercise_logs').update({ kcal_status: 'sem_duracao' }).eq('id', row.id)
      return json({ skipped: 'sem_duracao' })
    }
    const { data: goals } = await db.from('wellness_goals').select('weight_kg').eq('owner_id', row.owner_id).maybeSingle()
    const weight = Number(goals?.weight_kg) || DEFAULT_WEIGHT
    const desc = [`Atividade: ${row.activity}`, `Duração: ${row.duration_min} min`, row.intensity && `Intensidade informada: ${row.intensity}`,
      row.distance_km && `Distância: ${row.distance_km} km`, row.load_kg && `Carga: ${row.load_kg} kg`, row.sets && `Séries: ${row.sets}`,
      row.reps && `Repetições: ${row.reps}`, row.notes && `Observações: ${row.notes}`].filter(Boolean).join('\n')
    const out = await claude(EX_SYSTEM, EX_SCHEMA, desc)
    const met = Math.min(20, Math.max(1, Number(out.met) || 3.5))
    // Gasto = MET × peso (kg) × horas
    const upd = { met: r1(met), kcal: r1(met * weight * (row.duration_min / 60)), intensity: row.intensity ?? out.intensity ?? null, kcal_status: 'estimado' }
    await db.from('exercise_logs').update(upd).eq('id', row.id)
    return json({ ...upd, weight_used: weight, weight_assumed: !goals?.weight_kg })
  } catch (e) {
    console.error('nutrition-estimate', kind, e instanceof Error ? e.message : e)
    await db.from(table).update(kind === 'food' ? { nutrition_status: 'falhou' } : { kcal_status: 'falhou' }).eq('id', row.id)
    return json({ error: 'Não consegui estimar agora.' }, 502)
  }
})
