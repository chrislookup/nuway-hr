import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase, fmtDate, byCatRank, loadCatOrder } from '../lib/supabase'
import StatusBadge from '../components/StatusBadge'
import LicenceForm from '../components/LicenceForm'

export default function EmployeeDetail({ profile }) {
  const { id } = useParams()
  const [emp, setEmp] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [storeVehicles, setStoreVehicles] = useState([])
  const [addVeh, setAddVeh] = useState('')
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
  const [allLocs, setAllLocs] = useState([])
  const [allRoles, setAllRoles] = useState([])
  const [editing, setEditing] = useState(false)
  const [savingDetails, setSavingDetails] = useState(false)
  const [ef, setEf] = useState(null)

  async function load() {
    await loadCatOrder()
    const { data: e } = await supabase.from('profiles')
      .select('*, employee_locations(location_id, locations(name)), employee_job_roles(job_role_id, job_roles(name))').eq('id', id).single()
    setEmp(e)
    const locIds = [...new Set((e?.employee_locations || []).map(x => x.location_id).filter(Boolean))]
    if (locIds.length) { const { data: vs } = await supabase.from('vehicles').select('id, rego, type, induction_document_id, location_id').in('location_id', locIds).eq('active', true).order('rego'); setStoreVehicles(vs || []) } else setStoreVehicles([])
    const { data: a } = await supabase.from('assignments')
      .select('*, documents(code, title, document_categories(name)), completions(document_versions(version_no)), vehicles(rego, name))')
      .eq('employee_id', id).order('due_date', { nullsFirst: false })
    setAssignments(a || [])

    const { data: l } = await supabase.from('licences').select('*, licence_types(name)').eq('employee_id', id).eq('active', true)
    setLicences(l || [])
    const { data: d } = await supabase.from('documents').select('id, code, title').eq('active', true).order('code')
    setDocs(d || [])
    const { data: lt } = await supabase.from('licence_types').select('*').order('name')
    setLicTypes(lt || [])
    const { data: al } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
    setAllLocs(al || [])
    const { data: ar } = await supabase.from('job_roles').select('id, name').eq('active', true).order('name')
    setAllRoles(ar || [])
  }
  useEffect(() => { load() }, [id])

  async function addVehicleInduction() {
    const v = storeVehicles.find(x => x.id === addVeh)
    if (!v) return
    if (!v.induction_document_id) { setMsg('That vehicle has no induction form attached (set its type in Store settings).'); return }
    const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)
    const { error } = await supabase.from('assignments').insert({ employee_id: id, document_id: v.induction_document_id, vehicle_id: v.id, source: 'manual', assigned_by: profile.id, due_date: due })
    if (error) { setMsg(error.message); return }
    setMsg(`Induction added for ${v.type} ${v.rego}.`); setAddVeh(''); load()
  }
  async function removeVehicleInduction(a) {
    if (!window.confirm(`Remove the vehicle induction for ${a.vehicles?.rego || 'this vehicle'}?`)) return
    const { error } = await supabase.from('assignments').delete().eq('id', a.id)
    if (error) { setMsg(error.message); return }
    load()
  }
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
  const EMP_TYPE_OPTS = [['casual', 'Casual'], ['part_time', 'Part-time'], ['full_time', 'Full-time'], ['salary', 'Salary']]
  function openEdit() {
    setEf({
      first_name: emp.first_name || '', last_name: emp.last_name || '', mobile: emp.mobile || '',
      employment_type: emp.employment_type || '', date_of_birth: emp.date_of_birth || '', start_date: emp.start_date || '',
      locationIds: [...new Set((emp.employee_locations || []).map(x => x.location_id).filter(Boolean))],
      roleIds: [...new Set((emp.employee_job_roles || []).map(x => x.job_role_id).filter(Boolean))],
    })
    setEditing(true); setMsg('')
  }
  const toggleEf = (key, val) => setEf(p => ({ ...p, [key]: p[key].includes(val) ? p[key].filter(x => x !== val) : [...p[key], val] }))
  async function saveDetails() {
    if (!ef.first_name.trim() || !ef.last_name.trim()) { setMsg('First and last name are required.'); return }
    setSavingDetails(true); setMsg('')
    const { error: pe } = await supabase.from('profiles').update({
      first_name: ef.first_name.trim(), last_name: ef.last_name.trim(), mobile: ef.mobile.trim() || null,
      employment_type: ef.employment_type || null, date_of_birth: ef.date_of_birth || null, start_date: ef.start_date || null,
    }).eq('id', id)
    if (pe) { setMsg('Could not save: ' + pe.message); setSavingDetails(false); return }
    const curLoc = new Set((emp.employee_locations || []).map(x => x.location_id))
    const delLoc = [...curLoc].filter(x => !ef.locationIds.includes(x))
    const addLoc = ef.locationIds.filter(x => !curLoc.has(x))
    if (delLoc.length) await supabase.from('employee_locations').delete().eq('employee_id', id).in('location_id', delLoc)
    if (addLoc.length) await supabase.from('employee_locations').insert(addLoc.map((l, i) => ({ employee_id: id, location_id: l, is_primary: curLoc.size === 0 && i === 0 })))
    const curRole = new Set((emp.employee_job_roles || []).map(x => x.job_role_id))
    const delRole = [...curRole].filter(x => !ef.roleIds.includes(x))
    const addRole = ef.roleIds.filter(x => !curRole.has(x))
    if (delRole.length) await supabase.from('employee_job_roles').delete().eq('employee_id', id).in('job_role_id', delRole)
    if (addRole.length) await supabase.from('employee_job_roles').insert(addRole.map(r => ({ employee_id: id, job_role_id: r })))
    const { data: pushed, error: re } = await supabase.rpc('repush_employee', { emp: id })
    setMsg(re ? ('Details saved, but pushing new documents failed: ' + re.message) : `Details saved.${pushed ? ` Pushed ${pushed} new document${pushed === 1 ? '' : 's'} to their to-do.` : ' No new documents needed.'}`)
    setEditing(false); setSavingDetails(false); load()
  }
  async function removeLicence(l) {
    if (!window.confirm(`Remove ${l.licence_types?.name || 'this licence'} for ${emp.first_name}?`)) return
    const { error } = await supabase.from('licences').update({ active: false }).eq('id', l.id)
    if (error) { setMsg('Could not remove: ' + error.message); return }
    setMsg('Licence removed.'); load()
  }
  if (!emp) return <p className="muted">Loading…</p>
  const ver = a => a.completions?.[0]?.document_versions?.version_no
  const byDoc = {}
  const vehByVeh = {}
  for (const a of assignments) { if (a.vehicle_id) { (vehByVeh[a.vehicle_id] = vehByVeh[a.vehicle_id] || []).push(a) } }
  const vehInd = Object.values(vehByVeh).map(list => { list.sort((x, y) => new Date(y.assigned_at) - new Date(x.assigned_at)); return list[0] })
  for (const a of assignments) { if (a.vehicle_id) continue; (byDoc[a.document_id] = byDoc[a.document_id] || []).push(a) }
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

      {['admin', 'manager'].includes(profile.tier) && (
        <div className="card">
          <div className="row between">
            <h2>Details</h2>
            {!editing && <button className="small" onClick={openEdit}>Edit details</button>}
          </div>
          {!editing ? (
            <p className="muted" style={{ margin: 0 }}>Role, store, employment type, date of birth and contact details. Editing store or role will push any newly-required documents to this person. Access level (admin/manager/staff) can only be changed by an admin.</p>
          ) : (
            <div style={{ marginTop: 6 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div><label>First name</label><input value={ef.first_name} onChange={e => setEf({ ...ef, first_name: e.target.value })} /></div>
                <div><label>Last name</label><input value={ef.last_name} onChange={e => setEf({ ...ef, last_name: e.target.value })} /></div>
                <div><label>Mobile</label><input value={ef.mobile} onChange={e => setEf({ ...ef, mobile: e.target.value })} /></div>
                <div><label>Employment type</label>
                  <select value={ef.employment_type} onChange={e => setEf({ ...ef, employment_type: e.target.value })}>
                    <option value="">—</option>
                    {EMP_TYPE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label>Date of birth</label><input type="date" value={ef.date_of_birth || ''} onChange={e => setEf({ ...ef, date_of_birth: e.target.value })} /></div>
                <div><label>Start date</label><input type="date" value={ef.start_date || ''} onChange={e => setEf({ ...ef, start_date: e.target.value })} /></div>
              </div>
              <label style={{ marginTop: 10 }}>Roles</label>
              <div className="checkgrid">
                {allRoles.map(r => <label key={r.id}><input type="checkbox" style={{ width: 'auto' }} checked={ef.roleIds.includes(r.id)} onChange={() => toggleEf('roleIds', r.id)} />{r.name}</label>)}
              </div>
              <label style={{ marginTop: 10 }}>Stores</label>
              <div className="checkgrid">
                {allLocs.map(l => <label key={l.id}><input type="checkbox" style={{ width: 'auto' }} checked={ef.locationIds.includes(l.id)} onChange={() => toggleEf('locationIds', l.id)} />{l.name}</label>)}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={saveDetails} disabled={savingDetails}>{savingDetails ? 'Saving…' : 'Save details'}</button>
                <button className="secondary" onClick={() => setEditing(false)} disabled={savingDetails}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

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
        {Object.entries(byCat).sort(([a], [b]) => byCatRank(a, b)).map(([cat, list]) => (
          <div key={cat} style={{ marginTop: 14 }}>
            <h3>{cat}</h3>
            <table className="matrix"><tbody>
              {list.map(a => (
                <tr key={a.id}>
                  <td><b>{a.documents?.code}</b> {a.documents?.title}{a.vehicles?.rego ? ' · ' + a.vehicles.rego : ''}{ver(a) ? ' · v' + ver(a) : ''}</td>
                  <td className="muted col-due">due {fmtDate(a.due_date)}</td>
                  <td className="col-status"><StatusBadge assignment={a} /></td>
                  <td className="col-act">
                    {rej.id === a.id ? (
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <input autoFocus placeholder="Reason…" value={rej.reason} onChange={e => setRej({ ...rej, reason: e.target.value })} style={{ width: 150 }} />
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

      <div className="card">
        <div className="row between">
          <h2>Vehicle inductions</h2>
          <div className="row">
            <select value={addVeh} onChange={e => setAddVeh(e.target.value)} style={{ width: 300 }}>
              <option value="">+ Require induction on a vehicle…</option>
              {storeVehicles.filter(v => !vehInd.some(a => a.vehicle_id === v.id)).map(v => <option key={v.id} value={v.id}>{v.type} {v.rego}</option>)}
            </select>
            <button className="small" onClick={addVehicleInduction} disabled={!addVeh}>Add</button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Pick which vehicles at this person's store(s) they must be inducted on. Each includes the vehicle's risk assessment (read &amp; sign) and the machine induction form.</p>
        {vehInd.length === 0
          ? <p className="muted">No vehicle inductions assigned.</p>
          : <table className="matrix"><tbody>
              {vehInd.map(a => (
                <tr key={a.id}>
                  <td><b>{a.vehicles?.rego || '—'}</b> {a.vehicles?.name || ''}<div style={{ fontSize: 12 }} className="muted">{a.documents?.code} {a.documents?.title}{ver(a) ? ' · v' + ver(a) : ''}</div></td>
                  <td className="muted col-due">due {fmtDate(a.due_date)}</td>
                  <td className="col-status"><StatusBadge assignment={a} /></td>
                  <td className="col-act">
                    {['completed', 'awaiting_review'].includes(a.status) && <Link to={`/record/${a.id}`}>View / print</Link>}{' '}
                    <button className="small" style={{ color: '#b00020' }} onClick={() => removeVehicleInduction(a)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody></table>}
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
          <thead><tr><th>Licence</th><th>Class</th><th>Number</th><th>Conditions</th><th>Expiry</th><th>Photos</th><th></th></tr></thead>
          <tbody>
            {licences.map(l => (
              <tr key={l.id}>
                <td>{l.licence_types?.name}</td>
                <td>{l.licence_class || '—'}</td>
                <td>{l.licence_number || '—'}</td>
                <td className="muted">{l.conditions || '—'}</td>
                <td>{fmtDate(l.expiry_date)}</td>
                <td>{l.front_image_path && <a onClick={() => viewImg(l.front_image_path)} style={{ cursor: 'pointer' }}>front</a>}{l.front_image_path && l.back_image_path ? ' · ' : ''}{l.back_image_path && <a onClick={() => viewImg(l.back_image_path)} style={{ cursor: 'pointer' }}>back</a>}</td>
                <td style={{ textAlign: 'right' }}><button className="small" style={{ color: '#b00020' }} onClick={() => removeLicence(l)}>Remove</button></td>
              </tr>
            ))}
            {licences.length === 0 && <tr><td colSpan={7} className="muted">No licences recorded.</td></tr>}
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
