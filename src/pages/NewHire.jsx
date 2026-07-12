import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function NewHire({ profile }) {
  const [locations, setLocations] = useState([])
  const [roles, setRoles] = useState([])
  const [f, setF] = useState({
    first_name: '', last_name: '', email: '', mobile: '', employment_type: 'casual',
    date_of_birth: '', start_date: new Date().toISOString().slice(0, 10),
    commencement_approved_by: '', locations: [], roles: [],
  })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('locations').select('*').eq('active', true).order('name').then(({ data }) => setLocations(data || []))
    supabase.from('job_roles').select('*').eq('active', true).order('name').then(({ data }) => setRoles(data || []))
  }, [])

  function toggle(key, id) {
    const cur = f[key]
    setF({ ...f, [key]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] })
  }

  async function submit(e) {
    e.preventDefault()
    setErr(''); setOk('')
    if (!f.roles.length || !f.locations.length) { setErr('Pick at least one role and one location.'); return }
    if (!f.commencement_approved_by) { setErr('Commencement approval is required.'); return }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('create-employee', { body: f })
    if (error || data?.error) setErr(data?.error || error.message || 'Failed — is the create-employee function deployed?')
    else setOk(`${f.first_name} created — ${data.assigned} documents assigned. They'll get an invite email to set their password.`)
    setBusy(false)
  }

  return (
    <div>
      <h1>New hire</h1>
      <p className="muted">Creates the employee, sends their login invite, and auto-assigns every required document for their role(s) and location(s).</p>
      <form onSubmit={submit} className="card" style={{ maxWidth: 640 }}>
        <div className="row">
          <div style={{ flex: 1 }}><label>First name</label><input required value={f.first_name} onChange={e => setF({ ...f, first_name: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Last name</label><input required value={f.last_name} onChange={e => setF({ ...f, last_name: e.target.value })} /></div>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}><label>Email</label><input type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Mobile (+61…)</label><input value={f.mobile} onChange={e => setF({ ...f, mobile: e.target.value })} /></div>
        </div>
        <div className="row">
          <div style={{ flex: 1 }}><label>Employment type</label>
            <select value={f.employment_type} onChange={e => setF({ ...f, employment_type: e.target.value })}>
              <option value="casual">Casual</option><option value="part_time">Part-time</option>
              <option value="full_time">Full-time</option><option value="salary">Salary</option>
            </select></div>
          <div style={{ flex: 1 }}><label>Date of birth</label><input type="date" value={f.date_of_birth} onChange={e => setF({ ...f, date_of_birth: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Start date</label><input type="date" required value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /></div>
        </div>
        <label>Role(s)</label>
        <div className="checkgrid">
          {roles.map(r => <label key={r.id}><input type="checkbox" checked={f.roles.includes(r.id)} onChange={() => toggle('roles', r.id)} />{r.name}</label>)}
        </div>
        <label>Location(s)</label>
        <div className="checkgrid">
          {locations.map(l => <label key={l.id}><input type="checkbox" checked={f.locations.includes(l.id)} onChange={() => toggle('locations', l.id)} />{l.name}</label>)}
        </div>
        <label>Commencement approved by</label>
        <select value={f.commencement_approved_by} onChange={e => setF({ ...f, commencement_approved_by: e.target.value })}>
          <option value="">— select —</option>
          <option>Steve Myatt</option>
          <option>Chris Haddon</option>
        </select>
        {err && <div className="error">{err}</div>}
        {ok && <div className="success">{ok}</div>}
        <button style={{ marginTop: 16 }} disabled={busy}>{busy ? 'Creating…' : 'Create employee & assign documents'}</button>
      </form>
    </div>
  )
}
