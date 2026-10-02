import { useState } from 'react'
import { supabase } from '../lib/supabase'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)
  const [fullName, setFullName] = useState('')
  const [registrationKey, setRegistrationKey] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault()

    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (registering) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              registration_key: registrationKey.trim(),
            },
          },
        })
        if (error) {
          setError(
            'Registrace se nezdařila. Ověř platnost klíče, e-mail a heslo. Pokud problém trvá, kontaktuj administrátora.',
          )
          console.error('Registration failed:', error.code)
        } else if (!data.session) {
          setMessage('Registrace přijata. Zkontroluj e-mail a potvrď svůj účet. Pokud potvrzení nepřijde, kontaktuj administrátora.')
          setPassword('')
          setRegistrationKey('')
          setRegistering(false)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) {
          setError(error.message)
        }
      }
    } catch (error) {
      console.error('Authentication request failed:', error)
      setError('Nepodařilo se spojit se serverem. Zkus to znovu.')
    } finally {
      setLoading(false)
    }
  }

  return (
  <div className="login-page">
    <div className="login-card">
      <div className="login-header">
        <p className="login-eyebrow">ATTENDANCE APP</p>

        <h1>{registering ? 'Registrace' : 'Vítejte zpět'}</h1>

        <p className="login-subtitle">
          {registering ? 'Vytvoř účet pomocí pozvánky od administrátora' : 'Přihlaste se ke svému účtu'}
        </p>
      </div>

      <form className="login-form" onSubmit={handleLogin}>
        {registering && (
          <div className="login-field">
            <label htmlFor="full-name">Jméno</label>
            <input id="full-name" value={fullName} autoComplete="name"
              onChange={(event) => setFullName(event.target.value)} required disabled={loading} />
          </div>
        )}
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
            disabled={loading}
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
            autoComplete={registering ? 'new-password' : 'current-password'}
            minLength={registering ? 8 : undefined}
            disabled={loading}
          />
        </div>

        {registering && (
          <div className="login-field">
            <label htmlFor="registration-key">Registrační klíč</label>
            <input id="registration-key" type="password" value={registrationKey}
              onChange={(event) => setRegistrationKey(event.target.value)}
              required minLength={64} maxLength={64} autoComplete="off" disabled={loading} />
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="button button-primary login-button"
          type="submit"
          disabled={loading}
        >
          {loading ? 'Čekej prosím...' : registering ? 'Registrovat se' : 'Přihlásit se'}
        </button>
        <button className="button button-secondary" type="button" disabled={loading}
          onClick={() => {
            setRegistering((value) => !value)
            setError(null)
            setMessage(null)
            setRegistrationKey('')
            setPassword('')
          }}>
          {registering ? 'Zpět na přihlášení' : 'Mám registrační klíč'}
        </button>
      </form>
    </div>
  </div>
)
}

export default Login