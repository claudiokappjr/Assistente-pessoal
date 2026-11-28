// Lê um PDF/foto de exame laboratorial ou de receita médica enviado pelo
// usuário para o bucket privado `health-files` (pasta = id do usuário).
// - kind = 'exam': cria o exame (status "revisar") com cada resultado em
//   lab_results, para o usuário conferir.
// - kind = 'prescription': só devolve os medicamentos lidos; o app abre o
//   formulário preenchido e o usuário confirma antes de salvar.
// A IA apenas transcreve: não interpreta nem dá diagnóstico.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding@1/base64'

const MODEL = Deno.env.get('HEALTH_DOC_MODEL') ?? 'claude-sonnet-5-5'
const BUCKET = 'health-files'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MEDIA: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

const EXAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_lab_exam', 'collected_on', 'lab_name', 'title', 'results'],
  properties: {
    is_lab_exam: { type: 'boolean', description: 'false se o documento não for um laudo de exame laboratorial.' },
    collected_on: { type: 'string', description: 'Data da coleta em AAAA-MM-DD; "" se não houver.' },
    lab_name: { type: 'string', description: 'Nome do laboratório; "" se não houver.' },
    title: { type: 'string', description: 'Título curto, ex.: "Hemograma e bioquímica".' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['marker', 'category', 'is_numeric', 'numeric_value', 'text_value', 'unit', 'ref_low', 'ref_high', 'ref_text', 'flag'],
        properties: {
          marker: { type: 'string', description: 'Nome padronizado do analito em português, ex.: "Hemoglobina", "Glicose", "Colesterol LDL", "TSH".' },
          category: { type: 'string', description: 'Grupo, ex.: "Hemograma", "Lipídios", "Tireoide"; "" se não houver.' },
          is_numeric: { type: 'boolean' },
          numeric_value: { type: 'number', description: 'Valor numérico com ponto decimal e sem separador de milhar; 0 se não numérico.' },
          text_value: { type: 'string', description: 'Resultado em texto quando não numérico (ex.: "Negativo"); "" se numérico.' },
          unit: { type: 'string', description: 'Unidade como impressa, ex.: "mg/dL"; "" se não houver.' },
          ref_low: { type: 'string', description: 'Limite inferior de referência como número com ponto; "" se não houver.' },
          ref_high: { type: 'string', description: 'Limite superior de referência como número com ponto; "" se não houver.' },
          ref_text: { type: 'string', description: 'Texto da referência como impresso; "" se não houver.' },
          flag: { type: 'string', enum: ['baixo', 'normal', 'alto', 'alterado', 'sem_referencia'] },
        },
      },
    },
  },
}

const RX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_prescription', 'prescribed_on', 'prescriber', 'medications'],
  properties: {
    is_prescription: { type: 'boolean', description: 'false se o documento não for uma receita médica.' },
    prescribed_on: { type: 'string', description: 'Data da receita AAAA-MM-DD; "" se não houver.' },
    prescriber: { type: 'string', description: 'Nome e registro (CRM) do prescritor; "" se não houver.' },
    medications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'dose', 'frequency', 'route', 'duration_days', 'instructions'],
        properties: {
          name: { type: 'string', description: 'Nome do medicamento como escrito.' },
          dose: { type: 'string', description: 'Concentração/dose, ex.: "500 mg, 1 comprimido"; "" se não houver.' },
          frequency: { type: 'string', description: 'Ex.: "de 8 em 8 horas", "1x ao dia"; "" se não houver.' },
          route: { type: 'string', description: 'Via, ex.: "oral"; "" se não houver.' },
          duration_days: { type: 'integer', description: 'Duração em dias; 0 se uso contínuo ou não informado.' },
          instructions: { type: 'string', description: 'Outras orientações escritas; "" se não houver.' },
        },
      },
    },
  },
}

const EXAM_SYSTEM = `Você transcreve laudos de exames laboratoriais brasileiros para dados estruturados.
Regras:
- Transcreva somente o que está escrito; não invente valores, unidades nem referências. Não interprete nem comente.
- Um item por analito. Ignore cabeçalhos, método, material e assinaturas.
- Use nomes padronizados em português para o mesmo analito ser reconhecido em exames diferentes (ex.: "Glicose" e não "Glicemia de jejum"; "Colesterol LDL"; "Vitamina D (25-OH)").
- Números: ponto decimal e sem separador de milhar (13,5 → 13.5; 250.000 → 250000).
- Referência "70 a 99" → ref_low 70, ref_high 99. "Inferior a 200" → só ref_high 200. "Superior a 40" → só ref_low 40. Referências por faixa (sexo/idade): copie em ref_text e preencha limites só se houver uma faixa claramente aplicável.
- flag: compare o valor com a referência; se o laudo marcar alterado use "alterado"; sem referência use "sem_referencia".
- Se o documento não for um exame laboratorial, is_lab_exam = false e results vazio.`

const RX_SYSTEM = `Você transcreve receitas médicas brasileiras para dados estruturados.
Regras:
- Transcreva somente o que está escrito; não invente nem sugira medicamentos, doses ou orientações. Não interprete.
- Um item por medicamento prescrito.
- Se algo estiver ilegível, deixe o campo vazio em vez de adivinhar.
- Se o documento não for uma receita, is_prescription = false e medications vazio.`

