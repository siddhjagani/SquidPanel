import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AuthProvider, useAuth } from '@/lib/auth'
import { ServersProvider } from '@/lib/servers'
import { ConfirmProvider, Spinner, TipProvider } from '@/components/ui'
import { Logo } from '@/components/domain'
import Shell from '@/components/Shell'
import AuthPage from '@/pages/Auth'
import Dashboard from '@/pages/Dashboard'
import ServerLayout from '@/pages/server/Layout'
import Overview from '@/pages/server/Overview'
import ConsolePage from '@/pages/server/Console'

const Players = lazy(() => import('@/pages/server/Players'))
const Files = lazy(() => import('@/pages/server/Files'))
const Addons = lazy(() => import('@/pages/server/Addons'))
const Worlds = lazy(() => import('@/pages/server/Worlds'))
const Backups = lazy(() => import('@/pages/server/Backups'))
const ServerSettings = lazy(() => import('@/pages/server/Settings'))
const ServerAccess = lazy(() => import('@/pages/server/Access'))
const Users = lazy(() => import('@/pages/Users'))
const ActivityPage = lazy(() => import('@/pages/Activity'))
const PanelSettings = lazy(() => import('@/pages/PanelSettings'))
const Account = lazy(() => import('@/pages/Account'))

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5">
      <div className="animate-float"><Logo size={44} withText={false} /></div>
      <Spinner />
    </div>
  )
}

function Authed() {
  const { isAdmin } = useAuth()
  return (
    <ServersProvider>
      <Shell>
        <Suspense fallback={<div className="flex h-64 items-center justify-center"><Spinner /></div>}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="servers/:id" element={<ServerLayout />}>
              <Route index element={<Overview />} />
              <Route path="console" element={<ConsolePage />} />
              <Route path="players" element={<Players />} />
              <Route path="files" element={<Files />} />
              <Route path="addons" element={<Addons />} />
              <Route path="worlds" element={<Worlds />} />
              <Route path="backups" element={<Backups />} />
              <Route path="settings" element={<ServerSettings />} />
              <Route path="access" element={<ServerAccess />} />
            </Route>
            {isAdmin && <Route path="users" element={<Users />} />}
            <Route path="activity" element={<ActivityPage />} />
            {isAdmin && <Route path="settings" element={<PanelSettings />} />}
            <Route path="account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Shell>
    </ServersProvider>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <AuthPage />
  return <Authed />
}

export default function App() {
  return (
    <TipProvider>
      <ConfirmProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{ classNames: { toast: '!bg-raised !border-line-strong !text-fg !rounded-xl !shadow-pop', description: '!text-muted' } }}
        />
      </ConfirmProvider>
    </TipProvider>
  )
}
