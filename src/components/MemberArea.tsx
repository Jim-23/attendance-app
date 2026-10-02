import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AdminDashboard = lazy(() => import('./AdminDashboard'))
const Dashboard = lazy(() => import('./Dashboard'))

interface MemberAreaProps {
  userId: string
  email: string
  onLogout: () => Promise<void>
}

function MemberArea({ userId, email, onLogout }: MemberAreaProps) {
  const [role, setRole] = useState<'user' | 'admin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adminView, setAdminView] = useState(false)

  const loadRole = useCallback(async () => {
    const { data, error } = await supabase.from('profiles')
      .select('role').eq('id', userId).single()
    if (error || (data?.role !== 'user' && data?.role !== 'admin')) {
      console.error('Failed to load user permissions:', error)
      setError('Nepodařilo se ověřit oprávnění účtu.')
      setRole(null)
      return
    }
    setError(null)
    setRole(data.role)
    if (data.role !== 'admin') setAdminView(false)
  }, [userId])

  useEffect(() => {
    void Promise.resolve().then(loadRole)
  }, [loadRole])

  if (error) return (
    <div className="login-page"><div className="login-card">
      <p className="login-error" role="alert">{error}</p>
      <button className="button button-secondary" onClick={loadRole}>Zkusit znovu</button>
      <button className="button button-secondary" onClick={onLogout}>Odhlásit</button>
    </div></div>
  )
  if (!role) return <p role="status">Ověřuji účet...</p>
  if (adminView && role === 'admin') return (
    <Suspense fallback={<p role="status">Načítám administraci...</p>}>
      <AdminDashboard onBack={() => setAdminView(false)} onRoleChange={loadRole} />
    </Suspense>
  )
  return (
    <Suspense fallback={<p role="status">Načítám docházku...</p>}>
      <Dashboard userId={userId} email={email} onLogout={onLogout}
        onOpenAdmin={role === 'admin' ? () => setAdminView(true) : undefined} />
    </Suspense>
  )
}

export default MemberArea
