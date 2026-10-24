import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { FullAccessRoute } from '@/components/auth/FullAccessRoute'
import { Toaster } from '@/components/ui/toaster'
import Login from '@/pages/Login'
import Signup from '@/pages/Signup'
import ForgotPassword from '@/pages/ForgotPassword'
import LandingPage from '@/pages/LandingPage'
import ModelPage from '@/pages/model'
import ScenariosPage from '@/pages/scenarios'
import BaselinePage from '@/pages/baseline'
import SimulatePage from '@/pages/simulate'
import ResultsPage from '@/pages/results'

function HomeRoute() {
  const { user, isGuest, loading } = useAuth();
  if (loading) return null;
  if (user || isGuest) {
    return <Navigate to="/model" replace />;
  }
  return <LandingPage />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/app" element={<Navigate to="/model" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />

        {/* In-app routes with AppLayout and route protections */}
        <Route
          path="/model"
          element={
            <ProtectedRoute>
              <AppLayout>
                <div className="layout-route-shell flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <ModelPage />
                </div>
              </AppLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/scenarios"
          element={
            <FullAccessRoute>
              <AppLayout>
                <div className="layout-route-shell flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <ScenariosPage />
                </div>
              </AppLayout>
            </FullAccessRoute>
          }
        />
        <Route
          path="/baseline"
          element={
            <FullAccessRoute>
              <AppLayout>
                <div className="layout-route-shell flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <BaselinePage />
                </div>
              </AppLayout>
            </FullAccessRoute>
          }
        />
        <Route
          path="/simulate"
          element={
            <FullAccessRoute>
              <AppLayout>
                <div className="layout-route-shell flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <SimulatePage />
                </div>
              </AppLayout>
            </FullAccessRoute>
          }
        />
        <Route
          path="/results"
          element={
            <FullAccessRoute>
              <AppLayout>
                <div className="layout-route-shell flex flex-1 flex-col min-h-0 min-w-0 w-full overflow-hidden">
                  <ResultsPage />
                </div>
              </AppLayout>
            </FullAccessRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </Router>
  )
}

export default App