const num = (s: unknown) => {
  const t = String(s ?? '').trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const date = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? String(s) : null)
const str = (s: unknown) => String(s ?? '').trim() || null

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

  let path = '', kind = ''
  try {
    const b = await req.json()
    path = String(b.path ?? '')
    kind = String(b.kind ?? '')
  } catch { return json({ error: 'Corpo inválido' }, 400) }
  if (!['exam', 'prescription'].includes(kind)) return json({ error: 'Tipo inválido' }, 400)
  if (!path.startsWith(`${user.id}/`) || path.includes('..')) return json({ error: 'Arquivo inválido' }, 403)

  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const mediaType = MEDIA[ext]
  if (!mediaType) return json({ error: 'Envie PDF, JPG, PNG ou WEBP. Fotos HEIC do iPhone: tire print da tela ou exporte como JPG.' }, 400)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'IA não configurada' }, 503)

  // Exame: cria o registro já como "processando" para aparecer na lista.
  let examId: string | null = null
  if (kind === 'exam') {
    const { data, error } = await db.from('lab_exams')
      .insert({ owner_id: user.id, file_path: path, status: 'processando', title: 'Lendo exame…' })
      .select('id').single()
    if (error) { console.error('lab_exams insert', error.message); return json({ error: 'Não consegui registrar o exame.' }, 500) }
    examId = data.id
  }
  const fail = async (msg: string, status = 502) => {
    if (examId) await db.from('lab_exams').update({ status: 'falhou', error: msg, title: 'Exame não lido' }).eq('id', examId)
    return json({ error: msg, exam_id: examId }, status)
  }

  const { data: file, error: dlErr } = await db.storage.from(BUCKET).download(path)
  if (dlErr || !file) return await fail('Arquivo não encontrado. Envie de novo.', 404)
  const data = encodeBase64(new Uint8Array(await file.arrayBuffer()))
  const docBlock = mediaType === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data } }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2026-10-21', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: kind === 'exam' ? EXAM_SYSTEM : RX_SYSTEM,
      output_config: { format: { type: 'json_schema', schema: kind === 'exam' ? EXAM_SCHEMA : RX_SCHEMA } },
      messages: [{
        role: 'user',
        content: [docBlock, { type: 'text', text: kind === 'exam' ? 'Transcreva este exame.' : 'Transcreva esta receita.' }],
      }],
    }),
  })
  const body = await res.json()
  if (!res.ok) {
    console.error('health-doc-parse', res.status, body?.error?.message)
    return await fail('Não consegui ler o arquivo agora. Tente de novo em instantes.')
  }
  const block = body.content?.find((c: { type: string }) => c.type === 'text')
  let out
  try { out = JSON.parse(block?.text ?? '') } catch { return await fail('Não consegui entender o arquivo.') }

  if (kind === 'prescription') {
    if (!out.is_prescription) return json({ error: 'Não encontrei uma receita médica nesse arquivo.' }, 422)
    const medications = (out.medications ?? [])
      .filter((m: { name: string }) => str(m.name))
      .map((m: Record<string, unknown>) => ({
        name: str(m.name), dose: str(m.dose), frequency: str(m.frequency), route: str(m.route),
        duration_days: Number(m.duration_days) > 0 ? Math.round(Number(m.duration_days)) : null,
        instructions: str(m.instructions),
      }))
    return json({ prescribed_on: date(out.prescribed_on), prescriber: str(out.prescriber), medications, usage: body.usage })
  }

  if (!out.is_lab_exam) return await fail('Não encontrei resultados de exame nesse arquivo.', 422)
  const rows = (out.results ?? [])
    .filter((r: { marker: string }) => str(r.marker))
    .map((r: Record<string, unknown>, i: number) => {
      const value = r.is_numeric ? num(r.numeric_value) : null
      const value_text = value === null ? (str(r.text_value) ?? '—') : null
      return {
        exam_id: examId, owner_id: user.id, position: i,
        marker: str(r.marker), category: str(r.category), value, value_text, unit: str(r.unit),
        ref_low: num(r.ref_low), ref_high: num(r.ref_high), ref_text: str(r.ref_text),
        flag: ['baixo', 'normal', 'alto', 'alterado'].includes(String(r.flag)) ? r.flag : null,
      }
    })
  if (!rows.length) return await fail('Não encontrei resultados de exame nesse arquivo.', 422)

  const { error: insErr } = await db.from('lab_results').insert(rows)
  if (insErr) { console.error('lab_results insert', insErr.message); return await fail('Não consegui salvar os resultados.', 500) }
  await db.from('lab_exams').update({
    status: 'revisar', error: null,
    title: str(out.title) ?? 'Exame laboratorial',
    lab_name: str(out.lab_name),
    ...(date(out.collected_on) ? { collected_on: date(out.collected_on) } : {}),
  }).eq('id', examId)

  return json({ exam_id: examId, results: rows.length, usage: body.usage })
})
