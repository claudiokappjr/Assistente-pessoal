// Cálculo das metas a partir de sexo, idade, peso, altura, nível de atividade
// e objetivo. Gasto em repouso pela equação de Mifflin-St Jeor; gasto total =
// repouso × fator de atividade. Limites de segurança: perda de no máximo ~1%
// do peso por semana, ganho de ~0,25%/semana, calorias nunca abaixo de
// 1.200 (mulheres) / 1.500 (homens), sem déficit para quem está abaixo do peso.

export type Sex = 'feminino' | 'masculino'
export type Activity = 'sedentario' | 'leve' | 'moderado' | 'alto' | 'muito_alto'
export type GoalType = 'perder_gordura' | 'perder_peso' | 'ganhar_massa' | 'recomposicao' | 'manter' | 'condicionamento'

export const ACTIVITY: { key: Activity; label: string; hint: string; factor: number }[] = [
  { key: 'sedentario', label: 'Sedentário', hint: 'Pouco ou nenhum exercício', factor: 1.2 },
  { key: 'leve', label: 'Leve', hint: 'Exercício 1 a 3 vezes por semana', factor: 1.375 },
  { key: 'moderado', label: 'Moderado', hint: 'Exercício 3 a 5 vezes por semana', factor: 1.55 },
  { key: 'alto', label: 'Alto', hint: 'Exercício intenso 6 a 7 vezes por semana', factor: 1.725 },
  { key: 'muito_alto', label: 'Muito alto', hint: 'Treino pesado diário ou trabalho físico', factor: 1.9 },
]
export const GOALS: { key: GoalType; label: string; hint: string; emoji: string }[] = [
  { key: 'perder_gordura', label: 'Perder gordura', hint: 'Emagrecer preservando músculo', emoji: '🔥' },
  { key: 'perder_peso', label: 'Perder peso', hint: 'Reduzir o peso na balança', emoji: '⚖️' },
  { key: 'ganhar_massa', label: 'Ganhar massa muscular', hint: 'Hipertrofia com pouco ganho de gordura', emoji: '💪' },
  { key: 'recomposicao', label: 'Recomposição', hint: 'Trocar gordura por músculo mantendo o peso', emoji: '🔄' },
  { key: 'manter', label: 'Manter o peso / saúde', hint: 'Comer bem e manter', emoji: '🌿' },
  { key: 'condicionamento', label: 'Condicionamento', hint: 'Mais fôlego e desempenho', emoji: '🏃' },
]

export interface CalcInput { sex: Sex; age: number; weight: number; height: number; activity: Activity; goal: GoalType; targetWeight?: number | null; weeks?: number | null }
export interface CalcResult {
  bmr: number; tdee: number; bmi: number; kcal: number; protein: number; carbs: number; fat: number; water: number
  weeklyMinutes: number; daysPerWeek: number; minutesMonth: number; daysMonth: number; kcalMonth: number
  weeks: number | null; targetWeight: number | null; ratePerWeek: number; projection: { week: number; weight: number }[]
  warnings: string[]; summary: string
}

const KCAL_PER_KG = 7700
const r10 = (n: number) => Math.round(n / 10) * 10

