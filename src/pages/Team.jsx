import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

export default function Team({ profile }) {
  const [people, setPeople] = useState(null)
  const [reviews, setReviews] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [rej, setRej] = useState({ id: null, reason: '' })

  async function load() {
    const { data: profs } = await supabase.from('profiles')
      .select('*, employee_locations(locations(name)), employee_job_roles(job_roles(name))')
      .neq('id', profile.id).eq('status', 'active').order('first_name')
    const ids = (profs || []).map(p => p.id)
    let stats = {}
    if (ids.length) {
      const { data: asgs } = await supabase.from('assignments')
        .select('id, employee_id, status, due_date').in('employee_id', ids)
      for (const a of asgs || []) {
        stats[a.employee_id] = stats[a.employee_id] || { total: 0, done: 0, overdue: 0 }
        stats[a.employee_id].total++
        if (a.status === 'completed') stats[a.employee_id].done++
        else if (a.due_date && new Date(a.due_date) < new Date()) stats[a.employee_id].overdue++
      }
    }
    setPeople((profs || []).map(p => ({ ...p, stats: stats[p.id] || { total: 0, done: 0, overdue: 0 } })))

    const { data: rev } = await supabase.from('assignments')
      .select('*, documents(code, title), profiles!assignments_employee_id_fkey(first_name, last_name)')
      .eq('status', 'awaiting_review').order('completed_at', { ascending: false })
    setReviews(rev || [])
  }
  useEffect(() => { load() }, [])

  async function signOff(a) {
    setBusyId(a.id)
    await supabase.from('completions').update({ verified_by: profile.id, verified_at: new Date().toISOString() }).eq('assignment_id', a.id)
    await supabase.from('assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', a.id)
    await load()
    setBusyId(null)
  }

  async function reject(a) {
    if (!rej.reason.trim()) return
    setBusyId(a.id)
    await supabase.from('assignments').update({
      status: 'rejected', rejection_reason: rej.reason.trim(),
      reviewed_by: profile.id, reviewed_at: new Date().toISOString(), completed_at: null,
    }).eq('id', a.id)
    setRej({ id: null, reason: '' })
    await load(); setBusyId(null)
  }

  if (!people) return <p className="muted">Loading…</p>

  return (
    <div>
      <h1>Team</h1>
      {reviews.length > 0 && (
        <div className="card">
          <h2>Awaiting your sign-off ({reviews.length})</h2>
          <table><tbody>
            {reviews.map(a => (
              <tr key={a.id}>
                <td>{a.profiles?.first_name} {a.profiles?.last_name}</td>
                <td><b>{a.documents?.code}</b> {a.documents?.title}</td>
                <td className="muted">{fmtDate(a.completed_at)}</td>
                <td style={{ textAlign: 'right' }}>
                  {rej.id === a.id ? (
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <input autoFocus placeholder="Reason for returning…" value={rej.reason} onChange={e => setRej({ ...rej, reason: e.target.value })} style={{ width: 240 }} />
                      <button className="danger small" disabled={busyId === a.id || !rej.reason.trim()} onClick={() => reject(a)}>Confirm return</button>
                      <button className="secondary small" onClick={() => setRej({ id: null, reason: '' })}>Cancel</button>
                    </div>
                  ) : (
                    <>
                      <Link to={`/record/${a.id}`}><button className="secondary small">View completed</button></Link>{' '}
                      <button className="small" disabled={busyId === a.id} onClick={() => signOff(a)}>Sign off</button>{' '}
                      <button className="danger small" onClick={() => setRej({ id: a.id, reason: '' })}>Return</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      <div className="card">
        <h2>Employees ({people.length})</h2>
        <table>
          <thead><tr><th>Name</th><th>Location</th><th>Roles</th><th>Progress</th><th>Overdue</th><th /></tr></thead>
          <tbody>
            {people.map(p => (
              <tr key={p.id}>
                <td><Link to={`/employee/${p.id}`}>{p.first_name} {p.last_name}</Link></td>
                <td>{(p.employee_locations || []).map(l => l.locations?.name).join(', ') || '—'}</td>
                <td>{(p.employee_job_roles || []).map(r => r.job_roles?.name).join(', ') || '—'}</td>
                <td><div className="progressbar"><div style={{ width: `${p.stats.total ? p.stats.done / p.stats.total * 100 : 0}%` }} /></div>
                  <span className="muted">{p.stats.done}/{p.stats.total}</span></td>
                <td>{p.stats.overdue > 0 ? <span className="badge overdue">{p.stats.overdue}</span> : '—'}</td>
                <td style={{ textAlign: 'right' }}><Link to={`/employee/${p.id}`}><button className="secondary small">Open</button></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
