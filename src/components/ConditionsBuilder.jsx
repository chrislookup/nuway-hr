import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const EMP_TYPES = [['casual', 'Casual'], ['part_time', 'Part-time'], ['full_time', 'Full-time'], ['salary', 'Salary']]
const EMP_LABEL = Object.fromEntries(EMP_TYPES)

// Model: a dimension absent from conditions = "all" (everyone). A stored subset = limited to those.
// "Company-wide" = no dimension limited at all (conditions empty). Narrowing any dimension drops it.
export default function ConditionsBuilder({ value, onChange }) {
  const [locs, setLocs] = useState([])
  const [roles, setRoles] = useState([])
  const [adv, setAdv] = useState(false)
  const [raw, setRaw] = useState('')
  const c = value || {}

  useEffect(() => {
    supabase.from('locations').select('name').eq('active', true).order('name').then(({ data }) => setLocs((data || []).map(l => l.name)))
    supabase.from('job_roles').select('name').eq('active', true).order('name').then(({ data }) => setRoles((data || []).map(r => r.name)))
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

  // is this option currently ticked? (dimension absent => all ticked)
  const isOn = (key, val) => { const arr = c[key]; return !arr || !arr.length ? true : arr.includes(val) }

  // toggle one option within an "all ticked by default" group
  function toggleAllModel(key, val, allOptions) {
    const current = (c[key] && c[key].length) ? c[key] : allOptions.slice()
    const next = current.includes(val) ? current.filter(x => x !== val) : [...current, val]
    // all selected OR none selected => treat as "everyone" for this dimension (store nothing)
    if (next.length === 0 || next.length === allOptions.length) commit({ ...c, [key]: null })
    else commit({ ...c, [key]: next })
  }

  const isCompanyWide = Object.keys(c).length === 0
  function setCompanyWide() { onChange(null) }

  const summary = () => {
    if (isCompanyWide) return 'Everyone'
    const parts = []
    if (c.roles?.length) parts.push(c.roles.join(' / '))
    if (c.employment_type?.length) parts.push(c.employment_type.map(e => EMP_LABEL[e] || e).join(' / '))
    if (c.locations?.length) parts.push('at ' + c.locations.join(', '))
    if (c.age_under) parts.push('under ' + c.age_under)
    return parts.join(' · ') || 'Everyone'
  }

  const Group = ({ label, keyName, options }) => (
    <div style={{ marginTop: 12 }}>
      <label style={{ margin: '0 0 4px' }}>{label} <span className="muted" style={{ fontWeight: 400 }}>(untick any to limit)</span></label>
      <div className="checkgrid">
        {options.map(o => {
          const v = Array.isArray(o) ? o[0] : o, lbl = Array.isArray(o) ? o[1] : o
          return <label key={v}><input type="checkbox" style={{ width: 'auto' }} checked={isOn(keyName, v)} onChange={() => toggleAllModel(keyName, v, options.map(x => Array.isArray(x) ? x[0] : x))} />{lbl}</label>
        })}
      </div>
    </div>
  )

  return (
    <div className="fb-section" style={{ marginTop: 6 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, margin: 0 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={isCompanyWide} onChange={e => { if (e.target.checked) setCompanyWide() }} />
        Company-wide — everyone gets this
      </label>
      <div style={{ fontSize: 13, margin: '6px 0 4px' }}><b>Applies to:</b> <span style={{ color: 'var(--teal)' }}>{summary()}</span></div>
      <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>All options below start ticked (= everyone). Untick to limit — doing so turns off company-wide automatically.</p>

      <Group label="Role" keyName="roles" options={roles} />
      <Group label="Employment type" keyName="employment_type" options={EMP_TYPES} />
      <Group label="Store" keyName="locations" options={locs} />

      <div style={{ marginTop: 12 }}>
        <label style={{ margin: '0 0 4px' }}>Age limit <span className="muted" style={{ fontWeight: 400 }}>(optional — e.g. young-worker docs)</span></label>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>Only staff under</span>
          <input type="number" min="1" style={{ width: 80 }} value={c.age_under || ''} onChange={e => commit({ ...c, age_under: e.target.value ? Number(e.target.value) : null })} />
          <span className="muted" style={{ fontSize: 13 }}>years</span>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <a style={{ cursor: 'pointer', fontSize: 12 }} onClick={() => { setRaw(value ? JSON.stringify(value, null, 2) : ''); setAdv(a => !a) }}>{adv ? 'Hide' : 'Advanced (edit raw rules)'}</a>
        {adv && (
          <div style={{ marginTop: 6 }}>
            <textarea rows={4} value={raw} onChange={e => setRaw(e.target.value)} placeholder='{"roles":["Driver"]}' style={{ fontFamily: 'monospace', fontSize: 12 }} />
            <button type="button" className="small secondary" style={{ marginTop: 6 }} onClick={() => { try { onChange(raw.trim() ? JSON.parse(raw) : null); setAdv(false) } catch { alert('That isn’t valid JSON — check the brackets and quotes.') } }}>Apply raw rules</button>
          </div>
        )}
      </div>
    </div>
  )
}
