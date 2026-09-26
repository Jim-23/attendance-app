import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import Login from './components/Login'

function App() {
  const [session, setSession] = useState<Awaited<
    ReturnType<typeof supabase.auth.getSession>
  >['data']['session']>(null)

  useEffect(() => {
    async function loadSession() {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)
    }

    loadSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  if (!session) {
    return <Login />
  }

  return (
    <div>
      <h1>Attendance Dashboard</h1>
      <p>Logged in as: {session.user.email}</p>

      <button onClick={() => supabase.auth.signOut()}>
        Log out
      </button>
    </div>
  )
}

export default App