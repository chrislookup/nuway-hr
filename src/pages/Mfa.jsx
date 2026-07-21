import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Two-factor (TOTP) screen. mode = 'enroll' (first-time setup, shows QR) or 'challenge' (enter code).
export default function Mfa({ mode = 'challenge', onDone }) {
  const [factorId, setFactorId] = useState(null)
  const [qr, setQr] = useState(null)
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setErr('')
      try {
        if (mode === 'enroll') {
          // clear any half-finished (unverified) factors so enroll doesn't clash
          const { data: list } = await supabase.auth.mfa.listFactors()
          for (const f of (list?.all || []).filter(f => f.status === 'unverified')) {
            await supabase.auth.mfa.unenroll({ factorId: f.id })
          }
          const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator ' + Date.now() })
          if (error) throw error
          if (!alive) return
          setFactorId(data.id); setQr(data.totp.qr_code); setSecret(data.totp.secret); setReady(true)
        } else {
          const { data: list, error } = await supabase.auth.mfa.listFactors()
          if (error) throw error
          const f = (list?.totp || [])[0]
          if (!f) { setErr('No authenticator is set up on this account.'); return }
          if (!alive) return
          setFactorId(f.id); setReady(true)
        }
      } catch (e) { if (alive) setErr(e.message || String(e)) }
    })()
    return () => { alive = false }
  }, [mode])

  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!factorId) return
    setBusy(true)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
    setBusy(false)
    if (error) { setErr('That code was not accepted. Check your authenticator app and try again.'); return }
    onDone && onDone()
  }

  return (
    <div className="login-wrap">
      <div className="card login-box">
        <h1 style={{ textAlign: 'center' }}>NU<span style={{ color: 'var(--green)' }}>WAY</span> HR</h1>
        {mode === 'enroll' ? (
          <>
            <h2 style={{ textAlign: 'center', marginTop: 0 }}>Set up two-factor authentication</h2>
            <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>
              Manager and admin accounts are protected with a second step. Scan this code with an authenticator app
              (Google Authenticator, Microsoft Authenticator, Authy…), then enter the 6-digit code it shows.
            </p>
            {qr && <div style={{ textAlign: 'center', margin: '10px 0' }}><img src={qr} alt="Scan this QR code" style={{ width: 190, height: 190 }} /></div>}
            {secret && <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>Can’t scan? Enter this key manually:<br /><code style={{ fontSize: 13, letterSpacing: 1 }}>{secret}</code></p>}
          </>
        ) : (
          <>
            <h2 style={{ textAlign: 'center', marginTop: 0 }}>Enter your verification code</h2>
            <p className="muted" style={{ textAlign: 'center', fontSize: 13 }}>Open your authenticator app and enter the current 6-digit code for Nuway HR.</p>
          </>
        )}
        <form onSubmit={submit}>
          <label>6-digit code</label>
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))}
            style={{ letterSpacing: 6, textAlign: 'center', fontSize: 22 }} placeholder="••••••" required />
          {err && <div className="error">{err}</div>}
          <button style={{ width: '100%', marginTop: 14 }} disabled={busy || !ready || code.length < 6}>
            {busy ? 'Verifying…' : mode === 'enroll' ? 'Verify & turn on' : 'Verify'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 12 }}>
          <a onClick={() => supabase.auth.signOut()} style={{ cursor: 'pointer', fontSize: 13 }}>Sign out</a>
        </p>
      </div>
    </div>
  )
}
