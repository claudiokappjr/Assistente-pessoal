// Escalas de rastreio de uso livre (domínio público ou uso gratuito autorizado
// pelos autores): GAD-7 e PHQ-9 (Pfizer, domínio público), WHO-5 (OMS),
// AUDIT-C (OMS), FINDRISC (Finnish Diabetes Association) e EVA de dor.
// A pontuação oficial é calculada no banco (private.score_scale); aqui ficam
// o texto das perguntas e a explicação das faixas.

export type ScaleKey = 'gad7' | 'phq9' | 'who5' | 'auditc' | 'findrisc' | 'eva_dor'
export type ModuleKey = 'psicanalise' | 'saude'
export interface Option { label: string; value: number }
export interface Question { text: string; options?: Option[] }
export interface Band { upTo: number; key: string; label: string; tone: 'green' | 'lime' | 'amber' | 'orange' | 'red' }
export interface Scale {
  key: ScaleKey; name: string; title: string; about: string; stem?: string; minutes: number
  options?: Option[]; questions: Question[]; max: number; bands: Band[]; higherIsBetter?: boolean
  source: string; modules: ModuleKey[]; detail?: Record<string, string>
}

const FREQ: Option[] = [
  { label: 'Nenhuma vez', value: 0 }, { label: 'Vários dias', value: 1 },
  { label: 'Mais da metade dos dias', value: 2 }, { label: 'Quase todos os dias', value: 3 },
]

