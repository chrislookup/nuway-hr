import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

// Safe Work Procedure training matrix: who has done which SWP.
// Columns are every active document in a "Safe Work Procedures" category (category code
// starting SWP), so new SWPs appear here automatically the moment they're added in Admin.
// Managers only ever see their own staff — the database enforces that, not this screen.

const ALL = '__all'
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }

// fetch past the 1,000-row page limit so big stores don't silently truncate
async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

function cellState(a) {
  if (!a) return 'none'
  if (a.suspended) return 'suspended'
  if (a.status === 'completed') return 'done'
  if (a.status === 'awaiting_review') return 'review'
  if (a.due_date && new Date(a.due_date) < new Date()) return 'overdue'
  return 'todo'
}
const CELL = {
  done: { mark: '✔', bg: '#e0f2e6', fg: '#135c30', label: 'Completed' },
  review: { mark: '◐', bg: '#fdf3e0', fg: '#b7791f', label: 'Awaiting sign-off' },
  overdue: { mark: '!', bg: '#fdeaea', fg: '#b00020', label: 'Overdue' },
  todo: { mark: '○', bg: '#eef2f7', fg: '#56708f', label: 'Assigned, not done' },
  suspended: { mark: '–', bg: '#f1f1f1', fg: '#888', label: 'Suspended' },
  none: { mark: '', bg: 'transparent', fg: '#bbb', label: 'Not assigned' },
}

