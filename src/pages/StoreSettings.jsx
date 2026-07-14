import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
      setMsg(`${nv.type} ${nv.rego} added. Assign its induction to specific staff from their profile (Team → person → Vehicle inductions).`)
      setNv({ type: 'Forklift', rego: '', name: '', location_id: '', induction_document_id: '' }); load()
    } catch (e) { setMsg(e.message || String(e)) }
    setBusy(false)
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

  return (
    <div>
      <h1>Store settings — vehicles</h1>
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
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small secondary" onClick={() => startEdit(v)}>Edit</button> <button className={`small ${v.active ? 'secondary' : ''}`} onClick={() => toggleActive(v)}>{v.active ? 'Active' : 'Inactive'}</button> <button className="small" style={{ color: '#b00020' }} onClick={() => deleteVehicle(v)}>Delete</button></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ))}
      {shownVehicles.length === 0 && <p className="muted">No vehicles registered yet.</p>}
    </div>
  )
}
