import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase, IS_RECOVERY } from './lib/supabase'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Mfa from './pages/Mfa'
import Dashboard from './pages/Dashboard'
import CompleteDoc from './pages/CompleteDoc'
import Team from './pages/Team'
import EmployeeDetail from './pages/EmployeeDetail'
import NewHire from './pages/NewHire'
import SignedRecord from './pages/SignedRecord'
import AssessDoc from './pages/AssessDoc'
import Admin from './pages/Admin'
import StoreSettings from './pages/StoreSettings'
import PreEmployment from './pages/PreEmployment'
import Library from './pages/Library'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [recovery, setRecovery] = useState(IS_RECOVERY)
  const [reload, setReload] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  const [mfa, setMfa] = useState(undefined) // undefined=checking, null=cleared, 'enroll'|'challenge'
  const [mfaReload, setMfaReload] = useState(0)

  useEffect(() => {
    if ((window.location.hash + window.location.search).includes('type=recovery')) setRecovery(true)
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session, reload])

  useEffect(() => {
    if (!profile) { setReviewCount(0); return }
    const isM = profile.tier === 'manager' || profile.tier === 'admin'
    if (!isM) { setReviewCount(0); return }
    supabase.from('assignments').select('id', { count: 'exact', head: true }).eq('status', 'awaiting_review')
      .then(({ count }) => setReviewCount(count || 0))
  }, [profile])

  // Two-factor gate: managers/admins must have 2FA; anyone with a factor must pass it
  useEffect(() => {
    if (!session || !profile) { setMfa(undefined); return }
    let alive = true
    supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data, error }) => {
      if (!alive) return
      if (error || !data) { setMfa(null); return } // fail open on transient error, don't lock everyone out
      const isMgr = profile.tier === 'manager' || profile.tier === 'admin'
      if (data.currentLevel === 'aal2') setMfa(null)
      else if (data.nextLevel === 'aal2') setMfa('challenge')
      else if (isMgr) setMfa('enroll')
      else setMfa(null)
    })
    return () => { alive = false }
  }, [session, profile, mfaReload])

  if (session === undefined) return null
  if (!session) return <Login />
  // Password reset link → force a new password before continuing
  if (recovery) return <SetPassword mode="reset" onDone={() => setRecovery(false)} />
  if (!profile) return null
  // First login after invite → force a password to be set
  if (profile.must_set_password) return <SetPassword mode="first" onDone={() => setReload(r => r + 1)} />
  // Past employees lose portal access (admins are never blocked)
  if (profile.status && profile.status !== 'active' && profile.tier !== 'admin') {
    return (
      <div className="login-wrap">
        <div className="card login-box" style={{ textAlign: 'center' }}>
          <h1>Access removed</h1>
          <p className="muted">Your access to the Nuway HR portal has been removed. If you believe this is a mistake, please contact your manager.</p>
          <button className="secondary small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </div>
    )
  }

  // Two-factor step (managers/admins enrol; anyone with 2FA verifies) before the portal loads
  if (mfa === undefined) return null
  if (mfa === 'enroll') return <Mfa mode="enroll" onDone={() => setMfaReload(r => r + 1)} />
  if (mfa === 'challenge') return <Mfa mode="challenge" onDone={() => setMfaReload(r => r + 1)} />

  const tier = profile.tier
  const isMgr = tier === 'manager' || tier === 'admin'

  return (
    <HashRouter>
      <div className="app">
        <div className="sidebar">
          <div className="brand">
            <img src={`${import.meta.env.BASE_URL}nuway-logo-white.png`} alt="Nuway Landscape Supplies" className="brand-logo" onError={e => { e.currentTarget.style.display = 'none' }} onLoad={e => { const t = e.currentTarget.parentElement.querySelector('.brand-text'); if (t) t.style.display = 'none' }} />
            <div className="brand-text">Nuway <span>HR</span></div>
          </div>
          <nav>
            <NavLink to="/" end>My Dashboard</NavLink>
            <NavLink to="/forms">Forms</NavLink>
            <NavLink to="/resources">Resources</NavLink>
            {isMgr && <NavLink to="/team">Team{reviewCount > 0 && <span className="navbadge">{reviewCount}</span>}</NavLink>}
            {isMgr && <NavLink to="/pre-employment">Pre-employment</NavLink>}
            {isMgr && <NavLink to="/new-hire">New Hire</NavLink>}
            {isMgr && <NavLink to="/store">Store</NavLink>}
            {tier === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="whoami">{profile.first_name} {profile.last_name}<br />{tier.toUpperCase()}</div>
          <button className="secondary small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <div className="main">
          <Routes>
            <Route path="/" element={<Dashboard profile={profile} />} />
            <Route path="/forms" element={<Library key="form" profile={profile} kind="form" />} />
            <Route path="/resources" element={<Library key="resource" profile={profile} kind="resource" />} />
            <Route path="/doc/:assignmentId" element={<CompleteDoc profile={profile} />} />
            <Route path="/record/:assignmentId" element={<SignedRecord />} />
            <Route path="/assess/:assignmentId" element={<AssessDoc profile={profile} />} />
            {isMgr && <Route path="/team" element={<Team profile={profile} />} />}
            {isMgr && <Route path="/employee/:id" element={<EmployeeDetail profile={profile} />} />}
            {isMgr && <Route path="/pre-employment" element={<PreEmployment profile={profile} />} />}
            {isMgr && <Route path="/new-hire" element={<NewHire profile={profile} />} />}
            {isMgr && <Route path="/store" element={<StoreSettings profile={profile} />} />}
            {tier === 'admin' && <Route path="/admin/*" element={<Admin profile={profile} />} />}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  )
}