export default function SwpMatrix({ profile }) {
  const isAdmin = profile.tier === 'admin'
  const [locs, setLocs] = useState([])
  const [locId, setLocId] = useState('')
  const [docs, setDocs] = useState([])
  const [people, setPeople] = useState(null)
  const [asg, setAsg] = useState({})
  const [roleFilter, setRoleFilter] = useState([])
  const [catFilter, setCatFilter] = useState([])
  const [err, setErr] = useState('')

  // stores the viewer can choose from
  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from('locations').select('id, name').eq('active', true).order('name')
      let mine = l || []
      if (!isAdmin) {
        const { data: m } = await supabase.from('manager_location_access').select('location_id').eq('manager_id', profile.id)
        const ids = (m || []).map(x => x.location_id)
        mine = mine.filter(x => ids.includes(x.id))
      }
      setLocs(mine)
      setLocId(mine.length > 1 ? ALL : (mine[0]?.id || ''))
    })()
  }, [profile.id])

  // SWP columns
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('documents')
        .select('id, code, title, active, library, document_categories(code, name, sort_order)')
        .eq('active', true).is('library', null)
      const swp = (data || []).filter(d => (d.document_categories?.code || '').toUpperCase().startsWith('SWP'))
      swp.sort((a, b) =>
        (a.document_categories?.sort_order ?? 999) - (b.document_categories?.sort_order ?? 999) ||
        (a.document_categories?.name || '').localeCompare(b.document_categories?.name || '') ||
        (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
      setDocs(swp)
    })()
  }, [])

  // staff + their SWP assignments for the chosen store(s)
  useEffect(() => {
    if (!locId || !docs.length) return
    setPeople(null); setErr('')
    ;(async () => {
      try {
        const locIds = locId === ALL ? locs.map(l => l.id) : [locId]
        if (!locIds.length) { setPeople([]); return }
        const els = await fetchAll(() => supabase.from('employee_locations')
          .select('employee_id, locations(name), profiles(id, first_name, last_name, status, is_test, employee_job_roles(job_roles(name)))')
          .in('location_id', locIds))
        const byId = {}
        for (const x of els) {
          const p = x.profiles
          if (!p || p.status !== 'active') continue
          const cur = byId[p.id] || (byId[p.id] = {
            ...p, stores: [], roles: (p.employee_job_roles || []).map(r => r.job_roles?.name).filter(Boolean),
          })
          if (x.locations?.name && !cur.stores.includes(x.locations.name)) cur.stores.push(x.locations.name)
        }
        const list = Object.values(byId).sort((a, b) => `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
        const docIds = docs.map(d => d.id)
        const map = {}
        for (const ids of chunk(list.map(p => p.id), 80)) {
          const rows = await fetchAll(() => supabase.from('assignments')
            .select('employee_id, document_id, status, due_date, completed_at, assigned_at, suspended')
            .in('employee_id', ids).in('document_id', docIds).is('vehicle_id', null))
          for (const a of rows) {
            const k = `${a.employee_id}|${a.document_id}`
            // latest assignment wins — a re-issued new version replaces the old tick
            if (!map[k] || new Date(a.assigned_at) > new Date(map[k].assigned_at)) map[k] = a
          }
        }
        setAsg(map); setPeople(list)
      } catch (e) { setErr(e.message || String(e)); setPeople([]) }
    })()
  }, [locId, docs, locs])

  const cats = [...new Map(docs.map(d => [d.document_categories?.name || 'Other', true])).keys()]
  const shortCat = n => n.replace(/^Safe Work Procedures\s*-\s*/i, '') || n
  const cols = docs.filter(d => !catFilter.length || catFilter.includes(d.document_categories?.name || 'Other'))
  const allRoles = [...new Set((people || []).flatMap(p => p.roles))].sort()
  const rows = (people || []).filter(p => !roleFilter.length || p.roles.some(r => roleFilter.includes(r)))
  const toggle = (setter, v) => setter(cur => cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v])
  const shortCode = d => (d.code || '').replace(/^SWP-/i, '')

  // group header spans
  const groups = []
  for (const d of cols) {
    const n = d.document_categories?.name || 'Other'
    if (groups.length && groups[groups.length - 1].name === n) groups[groups.length - 1].span++
    else groups.push({ name: n, span: 1 })
  }

  function exportCsv() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const head = ['Staff member', 'Store(s)', 'Roles', ...cols.map(d => `${d.code} ${d.title}`), 'Completed', 'Assigned']
    const lines = rows.map(p => {
      const cells = cols.map(d => { const a = asg[`${p.id}|${d.id}`]; const st = cellState(a)
        return st === 'done' ? `Completed ${a.completed_at ? fmtDate(a.completed_at) : ''}` : st === 'none' ? '' : CELL[st].label })
      const assigned = cols.filter(d => asg[`${p.id}|${d.id}`]).length
      const done = cols.filter(d => cellState(asg[`${p.id}|${d.id}`]) === 'done').length
      return [`${p.first_name} ${p.last_name || ''}`.trim(), p.stores.join(' / '), p.roles.join(' / '), ...cells, done, assigned].map(esc).join(',')
    })
    const store = locId === ALL ? 'All stores' : (locs.find(l => l.id === locId)?.name || '')
    const csv = [`"SWP training matrix — ${store}","Generated ${new Date().toLocaleString('en-AU')}"`, '', head.map(esc).join(','), ...lines].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `SWP training matrix - ${store} - ${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const stickyL = { position: 'sticky', left: 0, background: '#fff', zIndex: 2 }

  return (
    <div className="card">
      <div className="row between" style={{ flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>SWP training matrix</h2>
        <div className="row" style={{ gap: 8 }}>
          <select style={{ width: 170 }} value={locId} onChange={e => setLocId(e.target.value)}>
            {locs.length > 1 && <option value={ALL}>{isAdmin ? 'All stores' : 'All my stores'}</option>}
            {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="secondary" onClick={exportCsv} disabled={!rows.length}>Export</button>
          <button className="secondary" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Every Safe Work Procedure in Documents appears here automatically — add a new SWP and it gets its own column.
        Hover a heading for the full name, or a cell for the date.
      </p>

      <div className="doc-content" style={{ margin: '0 0 12px', padding: '10px 12px' }}>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <b style={{ fontSize: 13 }}>Roles</b>
            <div className="checkgrid" style={{ marginTop: 4 }}>
              {allRoles.map(r => <label key={r}><input type="checkbox" checked={roleFilter.includes(r)} onChange={() => toggle(setRoleFilter, r)} />{r}</label>)}
            </div>
          </div>
          <div>
            <b style={{ fontSize: 13 }}>SWP groups</b>
            <div className="checkgrid" style={{ marginTop: 4 }}>
              {cats.map(c => <label key={c}><input type="checkbox" checked={catFilter.includes(c)} onChange={() => toggle(setCatFilter, c)} />{shortCat(c)}</label>)}
            </div>
          </div>
        </div>
        {(roleFilter.length > 0 || catFilter.length > 0) && (
          <div className="row" style={{ marginTop: 6, gap: 10, alignItems: 'center' }}>
            <span className="muted" style={{ fontSize: 12 }}>Showing {rows.length} of {(people || []).length} staff · {cols.length} of {docs.length} SWPs</span>
            <button className="secondary small" onClick={() => { setRoleFilter([]); setCatFilter([]) }}>Clear</button>
          </div>
        )}
        <div className="row" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap', fontSize: 12 }}>
          {['done', 'review', 'overdue', 'todo'].map(k => (
            <span key={k}><span style={{ display: 'inline-block', width: 18, textAlign: 'center', background: CELL[k].bg, color: CELL[k].fg, borderRadius: 4, fontWeight: 700 }}>{CELL[k].mark}</span> {CELL[k].label}</span>
          ))}
          <span className="muted">blank = not assigned</span>
        </div>
      </div>

      {err && <div className="error">{err}</div>}
      {people === null && !err && <p className="muted">Loading…</p>}
      {people && !docs.length && <p className="muted">No Safe Work Procedures found in Documents yet.</p>}

      {people && docs.length > 0 && (
        <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table style={{ fontSize: 12, borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 3, background: '#fff' }}>
              <tr>
                <th style={{ ...stickyL, zIndex: 4 }} />
                {locId === ALL && <th />}
                {groups.map((g, i) => (
                  <th key={i} colSpan={g.span} style={{ textAlign: 'center', borderLeft: '2px solid #d6e2dc', fontSize: 11, textTransform: 'none' }}>{shortCat(g.name)}</th>
                ))}
                <th />
              </tr>
              <tr>
                <th style={{ ...stickyL, zIndex: 4, minWidth: 170 }}>Staff member</th>
                {locId === ALL && <th style={{ minWidth: 90 }}>Store</th>}
                {cols.map((d, i) => {
                  const first = i === 0 || cols[i - 1].document_categories?.name !== d.document_categories?.name
                  return (
                    <th key={d.id} title={`${d.code} — ${d.title}`}
                      style={{ padding: '6px 2px', verticalAlign: 'bottom', height: 110, borderLeft: first ? '2px solid #d6e2dc' : undefined }}>
                      <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', fontSize: 11, fontWeight: 600, margin: '0 auto', maxHeight: 104, overflow: 'hidden', textOverflow: 'ellipsis', textTransform: 'none' }}>
                        {shortCode(d)} {d.title.replace(/^SWP\s*-\s*/i, '')}
                      </div>
                    </th>
                  )
                })}
                <th style={{ minWidth: 60 }}>Done</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const assigned = cols.filter(d => asg[`${p.id}|${d.id}`]).length
                const done = cols.filter(d => cellState(asg[`${p.id}|${d.id}`]) === 'done').length
                return (
                  <tr key={p.id}>
                    <td style={{ ...stickyL, whiteSpace: 'nowrap' }}>
                      <Link to={`/employee/${p.id}`}>{p.first_name} {p.last_name}</Link>
                      {p.is_test && <span className="muted" style={{ fontSize: 10 }}> · test</span>}
                      <div className="muted" style={{ fontSize: 10 }}>{p.roles.join(' / ')}</div>
                    </td>
                    {locId === ALL && <td className="muted" style={{ whiteSpace: 'nowrap' }}>{p.stores.join(', ')}</td>}
                    {cols.map((d, i) => {
                      const a = asg[`${p.id}|${d.id}`]
                      const st = cellState(a)
                      const c = CELL[st]
                      const first = i === 0 || cols[i - 1].document_categories?.name !== d.document_categories?.name
                      const tip = `${d.code} — ${d.title}\n${c.label}${st === 'done' && a.completed_at ? ' ' + fmtDate(a.completed_at) : ''}${(st === 'todo' || st === 'overdue') && a.due_date ? ' · due ' + fmtDate(a.due_date) : ''}`
                      return (
                        <td key={d.id} title={tip}
                          style={{ textAlign: 'center', padding: 3, borderLeft: first ? '2px solid #d6e2dc' : undefined }}>
                          {st !== 'none' && (
                            <span style={{ display: 'inline-block', width: 22, lineHeight: '20px', borderRadius: 4, background: c.bg, color: c.fg, fontWeight: 700 }}>{c.mark}</span>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {assigned ? <><b>{done}</b><span className="muted">/{assigned}</span></> : <span className="muted">—</span>}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={cols.length + 3} className="muted">No staff match.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr>
                  <td style={{ ...stickyL, fontWeight: 700 }}>Completed</td>
                  {locId === ALL && <td />}
                  {cols.map((d, i) => {
                    const assigned = rows.filter(p => asg[`${p.id}|${d.id}`]).length
                    const done = rows.filter(p => cellState(asg[`${p.id}|${d.id}`]) === 'done').length
                    const first = i === 0 || cols[i - 1].document_categories?.name !== d.document_categories?.name
                    return <td key={d.id} title={`${d.code}: ${done} of ${assigned} assigned staff completed`}
                      style={{ textAlign: 'center', fontSize: 10, borderLeft: first ? '2px solid #d6e2dc' : undefined }}>
                      {assigned ? `${done}/${assigned}` : ''}
                    </td>
                  })}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
