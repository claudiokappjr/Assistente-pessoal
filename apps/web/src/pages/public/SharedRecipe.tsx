import { ChefHat, Clock, Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthProvider'
import { Alert, Logo, Spinner, ThemeToggle } from '../../components/ui'
import { errorMessage, supabase } from '../../lib/supabase'
import { IngredientList, MEAL_LABEL, fmtNum, type MealType } from '../../modules/nutrition/NutritionPage'

interface PublicRecipe {
  title: string; meal_types: MealType[]; servings: number; prep_minutes: number | null; instructions: string | null
  ingredients: { name: string; quantity: number | null; unit: string | null }[]
}

/** Página aberta pelo link de compartilhamento (não precisa de conta para ver). */
export function SharedRecipePage() {
  const { token } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [recipe, setRecipe] = useState<PublicRecipe | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('get_shared_recipe', { _token: token ?? '' }).then(({ data }) => setRecipe((data as PublicRecipe | null) ?? null))
  }, [token])

  async function save() {
    setBusy(true); setError('')
    const { error } = await supabase.rpc('copy_recipe', { _recipe_id: null, _token: token })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    navigate('/app/nutricao?aba=receitas')
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link to="/"><Logo /></Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-16">
        {recipe === undefined && <Spinner className="size-6" />}
        {recipe === null && (
          <div className="card text-center">
            <ChefHat className="mx-auto size-8 text-stone-400" />
            <p className="mt-2 font-medium">Receita não encontrada</p>
            <p className="mt-1 text-sm text-stone-500">O link pode ter sido desligado por quem compartilhou.</p>
          </div>
        )}
        {recipe && (
          <article className="card">
            <p className="text-xs uppercase tracking-wide text-stone-500">{recipe.meal_types.map((m) => MEAL_LABEL[m]).join(' · ')}</p>
            <h1 className="mt-1 font-display text-3xl font-semibold">{recipe.title}</h1>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-stone-500">
              <span className="flex items-center gap-1"><Users className="size-4" /> rende {fmtNum(Number(recipe.servings))} porç{Number(recipe.servings) === 1 ? 'ão' : 'ões'}</span>
              {recipe.prep_minutes ? <span className="flex items-center gap-1"><Clock className="size-4" /> {recipe.prep_minutes} min</span> : null}
            </div>
            <h2 className="mt-6 mb-2 font-display text-lg font-semibold">Ingredientes</h2>
            <IngredientList items={recipe.ingredients} />
            {recipe.instructions && (
              <>
                <h2 className="mt-6 mb-2 font-display text-lg font-semibold">Modo de preparo</h2>
                <p className="whitespace-pre-wrap text-stone-700 dark:text-stone-300">{recipe.instructions}</p>
              </>
            )}
            <div className="mt-8 border-t border-stone-100 pt-5 dark:border-stone-800">
              {error && <div className="mb-3"><Alert>{error}</Alert></div>}
              {session ? (
                <button className="btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : <Plus className="size-4" />} Salvar nas minhas receitas</button>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/entrar" state={{ from: `/receita/${token}` }} className="btn-primary">Entrar para salvar</Link>
                  <Link to="/cadastro" className="btn-ghost">Criar conta</Link>
                </div>
              )}
            </div>
          </article>
        )}
      </main>
    </div>
  )
}
