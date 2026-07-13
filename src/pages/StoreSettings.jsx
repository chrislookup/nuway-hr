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

  async function load() {
    const { data: l } = await supabase.from('locations').select('*').eq('active', true).order('name')
    setLocations(l || [])
    const { data: v } = await supabase.from('vehicles').select('*, locations(name)').order('rego')
    setVehicles(v || [])
    const { data: d } = await supabase.from('documents').select('id, code, title').eq('active', true).order('code')
    setDocs(d || [])
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
      const { data: v, error } = await supabase.from('vehicles').insert({
        type: nv.type, rego: nv.rego.trim(), name: nv.name.trim() || `${nv.type} ${nv.rego.trim()}`,
        location_id: nv.location_id, induction_document_id: nv.induction_document_id || null, active: true,
      }).select('*').single()
      if (error) throw error
      let assigned = 0
      if (nv.induction_document_id) {
        const { data: els } = await supabase.from('employee_locations').select('employee_id').eq('location_id', nv.location_id)
        const empIds = [...new Set((els || []).map(e => e.employee_id))]
        if (empIds.length) {
          const { data: profs } = await supabase.from('profiles').select('id').in('id', empIds).eq('status', 'active')
          const ids = (profs || []).map(p => p.id)
          const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)
          if (ids.length) await supabase.from('assignments').insert(ids.map(id => ({ employee_id: id, document_id: nv.induction_document_id, vehicle_id: v.id, source: 'manual', assigned_by: profile.id, due_date: due })))
          assigned = ids.length
        }
      }
      setMsg(`${nv.type} ${nv.rego} added${nv.induction_document_id ? ` — induction assigned to ${assigned} staff at this store` : ''}.`)
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
  function startEdit(v) {
    setEdit({ id: v.id, type: v.type || 'Truck', rego: v.rego || '', name: v.name || '', location_id: v.location_id || '', induction_document_id: v.induction_document_id || '' })
  }
  async function saveEdit() {
    if (!edit.rego.trim() || !edit.location_id) { setMsg('Enter a rego and choose a store.'); return }
    const { error } = await supabase.from('vehicles').update({
      type: edit.type, rego: edit.rego.trim(), name: edit.name.trim() || `${edit.type} ${edit.rego.trim()}`,
      location_id: edit.location_id, induction_document_id: edit.induction_document_id || null,
    }).eq('id', edit.id)
    if (error) { setMsg(error.message); return }
    setEdit(null); setMsg('Saved.'); load()
  }

  const byLoc = {}
  for (const v of shownVehicles) { const n = v.locations?.name || 'Unassigned'; (byLoc[n] = byLoc[n] || []).push(v) }

  return (
    <div>
      <h1>Store settings — vehicles</h1>
      <p className="muted">Register the trucks, forklifts and loaders at each store. Attaching an induction assigns it to everyone at that store.</p>

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
          <div style={{ flex: 2, minWidth: 220 }}><label>Induction document (assigned to staff at this store)</label>
            <select value={nv.induction_document_id} onChange={e => setNv({ ...nv, induction_document_id: e.target.value })}>
              <option value="">— none —</option>
              {docs.map(d => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
            </select></div>
        </div>
        <button style={{ marginTop: 10 }} onClick={addVehicle} disabled={busy}>{busy ? 'Adding…' : 'Add vehicle'}</button>
      </div>

      {Object.entries(byLoc).map(([loc, list]) => (
        <div key={loc} className="card">
          <h2>{loc}</h2>
          <table>
            <thead><tr><th>Type</th><th>Rego</th><th>Name</th><th>Induction</th><th /></tr></thead>
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
                    <select style={{ marginTop: 4 }} value={edit.induction_document_id} onChange={e => setEdit({ ...edit, induction_document_id: e.target.value })}>
                      <option value="">— no induction —</option>
                      {docs.map(d => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small" onClick={saveEdit}>Save</button> <button className="small secondary" onClick={() => setEdit(null)}>Cancel</button></td>
                </tr>
              ) : (
                <tr key={v.id} style={{ opacity: v.active ? 1 : .5 }}>
                  <td>{v.type || '—'}</td>
                  <td><b>{v.rego}</b></td>
                  <td className="muted">{v.name}</td>
                  <td className="muted">{(() => { const d = docs.find(x => x.id === v.induction_document_id); return d ? `${d.code} ${d.title}` : '—' })()}</td>
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
