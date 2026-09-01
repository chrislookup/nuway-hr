import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import { suggestInductions } from '../lib/inductions'

export default function Team({ profile }) {
  const [people, setPeople] = useState(null)
  const [reviews, setReviews] = useState([])
  const [busyId, setBusyId] = useState(null)
  const [rej, setRej] = useState({ id: null, reason: '' })
  const [gaps, setGaps] = useState([])
  const [sort, setSort] = useState({ key: 'name', dir: 1 })
  const [filterLoc, setFilterLoc] = useState('')
  const [filterRole, setFilterRole] = useState('')

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
        else if (a.status !== 'awaiting_review' && a.due_date && new Date(a.due_date) < new Date()) stats[a.employee_id].overdue++
      }
    }
    setPeople((profs || []).map(p => ({ ...p, stats: stats[p.id] || { total: 0, done: 0, overdue: 0 } })))

    const { data: rev } = await supabase.from('assignments')
      .select('*, documents(code, title), profiles!assignments_employee_id_fkey(first_name, last_name)')
      .eq('status', 'awaiting_review').order('completed_at', { ascending: false })
    setReviews(rev || [])

    // who is missing a vehicle induction they look like they need?
    if (ids.length) {
      const [{ data: els }, { data: vehs }, { data: lics }, { data: vAsg }] = await Promise.all([
        supabase.from('employee_locations').select('employee_id, location_id').in('employee_id', ids),
        supabase.from('vehicles').select('id, rego, type, induction_document_id, location_id').eq('active', true),
        supabase.from('licences').select('employee_id, licence_class, licence_types(name)').in('employee_id', ids).eq('active', true),
        supabase.from('assignments').select('employee_id, vehicle_id').in('employee_id', ids).not('vehicle_id', 'is', null),
      ])
      const locsBy = {}, licBy = {}, asgBy = {}
      for (const x of els || []) (locsBy[x.employee_id] = locsBy[x.employee_id] || []).push(x.location_id)
      for (const x of lics || []) (licBy[x.employee_id] = licBy[x.employee_id] || []).push(x)
      for (const x of vAsg || []) (asgBy[x.employee_id] = asgBy[x.employee_id] || []).push(x.vehicle_id)
      const out = []
      for (const p of profs || []) {
        const myLocs = locsBy[p.id] || []
        const sug = suggestInductions({
          roles: (p.employee_job_roles || []).map(r => r.job_roles?.name).filter(Boolean),
          licences: licBy[p.id] || [],
          vehicles: (vehs || []).filter(v => myLocs.includes(v.location_id)),
          assignedVehicleIds: asgBy[p.id] || [],
        })
        if (sug.length) out.push({ person: p, sug })
      }
      setGaps(out)
    }
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

  const locsOf = p => (p.employee_locations || []).map(l => l.locations?.name).filter(Boolean).sort()
  const rolesOf = p => (p.employee_job_roles || []).map(r => r.job_roles?.name).filter(Boolean).sort()
  const allLocations = [...new Set((people || []).flatMap(locsOf))].sort()
  const allRoles = [...new Set((people || []).flatMap(rolesOf))].sort()

  // someone at several stores sorts under their first store alphabetically, and shows under each in the filter
  const sortKey = {
    name: p => `${p.first_name} ${p.last_name || ''}`.toLowerCase(),
    location: p => locsOf(p)[0]?.toLowerCase() ?? 'zzz',
    roles: p => rolesOf(p)[0]?.toLowerCase() ?? 'zzz',
    start: p => p.start_date || '',
    progress: p => (p.stats.total ? p.stats.done / p.stats.total : -1),
    overdue: p => p.stats.overdue,
  }
  const shownPeople = (people || [])
    .filter(p => !filterLoc || locsOf(p).includes(filterLoc))
    .filter(p => !filterRole || rolesOf(p).includes(filterRole))
    .slice()
    .sort((a, b) => {
      const f = sortKey[sort.key] || sortKey.name
      const x = f(a), y = f(b)
      if (x < y) return -1 * sort.dir
      if (x > y) return 1 * sort.dir
      return sortKey.name(a) < sortKey.name(b) ? -1 : 1
    })

  const Th = ({ k, children }) => (
    <th onClick={() => setSort(s => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      title="Sort by this column">
      {children}{sort.key === k ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </th>
  )

  return (
    <div>
      <h1>Team</h1>
      {gaps.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid var(--teal)' }}>
          <h2>Vehicle inductions to assign ({gaps.length})</h2>
          <p className="muted" style={{ fontSize: 13 }}>
            These staff have roles or licences that suggest they'll operate machinery, but haven't been inducted on it.
            Open the person to assign the machines they'll actually use.
          </p>
          <table><tbody>
            {gaps.map(({ person, sug }) => (
              <tr key={person.id}>
                <td><Link to={`/employee/${person.id}`}>{person.first_name} {person.last_name}</Link></td>
                <td className="muted">{[...new Set(sug.map(x => x.vehicle.type))].join(', ')} — {sug.length} machine{sug.length > 1 ? 's' : ''}</td>
                <td className="muted" style={{ fontSize: 12 }}>{sug[0].reason}</td>
                <td style={{ textAlign: 'right' }}><Link to={`/employee/${person.id}`}><button className="small">Review</button></Link></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

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
        <div className="row between" style={{ flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Employees ({shownPeople.length}{shownPeople.length !== people.length ? ` of ${people.length}` : ''})</h2>
          <div className="row" style={{ gap: 8 }}>
            <select style={{ width: 160 }} value={filterLoc} onChange={e => setFilterLoc(e.target.value)}>
              <option value="">All locations</option>
              {allLocations.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select style={{ width: 140 }} value={filterRole} onChange={e => setFilterRole(e.target.value)}>
              <option value="">All roles</option>
              {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <table>
          <thead><tr>
            <Th k="name">Name</Th><Th k="location">Location</Th><Th k="roles">Roles</Th>
            <Th k="start">Started</Th><Th k="progress">Progress</Th><Th k="overdue">Overdue</Th><th />
          </tr></thead>
          <tbody>
            {shownPeople.map(p => (
              <tr key={p.id}>
                <td><Link to={`/employee/${p.id}`}>{p.first_name} {p.last_name}</Link></td>
                <td>{(p.employee_locations || []).map(l => l.locations?.name).join(', ') || '—'}</td>
                <td>{(p.employee_job_roles || []).map(r => r.job_roles?.name).join(', ') || '—'}</td>
                <td className="muted">{p.start_date ? fmtDate(p.start_date) : '—'}</td>
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
