import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import LicenceForm from '../components/LicenceForm'

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
  const [imp, setImp] = useState({ document_id: '', signed_at: '', file: null })
  const [impMsg, setImpMsg] = useState('')
  const [impBusy, setImpBusy] = useState(false)
  const [rej, setRej] = useState({ id: null, reason: '' })
  const [showLic, setShowLic] = useState(false)

  async function load() {
    const { data: e } = await supabase.from('profiles')
      .select('*, employee_locations(locations(name)), employee_job_roles(job_roles(name))').eq('id', id).single()
    setEmp(e)
    const { data: a } = await supabase.from('assignments')
      .select('*, documents(code, title, document_categories(name)), completions(document_versions(version_no)), vehicles(rego))')
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

  async function viewImg(path) {
    if (!path) return
    const { data } = await supabase.storage.from('licences').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  async function returnDoc(a) {
    if (!rej.reason.trim()) return
    const { error } = await supabase.from('assignments').update({
      status: 'rejected', rejection_reason: rej.reason.trim(),
      reviewed_by: profile.id, reviewed_at: new Date().toISOString(), completed_at: null,
    }).eq('id', a.id)
    setMsg(error ? error.message : 'Document returned to the employee for correction.')
    setRej({ id: null, reason: '' }); load()
  }

  async function importRecord() {
    if (!imp.document_id || !imp.file) { setImpMsg('Pick a document and choose a file.'); return }
    setImpBusy(true); setImpMsg('')
    try {
      let { data: asg } = await supabase.from('assignments').select('*')
        .eq('employee_id', id).eq('document_id', imp.document_id)
        .order('assigned_at', { ascending: false }).limit(1).maybeSingle()
      if (!asg) {
        const { data: na, error: ae } = await supabase.from('assignments')
          .insert({ employee_id: id, document_id: imp.document_id, source: 'manual', assigned_by: profile.id, status: 'not_started' })
          .select('*').single()
        if (ae) throw ae
        asg = na
      }
      const { data: docRow } = await supabase.from('documents').select('current_version_id').eq('id', imp.document_id).single()
      if (!docRow?.current_version_id) throw new Error('Open this document in Admin \u2192 Documents and Save once first, then retry.')
      const safe = imp.file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${id}/${asg.id}-${safe}`
      const { error: fe } = await supabase.storage.from('completed-docs').upload(path, imp.file, { upsert: true })
      if (fe) throw fe
      const { error: ce } = await supabase.from('completions').insert({
        assignment_id: asg.id, document_version_id: docRow.current_version_id,
        completed_pdf_path: path, signed_name: `${emp.first_name} ${emp.last_name}`,
        signed_at: imp.signed_at || null, verified_by: profile.id, verified_at: new Date().toISOString(),
        form_data: { imported: true },
      })
      if (ce) throw ce
      await supabase.from('assignments').update({ status: 'completed', completed_at: imp.signed_at ? new Date(imp.signed_at).toISOString() : new Date().toISOString() }).eq('id', asg.id)
      setImpMsg('Imported \u2014 marked complete.')
      setImp({ document_id: '', signed_at: '', file: null }); load()
    } catch (e) { setImpMsg('Failed: ' + (e.message || String(e))) }
    setImpBusy(false)
  }

  async function setSuspended(a, val) {
    const { error } = await supabase.from('assignments').update({ suspended: val }).eq('id', a.id)
    if (error) { setMsg('Could not update: ' + error.message); return }
    setMsg(val ? 'Document put on hold.' : 'Document resumed.'); load()
  }
  if (!emp) return <p className="muted">Loading…</p>
  const ver = a => a.completions?.[0]?.document_versions?.version_no
  const byDoc = {}
  for (const a of assignments) { (byDoc[a.document_id] = byDoc[a.document_id] || []).push(a) }
  const current = [], superseded = []
  for (const list of Object.values(byDoc)) {
    list.sort((x, y) => new Date(y.assigned_at) - new Date(x.assigned_at))
    current.push(list[0]); superseded.push(...list.slice(1))
  }
  const byCat = {}
  for (const a of current) {
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
                  <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                  <td className="muted">due {fmtDate(a.due_date)}</td>
                  <td><StatusBadge assignment={a} /></td>
                  <td style={{ textAlign: 'right' }}>
                    {rej.id === a.id ? (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <input autoFocus placeholder="Reason for returning…" value={rej.reason} onChange={e => setRej({ ...rej, reason: e.target.value })} style={{ width: 200 }} />
                        <button className="danger small" disabled={!rej.reason.trim()} onClick={() => returnDoc(a)}>Confirm</button>
                        <button className="secondary small" onClick={() => setRej({ id: null, reason: '' })}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        {['completed', 'awaiting_review'].includes(a.status) && <Link to={`/record/${a.id}`}>View / print</Link>}{' '}
                        {['completed', 'awaiting_review'].includes(a.status) && <button className="danger small" onClick={() => setRej({ id: a.id, reason: '' })}>Return</button>}
                        {!['completed', 'awaiting_review'].includes(a.status) && (a.suspended
                          ? <button className="small" onClick={() => setSuspended(a, false)}>Resume</button>
                          : <button className="secondary small" onClick={() => setSuspended(a, true)}>Suspend</button>)}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody></table>
          </div>
        ))}
        {current.length === 0 && <p className="muted">No assignments yet.</p>}
      </div>

      {superseded.length > 0 && (
        <div className="card">
          <h2>Previous / superseded records ({superseded.length})</h2>
          <p className="muted">Earlier completions, kept for the record when a document was re-issued or a new version published.</p>
          <table><tbody>
            {superseded.map(a => (
              <tr key={a.id}>
                <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                <td><StatusBadge assignment={a} /></td>
                <td style={{ textAlign: 'right' }}>{['completed', 'awaiting_review'].includes(a.status) && <Link to={`/record/${a.id}`}>View / print</Link>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2>Licences</h2>
          <button className="small" onClick={() => setShowLic(v => !v)}>{showLic ? 'Close' : '+ Add licence'}</button>
        </div>
        {showLic && <LicenceForm employeeId={id} licenceTypes={licTypes} verifiedBy={profile.id} onSaved={() => { setShowLic(false); load() }} onCancel={() => setShowLic(false)} />}
        <table>
          <thead><tr><th>Licence</th><th>Class</th><th>Number</th><th>Conditions</th><th>Expiry</th><th>Photos</th></tr></thead>
          <tbody>
            {licences.map(l => (
              <tr key={l.id}>
                <td>{l.licence_types?.name}</td>
                <td>{l.licence_class || '—'}</td>
                <td>{l.licence_number || '—'}</td>
                <td className="muted">{l.conditions || '—'}</td>
                <td>{fmtDate(l.expiry_date)}</td>
                <td>{l.front_image_path && <a onClick={() => viewImg(l.front_image_path)} style={{ cursor: 'pointer' }}>front</a>}{l.front_image_path && l.back_image_path ? ' · ' : ''}{l.back_image_path && <a onClick={() => viewImg(l.back_image_path)} style={{ cursor: 'pointer' }}>back</a>}</td>
              </tr>
            ))}
            {licences.length === 0 && <tr><td colSpan={6} className="muted">No licences recorded.</td></tr>}
          </tbody>
        </table>
      </div>

      {['admin', 'manager'].includes(profile.tier) && (
        <div className="card">
          <h2>Upload a document on this employee’s behalf</h2>
          <p className="muted">Upload a document on behalf of this employee — e.g. a completed/signed form from your files, a CV, or a licence. It attaches to this employee and marks the requirement complete.</p>
          {impMsg && <div className={impMsg.startsWith('Failed') ? 'error' : 'success'}>{impMsg}</div>}
          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <select style={{ width: 320 }} value={imp.document_id} onChange={e => setImp({ ...imp, document_id: e.target.value })}>
              <option value="">Choose document…</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
            </select>
            <input type="date" value={imp.signed_at} onChange={e => setImp({ ...imp, signed_at: e.target.value })} title="Date originally signed (optional)" />
            <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={e => setImp({ ...imp, file: e.target.files?.[0] || null })} />
            <button className="small" onClick={importRecord} disabled={impBusy || !imp.document_id || !imp.file}>{impBusy ? 'Importing…' : 'Import & mark complete'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
