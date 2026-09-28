import { useState } from 'react'
import { supabase } from '../lib/supabase'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()

    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
    }

    setLoading(false)
  }

  return (
  <div className="login-page">
    <div className="login-card">
      <div className="login-header">
        <p className="login-eyebrow">ATTENDANCE APP</p>

        <h1>Vítejte zpět</h1>

        <p className="login-subtitle">
          Přihlaste se ke svému účtu
        </p>
      </div>

      <form className="login-form" onSubmit={handleLogin}>
        <div className="login-field">
          <label htmlFor="email">
            Email
          </label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>

        <div className="login-field">
          <label htmlFor="password">
            Heslo
          </label>

          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p className="login-error">
            {error}
          </p>
        )}

        <button
          className="button button-primary login-button"
          type="submit"
          disabled={loading}
        >
          {loading ? 'Přihlašování...' : 'Přihlásit se'}
        </button>
      </form>
    </div>
  </div>
)
}

export default Login