export const SCALES: Record<ScaleKey, Scale> = {
  gad7: {
    key: 'gad7', name: 'GAD-7', title: 'Ansiedade (GAD-7)', minutes: 2, modules: ['psicanalise', 'saude'],
    about: 'Rastreio de sintomas de ansiedade generalizada nas últimas 2 semanas.',
    stem: 'Nas últimas 2 semanas, com que frequência você foi incomodado(a) por:',
    options: FREQ, max: 21,
    questions: [
      'Sentir-se nervoso(a), ansioso(a) ou muito tenso(a)',
      'Não ser capaz de impedir ou de controlar as preocupações',
      'Preocupar-se muito com diversas coisas',
      'Dificuldade para relaxar',
      'Ficar tão agitado(a) que se torna difícil permanecer sentado(a)',
      'Ficar facilmente aborrecido(a) ou irritado(a)',
      'Sentir medo como se algo horrível fosse acontecer',
    ].map((text) => ({ text })),
    bands: [
      { upTo: 4, key: 'minimo', label: 'Mínimo', tone: 'green' },
      { upTo: 9, key: 'leve', label: 'Leve', tone: 'lime' },
      { upTo: 14, key: 'moderado', label: 'Moderado', tone: 'orange' },
      { upTo: 21, key: 'grave', label: 'Grave', tone: 'red' },
    ],
    detail: {
      minimo: 'Poucos sintomas ansiosos no período.',
      leve: 'Sintomas ansiosos leves. Vale observar como evoluem.',
      moderado: 'Sintomas ansiosos moderados. É recomendável conversar com um profissional.',
      grave: 'Sintomas ansiosos intensos. Procure um profissional de saúde mental.',
    },
    source: 'Spitzer et al., 2006. Domínio público.',
  },
  phq9: {
    key: 'phq9', name: 'PHQ-9', title: 'Humor / depressão (PHQ-9)', minutes: 3, modules: ['psicanalise', 'saude'],
    about: 'Rastreio de sintomas depressivos nas últimas 2 semanas.',
    stem: 'Nas últimas 2 semanas, com que frequência você foi incomodado(a) por:',
    options: FREQ, max: 27,
    questions: [
      'Pouco interesse ou pouco prazer em fazer as coisas',
      'Se sentir para baixo, deprimido(a) ou sem perspectiva',
      'Dificuldade para pegar no sono ou permanecer dormindo, ou dormir mais do que de costume',
      'Se sentir cansado(a) ou com pouca energia',
      'Falta de apetite ou comendo demais',
      'Se sentir mal consigo mesmo(a), ou achar que é um fracasso ou que decepcionou sua família ou a si mesmo(a)',
      'Dificuldade para se concentrar nas coisas, como ler ou ver televisão',
      'Lentidão para se movimentar ou falar a ponto de outras pessoas perceberem, ou o oposto: estar tão agitado(a) que fica andando de um lado para o outro mais do que de costume',
      'Pensar em se ferir de alguma maneira ou que seria melhor estar morto(a)',
    ].map((text) => ({ text })),
    bands: [
      { upTo: 4, key: 'minimo', label: 'Mínimo', tone: 'green' },
      { upTo: 9, key: 'leve', label: 'Leve', tone: 'lime' },
      { upTo: 14, key: 'moderado', label: 'Moderado', tone: 'amber' },
      { upTo: 19, key: 'moderadamente_grave', label: 'Moderadamente grave', tone: 'orange' },
      { upTo: 27, key: 'grave', label: 'Grave', tone: 'red' },
    ],
    detail: {
      minimo: 'Poucos sintomas depressivos no período.',
      leve: 'Sintomas leves. Vale observar como evoluem.',
      moderado: 'Sintomas moderados. É recomendável conversar com um profissional.',
      moderadamente_grave: 'Sintomas importantes. Procure um profissional de saúde.',
      grave: 'Sintomas intensos. Procure um profissional de saúde o quanto antes.',
    },
    source: 'Kroenke, Spitzer & Williams, 2001. Domínio público.',
  },
  who5: {
    key: 'who5', name: 'WHO-5', title: 'Bem-estar (WHO-5)', minutes: 1, modules: ['psicanalise', 'saude'], higherIsBetter: true,
    about: 'Índice de bem-estar geral nas últimas 2 semanas (quanto maior, melhor).',
    stem: 'Nas últimas 2 semanas:',
    options: [
      { label: 'Todo o tempo', value: 5 }, { label: 'A maior parte do tempo', value: 4 }, { label: 'Mais da metade do tempo', value: 3 },
      { label: 'Menos da metade do tempo', value: 2 }, { label: 'Algumas vezes', value: 1 }, { label: 'Nunca', value: 0 },
    ],
    max: 100,
    questions: [
      'Eu me senti alegre e bem-disposto(a)',
      'Eu me senti calmo(a) e relaxado(a)',
      'Eu me senti ativo(a) e com energia',
      'Acordei me sentindo descansado(a) e renovado(a)',
      'Meu dia a dia foi preenchido com coisas que me interessam',
    ].map((text) => ({ text })),
    bands: [
      { upTo: 28, key: 'muito_baixo', label: 'Bem-estar muito baixo', tone: 'red' },
      { upTo: 50, key: 'baixo', label: 'Bem-estar baixo', tone: 'amber' },
      { upTo: 100, key: 'adequado', label: 'Bem-estar adequado', tone: 'green' },
    ],
    detail: {
      muito_baixo: 'Bem-estar muito baixo. É recomendável uma avaliação com um profissional.',
      baixo: 'Bem-estar abaixo do esperado. Vale acompanhar e conversar com um profissional.',
      adequado: 'Bem-estar dentro do esperado.',
    },
    source: 'Organização Mundial da Saúde (1998). Uso livre.',
  },
  auditc: {
    key: 'auditc', name: 'AUDIT-C', title: 'Consumo de álcool (AUDIT-C)', minutes: 1, modules: ['saude'],
    about: 'Rastreio do consumo de risco de álcool. Uma dose ≈ 1 lata de cerveja, 1 taça de vinho ou 1 dose de destilado.',
    max: 12,
    questions: [
      { text: 'Com que frequência você toma bebidas alcoólicas?', options: [
        { label: 'Nunca', value: 0 }, { label: 'Mensalmente ou menos', value: 1 }, { label: '2 a 4 vezes por mês', value: 2 },
        { label: '2 a 3 vezes por semana', value: 3 }, { label: '4 ou mais vezes por semana', value: 4 }] },
      { text: 'Nas ocasiões em que bebe, quantas doses você costuma tomar?', options: [
        { label: '1 ou 2', value: 0 }, { label: '3 ou 4', value: 1 }, { label: '5 ou 6', value: 2 }, { label: '7 a 9', value: 3 }, { label: '10 ou mais', value: 4 }] },
      { text: 'Com que frequência você toma 6 ou mais doses em uma única ocasião?', options: [
        { label: 'Nunca', value: 0 }, { label: 'Menos de uma vez por mês', value: 1 }, { label: 'Mensalmente', value: 2 },
        { label: 'Semanalmente', value: 3 }, { label: 'Todos ou quase todos os dias', value: 4 }] },
    ],
    bands: [
      { upTo: 2, key: 'baixo', label: 'Baixo risco', tone: 'green' },
      { upTo: 3, key: 'atencao', label: 'Atenção', tone: 'amber' },
      { upTo: 12, key: 'positivo', label: 'Consumo de risco', tone: 'red' },
    ],
    detail: {
      baixo: 'Consumo de baixo risco.',
      atencao: 'Pontuação 3: considerada positiva para mulheres. Vale conversar com um profissional.',
      positivo: 'Indica consumo de risco (4 ou mais). Converse com um profissional de saúde.',
    },
    source: 'Bush et al., 1998, a partir do AUDIT (OMS). Uso livre.',
  },
  findrisc: {
    key: 'findrisc', name: 'FINDRISC', title: 'Risco de diabetes tipo 2 (FINDRISC)', minutes: 2, modules: ['saude'],
    about: 'Estima o risco de desenvolver diabetes tipo 2 nos próximos 10 anos.',
    max: 26,
    questions: [
      { text: 'Idade', options: [{ label: 'Menos de 45 anos', value: 0 }, { label: '45 a 54 anos', value: 2 }, { label: '55 a 64 anos', value: 3 }, { label: 'Mais de 64 anos', value: 4 }] },
      { text: 'Índice de massa corporal (IMC = peso ÷ altura²)', options: [{ label: 'Menor que 25', value: 0 }, { label: 'Entre 25 e 30', value: 1 }, { label: 'Maior que 30', value: 3 }] },
      { text: 'Circunferência da cintura (na altura do umbigo)', options: [
        { label: 'Homens: menos de 94 cm · Mulheres: menos de 80 cm', value: 0 },
        { label: 'Homens: 94 a 102 cm · Mulheres: 80 a 88 cm', value: 3 },
        { label: 'Homens: mais de 102 cm · Mulheres: mais de 88 cm', value: 4 }] },
      { text: 'Você pratica pelo menos 30 minutos de atividade física por dia (no trabalho ou no lazer)?', options: [{ label: 'Sim', value: 0 }, { label: 'Não', value: 2 }] },
      { text: 'Com que frequência você come verduras, legumes ou frutas?', options: [{ label: 'Todos os dias', value: 0 }, { label: 'Não todos os dias', value: 1 }] },
      { text: 'Já tomou remédio para pressão alta regularmente?', options: [{ label: 'Não', value: 0 }, { label: 'Sim', value: 2 }] },
      { text: 'Já teve glicose (açúcar no sangue) alta em exame, doença ou gravidez?', options: [{ label: 'Não', value: 0 }, { label: 'Sim', value: 5 }] },
      { text: 'Algum familiar teve diabetes (tipo 1 ou 2)?', options: [{ label: 'Não', value: 0 }, { label: 'Sim: avós, tios ou primos', value: 3 }, { label: 'Sim: pais, irmãos ou filhos', value: 5 }] },
    ],
    bands: [
      { upTo: 6, key: 'baixo', label: 'Risco baixo', tone: 'green' },
      { upTo: 11, key: 'levemente_elevado', label: 'Levemente elevado', tone: 'lime' },
      { upTo: 14, key: 'moderado', label: 'Moderado', tone: 'amber' },
      { upTo: 20, key: 'alto', label: 'Alto', tone: 'orange' },
      { upTo: 26, key: 'muito_alto', label: 'Muito alto', tone: 'red' },
    ],
    detail: {
      baixo: 'Risco estimado em 10 anos: cerca de 1 em 100.',
      levemente_elevado: 'Risco estimado em 10 anos: cerca de 1 em 25.',
      moderado: 'Risco estimado em 10 anos: cerca de 1 em 6. Converse com seu médico.',
      alto: 'Risco estimado em 10 anos: cerca de 1 em 3. Procure avaliação médica.',
      muito_alto: 'Risco estimado em 10 anos: cerca de 1 em 2. Procure avaliação médica.',
    },
    source: 'Lindström & Tuomilehto, 2003 (Finnish Diabetes Association). Uso livre.',
  },
  eva_dor: {
    key: 'eva_dor', name: 'EVA', title: 'Intensidade da dor (EVA)', minutes: 1, modules: ['saude'],
    about: 'Escala visual analógica de dor, de 0 (sem dor) a 10 (pior dor imaginável).',
    max: 10,
    questions: [{ text: 'De 0 a 10, qual a intensidade da sua dor agora?', options: Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: i })) }],
    bands: [
      { upTo: 0, key: 'sem_dor', label: 'Sem dor', tone: 'green' },
      { upTo: 3, key: 'leve', label: 'Dor leve', tone: 'lime' },
      { upTo: 6, key: 'moderada', label: 'Dor moderada', tone: 'amber' },
      { upTo: 10, key: 'intensa', label: 'Dor intensa', tone: 'red' },
    ],
    source: 'Escala visual analógica (EVA). Uso livre.',
  },
}

