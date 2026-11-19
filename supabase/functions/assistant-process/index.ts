// Assistente central — recebe uma mensagem do usuário, classifica com Claude
// e cria rascunhos (um por item) para confirmação. Nada é gravado como
// definitivo aqui: o usuário confirma na caixa de entrada.
//
// Segredos (configurados no Supabase, nunca no frontend):
//   ANTHROPIC_API_KEY  — obrigatório
//   ANTHROPIC_MODEL    — opcional (padrão abaixo)
import { createClient } from 'npm:@supabase/supabase-js@2'

// Haiku classifica (barato e rápido); Sonnet revisa só quando há dúvida.
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5'
const FALLBACK_MODEL = Deno.env.get('ANTHROPIC_FALLBACK_MODEL') ?? 'claude-sonnet-5-5'
const ESCALATE_BELOW = 0.7
const FREE_MONTHLY_LIMIT_FALLBACK = 50
const MAX_TEXT = 4000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Tipos de registro aceitos por módulo (orienta a IA e a interface).
const KINDS: Record<string, string[]> = {
  financas: ['despesa', 'receita', 'conta_a_pagar', 'conta_a_receber'],
  agenda: ['compromisso', 'lembrete'],
  saude: ['sintoma', 'medicamento', 'consulta', 'exame'],
  psicanalise: ['sonho', 'insight'],
  nutricao: ['refeicao', 'agua'],
  exercicios: ['treino'],
  ciclo: ['menstruacao', 'sintoma_ciclo'],
  memorias: ['nota', 'ideia', 'acontecimento'],
}

function systemPrompt(modules: { key: string; name: string }[], today: string) {
  const list = modules.map((m) => `- ${m.key} (${m.name}): ${KINDS[m.key]?.join(', ') ?? ''}`).join('\n')
  return `Você é o organizador de um aplicativo pessoal brasileiro. Sua única função é transformar mensagens do usuário em registros estruturados para os módulos do app. Você não é um assistente de conversa geral.

Hoje é ${today} (fuso America/Sao_Paulo). Converta datas relativas ("hoje", "ontem", "sexta") em AAAA-MM-DD.

Módulos habilitados para este usuário e tipos aceitos:
${list}

Regras:
1. Uma mensagem pode gerar vários itens, um por fato (ex.: "paguei R$ 120 na academia e fiz 40 min de musculação" = despesa em financas + treino em exercicios).
2. Use somente módulos da lista. Se o fato pertence a um módulo não habilitado, ou não tem destino claro, use module_key "nenhum" e explique em "ambiguity".
3. Valores em dinheiro: campo valor_centavos, inteiro em centavos (R$ 120,50 = "12050").
4. Preencha "ambiguity" quando faltar informação importante (ex.: forma de pagamento desconhecida não é ambiguidade; valor ausente numa despesa é). Confiança de 0 a 1.
5. Nunca invente valores que o usuário não disse.
6. Saúde, sonhos e emoções: registre o que foi relatado. Não faça diagnóstico, não interprete clinicamente, não recomende tratamento.
7. Perguntas: intent "pergunta", nenhum item; responda em "reply" que a consulta aos dados registrados estará disponível em breve. Não responda perguntas de conhecimento geral.
8. "reply": uma frase curta, em português, resumindo o que foi entendido, para o usuário confirmar.
9. "ambiguity": string vazia quando não houver dúvida.

Em "fields", informe pares campo/valor (valor sempre como texto). Campos sugeridos (use os que se aplicam):
- financas: valor_centavos, data, descricao, categoria, forma_pagamento, vencimento, parcelas
- exercicios: atividade, duracao_min, series, repeticoes, carga_kg, distancia_km, data
- agenda: titulo, data, horario, duracao_min, local, com_quem
- saude: descricao, intensidade (1-10), medicamento, dose, data, horario
- psicanalise: relato, emocoes, data
- nutricao: refeicao, alimentos, quantidade_ml, data, horario
- ciclo: data_inicio, fluxo, sintomas, intensidade
- memorias: texto, tags`
}

