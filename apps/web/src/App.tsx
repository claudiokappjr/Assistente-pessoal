import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RedirectIfAuthed, RequireAuth } from './auth/guards'
import { AppLayout } from './components/AppLayout'
import { Alert, ComingSoon } from './components/ui'
import { supabaseConfigured } from './lib/supabase'
import { AdminAuditPage, AdminCatalogPage, AdminDashboardPage, AdminIntegrationsPage, AdminUsersPage } from './pages/admin/Admin'
import { DashboardPage } from './pages/app/Dashboard'
import { MyProfessionalsPage } from './pages/app/Professionals'
import { SettingsPage } from './pages/app/Settings'
import { BecomeProfessionalPage, ProClientsPage, ProDashboardPage, ProProfilePage } from './pages/pro/Pro'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/public/Auth'
import { LandingPage, LegalPage, ProfessionalsCatalogPage } from './pages/public/Landing'

const MODULE_PAGES: { path: string; title: string; phase: number }[] = [
  { path: 'agenda', title: 'Agenda', phase: 3 },
  { path: 'financas', title: 'Finanças', phase: 3 },
  { path: 'saude', title: 'Saúde', phase: 4 },
  { path: 'psicanalise', title: 'Psicanálise', phase: 4 },
  { path: 'nutricao', title: 'Nutrição', phase: 5 },
  { path: 'exercicios', title: 'Exercícios', phase: 5 },
  { path: 'ciclo', title: 'Ciclo menstrual', phase: 5 },
  { path: 'memorias', title: 'Insights e memórias', phase: 6 },
]

export default function App() {
  if (!supabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Alert>Configuração ausente: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY (veja apps/web/.env.example).</Alert>
      </div>
    )
  }
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/profissionais" element={<ProfessionalsCatalogPage />} />
          <Route path="/privacidade" element={<LegalPage kind="privacidade" />} />
          <Route path="/termos" element={<LegalPage kind="termos" />} />
          <Route path="/entrar" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="/cadastro" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
          <Route path="/esqueci-a-senha" element={<ForgotPasswordPage />} />
          <Route path="/nova-senha" element={<RequireAuth><ResetPasswordPage /></RequireAuth>} />

          <Route path="/app" element={<RequireAuth><AppLayout area="app" /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="caixa-de-entrada" element={<ComingSoon title="Caixa de entrada" phase={2}>Aqui chegarão as mensagens enviadas pelo app e pelo WhatsApp, já classificadas pela IA e aguardando sua confirmação.</ComingSoon>} />
            <Route path="assistente" element={<ComingSoon title="Assistente" phase={2}>O assistente vai receber texto, áudio, fotos e documentos e propor registros nos módulos certos.</ComingSoon>} />
            {MODULE_PAGES.map((m) => <Route key={m.path} path={m.path} element={<ComingSoon title={m.title} phase={m.phase} />} />)}
            <Route path="profissionais" element={<MyProfessionalsPage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route path="sou-profissional" element={<BecomeProfessionalPage />} />
          </Route>

          <Route path="/pro" element={<RequireAuth role="professional"><AppLayout area="pro" /></RequireAuth>}>
            <Route index element={<ProDashboardPage />} />
            <Route path="clientes" element={<ProClientsPage />} />
            <Route path="agenda" element={<ComingSoon title="Agenda profissional" phase={3} />} />
            <Route path="perfil" element={<ProProfilePage />} />
          </Route>

          <Route path="/admin" element={<RequireAuth role="admin"><AppLayout area="admin" /></RequireAuth>}>
            <Route index element={<AdminDashboardPage />} />
            <Route path="usuarios" element={<AdminUsersPage />} />
            <Route path="catalogo" element={<AdminCatalogPage />} />
            <Route path="integracoes" element={<AdminIntegrationsPage />} />
            <Route path="auditoria" element={<AdminAuditPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
