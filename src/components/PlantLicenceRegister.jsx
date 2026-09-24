import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

// Live replacement for the per-store "Plant Licence Register" spreadsheet.
// Everything here is derived from staff profiles + the licences they upload,
// so it is current the moment a licence is added, verified, renewed or expires.

const DAY = 864e5
const isExp = d => d && new Date(d) < new Date()
const isSoon = (d, days = 60) => d && !isExp(d) && new Date(d) < new Date(Date.now() + days * DAY)

function ageUnder18(dob, start) {
  if (!dob) return null
  const d = new Date(dob), now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age < 18
}

function Expiry({ date, na }) {
  if (na) return <span className="muted">n/a</span>
  if (!date) return <span className="muted">—</span>
  return <span className={isExp(date) ? 'badge overdue' : isSoon(date) ? 'badge awaiting_review' : ''}>{fmtDate(date)}</span>
}

// One machine column: shows how the person is covered — licensed, on a logbook, or not at all
function Cover({ lic, logbook }) {
  if (lic) return (
    <>
      <span className="badge completed">✔ Licensed</span>
      {!lic.verified_at && <div style={{ fontSize: 11, color: '#b7791f' }}>unverified</div>}
    </>
  )
  if (logbook) return (
    <>
      <span className="badge in_progress">Logbook</span>
      <div style={{ fontSize: 11 }} className={isExp(logbook.expiry_date) ? 'badge overdue' : 'muted'}>
        {isExp(logbook.expiry_date) ? 'logbook expired' : `to ${fmtDate(logbook.expiry_date)}`}
      </div>
    </>
  )
  return <span className="muted">n/a</span>
}