// Saída estruturada (output_config.format). Regras do formato: todo objeto
// precisa de additionalProperties:false e não aceita chaves livres; por isso
// os campos do registro vêm como lista de pares {campo, valor}.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'reply', 'items'],
  properties: {
    intent: { type: 'string', enum: ['registro', 'pergunta', 'comando', 'agendamento', 'indefinido'] },
    reply: { type: 'string', description: 'Frase curta em português para o usuário.' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['module_key', 'kind', 'title', 'fields', 'confidence', 'ambiguity'],
        properties: {
          module_key: { type: 'string', description: 'Chave do módulo habilitado, ou "nenhum".' },
          kind: { type: 'string' },
          title: { type: 'string', description: 'Título curto, ex.: "Academia — R$ 120,00".' },
          fields: {
            type: 'array',
            description: 'Dados do registro como pares campo/valor. Use os nomes de campo sugeridos.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['campo', 'valor'],
              properties: { campo: { type: 'string' }, valor: { type: 'string' } },
            },
          },
          confidence: { type: 'number', description: 'De 0 a 1.' },
          ambiguity: { type: 'string', description: 'O que falta ou é duvidoso; string vazia se nada.' },
        },
      },
    },
  },
}

interface ClaudeItem { module_key: string; kind: string; title: string; fields: { campo: string; valor: string }[]; confidence: number; ambiguity: string }
interface ClaudeResult { intent: string; reply: string; items: ClaudeItem[] }

const NUMERIC = new Set(['valor_centavos', 'parcelas', 'duracao_min', 'series', 'repeticoes', 'carga_kg', 'distancia_km', 'intensidade', 'quantidade_ml'])
const LISTS = new Set(['alimentos', 'emocoes', 'sintomas', 'tags'])

function toData(fields: ClaudeItem['fields']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const { campo, valor } of fields ?? []) {
    const k = String(campo).trim().toLowerCase()
    const v = String(valor).trim()
    if (!k || !v) continue
    if (NUMERIC.has(k)) {
      const n = Number(v.replace(/[^\d,.-]/g, '').replace(',', '.'))
      if (Number.isFinite(n)) out[k] = k === 'valor_centavos' ? Math.round(n) : n
    } else if (LISTS.has(k)) {
      out[k] = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
    } else {
      out[k] = v
    }
  }
  return out
}

async function callClaude(apiKey: string, model: string, system: string, text: string) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      system,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: text }],
    }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`Claude ${res.status}: ${body?.error?.message ?? 'erro desconhecido'}`)
  const block = body.content?.find((c: { type: string }) => c.type === 'text')
  if (!block?.text) throw new Error('Resposta da IA vazia')
  const result = JSON.parse(block.text) as ClaudeResult
  return { result, usage: body.usage as { input_tokens: number; output_tokens: number } }
}

