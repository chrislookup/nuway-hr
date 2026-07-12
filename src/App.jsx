import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import Dashboard from './pages/Dashboard'
import CompleteDoc from './pages/CompleteDoc'
import Team from './pages/Team'
import EmployeeDetail from './pages/EmployeeDetail'
import NewHire from './pages/NewHire'
import SignedRecord from './pages/SignedRecord'
import Admin from './pages/Admin'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [recovery, setRecovery] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
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

  const tier = profile.tier
  const isMgr = tier === 'manager' || tier === 'admin'

  return (
    <HashRouter>
      <div className="app">
        <div className="sidebar">
          <div className="brand">NU<span>WAY</span> HR</div>
          <nav>
            <NavLink to="/" end>My Dashboard</NavLink>
            {isMgr && <NavLink to="/team">Team</NavLink>}
            {isMgr && <NavLink to="/new-hire">New Hire</NavLink>}
            {tier === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="whoami">{profile.first_name} {profile.last_name}<br />{tier.toUpperCase()}</div>
          <button className="secondary small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
        <div className="main">
          <Routes>
            <Route path="/" element={<Dashboard profile={profile} />} />
            <Route path="/doc/:assignmentId" element={<CompleteDoc profile={profile} />} />
            <Route path="/record/:assignmentId" element={<SignedRecord />} />
            {isMgr && <Route path="/team" element={<Team profile={profile} />} />}
            {isMgr && <Route path="/employee/:id" element={<EmployeeDetail profile={profile} />} />}
            {isMgr && <Route path="/new-hire" element={<NewHire profile={profile} />} />}
            {tier === 'admin' && <Route path="/admin/*" element={<Admin profile={profile} />} />}
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  )
}
