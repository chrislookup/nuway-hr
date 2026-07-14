import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const EMP_TYPES = [['casual', 'Casual'], ['part_time', 'Part-time'], ['full_time', 'Full-time'], ['salary', 'Salary']]
const EMP_LABEL = Object.fromEntries(EMP_TYPES)

export default function ConditionsBuilder({ value, onChange }) {
  const [locs, setLocs] = useState([])
  const [adv, setAdv] = useState(false)
  const [raw, setRaw] = useState('')
  const c = value || {}

  useEffect(() => {
    supabase.from('locations').select('name').eq('active', true).order('name')
      .then(({ data }) => setLocs((data || []).map(l => l.name)))
  }, [])

  function commit(next) {
    const clean = {}
    for (const [k, v] of Object.entries(next)) {
      if (v == null) continue
      if (Array.isArray(v)) { if (v.length) clean[k] = v }
      else if (v !== '') clean[k] = v
    }
    onChange(Object.keys(clean).length ? clean : null)
  }
  const toggle = (key, val) => {
    const arr = c[key] || []
    commit({ ...c, [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] })
  }
  const empSel = c.employment_type || []
  const locSel = c.locations || []

  const summary = () => {
    const parts = []
    if (empSel.length) parts.push(empSel.map(e => EMP_LABEL[e] || e).join(' / ') + ' staff')
    if (locSel.length) parts.push('at ' + locSel.join(', '))
    if (c.age_under) parts.push('under ' + c.age_under)
    return parts.length ? parts.join(' ') : 'Everyone'
  }

  return (
    <div className="fb-section" style={{ marginTop: 6 }}>
      <div style={{ fontSize: 13, marginBottom: 8 }}><b>Applies to:</b> <span style={{ color: 'var(--teal)' }}>{summary()}</span></div>

      <label style={{ margin: '4px 0' }}>Employment type <span className="muted" style={{ fontWeight: 400 }}>(tick to limit — none ticked = all types)</span></label>
      <div className="checkgrid">
        {EMP_TYPES.map(([v, lbl]) => (
          <label key={v}><input type="checkbox" style={{ width: 'auto' }} checked={empSel.includes(v)} onChange={() => toggle('employment_type', v)} />{lbl}</label>
        ))}
      </div>

      <label style={{ margin: '10px 0 4px' }}>Stores <span className="muted" style={{ fontWeight: 400 }}>(tick to limit — none ticked = all stores)</span></label>
      <div className="checkgrid">
        {locs.map(l => (
          <label key={l}><input type="checkbox" style={{ width: 'auto' }} checked={locSel.includes(l)} onChange={() => toggle('locations', l)} />{l}</label>
        ))}
      </div>

      <label style={{ margin: '10px 0 4px' }}>Age limit <span className="muted" style={{ fontWeight: 400 }}>(optional — e.g. young-worker docs)</span></label>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Only staff under</span>
        <input type="number" min="1" style={{ width: 80 }} value={c.age_under || ''} onChange={e => commit({ ...c, age_under: e.target.value ? Number(e.target.value) : null })} />
        <span className="muted" style={{ fontSize: 13 }}>years</span>
      </div>

      <div style={{ marginTop: 10 }}>
        <a style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => { setRaw(value ? JSON.stringify(value, null, 2) : ''); setAdv(a => !a) }}>{adv ? 'Hide' : 'Advanced (edit raw rules)'}</a>
        {adv && (
          <div style={{ marginTop: 6 }}>
            <textarea rows={4} value={raw} onChange={e => setRaw(e.target.value)} placeholder='{"employment_type":["casual"]}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <button type="button" className="small secondary" style={{ marginTop: 6 }} onClick={() => { try { onChange(raw.trim() ? JSON.parse(raw) : null); setAdv(false) } catch { alert('That isn’t valid JSON — check the brackets and quotes.') } }}>Apply raw rules</button>
          </div>
        )}
      </div>
    </div>
  )
}
