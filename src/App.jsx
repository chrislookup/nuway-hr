import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CompleteDoc from './pages/CompleteDoc'
import Team from './pages/Team'
import EmployeeDetail from './pages/EmployeeDetail'
import NewHire from './pages/NewHire'
import Admin from './pages/Admin'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setProfile(null); return }
    supabase.from('profiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setProfile(data))
  }, [session])

  if (session === undefined) return null
  if (!session) return <Login />
  if (!profile) return null

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