function needsReview(r: ClaudeResult) {
  if (r.intent === 'registro' && (!r.items || r.items.length === 0)) return true
  return (r.items ?? []).some((i) => (Number(i.confidence) || 0) < ESCALATE_BELOW || (i.ambiguity ?? '').trim() !== '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  // 1. Identifica o usuário pelo token de login.
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: auth } = await admin.auth.getUser(token ?? '')
  const user = auth?.user
  if (!user) return json({ error: 'Não autenticado' }, 401)

  let body: { text?: string; reprocess_message_id?: string }
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }

  // 2. Módulos habilitados.
  const { data: mods } = await admin.from('user_modules').select('modules(key, name, is_active)').eq('user_id', user.id).eq('enabled', true)
  const modules = (mods ?? []).map((m) => m.modules as unknown as { key: string; name: string; is_active: boolean }).filter((m) => m?.is_active)
  const enabled = new Set(modules.map((m) => m.key))

  // 3. Mensagem nova ou reprocessamento.
  let messageId: string
  let text: string
  let attempts = 1
  if (body.reprocess_message_id) {
    const { data: msg } = await admin.from('assistant_messages').select('*').eq('id', body.reprocess_message_id).eq('owner_id', user.id).maybeSingle()
    if (!msg) return json({ error: 'Mensagem não encontrada' }, 404)
    if (msg.status === 'processing') return json({ error: 'Mensagem já está sendo processada' }, 409)
    await admin.from('assistant_drafts').delete().eq('message_id', msg.id).eq('status', 'pending')
    await admin.from('assistant_messages').update({ status: 'processing', error: null }).eq('id', msg.id)
    messageId = msg.id
    text = msg.content_text ?? ''
    attempts = (msg.attempts ?? 0) + 1
  } else {
    text = (body.text ?? '').trim()
    if (!text) return json({ error: 'Mensagem vazia' }, 400)
    if (text.length > MAX_TEXT) return json({ error: `Mensagem muito longa (máx. ${MAX_TEXT} caracteres)` }, 400)

    // Limite mensal do plano (até as assinaturas existirem, vale o gratuito).
    const { data: plan } = await admin.from('plans').select('limits').eq('key', 'gratuito').maybeSingle()
    const limit = Number((plan?.limits as Record<string, number> | null)?.mensagens_ia_mes ?? FREE_MONTHLY_LIMIT_FALLBACK)
    const ym = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date())
    const monthStart = new Date(`${ym}-01T00:00:00-03:00`)
    const { count } = await admin.from('assistant_messages').select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id).gte('created_at', monthStart.toISOString())
    if ((count ?? 0) >= limit) return json({ error: `Você atingiu o limite de ${limit} mensagens deste mês no seu plano.` }, 429)

    const { data: msg, error } = await admin.from('assistant_messages')
      .insert({ owner_id: user.id, channel: 'app', content_type: 'text', content_text: text, status: 'processing' })
      .select('id').single()
    if (error) return json({ error: 'Não foi possível registrar a mensagem' }, 500)
    messageId = msg.id
  }

  // 4. IA configurada?
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    await admin.from('assistant_messages').update({ status: 'failed', error: 'IA não configurada (ANTHROPIC_API_KEY ausente)' }).eq('id', messageId)
    return json({ error: 'O assistente ainda não foi configurado. Sua mensagem ficou salva e poderá ser reprocessada.', message_id: messageId }, 503)
  }

  // 5. Classificação e extração.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).format(new Date())
  try {
    const system = systemPrompt(modules, today)
    const first = await callClaude(apiKey, MODEL, system, text)
    let result = first.result
    let usedModel = MODEL
    let tokensIn = first.usage?.input_tokens ?? 0
    let tokensOut = first.usage?.output_tokens ?? 0
    // Escala para o modelo mais capaz só quando o primeiro ficou em dúvida.
    if (FALLBACK_MODEL && FALLBACK_MODEL !== MODEL && needsReview(result)) {
      try {
        const second = await callClaude(apiKey, FALLBACK_MODEL, system, text)
        result = second.result
        usedModel = `${MODEL}→${FALLBACK_MODEL}`
        tokensIn += second.usage?.input_tokens ?? 0
        tokensOut += second.usage?.output_tokens ?? 0
      } catch (e) {
        console.warn('fallback falhou; mantendo primeira resposta', e instanceof Error ? e.message : e)
      }
    }
    const items = (result.items ?? []).map((i) => {
      const valid = enabled.has(i.module_key)
      const amb = (i.ambiguity ?? '').trim()
      return {
        owner_id: user.id,
        message_id: messageId,
        module_key: valid ? i.module_key : null,
        kind: String(i.kind || 'indefinido').slice(0, 40),
        title: String(i.title || 'Registro').slice(0, 200),
        data: toData(i.fields),
        confidence: Math.max(0, Math.min(1, Number(i.confidence) || 0)),
        ambiguity: valid ? (amb || null) : (amb || 'Sem módulo de destino disponível no seu plano'),
      }
    })
    if (items.length) {
      const { error } = await admin.from('assistant_drafts').insert(items)
      if (error) throw new Error(`Falha ao salvar rascunhos: ${error.message}`)
    }
    await admin.from('assistant_messages').update({
      status: 'processed', intent: result.intent, reply_text: result.reply?.slice(0, 1000) ?? null,
      model: usedModel, tokens_in: tokensIn, tokens_out: tokensOut,
      processed_at: new Date().toISOString(), error: null, attempts,
    }).eq('id', messageId)
    return json({ message_id: messageId, intent: result.intent, reply: result.reply, drafts: items.length })
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    await admin.from('assistant_messages').update({ status: 'failed', error: err.slice(0, 500), attempts }).eq('id', messageId)
    console.error('assistant-process', messageId, err)
    return json({ error: 'Não consegui processar agora. A mensagem ficou salva; tente reprocessar.', message_id: messageId }, 502)
  }
})
