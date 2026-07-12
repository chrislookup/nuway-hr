import { useState } from 'react'
import { supabase } from '../lib/supabase'

const EMPTY = { licence_type_id: '', licence_class: '', state: '', licence_number: '', conditions: '', issue_date: '', expiry_date: '' }

export default function LicenceForm({ employeeId, licenceTypes, verifiedBy, onSaved, onCancel }) {
  const [f, setF] = useState(EMPTY)
  const [front, setFront] = useState(null)
  const [back, setBack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function upload(file, side) {
    if (!file) return null
    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${employeeId}/licence-${Date.now()}-${side}-${safe}`
    const { error } = await supabase.storage.from('licences').upload(path, file, { upsert: true })
    if (error) throw error
    return path
  }

  async function save() {
    if (!f.licence_type_id) { setErr('Please choose a licence type.'); return }
    setBusy(true); setErr('')
    try {
      const front_image_path = await upload(front, 'front')
      const back_image_path = await upload(back, 'back')
      const { error } = await supabase.from('licences').insert({
        licence_type_id: f.licence_type_id, licence_class: f.licence_class || null, state: f.state || null,
        licence_number: f.licence_number || null, conditions: f.conditions || null,
        issue_date: f.issue_date || null, expiry_date: f.expiry_date || null,
        front_image_path, back_image_path, employee_id: employeeId,
        verified_by: verifiedBy || null, verified_at: verifiedBy ? new Date().toISOString() : null,
      })
      if (error) throw error
      setF(EMPTY); setFront(null); setBack(null); if (onSaved) onSaved()
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  return (
    <div className="fb-section" style={{ marginTop: 10 }}>
      <div className="row">
        <div style={{ flex: 1 }}><label>Licence type</label>
          <select value={f.licence_type_id} onChange={e => setF({ ...f, licence_type_id: e.target.value })}>
            <option value="">— select —</option>
            {(licenceTypes || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div style={{ width: 130 }}><label>Class</label><input value={f.licence_class} onChange={e => setF({ ...f, licence_class: e.target.value })} placeholder="e.g. HR, MC, LF" /></div>
        <div style={{ width: 90 }}><label>State</label><input value={f.state} onChange={e => setF({ ...f, state: e.target.value })} placeholder="QLD" /></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Licence number</label><input value={f.licence_number} onChange={e => setF({ ...f, licence_number: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label>Conditions</label><input value={f.conditions} onChange={e => setF({ ...f, conditions: e.target.value })} placeholder="e.g. S — must wear glasses" /></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Issue / start date</label><input type="date" value={f.issue_date} onChange={e => setF({ ...f, issue_date: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label>Expiry date</label><input type="date" value={f.expiry_date} onChange={e => setF({ ...f, expiry_date: e.target.value })} /></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Front photo (take a photo or choose a file)</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setFront(e.target.files?.[0] || null)} /></div>
        <div style={{ flex: 1 }}><label>Back photo</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setBack(e.target.files?.[0] || null)} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save licence'}</button>
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
