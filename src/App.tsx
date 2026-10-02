import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './components/Login'
import MemberArea from './components/MemberArea'

function App() {
  const [session, setSession] = useState<Awaited<
    ReturnType<typeof supabase.auth.getSession>
  >['data']['session']>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadSession() {
      const { data, error } = await supabase.auth.getSession()
      if (error) {
        setError('Nepodařilo se načíst přihlášení.')
        console.error('Failed to load authentication:', error)
      }
      setSession(data.session)
      setLoading(false)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  async function handleLogout() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('Failed to sign out:', error)
      setError('Odhlášení se nezdařilo. Zkus to znovu.')
    }
  }

  if (loading) return <p role="status">Načítám přihlášení...</p>
  if (error) return (
    <div className="login-page"><div className="login-card">
      <p className="login-error" role="alert">{error}</p>
      <button className="button button-secondary" onClick={() => setError(null)}>Zpět</button>
    </div></div>
  )
  if (!session) {
    return <Login />
  }

  return (
    <MemberArea
      key={session.user.id}
      userId={session.user.id}
      email={session.user.email ?? ''}
      onLogout={handleLogout}
    />
  )
}

export default App