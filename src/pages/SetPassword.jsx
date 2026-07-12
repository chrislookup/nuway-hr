import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SetPassword({ mode = 'first', onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (pw.length < 8) { setErr('Please use at least 8 characters.'); return }
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) { setErr(error.message); setBusy(false); return }
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('profiles').update({ must_set_password: false }).eq('id', user.id)
    setBusy(false)
    if (onDone) onDone()
  }

  return (
    <div className="login-wrap">
      <div className="card login-box">
        <h1 style={{ textAlign: 'center' }}>NU<span style={{ color: 'var(--green)' }}>WAY</span> HR</h1>
        <p className="muted" style={{ textAlign: 'center' }}>
          {mode === 'reset'
            ? 'Choose a new password for your account.'
            : 'Welcome! Set a password to finish setting up your account.'}
        </p>
        <form onSubmit={submit}>
          <label>New password</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" required />
          <label>Confirm password</label>
          <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} autoComplete="new-password" required />
          {err && <div className="error">{err}</div>}
          <button style={{ width: '100%', marginTop: 16 }} disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      </div>
    </div>
  )
}
