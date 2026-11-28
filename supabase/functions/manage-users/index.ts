// Criação de contas pelo servidor.
//  - Admin: cria usuário final ou profissional já ativo (cortesia).
//  - Profissional: cadastra cliente dentro das vagas do plano; o cliente
//    ganha acesso patrocinado e decide depois o que o profissional pode ver.
// Não envia e-mail: devolve um link de primeiro acesso para ser enviado
// por WhatsApp ou e-mail pelo próprio admin/profissional.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://assistente-pessoal-pink.vercel.app'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Body {
  user_id?: string
  email?: string
  full_name?: string
  mode?: 'admin' | 'professional' | 'access_link'
  account_type?: 'user' | 'professional'
  plan_key?: string
  pro_modules?: string[]
  seats?: number | null
  /** Profissional: módulos que quer acompanhar (vira pedido de acesso ao cliente). */
  modules?: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: auth } = await db.auth.getUser(token ?? '')
  const caller = auth?.user
  if (!caller) return json({ error: 'Não autenticado' }, 401)

  let body: Body
  try { body = await req.json() } catch { return json({ error: 'Corpo inválido' }, 400) }

  // ------------------------------------------------------------ Link de acesso (conta existente)
  // Gera link para criar/redefinir senha sem depender de e-mail.
  // Admin: qualquer usuário. Profissional: apenas clientes vinculados a ele.
  if (body.mode === 'access_link') {
    if (!body.user_id) return json({ error: 'Usuário não informado' }, 400)
    const { data: r } = await db.from('user_roles').select('role').eq('user_id', caller.id)
    const admin = (r ?? []).some((x) => x.role === 'admin')
    if (!admin) {
      const { data: link } = await db.from('professional_client_links').select('id')
        .eq('professional_id', caller.id).eq('client_id', body.user_id).in('status', ['invited', 'active']).maybeSingle()
      if (!link) return json({ error: 'Acesso negado' }, 403)
    }
    const { data: target, error: uErr } = await db.auth.admin.getUserById(body.user_id)
    if (uErr || !target?.user?.email) return json({ error: 'Usuário não encontrado' }, 404)
    // Profissional: só primeiro acesso (não pode assumir conta em uso do cliente).
    // Admin: pode gerar redefinição para qualquer conta; fica na auditoria e no
    // histórico de privacidade da própria pessoa.
    const isReset = Boolean(target.user.last_sign_in_at)
    if (isReset && !admin) {
      return json({ error: 'Esta pessoa já acessou a conta. Para trocar a senha, ela usa "Configurações → Alterar senha" ou peça ao suporte.' }, 409)
    }
    const { data, error } = await db.auth.admin.generateLink({
      type: 'recovery',
      email: target.user.email,
      options: { redirectTo: `${SITE_URL}/nova-senha?boas-vindas=1` },
    })
    if (error) return json({ error: error.message }, 400)
    await db.from('audit_logs').insert({ actor_id: caller.id, subject_id: body.user_id, action: 'access_link', table_name: 'auth.users', record_id: body.user_id, changes: { motivo: isReset ? 'link de redefinição de senha gerado pelo administrador' : 'link de primeiro acesso gerado' } })
    return json({ ok: true, action_link: data.properties?.action_link, name: target.user.user_metadata?.full_name ?? target.user.email })
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const fullName = (body.full_name ?? '').trim()
  if (!EMAIL_RE.test(email)) return json({ error: 'E-mail inválido' }, 400)
  if (fullName.length < 2) return json({ error: 'Informe o nome completo' }, 400)

  const { data: roles } = await db.from('user_roles').select('role').eq('user_id', caller.id)
  const isAdmin = (roles ?? []).some((r) => r.role === 'admin')

  const { data: plans } = await db.from('plans').select('id, key, audience, limits').eq('is_active', true)
  const planByKey = (k: string) => (plans ?? []).find((p) => p.key === k)
  const individual = planByKey('individual')
  if (!individual) return json({ error: 'Plano Individual não configurado' }, 500)

  // Usuário já existe?
  const { data: existing } = await db.rpc('find_user_id_by_email', { _email: email })
  const existingId = (existing as string | null) ?? null

  async function createWithLink() {
    const { data, error } = await db.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { full_name: fullName }, redirectTo: `${SITE_URL}/nova-senha?boas-vindas=1` },
    })
    if (error || !data?.user) throw new Error(error?.message ?? 'Falha ao criar conta')
    return { userId: data.user.id, link: data.properties?.action_link as string }
  }

  // ------------------------------------------------------------ Admin
  if (body.mode === 'admin') {
    if (!isAdmin) return json({ error: 'Acesso negado' }, 403)
    if (existingId) return json({ error: 'Já existe uma conta com este e-mail. Ajuste o plano dela na lista de usuários.' }, 409)
    const accountType = body.account_type === 'professional' ? 'professional' : 'user'
    const plan = accountType === 'professional' ? planByKey(body.plan_key ?? 'pro_10') : individual
    if (!plan || (accountType === 'professional' && plan.audience !== 'professional')) return json({ error: 'Plano inválido' }, 400)

    const { data: mods } = await db.from('modules').select('key').eq('is_active', true)
    const validMods = new Set((mods ?? []).map((m) => m.key))
    const proModules = (body.pro_modules ?? []).filter((m) => validMods.has(m))

    let created
    try { created = await createWithLink() } catch (e) { return json({ error: (e as Error).message }, 400) }

    const { error: subErr } = await db.from('subscriptions').insert({
      user_id: created.userId, plan_id: plan.id, status: 'active', source: 'admin',
      pro_modules: accountType === 'professional' ? proModules : [], seats: body.seats ?? null,
      started_at: new Date().toISOString(), created_by: caller.id, notes: 'Criado pelo admin (cortesia)',
    })
    if (subErr) return json({ error: `Conta criada, mas falhou ao ativar o plano: ${subErr.message}` }, 500)
    if (accountType === 'professional') {
      await db.from('user_roles').upsert({ user_id: created.userId, role: 'professional', granted_by: caller.id })
      await db.from('professional_profiles').upsert({ user_id: created.userId, public_name: fullName, approved_at: new Date().toISOString(), approved_by: caller.id })
      // O plano profissional ativo já libera também os módulos pessoais.
    }
    return json({ ok: true, user_id: created.userId, action_link: created.link })
  }

  // ------------------------------------------------------------ Profissional
  if (body.mode === 'professional') {
    const { data: pp } = await db.from('professional_profiles').select('approved_at').eq('user_id', caller.id).maybeSingle()
    if (!pp?.approved_at) return json({ error: 'Seu cadastro profissional ainda não foi aprovado' }, 403)
    const { data: subs } = await db.from('subscriptions').select('seats, pro_modules, plans!inner(audience, limits)')
      .eq('user_id', caller.id).eq('status', 'active').eq('plans.audience', 'professional')
      .order('created_at', { ascending: false }).limit(1)
    const sub = subs?.[0] as unknown as { seats: number | null; pro_modules: string[] | null; plans: { limits: Record<string, number> } } | undefined
    if (!sub) return json({ error: 'Seu plano profissional não está ativo' }, 403)
    const seats = sub.seats ?? Number(sub.plans.limits?.clientes ?? 0)
    const { count } = await db.from('professional_client_links').select('id', { count: 'exact', head: true })
      .eq('professional_id', caller.id).in('status', ['invited', 'active'])
    if ((count ?? 0) >= seats) return json({ error: `Todas as ${seats} vagas do seu plano estão em uso` }, 409)

    // Pedido de acesso aos módulos escolhidos (só os do plano); o cliente decide.
    const wanted = [...new Set(body.modules ?? [])].filter((m) => (sub.pro_modules ?? []).includes(m))
    const requestAccess = async (clientId: string) => {
      if (!wanted.length) return 0
      const { error } = await db.from('consent_requests').insert(wanted.map((m) => ({ professional_id: caller.id, client_id: clientId, module_key: m })))
      if (error && error.code !== '23505') console.error('consent_requests', error.message)
      return error ? 0 : wanted.length
    }

    if (existingId) {
      if (existingId === caller.id) return json({ error: 'Este é o seu próprio e-mail' }, 400)
      const { error } = await db.from('professional_client_links').insert({ professional_id: caller.id, client_id: existingId, invited_by: caller.id })
      if (error) return json({ error: error.code === '23505' ? 'Este cliente já está vinculado a você' : error.message }, 409)
      const requested = await requestAccess(existingId)
      return json({ ok: true, existed: true, user_id: existingId, requested })
    }

    let created
    try { created = await createWithLink() } catch (e) { return json({ error: (e as Error).message }, 400) }
    // Paciente criado pelo próprio profissional já nasce vinculado; ele só escolhe o que compartilhar.
    const { error: linkErr } = await db.from('professional_client_links').insert({ professional_id: caller.id, client_id: created.userId, invited_by: caller.id, status: 'active', accepted_at: new Date().toISOString() })
    if (linkErr) return json({ error: `Conta criada, mas falhou o vínculo: ${linkErr.message}` }, 500)
    await db.from('subscriptions').insert({
      user_id: created.userId, plan_id: individual.id, status: 'active', source: 'professional',
      sponsor_id: caller.id, started_at: new Date().toISOString(), created_by: caller.id,
    })
    const requested = await requestAccess(created.userId)
    return json({ ok: true, user_id: created.userId, action_link: created.link, requested })
  }

  return json({ error: 'Modo inválido' }, 400)
})
