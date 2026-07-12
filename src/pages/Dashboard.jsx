import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate, isOverdue } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'

export default function Dashboard({ profile }) {
  const [assignments, setAssignments] = useState(null)
  const [licences, setLicences] = useState([])

  useEffect(() => {
    supabase.from('assignments')
      .select('*, documents(id, code, title, doc_type, requires_signature, category_id, document_categories(name))')
      .eq('employee_id', profile.id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => setAssignments(data || []))
    supabase.from('licences')
      .select('*, licence_types(name)')
      .eq('employee_id', profile.id).eq('active', true)
      .then(({ data }) => setLicences(data || []))
  }, [profile.id])

  if (!assignments) return <p className="muted">Loading…</p>

  const done = assignments.filter(a => a.status === 'completed').length
  const overdue = assignments.filter(isOverdue).length
  const awaiting = assignments.filter(a => a.status === 'awaiting_review').length
  const open = assignments.filter(a => !['completed', 'expired'].includes(a.status))
  const pct = assignments.length ? Math.round(done / assignments.length * 100) : 0

  // training matrix: group by category
  const byCat = {}
  for (const a of assignments) {
    const cat = a.documents?.document_categories?.name || 'Other'
    byCat[cat] = byCat[cat] || { total: 0, done: 0 }
    byCat[cat].total++
    if (a.status === 'completed') byCat[cat].done++
  }

  return (
    <div>
      <h1>G'day, {profile.first_name}</h1>
      <p className="muted">Your training &amp; compliance dashboard</p>

      <div className="grid cols-3">
        <div className="card stat green"><div className="n">{pct}%</div><div className="l">Overall complete</div></div>
        <div className="card stat red"><div className="n">{overdue}</div><div className="l">Overdue</div></div>
        <div className="card stat amber"><div className="n">{awaiting}</div><div className="l">Awaiting sign-off</div></div>
      </div>

      <div className="card">
        <h2>Training matrix</h2>
        <table>
          <thead><tr><th>Area</th><th>Progress</th><th style={{ textAlign: 'right' }}>Done</th></tr></thead>
          <tbody>
            {Object.entries(byCat).map(([cat, v]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td><div className="progressbar"><div style={{ width: `${v.total ? v.done / v.total * 100 : 0}%` }} /></div></td>
                <td style={{ textAlign: 'right' }}>{v.done}/{v.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>To do ({open.length})</h2>
        {open.length === 0 && <p className="success">All caught up — nothing outstanding.</p>}
        <table>
          <tbody>
            {open.map(a => (
              <tr key={a.id}>
                <td><Link to={`/doc/${a.id}`}><b>{a.documents?.code}</b> {a.documents?.title}</Link>
                  {a.status === 'rejected' && a.rejection_reason && <div style={{ fontSize: 12, color: '#b42318' }}>Returned: {a.rejection_reason}</div>}
                </td>
                <td className="muted">due {fmtDate(a.due_date)}</td>
                <td><StatusBadge assignment={a} /></td>
                <td style={{ textAlign: 'right' }}><Link to={`/doc/${a.id}`}><button className="small">Open</button></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done > 0 && (
        <div className="card">
          <h2>My completed records</h2>
          <table><tbody>
            {assignments.filter(a => a.status === 'completed').map(a => (
              <tr key={a.id}>
                <td><b>{a.documents?.code}</b> {a.documents?.title}</td>
                <td className="muted">{fmtDate(a.completed_at)}</td>
                <td style={{ textAlign: 'right' }}><Link to={`/record/${a.id}`}>View / print</Link></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {licences.length > 0 && (
        <div className="card">
          <h2>My licences</h2>
          <table>
            <thead><tr><th>Licence</th><th>Number</th><th>Expiry</th></tr></thead>
            <tbody>
              {licences.map(l => {
                const soon = l.expiry_date && new Date(l.expiry_date) < new Date(Date.now() + 60 * 864e5)
                return (
                  <tr key={l.id}>
                    <td>{l.licence_types?.name}</td>
                    <td>{l.licence_number || '—'}</td>
                    <td>{l.expiry_date ? <span className={soon ? 'badge overdue' : ''}>{fmtDate(l.expiry_date)}</span> : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
