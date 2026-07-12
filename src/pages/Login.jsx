import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    setBusy(true); setErr(''); setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  async function forgot() {
    if (!email) { setErr('Enter your email first, then tap Forgot password.'); return }
    setErr(''); setMsg('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    if (error) setErr(error.message)
    else setMsg('Password reset email sent — check your inbox.')
  }

  return (
    <div className="login-wrap">
      <div className="card login-box">
        <h1 style={{ textAlign: 'center' }}>NU<span style={{ color: 'var(--green)' }}>WAY</span> HR</h1>
        <p className="muted" style={{ textAlign: 'center' }}>Training &amp; compliance portal</p>
        <form onSubmit={signIn}>
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          {err && <div className="error">{err}</div>}
          {msg && <div className="success">{msg}</div>}
          <button style={{ width: '100%', marginTop: 16 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 12 }}><a onClick={forgot} style={{ cursor: 'pointer' }}>Forgot password?</a></p>
      </div>
    </div>
  )
}
