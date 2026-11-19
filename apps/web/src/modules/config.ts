// Configuração declarativa de cada módulo: tabela, campos do formulário,
// como listar e como resumir. A tela genérica (ModulePage) lê daqui.

export type FieldType = 'text' | 'textarea' | 'money' | 'number' | 'date' | 'time' | 'datetime' | 'select' | 'tags' | 'checkbox'

export interface Field {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  /** Só aparece quando a condição sobre o registro em edição é verdadeira. */
  showIf?: (r: Row) => boolean
  half?: boolean
}

export type Row = Record<string, unknown> & { id: string; owner_id: string; source_draft_id?: string | null }

export interface ModuleConfig {
  key: string
  table: string
  title: string
  subtitle: string
  /** Coluna de data usada no filtro por mês e na ordenação. */
  dateKey: string
  dateIsTimestamp?: boolean
  ascending?: boolean
  fields: Field[]
  defaults: () => Record<string, unknown>
  primary: (r: Row) => string
  secondary: (r: Row) => string
  badge?: (r: Row) => { text: string; tone: 'green' | 'red' | 'amber' | 'stone' } | null
  amount?: (r: Row) => { text: string; tone: 'green' | 'red' | 'stone' } | null
  note?: string
}

export const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const money = (cents: unknown) => brl.format(Number(cents ?? 0) / 100)
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '')
const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '')
const join = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ')
export const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const nowLocal = () => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}
const timeOf = (iso: unknown) => typeof iso === 'string'
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : ''

