import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'

export default function EmployeeDetail({ profile }) {
  const { id } = useParams()
  const [emp, setEmp] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [licences, setLicences] = useState([])
  const [docs, setDocs] = useState([])
  const [licTypes, setLicTypes] = useState([])
  const [addDoc, setAddDoc] = useState('')
  const [lic, setLic] = useState({ licence_type_id: '', licence_number: '', expiry_date: '' })
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: e } = await supabase.from('profiles')
      .select('*, employee_locations(locations(name)), employee_job_roles(job_roles(name))').eq('id', id).single()
    setEmp(e)
    const { data: a } = await supabase.from('assignments')
      .select('*, documents(code, title, document_categories(name))')
      .eq('employee_id', id).order('due_date', { nullsFirst: false })
    setAssignments(a || [])
    const { data: l } = await supabase.from('licences').select('*, licence_types(name)').eq('employee_id', id).eq('active', true)
    setLicences(l || [])
    const { data: d } = await supabase.from('documents').select('id, code, title').eq('active', true).order('code')
    setDocs(d || [])
    const { data: lt } = await supabase.from('licence_types').select('*').order('name')
    setLicTypes(lt || [])
  }
  useEffect(() => { load() }, [id])

  async function assign() {
    if (!addDoc) return
    const { error } = await supabase.from('assignments').insert({
      employee_id: id, document_id: addDoc, source: 'manual', assigned_by: profile.id,
      due_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    })
    setMsg(error ? error.message : 'Assigned.')
    setAddDoc(''); load()
  }
  async function addLicence() {
    if (!lic.licence_type_id) return
    const { error } = await supabase.from('licences').insert({ ...lic, expiry_date: lic.expiry_date || null, employee_id: id, verified_by: profile.id, verified_at: new Date().toISOString() })
    setMsg(error ? error.message : 'Licence added.')
    setLic({ licence_type_id: '', licence_number: '', expiry_date: '' }); load()
  }

  if (!emp) return <p className="muted">Loading…</p>
  const byCat = {}
  for (const a of assignments) {
    const c = a.documents?.document_categories?.name || 'Other'
    ;(byCat[c] = byCat[c] || []).push(a)
  }

  return (
    <div>
      <Link to="/team">&larr; Team</Link>
      <h1>{emp.first_name} {emp.last_name}</h1>
      <p className="muted">
        {(emp.employee_job_roles || []).map(r => r.job_roles?.name).join(', ')} ·{' '}
        {(emp.employee_locations || []).map(l => l.locations?.name).join(', ')} ·{' '}
        started {fmtDate(emp.start_date)} · {emp.email} · {emp.mobile || 'no mobile'}
      </p>
      {msg && <div className="success">{msg}</div>}

      <div className="card">
        <div className="row between">
          <h2>Training matrix</h2>
          <div className="row">
            <select value={addDoc} onChange={e => setAddDoc(e.target.value)} style={{ width: 320 }}>
              <option value="">+ Assign extra document…</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
            </select>
            <button className="small" onClick={assign} disabled={!addDoc}>Assign</button>
          </div>
        </div>
        {Object.entries(byCat).map(([cat, list]) => (
          <div key={cat} style={{ marginTop: 14 }}>
            <h3>{cat}</h3>
            <table><tbody>
              {list.map(a => (
                <tr key={a.id}>
                  <td><b>{a.documents?.code}</b> {a.documents?.title}</td>
                  <td className="muted">due {fmtDate(a.due_date)}</td>
                  <td><StatusBadge assignment={a} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        {assignments.length === 0 && <p className="muted">No assignments yet.</p>}
      </div>

      <div className="card">
        <h2>Licences</h2>
        <table><tbody>
          {licences.map(l => (
            <tr key={l.id}><td>{l.licence_types?.name}</td><td>{l.licence_number || '—'}</td><td>{fmtDate(l.expiry_date)}</td></tr>
          ))}
        </tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <select style={{ width: 220 }} value={lic.licence_type_id} onChange={e => setLic({ ...lic, licence_type_id: e.target.value })}>
            <option value="">+ Add licence…</option>
            {licTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input style={{ width: 160 }} placeholder="Number" value={lic.licence_number} onChange={e => setLic({ ...lic, licence_number: e.target.value })} />
          <input style={{ width: 160 }} type="date" value={lic.expiry_date} onChange={e => setLic({ ...lic, expiry_date: e.target.value })} />
          <button className="small" onClick={addLicence} disabled={!lic.licence_type_id}>Add</button>
        </div>
      </div>
    </div>
  )
}