/** Especialidades e as escalas pertinentes a cada uma. */
export const SPECIALTIES: { key: string; name: string; scales: ScaleKey[] }[] = [
  { key: 'clinica_geral', name: 'Clínica geral / Medicina de família', scales: ['phq9', 'gad7', 'who5', 'auditc', 'findrisc', 'eva_dor'] },
  { key: 'psiquiatria', name: 'Psiquiatria', scales: ['phq9', 'gad7', 'who5', 'auditc'] },
  { key: 'psicologia', name: 'Psicologia', scales: ['gad7', 'phq9', 'who5'] },
  { key: 'psicanalise', name: 'Psicanálise', scales: ['gad7', 'phq9', 'who5'] },
  { key: 'endocrinologia', name: 'Endocrinologia', scales: ['findrisc'] },
  { key: 'cardiologia', name: 'Cardiologia', scales: ['findrisc', 'auditc'] },
  { key: 'nutricao', name: 'Nutrição', scales: ['findrisc'] },
  { key: 'ortopedia', name: 'Ortopedia / Fisioterapia / Reumatologia', scales: ['eva_dor'] },
]
/** Especialidade sugerida a partir do cadastro do profissional. */
export const SPECIALTY_FROM_PROFILE: Record<string, string> = {
  medicina: 'clinica_geral', psicologia: 'psicologia', psicanalise: 'psicanalise', nutricao: 'nutricao',
}

export const TONE: Record<Band['tone'], { bg: string; text: string; badge: string }> = {
  green: { bg: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  lime: { bg: 'bg-lime-400', text: 'text-lime-700 dark:text-lime-400', badge: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300' },
  amber: { bg: 'bg-amber-400', text: 'text-amber-700 dark:text-amber-400', badge: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  orange: { bg: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-400', badge: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  red: { bg: 'bg-red-500', text: 'text-red-700 dark:text-red-400', badge: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
}
export const bandOf = (scale: Scale, severity: string) => scale.bands.find((b) => b.key === severity) ?? scale.bands[0]
export const optionsFor = (s: Scale, i: number) => s.questions[i].options ?? s.options ?? []