export const MODULES: Record<string, ModuleConfig> = {
  financas: {
    key: 'financas', table: 'finance_transactions', title: 'Finanças', subtitle: 'Receitas, despesas e contas previstas.',
    dateKey: 'occurred_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'despesa', label: 'Despesa' }, { value: 'receita', label: 'Receita' }] },
      { key: 'status', label: 'Situação', type: 'select', required: true, half: true, options: [{ value: 'realizado', label: 'Realizado (já pago/recebido)' }, { value: 'previsto', label: 'Previsto (a pagar/receber)' }] },
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'amount_cents', label: 'Valor', type: 'money', required: true, half: true },
      { key: 'occurred_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'due_on', label: 'Vencimento', type: 'date', half: true, showIf: (r) => r.status === 'previsto' },
      { key: 'category', label: 'Categoria', type: 'text', half: true, placeholder: 'Ex.: Alimentação' },
      { key: 'payment_method', label: 'Forma de pagamento', type: 'text', half: true, placeholder: 'Pix, débito, crédito…' },
      { key: 'installments', label: 'Parcelas', type: 'number', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'despesa', status: 'realizado', occurred_on: todayISO() }),
    primary: (r) => String(r.description ?? ''),
    secondary: (r) => join(r.category as string, r.payment_method as string, r.status === 'previsto' && r.due_on ? `vence ${String(r.due_on).split('-').reverse().join('/')}` : null),
    amount: (r) => ({ text: `${r.kind === 'despesa' ? '−' : '+'} ${money(r.amount_cents)}`, tone: r.kind === 'despesa' ? 'red' : 'green' }),
    badge: (r) => (r.status === 'previsto' ? { text: r.kind === 'despesa' ? 'A pagar' : 'A receber', tone: 'amber' } : null),
    note: 'Importação de extratos (OFX/CSV), conciliação, patrimônio e investimentos chegam nas próximas versões do módulo.',
  },
  agenda: {
    key: 'agenda', table: 'agenda_events', title: 'Agenda', subtitle: 'Compromissos e lembretes.',
    dateKey: 'starts_at', dateIsTimestamp: true, ascending: true,
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'compromisso', label: 'Compromisso' }, { value: 'lembrete', label: 'Lembrete' }] },
      { key: 'starts_at', label: 'Data e hora', type: 'datetime', required: true, half: true },
      { key: 'title', label: 'Título', type: 'text', required: true },
      { key: 'duration_min', label: 'Duração (min)', type: 'number', half: true },
      { key: 'location', label: 'Local', type: 'text', half: true },
      { key: 'with_whom', label: 'Com quem', type: 'text' },
      { key: 'done', label: 'Concluído', type: 'checkbox' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'compromisso', starts_at: nowLocal() }),
    primary: (r) => String(r.title ?? ''),
    secondary: (r) => join(timeOf(r.starts_at), r.duration_min ? `${r.duration_min} min` : null, r.location as string, r.with_whom as string),
    badge: (r) => (r.done ? { text: 'Concluído', tone: 'stone' } : r.kind === 'lembrete' ? { text: 'Lembrete', tone: 'amber' } : null),
    note: 'Lembretes automáticos e integração com o Google Agenda chegam com a Fase 3.',
  },
  exercicios: {
    key: 'exercicios', table: 'exercise_logs', title: 'Exercícios', subtitle: 'Treinos e atividades realizadas.',
    dateKey: 'performed_on',
    fields: [
      { key: 'activity', label: 'Atividade', type: 'text', required: true, placeholder: 'Musculação, corrida…' },
      { key: 'performed_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'duration_min', label: 'Duração (min)', type: 'number', half: true },
      { key: 'distance_km', label: 'Distância (km)', type: 'number', half: true },
      { key: 'load_kg', label: 'Carga (kg)', type: 'number', half: true },
      { key: 'sets', label: 'Séries', type: 'number', half: true },
      { key: 'reps', label: 'Repetições', type: 'number', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ performed_on: todayISO() }),
    primary: (r) => String(r.activity ?? ''),
    secondary: (r) => join(r.duration_min != null && `${r.duration_min} min`, r.distance_km != null && `${r.distance_km} km`,
      r.sets != null && r.reps != null && `${r.sets}×${r.reps}`, r.load_kg != null && `${r.load_kg} kg`),
  },
  nutricao: {
    key: 'nutricao', table: 'food_logs', title: 'Nutrição', subtitle: 'Refeições e água. Valores estimados são aproximados.',
    dateKey: 'logged_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'refeicao', label: 'Refeição' }, { value: 'agua', label: 'Água' }] },
      { key: 'logged_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'meal', label: 'Refeição', type: 'text', half: true, placeholder: 'Café, almoço…', showIf: (r) => r.kind !== 'agua' },
      { key: 'logged_time', label: 'Horário', type: 'time', half: true },
      { key: 'items', label: 'Alimentos (separados por vírgula)', type: 'tags', showIf: (r) => r.kind !== 'agua' },
      { key: 'water_ml', label: 'Quantidade (ml)', type: 'number', showIf: (r) => r.kind === 'agua' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'refeicao', logged_on: todayISO() }),
    primary: (r) => (r.kind === 'agua' ? `Água${r.water_ml ? ` — ${r.water_ml} ml` : ''}` : String(r.meal ?? 'Refeição')),
    secondary: (r) => join(hhmm(r.logged_time), list(r.items)),
    note: 'Planos alimentares do nutricionista, foto do prato e estimativa de calorias chegam na Fase 5.',
  },
  saude: {
    key: 'saude', table: 'health_entries', title: 'Saúde', subtitle: 'Sintomas, medicamentos, consultas e exames.',
    dateKey: 'occurred_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'sintoma', label: 'Sintoma' }, { value: 'medicamento', label: 'Medicamento' }, { value: 'consulta', label: 'Consulta' }, { value: 'exame', label: 'Exame' }] },
      { key: 'occurred_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'intensity', label: 'Intensidade (0 a 10)', type: 'number', half: true, showIf: (r) => r.kind === 'sintoma' },
      { key: 'occurred_time', label: 'Horário', type: 'time', half: true },
      { key: 'medication', label: 'Medicamento', type: 'text', half: true, showIf: (r) => r.kind === 'medicamento' },
      { key: 'dose', label: 'Dose', type: 'text', half: true, showIf: (r) => r.kind === 'medicamento' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'sintoma', occurred_on: todayISO() }),
    primary: (r) => String(r.description ?? ''),
    secondary: (r) => join(hhmm(r.occurred_time), r.intensity != null && `intensidade ${r.intensity}/10`, r.medication as string, r.dose as string),
    badge: (r) => ({ text: ({ sintoma: 'Sintoma', medicamento: 'Medicamento', consulta: 'Consulta', exame: 'Exame' } as Record<string, string>)[String(r.kind)] ?? '', tone: 'stone' }),
    note: 'Registro pessoal, sem valor de diagnóstico. Upload de exames em PDF e prontuário profissional chegam na Fase 4.',
  },
  psicanalise: {
    key: 'psicanalise', table: 'psy_entries', title: 'Psicanálise', subtitle: 'Sonhos e insights, só seus — e de quem você autorizar.',
    dateKey: 'occurred_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'sonho', label: 'Sonho' }, { value: 'insight', label: 'Insight' }] },
      { key: 'occurred_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'content', label: 'Relato', type: 'textarea', required: true },
      { key: 'emotions', label: 'Emoções (separadas por vírgula)', type: 'tags' },
      { key: 'notes', label: 'Anotações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'sonho', occurred_on: todayISO() }),
    primary: (r) => String(r.content ?? '').slice(0, 140),
    secondary: (r) => list(r.emotions),
    badge: (r) => ({ text: r.kind === 'sonho' ? 'Sonho' : 'Insight', tone: 'stone' }),
    note: 'Análise de elementos dos sonhos, recorrências e sessões com o profissional chegam na Fase 4.',
  },
  ciclo: {
    key: 'ciclo', table: 'cycle_entries', title: 'Ciclo menstrual', subtitle: 'Menstruação e sintomas do ciclo.',
    dateKey: 'started_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'menstruacao', label: 'Menstruação' }, { value: 'sintoma_ciclo', label: 'Sintoma' }] },
      { key: 'started_on', label: 'Início', type: 'date', required: true, half: true },
      { key: 'ended_on', label: 'Fim', type: 'date', half: true, showIf: (r) => r.kind === 'menstruacao' },
      { key: 'flow', label: 'Fluxo', type: 'select', half: true, showIf: (r) => r.kind === 'menstruacao', options: [{ value: '', label: '—' }, { value: 'leve', label: 'Leve' }, { value: 'moderado', label: 'Moderado' }, { value: 'intenso', label: 'Intenso' }] },
      { key: 'symptoms', label: 'Sintomas (separados por vírgula)', type: 'tags' },
      { key: 'intensity', label: 'Intensidade (0 a 10)', type: 'number', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    defaults: () => ({ kind: 'menstruacao', started_on: todayISO() }),
    primary: (r) => (r.kind === 'menstruacao' ? 'Menstruação' : 'Sintoma do ciclo'),
    secondary: (r) => join(r.ended_on ? `até ${String(r.ended_on).split('-').reverse().join('/')}` : null, r.flow ? `fluxo ${r.flow}` : null, list(r.symptoms)),
    note: 'Previsões do próximo ciclo (sempre com indicação de incerteza) chegam na Fase 5. Não use como método contraceptivo.',
  },
  memorias: {
    key: 'memorias', table: 'memory_entries', title: 'Insights e memórias', subtitle: 'Ideias, notas e acontecimentos.',
    dateKey: 'occurred_on',
    fields: [
      { key: 'kind', label: 'Tipo', type: 'select', required: true, half: true, options: [{ value: 'nota', label: 'Nota' }, { value: 'ideia', label: 'Ideia' }, { value: 'acontecimento', label: 'Acontecimento' }] },
      { key: 'occurred_on', label: 'Data', type: 'date', required: true, half: true },
      { key: 'content', label: 'Texto', type: 'textarea', required: true },
      { key: 'tags', label: 'Tags (separadas por vírgula)', type: 'tags' },
      { key: 'pinned', label: 'Fixar no topo', type: 'checkbox' },
    ],
    defaults: () => ({ kind: 'nota', occurred_on: todayISO() }),
    primary: (r) => String(r.content ?? '').slice(0, 160),
    secondary: (r) => list(r.tags),
    badge: (r) => (r.pinned ? { text: 'Fixado', tone: 'green' } : { text: ({ nota: 'Nota', ideia: 'Ideia', acontecimento: 'Acontecimento' } as Record<string, string>)[String(r.kind)] ?? '', tone: 'stone' }),
    note: 'Busca por significado e resumos periódicos chegam na Fase 6.',
  },
}
