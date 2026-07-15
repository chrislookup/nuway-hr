import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PreEmployment({ profile }) {
  const isAdmin = profile.tier === 'admin'
  const [roles, setRoles] = useState([])
  const [map, setMap] = useState([])          // {job_role_id, document_id}
  const [preDocs, setPreDocs] = useState([])  // all pre-employment docs
  const [vers, setVers] = useState({})        // document_id -> pdf_path
  const [sel, setSel] = useState([])          // selected role ids
  const [showCfg, setShowCfg] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    const { data: r } = await supabase.from('job_roles').select('id, name').eq('active', true).order('name')
    setRoles(r || [])
    const { data: m } = await supabase.from('role_pre_documents').select('job_role_id, document_id')
    setMap(m || [])
    const { data: d } = await supabase.from('documents').select('id, code, title, current_version_id').eq('pre_employment', true).order('code')
    setPreDocs(d || [])
    const vids = (d || []).map(x => x.current_version_id).filter(Boolean)
    if (vids.length) { const { data: v } = await supabase.from('document_versions').select('id, pdf_path').in('id', vids); const mm = {}; for (const x of d || []) { const vv = (v || []).find(z => z.id === x.current_version_id); mm[x.id] = vv?.pdf_path || null } setVers(mm) }
  }
  useEffect(() => { load() }, [])

  function toggleRole(id) { setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]) }

  const docById = Object.fromEntries(preDocs.map(d => [d.id, d]))
  const packIds = new Set()
  for (const m of map) if (sel.includes(m.job_role_id)) packIds.add(m.document_id)
  const pack = [...packIds].map(id => docById[id]).filter(Boolean).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))

  async function openForm(d) {
    const path = vers[d.id]
    if (!path) { setMsg(`${d.code} has no PDF uploaded yet — an admin can add it in Admin → Documents → ${d.code} → Master file.`); return }
    const { data } = await supabase.storage.from('masters').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const hasMap = (roleId, docId) => map.some(m => m.job_role_id === roleId && m.document_id === docId)
  async function toggleMap(roleId, docId) {
    if (hasMap(roleId, docId)) await supabase.from('role_pre_documents').delete().eq('job_role_id', roleId).eq('document_id', docId)
    else await supabase.from('role_pre_documents').insert({ job_role_id: roleId, document_id: docId })
    load()
  }

  return (
    <div>
      <h1>Pre-employment</h1>
      <p className="muted">Select the position(s) an applicant is applying for to get the set of forms to print. These are filled in by hand — scan the completed copies, save them on your computer, and email them to Nuway HR for approval. Nothing is stored here.</p>

      <div className="card">
        <h2>Position(s)</h2>
        <div className="checkgrid">
          {roles.map(r => <label key={r.id}><input type="checkbox" style={{ width: 'auto' }} checked={sel.includes(r.id)} onChange={() => toggleRole(r.id)} />{r.name}</label>)}
        </div>
        {msg && <div className="error" style={{ marginTop: 10 }}>{msg}</div>}
        {sel.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3>Forms to print ({pack.length})</h3>
            {pack.length === 0 && <p className="muted">No forms mapped to the selected position(s) yet.</p>}
            <table><tbody>
              {pack.map(d => (
                <tr key={d.id}>
                  <td><b>{d.code}</b> {d.title}</td>
                  <td className="muted">{vers[d.id] ? 'PDF ready' : 'no PDF yet'}</td>
                  <td style={{ textAlign: 'right' }}><button className="small" onClick={() => openForm(d)}>Open / print ↗</button></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="card">
          <div className="row between"><h2>Manage forms per position</h2>
            <button className="small secondary" onClick={() => setShowCfg(v => !v)}>{showCfg ? 'Hide' : 'Configure'}</button></div>
          {showCfg && (
            <>
              <p className="muted" style={{ fontSize: 12 }}>Tick which pre-employment forms each position requires. To add a new form, create it in Admin → Documents, tick “Pre-employment form”, and upload its PDF master.</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Form</th>{roles.map(r => <th key={r.id} style={{ textAlign: 'center' }}>{r.name}</th>)}</tr></thead>
                  <tbody>
                    {preDocs.map(d => (
                      <tr key={d.id}>
                        <td><b>{d.code}</b> {d.title} {!vers[d.id] && <span className="muted">(no PDF)</span>}</td>
                        {roles.map(r => (
                          <td key={r.id} style={{ textAlign: 'center' }}>
                            <input type="checkbox" style={{ width: 'auto' }} checked={hasMap(r.id, d.id)} onChange={() => toggleMap(r.id, d.id)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {preDocs.length === 0 && <tr><td colSpan={roles.length + 1} className="muted">No pre-employment forms yet. Flag a document as “Pre-employment form” in the document editor.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