export function calculate(i: CalcInput): CalcResult {
  const warnings: string[] = []
  const h = i.height / 100
  const bmi = i.weight / (h * h)
  const bmr = 10 * i.weight + 6.25 * i.height - 5 * i.age + (i.sex === 'masculino' ? 5 : -161)
  const tdee = bmr * (ACTIVITY.find((a) => a.key === i.activity)?.factor ?? 1.2)
  const floor = i.sex === 'masculino' ? 1500 : 1200
  let goal = i.goal
  let target = i.targetWeight ?? null
  let weeks = i.weeks ?? null

  const losing = goal === 'perder_gordura' || goal === 'perder_peso'
  if (losing && bmi < 18.5) {
    warnings.push('Seu IMC está abaixo do adequado, então não calculamos déficit de calorias. Converse com um nutricionista ou médico.')
    goal = 'manter'; target = null
  }
  if (target != null && target / (h * h) < 18.5) {
    warnings.push(`O peso desejado (${target} kg) ficaria abaixo do IMC saudável (18,5). Usamos um ritmo sem meta de peso.`)
    target = null
  }
  if (losing && target != null && target >= i.weight) target = null
  if (goal === 'ganhar_massa' && target != null && target <= i.weight) target = null

  let kcal = tdee
  let rate = 0 // kg por semana (negativo = perder)
  if (goal === 'perder_gordura' || goal === 'perder_peso') {
    const maxRate = i.weight * (goal === 'perder_gordura' ? 0.0075 : 0.01)
    if (target != null) {
      const total = i.weight - target
      const minWeeks = Math.ceil(total / maxRate)
      if (!weeks || weeks < minWeeks) {
        if (weeks) warnings.push(`Para perder ${total.toFixed(1).replace('.', ',')} kg com segurança, o prazo mínimo é de ${minWeeks} semanas (~${Math.round(minWeeks / 4.3)} meses). Ajustamos o prazo.`)
        weeks = Math.max(minWeeks, weeks ?? 0)
      }
      rate = total / weeks
    } else {
      rate = Math.min(maxRate, (tdee * (goal === 'perder_gordura' ? 0.2 : 0.22) * 7) / KCAL_PER_KG)
    }
    let deficit = Math.min((rate * KCAL_PER_KG) / 7, tdee * 0.25, 1000)
    if (tdee - deficit < floor) {
      deficit = Math.max(0, tdee - floor)
      warnings.push(`Para não ficar abaixo de ${floor} kcal por dia, o ritmo foi reduzido; o exercício ajuda a acelerar.`)
    }
    kcal = tdee - deficit
    rate = -(deficit * 7) / KCAL_PER_KG
    if (target != null) weeks = Math.ceil((i.weight - target) / -rate)
  } else if (goal === 'ganhar_massa') {
    const maxRate = i.weight * 0.0025
    kcal = tdee + Math.min(tdee * 0.1, 350)
    rate = Math.min(maxRate, ((kcal - tdee) * 7) / KCAL_PER_KG)
    if (target != null) {
      const minWeeks = Math.ceil((target - i.weight) / maxRate)
      if (weeks && weeks < minWeeks) warnings.push(`Ganho de massa saudável é lento: para chegar a ${target} kg, o prazo realista é de ~${minWeeks} semanas (~${Math.round(minWeeks / 4.3)} meses).`)
      weeks = Math.max(minWeeks, weeks ?? 0)
    }
  } else if (goal === 'recomposicao') {
    kcal = tdee * 0.92
  }

  // Proteína pelo peso de referência (IMC > 30 usa o peso para IMC 27).
  const refW = bmi > 30 ? 27 * h * h : i.weight
  const pPerKg = { perder_gordura: 2.0, perder_peso: 1.6, ganhar_massa: 1.8, recomposicao: 2.0, manter: 1.4, condicionamento: 1.6 }[goal]
  const protein = Math.round(refW * pPerKg)
  const fat = Math.round(Math.max(0.8 * refW, (0.25 * kcal) / 9))
  const carbs = Math.max(80, Math.round((kcal - protein * 4 - fat * 9) / 4))

  const ex = {
    perder_gordura: [250, 5, 6], perder_peso: [210, 5, 5.5], ganhar_massa: [240, 4, 5], recomposicao: [240, 4, 5.5], manter: [150, 3, 5], condicionamento: [300, 5, 7],
  }[goal]
  const minutesMonth = Math.round((ex[0] * 30) / 7 / 10) * 10
  const daysMonth = Math.round(ex[1] * 4.3)
  const kcalMonth = r10((minutesMonth / 60) * ex[2] * i.weight)

  const projection: { week: number; weight: number }[] = []
  const horizon = weeks ?? (rate !== 0 ? 12 : 0)
  for (let w = 0; w <= horizon; w += Math.max(1, Math.round(horizon / 12))) projection.push({ week: w, weight: +(i.weight + rate * w).toFixed(1) })
  if (horizon && projection[projection.length - 1].week !== horizon) projection.push({ week: horizon, weight: +(i.weight + rate * horizon).toFixed(1) })

  const g = GOALS.find((x) => x.key === goal)!
  const summary = [
    `${g.label}: ${r10(kcal)} kcal/dia (gasto estimado ${r10(tdee)} kcal)`,
    rate !== 0 ? `${rate > 0 ? '+' : ''}${(rate).toFixed(2).replace('.', ',')} kg/semana` : 'peso estável',
    target != null && weeks ? `meta de ${target} kg em ~${weeks} semanas` : '',
  ].filter(Boolean).join(' · ')

  return {
    bmr: Math.round(bmr), tdee: Math.round(tdee), bmi: +bmi.toFixed(1), kcal: r10(kcal), protein, carbs, fat, water: r10(i.weight * 35),
    weeklyMinutes: ex[0], daysPerWeek: ex[1], minutesMonth, daysMonth, kcalMonth,
    weeks: target != null ? weeks : null, targetWeight: target, ratePerWeek: rate, projection, warnings, summary,
  }
}
