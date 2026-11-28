// Interpreta um sonho registrado e extrai os pontos principais para contagem.
// Chamada pelo banco (gatilho com chave interna) logo após o registro, ou pelo
// dono do sonho no botão "Interpretar de novo".
// A leitura é uma HIPÓTESE para reflexão (não é diagnóstico) e fica marcada assim no app.
import { createClient } from 'npm:@supabase/supabase-js@2'

const MODEL = Deno.env.get('DREAM_MODEL') ?? 'claude-sonnet-5-5'

const THEMES = [
  'queda', 'perseguição', 'voar', 'água', 'morte', 'família', 'mãe', 'pai', 'filhos', 'relacionamento', 'ex', 'trabalho',
  'escola / prova', 'atraso', 'dentes', 'nudez / exposição', 'casa', 'animais', 'viagem', 'infância', 'perda', 'violência',
  'doença', 'dinheiro', 'pessoa desconhecida', 'lugar desconhecido',
]
const EMOTIONS = ['medo', 'angústia', 'tristeza', 'raiva', 'culpa', 'vergonha', 'alegria', 'alívio', 'saudade', 'confusão', 'calma', 'excitação']

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['themes', 'emotions', 'symbols', 'summary', 'interpretation', 'questions'],
  properties: {
    themes: { type: 'array', items: { type: 'string' }, description: 'Motivos principais (2 a 5). Use os nomes da lista sempre que couber; só crie um novo (curto, minúsculo) se nenhum servir.' },
    emotions: { type: 'array', items: { type: 'string' }, description: 'Emoções relatadas ou claramente presentes (0 a 4), preferindo os nomes da lista.' },
    symbols: { type: 'array', items: { type: 'string' }, description: 'Elementos marcantes do sonho (3 a 8): pessoas, lugares, objetos, animais, ações. Substantivos curtos no singular e minúsculos, ex.: "mar", "irmã", "escada", "carro".' },
    summary: { type: 'string', description: 'Uma frase resumindo o sonho.' },
    interpretation: { type: 'string', description: 'Leitura em 2 a 4 parágrafos curtos.' },
    questions: { type: 'array', items: { type: 'string' }, description: '2 ou 3 perguntas para a pessoa refletir ou levar à sessão.' },
  },
}

const SYSTEM = `Você ajuda pessoas a refletir sobre os próprios sonhos, num app usado junto com psicólogos e psicanalistas.
Escreva em português do Brasil, com linguagem simples, acolhedora e respeitosa, falando diretamente com a pessoa ("você").

Interpretação:
- Apresente possibilidades, nunca certezas ("pode representar", "talvez fale de"). Quem dá sentido ao sonho é a própria pessoa.
- Use referências da psicanálise (desejo, conflito, restos do dia, deslocamento, condensação) e da psicologia analítica de Jung (símbolos, sombra), sem jargão pesado; explique o termo quando usar.
- Se houver associações ou contexto do dia, relacione com eles.
- Não faça diagnóstico, não fale em transtorno, não recomende remédio nem tratamento. Não preveja o futuro.
- Se o relato mencionar vontade de morrer ou de se machucar, acolha, diga que vale conversar com o profissional que acompanha a pessoa e cite o CVV (ligue 188, gratuito, 24 h).

Pontos principais: escolha motivos e emoções da lista para que possam ser contados ao longo do tempo.
Motivos: ${THEMES.join(', ')}.
Emoções: ${EMOTIONS.join(', ')}.`

async function claude(text: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '', 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2500, system: SYSTEM, output_config: { format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content: text }] }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body?.error?.message ?? ''}`)
  return JSON.parse(body.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '{}')
}

const clean = (a: unknown, max: number) =>
  [...new Set((Array.isArray(a) ? a : []).map((x) => String(x).trim().toLowerCase()).filter((x) => x && x.length <= 40))].slice(0, max)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let b: { id?: string } = {}
  try { b = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }
  if (!b.id) return json({ error: 'Parâmetros inválidos' }, 400)

  // Quem pode pedir: o próprio banco (chave interna) ou o dono do sonho.
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

  const { data: row } = await db.from('psy_entries').select('id, owner_id, kind, content, notes, themes, emotions, occurred_on').eq('id', b.id).maybeSingle()
  if (!row || row.kind !== 'sonho' || (ownerCheck && row.owner_id !== ownerCheck)) return json({ error: 'Sonho não encontrado' }, 404)
  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    await db.from('psy_entries').update({ ai_status: 'falhou' }).eq('id', row.id)
    return json({ error: 'IA não configurada' }, 503)
  }

  try {
    const text = [`Relato do sonho (${row.occurred_on}):\n${row.content}`,
      row.notes && `Associações / contexto do dia:\n${row.notes}`,
      row.themes?.length && `Motivos que a pessoa marcou: ${row.themes.join(', ')}`,
      row.emotions?.length && `Emoções que a pessoa marcou: ${row.emotions.join(', ')}`].filter(Boolean).join('\n\n')
    const out = await claude(text)
    // O que a pessoa marcou é mantido; a IA só acrescenta.
    const upd = {
      themes: [...new Set([...(row.themes ?? []), ...clean(out.themes, 5)])],
      emotions: [...new Set([...(row.emotions ?? []), ...clean(out.emotions, 4)])],
      symbols: clean(out.symbols, 8),
      ai_summary: String(out.summary ?? '').slice(0, 400) || null,
      ai_interpretation: String(out.interpretation ?? '').slice(0, 4000) || null,
      ai_questions: (Array.isArray(out.questions) ? out.questions : []).map(String).slice(0, 3),
      ai_status: 'pronto', ai_at: new Date().toISOString(),
    }
    await db.from('psy_entries').update(upd).eq('id', row.id)
    return json(upd)
  } catch (e) {
    console.error('dream-interpret', e instanceof Error ? e.message : e)
    await db.from('psy_entries').update({ ai_status: 'falhou' }).eq('id', row.id)
    return json({ error: 'Não consegui interpretar agora.' }, 502)
  }
})
