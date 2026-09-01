import { useState } from 'react'
import { supabase } from '../lib/supabase'

const EMPTY = {
  licence_type_id: '', licence_class: '', state: '', country: '', licence_number: '',
  conditions: '', transmission: '', issue_date: '', expiry_date: '',
}

// Australian states + overseas option. "Overseas" reveals a country box.
const STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT', 'Overseas']

function addMonths(dateStr, months) {
  const d = new Date(dateStr)
  if (isNaN(d)) return ''
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export default function LicenceForm({ employeeId, licenceTypes, verifiedBy, onSaved, onCancel }) {
  const [f, setF] = useState(EMPTY)
  const [front, setFront] = useState(null)
  const [back, setBack] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const type = (licenceTypes || []).find(t => t.id === f.licence_type_id)
  const overseas = f.state === 'Overseas'

  // choosing a type with a fixed validity (e.g. 6-month logbooks) pre-fills expiry from the issue date
  function setType(id) {
    const t = (licenceTypes || []).find(x => x.id === id)
    const next = { ...f, licence_type_id: id }
    if (t?.validity_months && f.issue_date) next.expiry_date = addMonths(f.issue_date, t.validity_months)
    setF(next)
  }
  function setIssue(v) {
    const next = { ...f, issue_date: v }
    if (type?.validity_months && v) next.expiry_date = addMonths(v, type.validity_months)
    setF(next)
  }

  async function upload(file, side) {
    if (!file) return null
    const safe = file.name.replace(/[^\w.\-]+/g, '_')
    const path = `${employeeId}/licence-${Date.now()}-${side}-${safe}`
    const { error } = await supabase.storage.from('licences').upload(path, file, { upsert: true })
    if (error) throw error
    return path
  }

  async function save() {
    setErr('')
    if (!f.licence_type_id) { setErr('Please choose a licence type.'); return }
    if (type?.requires_expiry && !f.expiry_date) { setErr(`An expiry date is required for ${type.name}.`); return }
    if (type?.requires_class && !f.licence_class.trim()) { setErr(`Please enter the licence class for ${type.name} (e.g. C, LR, MR, HR, HC, MC).`); return }
    if (type?.requires_state && !f.state) { setErr(`Please choose the state (or Overseas) for ${type.name}.`); return }
    if (overseas && !f.country.trim()) { setErr('Please enter the country that issued the licence.'); return }
    if (type?.transmission_applies && !f.transmission) { setErr('Please choose automatic or manual.'); return }
    setBusy(true)
    try {
      const front_image_path = await upload(front, 'front')
      const back_image_path = await upload(back, 'back')
      const { error } = await supabase.from('licences').insert({
        licence_type_id: f.licence_type_id,
        licence_class: f.licence_class.trim() || null,
        state: f.state || null,
        country: overseas ? f.country.trim() : null,
        licence_number: f.licence_number.trim() || null,
        conditions: f.conditions.trim() || null,
        transmission: f.transmission || null,
        issue_date: f.issue_date || null,
        expiry_date: f.expiry_date || null,
        front_image_path, back_image_path, employee_id: employeeId,
        verified_by: verifiedBy || null, verified_at: verifiedBy ? new Date().toISOString() : null,
      })
      if (error) throw error
      setF(EMPTY); setFront(null); setBack(null); if (onSaved) onSaved()
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  const req = <span style={{ color: '#b00020' }}>*</span>

  return (
    <div className="fb-section" style={{ marginTop: 10 }}>
      <div className="row">
        <div style={{ flex: 1 }}><label>Licence type {req}</label>
          <select value={f.licence_type_id} onChange={e => setType(e.target.value)}>
            <option value="">— select —</option>
            {(licenceTypes || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></div>
        <div style={{ width: 150 }}><label>Class {type?.requires_class && req}</label>
          <input value={f.licence_class} onChange={e => setF({ ...f, licence_class: e.target.value })} placeholder="e.g. C, HR, MC" /></div>
        <div style={{ width: 140 }}><label>State {type?.requires_state && req}</label>
          <select value={f.state} onChange={e => setF({ ...f, state: e.target.value, country: e.target.value === 'Overseas' ? f.country : '' })}>
            <option value="">— select —</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        {overseas && (
          <div style={{ width: 170 }}><label>Issuing country {req}</label>
            <input value={f.country} onChange={e => setF({ ...f, country: e.target.value })} placeholder="e.g. New Zealand" /></div>
        )}
      </div>
      {type?.transmission_applies && (
        <div className="row">
          <div style={{ width: 260 }}><label>Transmission {req}</label>
            <select value={f.transmission} onChange={e => setF({ ...f, transmission: e.target.value })}>
              <option value="">— select —</option>
              <option value="auto">Automatic</option>
              <option value="manual">Manual</option>
            </select></div>
          <div className="muted" style={{ fontSize: 13, alignSelf: 'flex-end', paddingBottom: 9 }}>
            A driver on an automatic-only licence must not be rostered to a manual vehicle.
          </div>
        </div>
      )}
      <div className="row">
        <div style={{ flex: 1 }}><label>Licence number</label><input value={f.licence_number} onChange={e => setF({ ...f, licence_number: e.target.value })} /></div>
        <div style={{ flex: 1 }}><label>Conditions</label><input value={f.conditions} onChange={e => setF({ ...f, conditions: e.target.value })} placeholder="e.g. S — must wear glasses" /></div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Issue / start date</label><input type="date" value={f.issue_date} onChange={e => setIssue(e.target.value)} /></div>
        <div style={{ flex: 1 }}><label>Expiry date {type?.requires_expiry && req}</label>
          <input type="date" value={f.expiry_date} onChange={e => setF({ ...f, expiry_date: e.target.value })} />
          {type?.validity_months ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Valid for {type.validity_months} months — filled in automatically from the issue date, change it if needed.</div> : null}
        </div>
      </div>
      <div className="row">
        <div style={{ flex: 1 }}><label>Front photo (take a photo or choose a file)</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setFront(e.target.files?.[0] || null)} /></div>
        <div style={{ flex: 1 }}><label>Back photo</label>
          <input type="file" accept="image/*" capture="environment" onChange={e => setBack(e.target.files?.[0] || null)} /></div>
      </div>
      {!verifiedBy && <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Your manager will check this against your physical licence before it counts as verified.</p>}
      {err && <div className="error">{err}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save licence'}</button>
        {onCancel && <button className="secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
