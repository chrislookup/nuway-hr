import { useEffect, useState, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate, isOverdue, byCatRank, loadCatOrder } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import LicenceForm from '../components/LicenceForm'

export default function Dashboard({ profile }) {
  const [assignments, setAssignments] = useState(null)
  const [, setCatReady] = useState(0)
  const [licences, setLicences] = useState([])
  const [assessQ, setAssessQ] = useState([])
  const [licenceTypes, setLicenceTypes] = useState([])
  const [showLic, setShowLic] = useState(false)

  function loadLic() {
    supabase.from('licences').select('*, licence_types(name)').eq('employee_id', profile.id).eq('active', true).then(({ data }) => setLicences(data || []))
  }
  async function viewImg(path) {
    if (!path) return
    const { data } = await supabase.storage.from('licences').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  function loadAssess() {
    supabase.from('assignments')
      .select('*, documents(code, title, requires_assessor_signoff), profiles!assignments_employee_id_fkey(first_name, last_name)')
      .eq('status', 'awaiting_review')
      .then(({ data }) => setAssessQ((data || []).filter(a => a.documents?.requires_assessor_signoff && a.employee_id !== profile.id)))
  }

  useEffect(() => {
    loadCatOrder().then(() => setCatReady(x => x + 1))
    supabase.from('assignments')
      .select('*, documents(id, code, title, doc_type, requires_signature, category_id, document_categories(name)), completions(document_versions(version_no)), vehicles(rego, name))')
      .eq('employee_id', profile.id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => setAssignments(data || []))
    supabase.from('licences')
      .select('*, licence_types(name)')
      .eq('employee_id', profile.id).eq('active', true)
      .then(({ data }) => setLicences(data || []))
    supabase.from('licence_types').select('*').order('name').then(({ data }) => setLicenceTypes(data || []))
    if (profile.can_assess) loadAssess()
  }, [profile.id])

  if (!assignments) return <p className="muted">Loading…</p>

  const ver = a => a.completions?.[0]?.document_versions?.version_no
  const byDoc = {}
  const vehByVeh = {}
  for (const a of assignments) { if (a.vehicle_id) { (vehByVeh[a.vehicle_id] = vehByVeh[a.vehicle_id] || []).push(a) } }
  const vehInd = Object.values(vehByVeh).map(list => { list.sort((x, y) => new Date(y.assigned_at) - new Date(x.assigned_at)); return list[0] })
  for (const a of assignments) { if (a.vehicle_id) continue; (byDoc[a.document_id] = byDoc[a.document_id] || []).push(a) }
  const current = [], superseded = []
  for (const list of Object.values(byDoc)) { list.sort((x, y) => new Date(y.assigned_at) - new Date(x.assigned_at)); current.push(list[0]); superseded.push(...list.slice(1)) }
  const done = current.filter(a => a.status === 'completed').length
  const overdue = current.filter(isOverdue).length
  const awaiting = current.filter(a => a.status === 'awaiting_review').length
  const open = current.filter(a => !['completed', 'expired'].includes(a.status) && !a.suspended)
  const pct = current.length ? Math.round(done / current.length * 100) : 0

  const groupByCat = (list) => {
    const g = {}
    for (const a of list) { const c = a.documents?.document_categories?.name || 'Other'; (g[c] = g[c] || []).push(a) }
    return g
  }

  // training matrix: group by category
  const byCat = {}
  for (const a of current) {
    const cat = a.documents?.document_categories?.name || 'Other'
    byCat[cat] = byCat[cat] || { total: 0, done: 0 }
    byCat[cat].total++
    if (a.status === 'completed') byCat[cat].done++
  }

  async function removeLicence(l) {
    if (!window.confirm(`Remove your ${l.licence_types?.name || 'licence'}? You can add it again anytime.`)) return
    const { error } = await supabase.from('licences').update({ active: false }).eq('id', l.id)
    if (error) { window.alert('Could not remove: ' + error.message); return }
    loadLic()
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

      {profile.can_assess && assessQ.length > 0 && (
        <div className="card">
          <h2>Assessments awaiting your sign-off ({assessQ.length})</h2>
          <p className="muted">You're a competent person for these. Confirm each staff member has demonstrated the competency, then sign off.</p>
          <table><tbody>
            {assessQ.map(a => (
              <tr key={a.id}>
                <td>{a.profiles?.first_name} {a.profiles?.last_name}</td>
                <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                <td style={{ textAlign: 'right' }}>
                  <Link to={`/record/${a.id}`}><button className="secondary small">View</button></Link>{' '}
                  <Link to={`/assess/${a.id}`}><button className="small">Complete &amp; sign</button></Link>
                </td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="card">
        <h2>Training matrix</h2>
        <table>
          <thead><tr><th>Area</th><th>Progress</th><th style={{ textAlign: 'right' }}>Done</th></tr></thead>
          <tbody>
            {Object.entries(byCat).sort(([a], [b]) => byCatRank(a, b)).map(([cat, v]) => (
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
        {open.length > 0 && (
          <table className="listgrouped"><tbody>
            {Object.entries(groupByCat(open)).sort(([a], [b]) => byCatRank(a, b)).map(([cat, items]) => (
              <Fragment key={cat}>
                <tr className="cathead"><td colSpan={4}>{cat}</td></tr>
                {items.map(a => (
                  <tr key={a.id}>
                    <td><Link to={`/doc/${a.id}`}><b>{a.documents?.code}</b> {a.documents?.title}</Link>
                      {a.status === 'rejected' && a.rejection_reason && <div style={{ fontSize: 12, color: '#b42318' }}>Returned: {a.rejection_reason}</div>}
                    </td>
                    <td className="muted col-due">due {fmtDate(a.due_date)}</td>
                    <td className="col-status"><StatusBadge assignment={a} /></td>
                    <td className="col-act"><Link to={`/doc/${a.id}`}><button className="small">Open</button></Link></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody></table>
        )}
      </div>

      {vehInd.length > 0 && (
        <div className="card">
          <h2>Vehicle inductions ({vehInd.length})</h2>
          <p className="muted" style={{ fontSize: 13 }}>One induction per machine you're assigned to — each includes the vehicle's risk assessment and induction form.</p>
          <table className="listgrouped"><tbody>
            {vehInd.map(a => (
              <tr key={a.id}>
                <td><b>{a.vehicles?.rego || '—'}</b> {a.vehicles?.name || ''}<div style={{ fontSize: 12 }} className="muted">{a.documents?.code} {a.documents?.title}</div></td>
                <td className="muted col-due">due {fmtDate(a.due_date)}</td>
                <td className="col-status"><StatusBadge assignment={a} /></td>
                <td className="col-act">{['completed', 'awaiting_review'].includes(a.status)
                  ? <Link to={`/record/${a.id}`}>View / print</Link>
                  : <Link to={`/doc/${a.id}`}><button className="small">Open</button></Link>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      {done > 0 && (
        <div className="card">
          <h2>My completed records</h2>
          <table className="listgrouped"><tbody>
            {Object.entries(groupByCat(current.filter(a => a.status === 'completed'))).sort(([a], [b]) => byCatRank(a, b)).map(([cat, items]) => (
              <Fragment key={cat}>
                <tr className="cathead"><td colSpan={3}>{cat}</td></tr>
                {items.map(a => (
                  <tr key={a.id}>
                    <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                    <td className="muted col-due">{fmtDate(a.completed_at)}</td>
                    <td className="col-act"><Link to={`/record/${a.id}`}>View / print</Link></td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody></table>
        </div>
      )}

      {superseded.length > 0 && (
        <div className="card">
          <h2>Previous records ({superseded.length})</h2>
          <p className="muted">Earlier completions kept for your record after a document was updated or re-issued.</p>
          <table><tbody>
            {superseded.map(a => (
              <tr key={a.id}>
                <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                <td className="muted">{fmtDate(a.completed_at)}</td>
                <td style={{ textAlign: 'right' }}>{['completed', 'awaiting_review'].includes(a.status) && <Link to={`/record/${a.id}`}>View / print</Link>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2>My licences</h2>
          <button className="small" onClick={() => setShowLic(v => !v)}>{showLic ? 'Close' : '+ Add licence'}</button>
        </div>
        {showLic && <LicenceForm employeeId={profile.id} licenceTypes={licenceTypes} onSaved={() => { setShowLic(false); loadLic() }} onCancel={() => setShowLic(false)} />}
        {licences.length === 0 && !showLic && <p className="muted">No licences yet. Add your driver, forklift or loader licence with front &amp; back photos.</p>}
        {licences.length > 0 && (
          <table>
            <thead><tr><th>Licence</th><th>Class</th><th>Number</th><th>Conditions</th><th>Expiry</th><th>Photos</th><th></th></tr></thead>
            <tbody>
              {licences.map(l => {
                const soon = l.expiry_date && new Date(l.expiry_date) < new Date(Date.now() + 60 * 864e5)
                return (
                  <tr key={l.id}>
                    <td>{l.licence_types?.name}</td>
                    <td>{l.licence_class || '—'}</td>
                    <td>{l.licence_number || '—'}</td>
                    <td className="muted">{l.conditions || '—'}</td>
                    <td>{l.expiry_date ? <span className={soon ? 'badge overdue' : ''}>{fmtDate(l.expiry_date)}</span> : '—'}</td>
                    <td>{l.front_image_path && <a onClick={() => viewImg(l.front_image_path)} style={{ cursor: 'pointer' }}>front</a>}{l.front_image_path && l.back_image_path ? ' · ' : ''}{l.back_image_path && <a onClick={() => viewImg(l.back_image_path)} style={{ cursor: 'pointer' }}>back</a>}</td>
                    <td style={{ textAlign: 'right' }}><button className="small" style={{ color: '#b00020' }} onClick={() => removeLicence(l)}>Remove</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
