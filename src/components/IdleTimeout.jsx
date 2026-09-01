import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

// Signs a user out after a period of inactivity — stores share devices, and licence
// scans and personal details shouldn't sit on an unattended screen. A warning appears
// first so nobody loses what they're part-way through without a chance to stay in.
const ACTIVITY = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'pointerdown']

export default function IdleTimeout({ profile }) {
  const [cfg, setCfg] = useState(null)
  const [left, setLeft] = useState(null)   // seconds remaining in the warning, or null
  const last = useRef(Date.now())
  const warned = useRef(false)

  useEffect(() => {
    supabase.from('app_settings').select('*').eq('id', 1).single()
      .then(({ data }) => setCfg(data))
  }, [])

  useEffect(() => {
    if (!cfg?.idle_enabled) return
    const privileged = profile.tier === 'admin' || profile.tier === 'manager'
    const limitMs = (privileged ? cfg.idle_minutes_privileged : cfg.idle_minutes) * 60000
    const warnMs = cfg.idle_warn_seconds * 1000

    const bump = () => { last.current = Date.now(); if (warned.current) { warned.current = false; setLeft(null) } }
    for (const e of ACTIVITY) window.addEventListener(e, bump, { passive: true })
    // clicking into an embedded PDF blurs the page — that's still the person working
    const onBlur = () => { if (document.activeElement?.tagName === 'IFRAME') bump() }
    window.addEventListener('blur', onBlur)

    const tick = setInterval(() => {
      const idle = Date.now() - last.current
      if (idle >= limitMs) {
        clearInterval(tick)
        supabase.auth.signOut()
        return
      }
      if (idle >= limitMs - warnMs) {
        warned.current = true
        setLeft(Math.ceil((limitMs - idle) / 1000))
      }
    }, 1000)

    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, bump)
      window.removeEventListener('blur', onBlur)
      clearInterval(tick)
    }
  }, [cfg, profile.tier])

  if (left === null) return null

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,30,25,.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{ maxWidth: 420, margin: 0, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Still there?</h2>
        <p>You'll be signed out in <b>{left}</b> second{left === 1 ? '' : 's'} because the screen has been idle.</p>
        <p className="muted" style={{ fontSize: 13 }}>Anything you've typed but not submitted won't be saved.</p>
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button onClick={() => { last.current = Date.now(); warned.current = false; setLeft(null) }}>Stay signed in</button>
          <button className="secondary" onClick={() => supabase.auth.signOut()}>Sign out now</button>
        </div>
      </div>
    </div>
  )
}