export default function PlantLicenceRegister({ profile, locations, allowedLocIds }) {
  const [rows, setRows] = useState(null)
  const [locId, setLocId] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [filters, setFilters] = useState([])      // e.g. ['forklift','HR']
  const [matchAll, setMatchAll] = useState(false) // any vs all of the ticked items
  const isAdmin = profile?.tier === 'admin'
  const ALL = '__all'

  const locs = (locations || []).filter(l => !allowedLocIds || allowedLocIds.includes(l.id))

  useEffect(() => { if (!locId && locs.length) setLocId(locs[0].id) }, [locs.length])

  useEffect(() => {
    if (!locId) return
    setRows(null);
    (async () => {
      let q = supabase.from('employee_locations')
        .select('employee_id, location_id, locations(name), profiles(id, first_name, last_name, start_date, end_date, date_of_birth, employment_type, status, is_test, employee_job_roles(job_roles(name)))')
      q = locId === ALL ? q.in('location_id', locs.map(l => l.id)) : q.eq('location_id', locId)
      const { data: els } = await q
      // someone at several stores appears once, with all their stores listed
      const byId = {}
      for (const x of els || []) {
        if (!x.profiles) continue
        const cur = byId[x.profiles.id] || (byId[x.profiles.id] = { ...x.profiles, stores: [] })
        if (x.locations?.name && !cur.stores.includes(x.locations.name)) cur.stores.push(x.locations.name)
      }
      const people = Object.values(byId)
      const ids = people.map(p => p.id)
      let lics = []
      if (ids.length) {
        const { data } = await supabase.from('licences')
          .select('*, licence_types(name)').in('employee_id', ids).eq('active', true)
        lics = data || []
      }
      const byEmp = {}
      for (const l of lics) (byEmp[l.employee_id] = byEmp[l.employee_id] || []).push(l)
      const pick = (list, re) => (list || []).find(l => re.test(l.licence_types?.name || ''))
      setRows(people.map(p => {
        const mine = byEmp[p.id] || []
        return {
          p,
          roles: (p.employee_job_roles || []).map(r => r.job_roles?.name).filter(Boolean),
          driver: pick(mine, /^Driver Licence/i),
          forklift: pick(mine, /^Forklift \(/i),
          forkLog: pick(mine, /^Forklift Logbook/i),
          loader: pick(mine, /^Front End Loader/i),
          loadLog: pick(mine, /^Loader Logbook/i),
        }
      }).sort((a, b) => (a.p.first_name || '').localeCompare(b.p.first_name || '')))
    })()
  }, [locId])

  const locName = locId === ALL ? 'All stores' : (locs.find(l => l.id === locId)?.name || '')
  const active = (rows || []).filter(r => r.p.status === 'active')
  const past = (rows || []).filter(r => r.p.status !== 'active')

  // tick-box filters: machine cover, logbooks, and driver licence class
  const PLANT = [['forklift', 'Forklift licence'], ['loader', 'Loader licence'], ['forkLog', 'Forklift logbook'], ['loadLog', 'Loader logbook']]
  const classesPresent = [...new Set((rows || []).map(r => (r.driver?.licence_class || '').trim().toUpperCase()).filter(Boolean))]
  const CLASS_ORDER = ['C', 'LR', 'MR', 'HR', 'HC', 'MC']
  const classes = [...CLASS_ORDER.filter(c => classesPresent.includes(c)), ...classesPresent.filter(c => !CLASS_ORDER.includes(c)).sort()]
  const meets = (r, f) => {
    if (['forklift', 'loader', 'forkLog', 'loadLog'].includes(f)) return !!r[f]
    return (r.driver?.licence_class || '').trim().toUpperCase() === f
  }
  const passes = r => !filters.length || (matchAll ? filters.every(f => meets(r, f)) : filters.some(f => meets(r, f)))
  const toggleFilter = f => setFilters(cur => cur.includes(f) ? cur.filter(x => x !== f) : [...cur, f])
  const base = showPast ? past : active
  const shown = base.filter(passes)

  // headline counts — what a manager needs to act on
  const flags = active.reduce((acc, r) => {
    for (const l of [r.driver, r.forklift, r.loader, r.forkLog, r.loadLog]) {
      if (!l) continue
      if (isExp(l.expiry_date)) acc.expired++
      else if (isSoon(l.expiry_date)) acc.soon++
      if (!l.verified_at) acc.unverified++
    }
    if (!r.driver && r.roles.some(x => /driver/i.test(x))) acc.missing++
    return acc
  }, { expired: 0, soon: 0, unverified: 0, missing: 0 })

  function exportCsv() {
    const head = ['#', 'Staff member', ...(locId === ALL ? ['Store'] : []), 'Under 18', 'Started', 'Duties', 'Employment', 'DL class', 'DL state', 'DL number', 'Transmission', 'DL expiry', 'Loader', 'Loader number', 'Forklift', 'Forklift number', 'Forklift expiry']
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = shown.map((r, i) => [
      i + 1, `${r.p.first_name} ${r.p.last_name || ''}`.trim(), ...(locId === ALL ? [(r.p.stores || []).join(' / ')] : []),
      ageUnder18(r.p.date_of_birth) ? 'YES' : 'No',
      r.p.start_date || '', r.roles.join(' / '), r.p.employment_type || '',
      r.driver?.licence_class || '', r.driver?.state === 'Overseas' ? (r.driver?.country || 'Overseas') : (r.driver?.state || ''),
      r.driver?.licence_number || '', r.driver?.transmission || '', r.driver?.expiry_date || '',
      r.loader ? 'Licensed' : r.loadLog ? 'Logbook' : 'n/a', r.loader?.licence_number || '',
      r.forklift ? 'Licensed' : r.forkLog ? 'Logbook' : 'n/a', r.forklift?.licence_number || '', r.forklift?.expiry_date || '',
    ].map(esc).join(','))
    const csv = [`"Plant Licence Register — ${locName}${showPast ? ' (past employees)' : ''}${filters.length ? ' — filtered: ' + filters.join(', ') : ''}","Generated ${new Date().toLocaleString('en-AU')}"`, '', head.map(esc).join(','), ...lines].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `Plant Licence Register - ${locName}${showPast ? ' - past' : ''} - ${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Plant licence register</h2>
        <div className="row" style={{ gap: 8 }}>
          <select style={{ width: 170 }} value={locId} onChange={e => setLocId(e.target.value)}>
            {isAdmin && locs.length > 1 && <option value={ALL}>All stores</option>}
            {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className={showPast ? '' : 'secondary'} onClick={() => setShowPast(v => !v)}>{showPast ? 'Showing past staff' : 'Past staff'}</button>
          <button className="secondary" onClick={exportCsv} disabled={!shown.length}>Export</button>
          <button className="secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Live from staff licences — updates the moment someone adds or renews one. Replaces the Dropbox spreadsheet.
      </p>

      {rows && (
        <div className="doc-content" style={{ margin: '0 0 12px', padding: '10px 12px' }}>
          <div className="row between" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ fontSize: 13 }}>Show only staff with</b>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              {filters.length > 1 && (
                <select style={{ width: 150, padding: '4px 8px', fontSize: 13 }} value={matchAll ? 'all' : 'any'} onChange={e => setMatchAll(e.target.value === 'all')}>
                  <option value="any">any ticked item</option>
                  <option value="all">all ticked items</option>
                </select>
              )}
              {filters.length > 0 && <button className="secondary small" onClick={() => setFilters([])}>Clear</button>}
            </div>
          </div>
          <div className="checkgrid" style={{ marginTop: 6 }}>
            {PLANT.map(([k, lab]) => (
              <label key={k}><input type="checkbox" checked={filters.includes(k)} onChange={() => toggleFilter(k)} />{lab}</label>
            ))}
            {classes.map(c => (
              <label key={c}><input type="checkbox" checked={filters.includes(c)} onChange={() => toggleFilter(c)} />{c} driver licence</label>
            ))}
          </div>
          {filters.length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
              Showing {shown.length} of {base.length} staff. Licence classes match exactly — an HR holder won't appear under MR.
            </p>
          )}
        </div>
      )}

      {rows === null && <p className="muted">Loading…</p>}

      {rows && !showPast && (
        <div className="row" style={{ gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          {flags.expired > 0 && <span className="badge overdue">{flags.expired} expired</span>}
          {flags.soon > 0 && <span className="badge awaiting_review">{flags.soon} expiring within 60 days</span>}
          {flags.unverified > 0 && <span className="badge in_progress">{flags.unverified} awaiting manager check</span>}
          {flags.missing > 0 && <span className="badge overdue">{flags.missing} driver(s) with no licence on file</span>}
          {!flags.expired && !flags.soon && !flags.unverified && !flags.missing && active.length > 0 && <span className="badge completed">All current</span>}
        </div>
      )}

      {rows && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: 13, minWidth: 900 }}>
            <thead>
              <tr>
                <th>#</th><th>Staff member</th>{locId === ALL && <th>Store</th>}<th>U18</th><th>Started</th><th>Duties</th><th>Employment</th>
                <th>Driver licence</th><th>Expiry</th><th>Loader</th><th>Forklift</th><th>Forklift expiry</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.p.id}>
                  <td className="muted">{i + 1}</td>
                  <td><Link to={`/employee/${r.p.id}`}>{r.p.first_name} {r.p.last_name}</Link>{r.p.is_test && <span className="muted" style={{ fontSize: 11 }}> · test</span>}</td>
                  {locId === ALL && <td className="muted">{(r.p.stores || []).join(', ')}</td>}
                  <td>{ageUnder18(r.p.date_of_birth) ? <span className="badge awaiting_review">U18</span> : <span className="muted">✘</span>}</td>
                  <td className="muted">{r.p.start_date ? fmtDate(r.p.start_date) : '—'}</td>
                  <td className="muted">{r.roles.join(' / ') || '—'}</td>
                  <td className="muted">{(r.p.employment_type || '').replace('_', '-') || '—'}</td>
                  <td>
                    {r.driver ? (<>
                      <b>{r.driver.licence_class || '—'}</b>
                      <span className="muted"> {r.driver.state === 'Overseas' ? (r.driver.country || 'Overseas') : r.driver.state || ''}</span>
                      {r.driver.transmission && <span className="muted"> · {r.driver.transmission}</span>}
                      <div className="muted" style={{ fontSize: 11 }}>{r.driver.licence_number || ''}{!r.driver.verified_at ? ' · unverified' : ''}</div>
                    </>) : r.roles.some(x => /driver/i.test(x))
                      ? <span className="badge overdue">none on file</span>
                      : <span className="muted">n/a</span>}
                  </td>
                  <td><Expiry date={r.driver?.expiry_date} na={!r.driver} /></td>
                  <td><Cover lic={r.loader} logbook={r.loadLog} /></td>
                  <td><Cover lic={r.forklift} logbook={r.forkLog} /></td>
                  <td><Expiry date={r.forklift?.expiry_date} na={!r.forklift} /></td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={locId === ALL ? 12 : 11} className="muted">{filters.length ? 'Nobody matches the ticked filters.' : showPast ? 'No past employees here.' : 'No staff here yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {rows && !showPast && (() => {
        const learners = shown.filter(r => r.forkLog || r.loadLog)
        return (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 4 }}>Training logbook register</h3>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Logbook operators must have a fully licensed operator on site at all times.</p>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Learner</th><th>Machine</th><th>Started</th><th>Completion due (6 months)</th><th>Status</th></tr></thead>
              <tbody>
                {learners.flatMap(r => [r.forkLog && ['Forklift', r.forkLog], r.loadLog && ['Loader', r.loadLog]].filter(Boolean).map(([machine, lg]) => (
                  <tr key={lg.id}>
                    <td>{r.p.first_name} {r.p.last_name}</td>
                    <td>{machine}</td>
                    <td className="muted">{lg.issue_date ? fmtDate(lg.issue_date) : '—'}</td>
                    <td><Expiry date={lg.expiry_date} /></td>
                    <td>{isExp(lg.expiry_date)
                      ? <span className="badge overdue">Expired — licence required</span>
                      : isSoon(lg.expiry_date, 30) ? <span className="badge awaiting_review">Due soon</span> : <span className="badge completed">In training</span>}</td>
                  </tr>
                )))}
                {learners.length === 0 && <tr><td colSpan={5} className="muted">No one at this store is currently on a training logbook.</td></tr>}
              </tbody>
            </table>
          </div>
        )
      })()}
    </div>
  )
}
