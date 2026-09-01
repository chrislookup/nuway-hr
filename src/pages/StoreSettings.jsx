import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import PlantLicenceRegister from '../components/PlantLicenceRegister'
import { machineNeeds } from '../lib/inductions'

const TYPES = ['Truck', 'Loader', 'Forklift']

export default function StoreSettings({ profile }) {
  const isAdmin = profile.tier === 'admin'
  const [locations, setLocations] = useState([])
  const [myLocs, setMyLocs] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [docs, setDocs] = useState([])
  const [nv, setNv] = useState({ type: 'Forklift', rego: '', name: '', location_id: '', induction_document_id: '' })
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [indMap, setIndMap] = useState({})
  const [tab, setTab] = useState('register')
  const [staff, setStaff] = useState([])
  const [induct, setInduct] = useState(null)   // { vehicle, picks:{id:bool} }

  async function load() {
    const { data: l } = await supabase.from('locations').select('*').eq('active', true).order('name')
    setLocations(l || [])
    const { data: v } = await supabase.from('vehicles').select('*, locations(name)').order('rego')
    setVehicles(v || [])
    const { data: d } = await supabase.from('documents').select('id, code, title').eq('active', true).order('code')
    setDocs(d || [])
    const { data: inds } = await supabase.from('documents').select('id, code').in('code', ['11.3F', '11.3L', '11.4T'])
    const m = {}; for (const x of inds || []) { if (x.code === '11.3F') m.Forklift = x.id; if (x.code === '11.3L') m.Loader = x.id; if (x.code === '11.4T') m.Truck = x.id }
    setIndMap(m)
    if (!isAdmin) {
      const { data: m } = await supabase.from('manager_location_access').select('location_id').eq('manager_id', profile.id)
      setMyLocs((m || []).map(x => x.location_id))
    }
    const { data: els } = await supabase.from('employee_locations')
      .select('location_id, profiles(id, first_name, last_name, status, is_test, employee_job_roles(job_roles(name)))')
    const ids = [...new Set((els || []).map(x => x.profiles?.id).filter(Boolean))]
    let licBy = {}
    if (ids.length) {
      const { data: lics } = await supabase.from('licences')
        .select('employee_id, licence_class, licence_types(name)').in('employee_id', ids).eq('active', true)
      for (const x of lics || []) (licBy[x.employee_id] = licBy[x.employee_id] || []).push(x)
    }
    setStaff((els || []).filter(x => x.profiles?.status === 'active').map(x => ({
      id: x.profiles.id, location_id: x.location_id,
      name: `${x.profiles.first_name} ${x.profiles.last_name || ''}`.trim(),
      is_test: x.profiles.is_test,
      roles: (x.profiles.employee_job_roles || []).map(r => r.job_roles?.name).filter(Boolean),
      licences: licBy[x.profiles.id] || [],
    })))
  }
  useEffect(() => { load() }, [])

  const allowedLocs = isAdmin ? locations : locations.filter(l => myLocs.includes(l.id))
  const shownVehicles = isAdmin ? vehicles : vehicles.filter(v => myLocs.includes(v.location_id))

  async function addVehicle() {
    if (!nv.rego.trim() || !nv.location_id) { setMsg('Enter a rego and choose a store.'); return }
    setBusy(true); setMsg('')
    try {
      const { error } = await supabase.from('vehicles').insert({
        type: nv.type, rego: nv.rego.trim(), name: nv.name.trim() || `${nv.type} ${nv.rego.trim()}`,
        location_id: nv.location_id, induction_document_id: indMap[nv.type] || null, active: true,
      })
      if (error) throw error
      const { data: added } = await supabase.from('vehicles').select('*').eq('rego', nv.rego.trim()).maybeSingle()
      setMsg(`${nv.type} ${nv.rego} added.`)
      if (added) openInduct(added)
      setNv({ type: 'Forklift', rego: '', name: '', location_id: '', induction_document_id: '' }); load()
    } catch (e) { setMsg(e.message || String(e)) }
    setBusy(false)
  }
  function candidatesFor(v) {
    return staff.filter(p => p.location_id === v.location_id && !!machineNeeds(p)[v.type])
  }
  function openInduct(v) {
    const picks = {}
    for (const p of candidatesFor(v)) picks[p.id] = true
    setInduct({ vehicle: v, picks })
  }
  async function assignInductions() {
    const v = induct.vehicle
    const chosen = Object.entries(induct.picks).filter(([, on]) => on).map(([pid]) => pid)
    if (!chosen.length) { setInduct(null); return }
    if (!v.induction_document_id) { setMsg('This vehicle has no induction form attached — set its type first.'); return }
    setBusy(true)
    const { data: existing } = await supabase.from('assignments')
      .select('employee_id').eq('vehicle_id', v.id).in('employee_id', chosen)
    const already = new Set((existing || []).map(x => x.employee_id))
    const rows = chosen.filter(pid => !already.has(pid)).map(pid => ({
      employee_id: pid, document_id: v.induction_document_id, vehicle_id: v.id,
      source: 'manual', assigned_by: profile.id,
      due_date: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
    }))
    if (rows.length) {
      const { error } = await supabase.from('assignments').insert(rows)
      if (error) { setMsg(error.message); setBusy(false); return }
    }
    setMsg(`${rows.length} induction${rows.length === 1 ? '' : 's'} assigned for ${v.type} ${v.rego}.${already.size ? ` ${already.size} already had it.` : ''}`)
    setInduct(null); setBusy(false)
  }

  async function toggleActive(v) {
    await supabase.from('vehicles').update({ active: !v.active }).eq('id', v.id); load()
  }
  async function deleteVehicle(v) {
    if (!window.confirm(`Delete ${v.type || 'vehicle'} ${v.rego}? This can't be undone.`)) return
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id)
    if (error) { setMsg(/foreign key|violates/i.test(error.message) ? 'This vehicle has inductions assigned to staff — set it Inactive instead of deleting.' : error.message); return }
    setMsg(''); load()
  }
  async function uploadRA(v, file) {
    if (!file) return
    setBusy(true); setMsg('')
    const path = `vehicle-ra/${v.id}.pdf`
    const { error } = await supabase.storage.from('masters').upload(path, file, { upsert: true, contentType: 'application/pdf' })
    if (error) { setMsg('Risk assessment upload failed: ' + error.message); setBusy(false); return }
    await supabase.from('vehicles').update({ risk_assessment_path: path }).eq('id', v.id)
    setMsg(`Risk assessment uploaded for ${v.rego}.`); setBusy(false); load()
  }
  async function viewRA(v) {
    const { data } = await supabase.storage.from('masters').createSignedUrl(v.risk_assessment_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  function startEdit(v) {
    setEdit({ id: v.id, type: v.type || 'Truck', rego: v.rego || '', name: v.name || '', location_id: v.location_id || '', induction_document_id: v.induction_document_id || '' })
  }
  async function saveEdit() {
    if (!edit.rego.trim() || !edit.location_id) { setMsg('Enter a rego and choose a store.'); return }
    const { error } = await supabase.from('vehicles').update({
      type: edit.type, rego: edit.rego.trim(), name: edit.name.trim() || `${edit.type} ${edit.rego.trim()}`,
      location_id: edit.location_id, induction_document_id: indMap[edit.type] || edit.induction_document_id || null,
    }).eq('id', edit.id)
    if (error) { setMsg(error.message); return }
    setEdit(null); setMsg('Saved.'); load()
  }

  const byLoc = {}
  for (const v of shownVehicles) { const n = v.locations?.name || 'Unassigned'; (byLoc[n] = byLoc[n] || []).push(v) }

  const allowedIds = isAdmin ? null : myLocs

  return (
    <div>
      <h1>Store</h1>
      <div className="pill-tabs">
        <button className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Plant licence register</button>
        <button className={tab === 'vehicles' ? 'on' : ''} onClick={() => setTab('vehicles')}>Vehicles</button>
      </div>

      {tab === 'register' && <PlantLicenceRegister profile={profile} locations={locations} allowedLocIds={allowedIds} />}

      <div style={{ display: tab === 'vehicles' ? 'block' : 'none' }}>
      <h2>Vehicles</h2>
      <p className="muted">Register the trucks, forklifts and loaders at each store, and upload each vehicle’s risk assessment. The right induction form is attached automatically by type. Inductions are then assigned to specific staff from their profile.</p>

      <div className="card">
        <h2>Add a vehicle</h2>
        {msg && <div className="success">{msg}</div>}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div style={{ width: 160 }}><label>Type</label>
            <select value={nv.type} onChange={e => setNv({ ...nv, type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
          <div style={{ width: 140 }}><label>Rego</label><input value={nv.rego} onChange={e => setNv({ ...nv, rego: e.target.value })} placeholder="ABC123" /></div>
          <div style={{ flex: 1, minWidth: 160 }}><label>Name / description (optional)</label><input value={nv.name} onChange={e => setNv({ ...nv, name: e.target.value })} placeholder="e.g. Toyota 2.5t" /></div>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180 }}><label>Store</label>
            <select value={nv.location_id} onChange={e => setNv({ ...nv, location_id: e.target.value })}>
              <option value="">— select —</option>
              {allowedLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select></div>
        </div>
        <button style={{ marginTop: 10 }} onClick={addVehicle} disabled={busy}>{busy ? 'Adding…' : 'Add vehicle'}</button>
      </div>

      {induct && (() => {
        const v = induct.vehicle
        const cands = candidatesFor(v)
        const others = staff.filter(p => p.location_id === v.location_id && !cands.some(c => c.id === p.id))
        const n = Object.values(induct.picks).filter(Boolean).length
        return (
          <div className="card" style={{ borderLeft: '4px solid var(--teal)' }}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>Who needs inducting on {v.type} {v.rego}?</h2>
              <button className="secondary small" onClick={() => setInduct(null)}>Close</button>
            </div>
            {!v.risk_assessment_path && (
              <div className="error" style={{ marginTop: 10 }}>
                No risk assessment uploaded for this machine yet. Staff read and sign the risk assessment as part of the induction — upload it before they start.
              </div>
            )}
            <p className="muted" style={{ fontSize: 13 }}>
              Ticked by default: everyone at this store whose role or licences suit a {v.type.toLowerCase()}. Untick anyone who won't operate it.
            </p>
            <div className="checkgrid">
              {cands.map(p => (
                <label key={p.id}>
                  <input type="checkbox" checked={!!induct.picks[p.id]}
                    onChange={e => setInduct({ ...induct, picks: { ...induct.picks, [p.id]: e.target.checked } })} />
                  {p.name}{p.is_test ? ' (test)' : ''} <span className="muted" style={{ fontSize: 12 }}>· {p.roles.join('/') || 'no role'}</span>
                </label>
              ))}
              {cands.length === 0 && <p className="muted">Nobody at this store currently has a matching role or licence.</p>}
            </div>
            {others.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Other staff at this store ({others.length})</summary>
                <div className="checkgrid" style={{ marginTop: 8 }}>
                  {others.map(p => (
                    <label key={p.id}>
                      <input type="checkbox" checked={!!induct.picks[p.id]}
                        onChange={e => setInduct({ ...induct, picks: { ...induct.picks, [p.id]: e.target.checked } })} />
                      {p.name}{p.is_test ? ' (test)' : ''} <span className="muted" style={{ fontSize: 12 }}>· {p.roles.join('/') || 'no role'}</span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={assignInductions} disabled={busy || !n}>{busy ? 'Assigning…' : `Assign induction to ${n} ${n === 1 ? 'person' : 'people'}`}</button>
              <button className="secondary" onClick={() => setInduct(null)}>Not now</button>
            </div>
          </div>
        )
      })()}

      {Object.entries(byLoc).map(([loc, list]) => (
        <div key={loc} className="card">
          <h2>{loc}</h2>
          <table>
            <thead><tr><th>Type</th><th>Rego</th><th>Name</th><th>Induction</th><th>Risk assessment</th><th /></tr></thead>
            <tbody>
              {list.map(v => (edit && edit.id === v.id ? (
                <tr key={v.id}>
                  <td><select value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value })}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></td>
                  <td><input style={{ width: 90 }} value={edit.rego} onChange={e => setEdit({ ...edit, rego: e.target.value })} /></td>
                  <td><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="Name / description" /></td>
                  <td>
                    <select value={edit.location_id} onChange={e => setEdit({ ...edit, location_id: e.target.value })}>
                      {allowedLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </td>
                  <td className="muted">—</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small" onClick={saveEdit}>Save</button> <button className="small secondary" onClick={() => setEdit(null)}>Cancel</button></td>
                </tr>
              ) : (
                <tr key={v.id} style={{ opacity: v.active ? 1 : .5 }}>
                  <td>{v.type || '—'}</td>
                  <td><b>{v.rego}</b></td>
                  <td className="muted">{v.name}</td>
                  <td className="muted">{(() => { const d = docs.find(x => x.id === v.induction_document_id); return d ? `${d.code} ${d.title}` : '—' })()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {v.risk_assessment_path && <button className="small secondary" onClick={() => viewRA(v)}>View</button>}{' '}
                    <label className="small secondary" style={{ display: 'inline-block', cursor: 'pointer', padding: '4px 10px', border: '1px solid #d9dede', borderRadius: 7, background: '#eef1f1' }}>
                      {v.risk_assessment_path ? 'Replace' : 'Upload RA'}
                      <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => uploadRA(v, e.target.files?.[0])} />
                    </label>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small" onClick={() => openInduct(v)}>Induct staff</button> <button className="small secondary" onClick={() => startEdit(v)}>Edit</button> <button className={`small ${v.active ? 'secondary' : ''}`} onClick={() => toggleActive(v)}>{v.active ? 'Active' : 'Inactive'}</button> <button className="small" style={{ color: '#b00020' }} onClick={() => deleteVehicle(v)}>Delete</button></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ))}
      {shownVehicles.length === 0 && <p className="muted">No vehicles registered yet.</p>}
      </div>
    </div>
  )
}
