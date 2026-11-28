import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RedirectIfAuthed, RequireAuth } from './auth/guards'
import { AppLayout } from './components/AppLayout'
import { Alert, ComingSoon } from './components/ui'
import { supabaseConfigured } from './lib/supabase'
import { AdminAuditPage, AdminCatalogPage, AdminDashboardPage, AdminIntegrationsPage, AdminUsersPage } from './pages/admin/Admin'
import { DashboardPage } from './pages/app/Dashboard'
import { AssistantPage, InboxPage } from './pages/app/Inbox'
import { MODULES } from './modules/config'
import { ModulePage } from './modules/ModulePage'
import { NutritionPage } from './modules/nutrition/NutritionPage'
import { MyProfessionalsPage } from './pages/app/Professionals'
import { SettingsPage } from './pages/app/Settings'
import { BecomeProfessionalPage, ProClientDetailPage, ProClientsPage, ProDashboardPage, ProProfilePage } from './pages/pro/Pro'
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/public/Auth'
import { LandingPage, LegalPage, ProfessionalsCatalogPage } from './pages/public/Landing'


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
            <Route path="caixa-de-entrada" element={<InboxPage />} />
            <Route path="assistente" element={<AssistantPage />} />
            {Object.values(MODULES).filter((m) => m.key !== 'nutricao').map((m) => <Route key={m.key} path={m.key} element={<ModulePage key={m.key} config={m} />} />)}
            <Route path="nutricao" element={<NutritionPage />} />
            <Route path="profissionais" element={<MyProfessionalsPage />} />
            <Route path="configuracoes" element={<SettingsPage />} />
            <Route path="sou-profissional" element={<BecomeProfessionalPage />} />
          </Route>

          <Route path="/pro" element={<RequireAuth role="professional"><AppLayout area="pro" /></RequireAuth>}>
            <Route index element={<ProDashboardPage />} />
            <Route path="clientes" element={<ProClientsPage />} />
            <Route path="clientes/:clientId" element={<ProClientDetailPage />} />
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
