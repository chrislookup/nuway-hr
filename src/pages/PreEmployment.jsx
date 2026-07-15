import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function PreEmployment({ profile }) {
  const isAdmin = profile.tier === 'admin'
  const [roles, setRoles] = useState([])
  const [map, setMap] = useState([])          // {job_role_id, document_id}
  const [preDocs, setPreDocs] = useState([])
  const [vers, setVers] = useState({})        // document_id -> pdf_path
  const [sel, setSel] = useState([])          // selected role ids
  const [showCfg, setShowCfg] = useState(false)
  const [msg, setMsg] = useState('')
  const [nf, setNf] = useState({ code: '', title: '' })
  const [editForm, setEditForm] = useState(null)
  const [defaultCat, setDefaultCat] = useState(null)
  const [age, setAge] = useState(99)

  async function load() {
    const { data: r } = await supabase.from('job_roles').select('id, name').eq('active', true).order('name')
    setRoles(r || [])
    const { data: m } = await supabase.from('role_pre_documents').select('job_role_id, document_id')
    setMap(m || [])
    const { data: d } = await supabase.from('documents').select('id, code, title, current_version_id, pre_emp_age_max, pre_emp_provided').eq('pre_employment', true).order('code')
    setPreDocs(d || [])
    const vids = (d || []).map(x => x.current_version_id).filter(Boolean)
    const mm = {}
    if (vids.length) { const { data: v } = await supabase.from('document_versions').select('id, pdf_path').in('id', vids); for (const x of d || []) { const vv = (v || []).find(z => z.id === x.current_version_id); mm[x.id] = vv?.pdf_path || null } }
    setVers(mm)
    const { data: cat } = await supabase.from('document_categories').select('id').eq('code', 'F5.0').maybeSingle()
    setDefaultCat(cat?.id || null)
  }
  useEffect(() => { load() }, [])

  function toggleRole(id) { setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]) }
  const docById = Object.fromEntries(preDocs.map(d => [d.id, d]))
  const packIds = new Set()
  for (const m of map) if (sel.includes(m.job_role_id)) packIds.add(m.document_id)
  for (const d of preDocs) if (d.pre_emp_age_max != null && age < d.pre_emp_age_max) packIds.add(d.id)
  const pack = [...packIds].map(id => docById[id]).filter(Boolean).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
  const printForms = pack.filter(d => !d.pre_emp_provided)
  const collectItems = pack.filter(d => d.pre_emp_provided)
  const roleNames = roles.filter(r => sel.includes(r.id)).map(r => r.name).join(', ')
  const ageLabel = age >= 99 ? '18 or over' : age < 16 ? 'Under 16' : 'Under 18 (16–17)'
  const STEPS = [
    'Print the forms below and interview the applicant.',
    'Collect from the applicant: CV / resume, and front & back copies of any licence the role requires (e.g. driver, forklift, loader).',
    'Complete the forms, then STOP & CHECK they are correctly initialled and signed by all relevant parties.',
    'Scan all completed documents.',
    'Name each file per this checklist and the applicant\'s name — e.g. "F5.1.2 – Interview Questions – [Applicant Name]".',
    'Email the completed set to steve@nuway.com.au and brent@nuway.com.au for approval.',
  ]
  function printChecklist() {
    const items = [...printForms.map(d => `${d.code || ''} ${d.title}`), ...collectItems.map(d => d.title)]
    const w = window.open('', '_blank')
    w.document.write(`<html><head><title>Pre-employment checklist</title><style>body{font-family:Segoe UI,sans-serif;padding:28px;color:#222} h1{color:#008C95} h2{color:#008C95;margin-top:20px;font-size:16px} li{margin:7px 0} .box{display:inline-block;width:14px;height:14px;border:1.5px solid #333;margin-right:8px;vertical-align:middle}</style></head><body>
      <h1>Pre-employment checklist</h1>
      <p><b>Position(s):</b> ${roleNames || '—'} &nbsp; <b>Applicant age:</b> ${ageLabel}</p>
      <p><b>Applicant name:</b> ______________________________</p>
      <h2>Documents required</h2><div>${items.map(i => `<div><span class=box></span> ${i}</div>`).join('')}</div>
      <h2>Process</h2><ol>${STEPS.map(x => `<li>${x.replace(/</g,'&lt;')}</li>`).join('')}</ol>
    </body></html>`)
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
  }

  async function openForm(d) {
    const path = vers[d.id]
    if (!path) { setMsg(`${d.code || d.title} has no PDF uploaded yet.`); return }
    const { data } = await supabase.storage.from('masters').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }
  const hasMap = (roleId, docId) => map.some(m => m.job_role_id === roleId && m.document_id === docId)
  async function toggleMap(roleId, docId) {
    if (hasMap(roleId, docId)) await supabase.from('role_pre_documents').delete().eq('job_role_id', roleId).eq('document_id', docId)
    else await supabase.from('role_pre_documents').insert({ job_role_id: roleId, document_id: docId })
    load()
  }
  async function addForm() {
    if (!nf.title.trim()) return
    setMsg('')
    const { error } = await supabase.from('documents').insert({ code: nf.code.trim() || null, title: nf.title.trim(), doc_type: 'standard', pre_employment: true, requires_signature: false, active: true, category_id: defaultCat })
    if (error) { setMsg(error.message); return }
    setNf({ code: '', title: '' }); load()
  }
  async function saveFormEdit() {
    const { error } = await supabase.from('documents').update({ code: editForm.code?.trim() || null, title: editForm.title.trim() }).eq('id', editForm.id)
    if (error) { setMsg(error.message); return }
    setEditForm(null); load()
  }
  async function uploadFormPdf(d, file) {
    if (!file) return
    setMsg('')
    let vid = d.current_version_id
    if (!vid) { const { data: nv, error: ve } = await supabase.from('document_versions').insert({ document_id: d.id, version_no: 1 }).select('id').single(); if (ve) { setMsg(ve.message); return } vid = nv.id; await supabase.from('documents').update({ current_version_id: vid }).eq('id', d.id) }
    const path = `${d.id}/${file.name.replace(/[^\w.\-]+/g, '_')}`
    const { error } = await supabase.storage.from('masters').upload(path, file, { upsert: true, contentType: 'application/pdf' })
    if (error) { setMsg('Upload failed: ' + error.message); return }
    await supabase.from('document_versions').update({ pdf_path: path }).eq('id', vid)
    setMsg(`PDF uploaded for ${d.code || d.title}.`); load()
  }
  async function saveAge(d, val) {
    await supabase.from('documents').update({ pre_emp_age_max: val === '' ? null : Number(val) }).eq('id', d.id)
    load()
  }
  async function deleteForm(d) {
    if (!window.confirm(`Delete pre-employment form "${d.code || ''} ${d.title}"? This removes it from all positions.`)) return
    await supabase.from('role_pre_documents').delete().eq('document_id', d.id)
    await supabase.from('documents').update({ current_version_id: null }).eq('id', d.id)
    await supabase.from('document_versions').delete().eq('document_id', d.id)
    const { error } = await supabase.from('documents').delete().eq('id', d.id)
    if (error) { setMsg('Could not delete (it may be used elsewhere): ' + error.message); return }
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
        <label style={{ marginTop: 12 }}>Applicant age</label>
        <select value={age} onChange={e => setAge(Number(e.target.value))} style={{ width: 240 }}>
          <option value={99}>18 or over</option>
          <option value={17}>Under 18 (16–17)</option>
          <option value={15}>Under 16</option>
        </select>
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Under 18 adds the under-18 consent form; under 16 adds both the under-16 and under-18 forms.</p>
        {msg && <div className="error" style={{ marginTop: 10 }}>{msg}</div>}
        {(sel.length > 0 || pack.length > 0) && (
          <div style={{ marginTop: 14 }}>
            <div className="row between" style={{ alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>Required documents</h3>
              <button className="small" onClick={printChecklist}>🖨 Print checklist</button>
            </div>
            {pack.length === 0 && <p className="muted">No documents mapped to the selected position(s) yet.</p>}
            {printForms.length > 0 && <><p className="muted" style={{ margin: '10px 0 4px', fontWeight: 600 }}>Forms to print &amp; complete</p>
            <table><tbody>
              {printForms.map(d => (
                <tr key={d.id}>
                  <td><b>{d.code}</b> {d.title}</td>
                  <td className="muted">{vers[d.id] ? 'PDF ready' : 'no PDF yet'}</td>
                  <td style={{ textAlign: 'right' }}><button className="small" disabled={!vers[d.id]} onClick={() => openForm(d)}>Open / print ↗</button></td>
                </tr>
              ))}
            </tbody></table></>}
            {collectItems.length > 0 && <><p className="muted" style={{ margin: '14px 0 4px', fontWeight: 600 }}>Collect from the applicant</p>
            <table><tbody>
              {collectItems.map(d => <tr key={d.id}><td>☐ {d.title}</td></tr>)}
            </tbody></table></>}
            <div className="ackbox" style={{ marginTop: 14 }}>
              <b>Process</b>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18 }}>{STEPS.map((x, i) => <li key={i} style={{ margin: '4px 0' }}>{x}</li>)}</ol>
            </div>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="card">
          <div className="row between"><h2>Manage pre-employment forms</h2>
            <button className="small secondary" onClick={() => setShowCfg(v => !v)}>{showCfg ? 'Hide' : 'Configure'}</button></div>
          {showCfg && (
            <>
              <p className="muted" style={{ fontSize: 12 }}>Add or remove forms, upload each form's PDF, and tick which positions require it.</p>
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead><tr><th>Form</th><th>PDF</th><th style={{ textAlign: 'center' }} title="Applies if applicant age is under this">Age &lt;</th>{roles.map(r => <th key={r.id} style={{ textAlign: 'center' }}>{r.name}</th>)}<th /></tr></thead>
                  <tbody>
                    {preDocs.map(d => (
                      <tr key={d.id}>
                        {editForm?.id === d.id ? (
                          <td><input style={{ width: 80 }} value={editForm.code || ''} onChange={e => setEditForm({ ...editForm, code: e.target.value })} placeholder="Code" /> <input value={editForm.title} onChange={e => setEditForm({ ...editForm, title: e.target.value })} /> <button className="small" onClick={saveFormEdit}>Save</button> <button className="small secondary" onClick={() => setEditForm(null)}>✕</button></td>
                        ) : (
                          <td><b>{d.code}</b> {d.title}</td>
                        )}
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {vers[d.id] && <button className="small secondary" onClick={() => openForm(d)}>View</button>}{' '}
                          <label className="small secondary" style={{ display: 'inline-block', cursor: 'pointer', padding: '4px 10px', border: '1px solid #d9dede', borderRadius: 7, background: '#eef1f1' }}>
                            {vers[d.id] ? 'Replace' : 'Upload'}
                            <input type="file" accept="application/pdf" style={{ display: 'none' }} onChange={e => uploadFormPdf(d, e.target.files?.[0])} />
                          </label>
                        </td>
                        <td style={{ textAlign: 'center' }}><input type="number" style={{ width: 60 }} value={d.pre_emp_age_max ?? ''} onChange={e => saveAge(d, e.target.value)} placeholder="—" /></td>
                        {roles.map(r => (
                          <td key={r.id} style={{ textAlign: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={hasMap(r.id, d.id)} onChange={() => toggleMap(r.id, d.id)} /></td>
                        ))}
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small secondary" onClick={() => setEditForm({ id: d.id, code: d.code, title: d.title })}>Edit</button> <button className="small" style={{ color: '#b00020' }} onClick={() => deleteForm(d)}>Delete</button></td>
                      </tr>
                    ))}
                    {preDocs.length === 0 && <tr><td colSpan={roles.length + 4} className="muted">No pre-employment forms yet — add one below.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
                <div style={{ width: 100 }}><label>Code</label><input value={nf.code} onChange={e => setNf({ ...nf, code: e.target.value })} placeholder="F5.1.x" /></div>
                <div style={{ flex: 1 }}><label>New form title</label><input value={nf.title} onChange={e => setNf({ ...nf, title: e.target.value })} placeholder="e.g. Reference Check Consent" /></div>
                <button className="small" onClick={addForm} disabled={!nf.title.trim()}>+ Add form</button>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>After adding a form, upload its PDF with the Upload button, then tick the positions that need it.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
