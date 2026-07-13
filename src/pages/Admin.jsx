import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import FormBuilder from '../components/FormBuilder'
import QuestionBuilder from '../components/QuestionBuilder'
import { supabase, CAPABILITIES, fmtDate } from '../lib/supabase'

const TABS = ['Documents', 'Packs', 'People', 'Organisation']

export default function Admin({ profile }) {
  const [tab, setTab] = useState('Documents')
  return (
    <div>
      <h1>Admin</h1>
      <div className="pill-tabs">
        {TABS.map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>
      {tab === 'Documents' && <Documents profile={profile} />}
      {tab === 'Packs' && <Packs />}
      {tab === 'People' && <People profile={profile} />}
      {tab === 'Organisation' && <Organisation />}
    </div>
  )
}

function Documents({ profile }) {
  const [docs, setDocs] = useState([])
  const [cats, setCats] = useState([])
  const [edit, setEdit] = useState(null)
  const [version, setVersion] = useState(null)
  const [file, setFile] = useState(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [pages, setPages] = useState([])
  const [test, setTest] = useState(null)
  const [versions, setVersions] = useState([])
  const [saveAsk, setSaveAsk] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [reassign, setReassign] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('documents').select('*, document_categories(name)').order('code')
    setDocs(data || [])
    const { data: c } = await supabase.from('document_categories').select('*').order('code')
    setCats(c || [])
  }
  useEffect(() => { load() }, [])

  async function openEdit(d) {
    setMsg(''); setFile(null); setEdit(d); setVersion(null); setMediaUrl(''); setPages([]); setTest(null); setSaveAsk(false); setChangeNote(''); setReassign(false)
    if (d?.current_version_id) {
      const { data: v } = await supabase.from('document_versions').select('*').eq('id', d.current_version_id).single()
      setVersion(v || null); setMediaUrl(v?.media_url || ''); setPages(v?.form_schema?.pages || [])
      const { data: tst } = await supabase.from('tests').select('*').eq('document_version_id', d.current_version_id).maybeSingle()
      setTest(tst || null)
      const { data: vs } = await supabase.from('document_versions').select('*').eq('document_id', d.id).order('version_no', { ascending: false })
      setVersions(vs || [])
    } else { setVersions([]) }
  }
  function newDoc() {
    setMsg(''); setFile(null); setVersion(null); setMediaUrl(''); setPages([]); setTest(null); setVersions([]); setSaveAsk(false)
    setEdit({ code: '', title: '', doc_type: 'media', requires_signature: true, requires_manager_signoff: false, requires_admin_signoff: false, requires_assessor_signoff: false, completed_by: 'employee', active: true, category_id: cats[0]?.id })
  }
  async function viewMaster() {
    if (!version?.pdf_path) return
    const { data } = await supabase.storage.from('masters').createSignedUrl(version.pdf_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function saveInPlace() {
    setBusy(true); setMsg('')
    const d = { ...edit }; delete d.document_categories
    let docId = d.id, error
    if (d.id) ({ error } = await supabase.from('documents').update(d).eq('id', d.id))
    else {
      const { data: ins, error: ie } = await supabase.from('documents').insert(d).select('id').single()
      error = ie; docId = ins?.id
    }
    if (error) { setMsg(error.message); setBusy(false); return }

    let versionId = version?.id || edit.current_version_id
    if (!versionId && docId) {
      const { data: nv } = await supabase.from('document_versions').insert({ document_id: docId, version_no: 1 }).select('id').single()
      versionId = nv?.id
      if (versionId) await supabase.from('documents').update({ current_version_id: versionId }).eq('id', docId)
    }

    let pdf_path = file ? null : (version?.pdf_path || null)
    if (file && versionId) {
      const safe = file.name.replace(/[^\w.\-]+/g, '_')
      const path = `${docId}/${safe}`
      const { error: fe } = await supabase.storage.from('masters').upload(path, file, { upsert: true })
      if (fe) { setMsg('File upload failed: ' + fe.message); setBusy(false); return }
      pdf_path = path
    }
    if (versionId && (file || mediaUrl || version || edit.doc_type === 'web_form')) {
      const vpatch = { pdf_path, media_url: mediaUrl || null }
      if (edit.doc_type === 'web_form') vpatch.form_schema = pages.length ? { type: 'guided', pages } : null
      await supabase.from('document_versions').update(vpatch).eq('id', versionId)
    }
    // understanding questions (tests)
    if (versionId) {
      const cleanQs = (test?.questions || []).filter(q => q.q && (q.options || []).length >= 2 && q.answer)
      if (cleanQs.length) {
        const payload = { pass_mark: Number(test.pass_mark) || 80, questions: cleanQs, shuffle: test.shuffle ?? true }
        if (test.id) await supabase.from('tests').update(payload).eq('id', test.id)
        else await supabase.from('tests').insert({ ...payload, document_version_id: versionId })
      } else if (test?.id) {
        await supabase.from('tests').delete().eq('id', test.id)
      }
    }

    setMsg('Saved.'); setEdit(null); setFile(null); setVersion(null); setSaveAsk(false); setBusy(false); load()
  }

  async function publishNewVersion() {
    setBusy(true); setMsg('')
    try {
      const d = { ...edit }; delete d.document_categories
      const { error: ue } = await supabase.from('documents').update(d).eq('id', edit.id)
      if (ue) throw ue
      const safe = file ? file.name.replace(/[^\w.\-]+/g, '_') : null
      const newNo = (version?.version_no || 1) + 1
      let pdf_path = file ? `${edit.id}/v${newNo}-${safe}` : (version?.pdf_path || null)
      const { data: nv, error: ie } = await supabase.from('document_versions').insert({
        document_id: edit.id, version_no: newNo,
        form_schema: edit.doc_type === 'web_form' ? (pages.length ? { type: 'guided', pages } : null) : (version?.form_schema || null),
        pdf_path, media_url: mediaUrl || null, notes: changeNote || null, created_by: profile.id,
      }).select('*').single()
      if (ie) throw ie
      if (file) { const { error: fe } = await supabase.storage.from('masters').upload(pdf_path, file, { upsert: true }); if (fe) throw fe }
      const cleanQs = (test?.questions || []).filter(q => q.q && (q.options || []).length >= 2 && q.answer)
      if (cleanQs.length) await supabase.from('tests').insert({ document_version_id: nv.id, pass_mark: Number(test.pass_mark) || 80, questions: cleanQs, shuffle: test.shuffle ?? true })
      await supabase.from('documents').update({ current_version_id: nv.id }).eq('id', edit.id)
      let reassigned = 0
      if (reassign) {
        const { data: rows } = await supabase.from('assignments').select('employee_id, profiles!assignments_employee_id_fkey(status)').eq('document_id', edit.id)
        const ids = [...new Set((rows || []).filter(r => r.profiles?.status === 'active').map(r => r.employee_id))]
        const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10)
        if (ids.length) await supabase.from('assignments').insert(ids.map(id => ({ employee_id: id, document_id: edit.id, source: 'manual', assigned_by: profile.id, due_date: due })))
        reassigned = ids.length
      }
      setMsg(`Published v${newNo}. ${reassign ? `Re-assigned to ${reassigned} staff to re-complete.` : 'Existing completions kept against their version.'}`)
      setSaveAsk(false); setEdit(null); setFile(null); setVersion(null); setBusy(false); load()
    } catch (e) { setMsg(e.message || String(e)); setBusy(false) }
  }

  const masterName = version?.pdf_path ? version.pdf_path.split('/').pop() : null

  return (
    <div className="card">
      <div className="row between">
        <h2>Documents ({docs.length})</h2>
        <button className="small" onClick={newDoc}>+ New document</button>
      </div>
      {msg && <div className="success">{msg}</div>}
      {edit && (
        <div className="doc-content">
          <div className="row">
            <div style={{ width: 120 }}><label>Code</label><input value={edit.code || ''} onChange={e => setEdit({ ...edit, code: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label>Title</label><input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></div>
          </div>
          <div className="row">
            <div style={{ flex: 1 }}><label>Category</label>
              <select value={edit.category_id || ''} onChange={e => setEdit({ ...edit, category_id: e.target.value })}>
                {cats.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
              </select></div>
            <div style={{ flex: 1 }}><label>Type</label>
              <select value={edit.doc_type} onChange={e => setEdit({ ...edit, doc_type: e.target.value })}>
                {['web_form', 'pdf_form', 'media', 'test', 'manual', 'upload', 'task'].map(t => <option key={t}>{t}</option>)}
              </select></div>
            <div style={{ flex: 1 }}><label>Completed by</label>
              <select value={edit.completed_by} onChange={e => setEdit({ ...edit, completed_by: e.target.value })}>
                <option>employee</option><option>manager</option><option>both</option>
              </select></div>
            <div style={{ width: 150 }}><label>Refresher (months)</label>
              <input type="number" value={edit.recurrence_months || ''} onChange={e => setEdit({ ...edit, recurrence_months: e.target.value ? Number(e.target.value) : null })} /></div>
          </div>

          <label style={{ marginTop: 10 }}>Who must e-sign</label>
          <div className="checkgrid">
            <label><input type="checkbox" checked={!!edit.requires_signature} onChange={e => setEdit({ ...edit, requires_signature: e.target.checked })} />Employee e-signature</label>
            <label><input type="checkbox" checked={!!edit.requires_manager_signoff} onChange={e => setEdit({ ...edit, requires_manager_signoff: e.target.checked })} />Manager sign-off</label>
            <label><input type="checkbox" checked={!!edit.requires_admin_signoff} onChange={e => setEdit({ ...edit, requires_admin_signoff: e.target.checked })} />Admin sign-off</label>
            <label><input type="checkbox" checked={!!edit.requires_assessor_signoff} onChange={e => setEdit({ ...edit, requires_assessor_signoff: e.target.checked })} />Competent-person sign-off</label>
            <label><input type="checkbox" checked={!!edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Active</label>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Master file {masterName && <span className="muted">— current: <a onClick={viewMaster} style={{ cursor: 'pointer' }}>{masterName} ↗</a></span>}</label>
              <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] || null)} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Media URL (video on nuway.com.au, optional)</label>
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} placeholder="https://nuway.com.au/…" />
            </div>
          </div>

          {edit.doc_type === 'web_form' && (
            <div style={{ marginTop: 14 }}>
              <label>Form content (no code — build the sections your staff will complete)</label>
              <FormBuilder pages={pages} onChange={setPages} />
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label>Understanding questions (optional — checks the employee understood before it counts as complete)</label>
            <QuestionBuilder test={test} onChange={setTest} />
          </div>

          <label style={{ marginTop: 10 }}>Conditions (JSON — e.g. {'{'}"employment_type":["casual"]{'}'} or {'{'}"locations":["Logan"]{'}'})</label>
          <input value={edit.conditions ? JSON.stringify(edit.conditions) : ''} onChange={e => {
            try { setEdit({ ...edit, conditions: e.target.value ? JSON.parse(e.target.value) : null }) } catch { /* typing */ }
          }} placeholder="blank = applies to everyone" />

          {edit.id && versions.length > 0 && (
            <div className="fb-section" style={{ marginTop: 14 }}>
              <label style={{ margin: 0 }}>Version history</label>
              <table><tbody>
                {versions.map(v => (
                  <tr key={v.id}>
                    <td><b>v{v.version_no}</b></td>
                    <td><span className={`badge ${v.id === edit.current_version_id ? 'completed' : 'expired'}`}>{v.id === edit.current_version_id ? 'current' : 'archived'}</span></td>
                    <td className="muted">{v.notes || '—'}</td>
                    <td className="muted">{v.created_at ? fmtDate(v.created_at) : ''}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
          )}

          {saveAsk ? (
            <div className="fb-section" style={{ marginTop: 12 }}>
              <b>Save changes to “{edit.code} {edit.title}”</b>
              <p className="muted" style={{ fontSize: 13 }}>Have you changed the content in a way staff need to re-acknowledge?</p>
              <button className="secondary" style={{ marginTop: 4 }} onClick={() => { setSaveAsk(false); saveInPlace() }} disabled={busy}>Minor edit — just update (no re-sign)</button>
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e0e6e0' }}>
                <label>Publish as a new version — what changed?</label>
                <input value={changeNote} onChange={e => setChangeNote(e.target.value)} placeholder="e.g. Updated section 3 obligations" />
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400, marginTop: 8 }}>
                  <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={reassign} onChange={e => setReassign(e.target.checked)} />
                  <span>Require staff who already completed this to re-complete the new version (pushes it to their to-do)</span>
                </label>
                <div className="row" style={{ marginTop: 10 }}>
                  <button onClick={publishNewVersion} disabled={busy}>{busy ? 'Publishing…' : 'Publish new version'}</button>
                  <button className="secondary" onClick={() => setSaveAsk(false)}>Back</button>
                </div>
                <p className="muted" style={{ fontSize: 12 }}>The current version is archived (kept &amp; retrievable). Existing signed records stay bound to the version each person actually signed.</p>
              </div>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={() => (edit.id ? setSaveAsk(true) : saveInPlace())} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button className="secondary" onClick={() => setEdit(null)}>Cancel</button>
            </div>
          )}
        </div>
      )}
      <table>
        <thead><tr><th>Code</th><th>Title</th><th>Category</th><th>Type</th><th>Emp</th><th>Mgr</th><th>Adm</th><th /></tr></thead>
        <tbody>
          {docs.map(d => (
            <tr key={d.id} style={{ opacity: d.active ? 1 : .45 }}>
              <td><b>{d.code}</b></td><td>{d.title}</td>
              <td className="muted">{d.document_categories?.name}</td>
              <td className="muted">{d.doc_type}</td>
              <td>{d.requires_signature ? '✓' : ''}</td>
              <td>{d.requires_manager_signoff ? '✓' : ''}</td>
              <td>{d.requires_admin_signoff ? '✓' : ''}</td>
              <td><button className="secondary small" onClick={() => openEdit(d)}>Edit</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Packs() {
  const [packs, setPacks] = useState([])
  const [items, setItems] = useState([])
  const [links, setLinks] = useState([])
  const [roles, setRoles] = useState([])
  const [docs, setDocs] = useState([])
  const [sel, setSel] = useState(null)
  const [addDoc, setAddDoc] = useState('')
  const [addDue, setAddDue] = useState(7)
  const [newPack, setNewPack] = useState('')

  async function load() {
    const [p, i, l, r, d] = await Promise.all([
      supabase.from('document_packs').select('*').order('name'),
      supabase.from('pack_documents').select('*, documents(code, title)'),
      supabase.from('job_role_packs').select('*'),
      supabase.from('job_roles').select('*').order('name'),
      supabase.from('documents').select('id, code, title').eq('active', true).order('code'),
    ])
    setPacks(p.data || []); setItems(i.data || []); setLinks(l.data || []); setRoles(r.data || []); setDocs(d.data || [])
  }
  useEffect(() => { load() }, [])

  const pack = packs.find(p => p.id === sel)
  const pItems = items.filter(i => i.pack_id === sel).sort((a, b) => a.sort_order - b.sort_order)

  async function addItem() {
    if (!addDoc) return
    await supabase.from('pack_documents').insert({ pack_id: sel, document_id: addDoc, due_days: addDue, sort_order: pItems.length + 1 })
    setAddDoc(''); load()
  }
  async function rmItem(i) {
    await supabase.from('pack_documents').delete().eq('pack_id', i.pack_id).eq('document_id', i.document_id)
    load()
  }
  async function toggleRole(rid) {
    const has = links.find(l => l.pack_id === sel && l.job_role_id === rid)
    if (has) await supabase.from('job_role_packs').delete().eq('pack_id', sel).eq('job_role_id', rid)
    else await supabase.from('job_role_packs').insert({ pack_id: sel, job_role_id: rid })
    load()
  }
  async function createPack() {
    if (!newPack.trim()) return
    await supabase.from('document_packs').insert({ name: newPack.trim() })
    setNewPack(''); load()
  }

  return (
    <div className="card">
      <div className="row between">
        <h2>Document packs</h2>
        <div className="row">
          <input style={{ width: 220 }} placeholder="New pack name" value={newPack} onChange={e => setNewPack(e.target.value)} />
          <button className="small" onClick={createPack}>Create</button>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 260 }}>
          {packs.map(p => (
            <div key={p.id} onClick={() => setSel(p.id)}
              style={{ padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: sel === p.id ? '#e0f2e6' : 'transparent' }}>
              <b>{p.name}</b><br /><span className="muted">{items.filter(i => i.pack_id === p.id).length} documents</span>
            </div>
          ))}
        </div>
        <div style={{ flex: 1 }}>
          {!pack && <p className="muted">Select a pack to edit its contents and roles.</p>}
          {pack && (<>
            <h3>{pack.name}</h3>
            <p className="muted">Auto-assigned to roles:{' '}
              {roles.map(r => {
                const on = links.some(l => l.pack_id === sel && l.job_role_id === r.id)
                return <button key={r.id} className={`small ${on ? '' : 'secondary'}`} style={{ marginRight: 6 }} onClick={() => toggleRole(r.id)}>{r.name}</button>
              })}
            </p>
            <table><tbody>
              {pItems.map(i => (
                <tr key={i.document_id}>
                  <td><b>{i.documents?.code}</b> {i.documents?.title}</td>
                  <td className="muted">day {i.due_days ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}><button className="danger small" onClick={() => rmItem(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody></table>
            <div className="row" style={{ marginTop: 10 }}>
              <select style={{ flex: 1 }} value={addDoc} onChange={e => setAddDoc(e.target.value)}>
                <option value="">+ Add document…</option>
                {docs.filter(d => !pItems.some(i => i.document_id === d.id)).map(d => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
              </select>
              <input type="number" style={{ width: 90 }} value={addDue} onChange={e => setAddDue(Number(e.target.value))} title="Due (days from start)" />
              <button className="small" onClick={addItem} disabled={!addDoc}>Add</button>
            </div>
          </>)}
        </div>
      </div>
    </div>
  )
}

function People({ profile }) {
  const [people, setPeople] = useState([])
  const [locations, setLocations] = useState([])
  const [sel, setSel] = useState(null)
  const [mla, setMla] = useState([])
  const [caps, setCaps] = useState([])
  const [msg, setMsg] = useState('')
  const [filt, setFilt] = useState('active')

  async function load() {
    const { data } = await supabase.from('profiles').select('*, employee_locations(is_primary, locations(name))').order('first_name')
    setPeople(data || [])
    const { data: l } = await supabase.from('locations').select('*').eq('active', true).order('name')
    setLocations(l || [])
  }
  useEffect(() => { load() }, [])

  function locName(p) {
    const els = p.employee_locations || []
    const prim = els.find(e => e.is_primary) || els[0]
    return prim?.locations?.name || 'Unassigned'
  }

  async function open(p) {
    setSel(p); setMsg('')
    const { data: m } = await supabase.from('manager_location_access').select('*').eq('manager_id', p.id)
    setMla((m || []).map(x => x.location_id))
    const { data: c } = await supabase.from('manager_capabilities').select('*').eq('manager_id', p.id)
    setCaps((c || []).map(x => x.capability))
  }
  async function setTier(tier) {
    await supabase.from('profiles').update({ tier }).eq('id', sel.id)
    setSel({ ...sel, tier }); load()
  }
  async function toggleLoc(id) {
    if (mla.includes(id)) { await supabase.from('manager_location_access').delete().eq('manager_id', sel.id).eq('location_id', id); setMla(mla.filter(x => x !== id)) }
    else { await supabase.from('manager_location_access').insert({ manager_id: sel.id, location_id: id }); setMla([...mla, id]) }
  }
  async function toggleCap(cap) {
    if (caps.includes(cap)) { await supabase.from('manager_capabilities').delete().eq('manager_id', sel.id).eq('capability', cap); setCaps(caps.filter(x => x !== cap)) }
    else { await supabase.from('manager_capabilities').insert({ manager_id: sel.id, capability: cap }); setCaps([...caps, cap]) }
  }
  async function deactivate() {
    await supabase.from('profiles').update({ status: 'terminated', end_date: new Date().toISOString().slice(0, 10) }).eq('id', sel.id)
    setSel({ ...sel, status: 'terminated' }); setMsg('Marked as past employee — records kept, portal access removed.'); load()
  }
  async function reactivate() {
    await supabase.from('profiles').update({ status: 'active', end_date: null }).eq('id', sel.id)
    setSel({ ...sel, status: 'active' }); setMsg('Employee reactivated — portal access restored.'); load()
  }

  async function toggleCanAssess(v) {
    await supabase.from('profiles').update({ can_assess: v }).eq('id', sel.id)
    setSel({ ...sel, can_assess: v }); load()
  }

  const shown = people
    .filter(p => filt === 'all' ? true : filt === 'past' ? p.status !== 'active' : p.status === 'active')
    .sort((a, b) => (locName(a).localeCompare(locName(b))) || `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`))
  const counts = {
    active: people.filter(p => p.status === 'active').length,
    past: people.filter(p => p.status !== 'active').length,
  }
  let lastLoc = null

  return (
    <div className="card">
      <h2>People &amp; access</h2>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className={`small ${filt === 'active' ? '' : 'secondary'}`} onClick={() => setFilt('active')}>Active ({counts.active})</button>
        <button className={`small ${filt === 'past' ? '' : 'secondary'}`} onClick={() => setFilt('past')}>Past employees ({counts.past})</button>
        <button className={`small ${filt === 'all' ? '' : 'secondary'}`} onClick={() => setFilt('all')}>All</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ width: 300 }}>
          {shown.length === 0 && <p className="muted">No {filt === 'past' ? 'past employees' : 'people'} to show.</p>}
          {shown.map(p => {
            const loc = locName(p); const showHeader = loc !== lastLoc; lastLoc = loc
            return (
              <div key={p.id}>
                {showHeader && <div className="muted" style={{ fontSize: 12, fontWeight: 700, margin: '10px 0 2px', textTransform: 'uppercase', letterSpacing: .3 }}>{loc}</div>}
                <div onClick={() => open(p)} style={{ padding: '7px 10px', borderRadius: 7, cursor: 'pointer', background: sel?.id === p.id ? '#e0f2e6' : 'transparent', opacity: p.status === 'active' ? 1 : .55 }}>
                  {p.first_name} {p.last_name} <span className="muted">· {p.tier}{p.status !== 'active' ? ' · past' : ''}</span>
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ flex: 1 }}>
          {!sel && <p className="muted">Select a person to manage their access, or view their records.</p>}
          {sel && (<>
            <div className="row between">
              <h3 style={{ margin: 0 }}>{sel.first_name} {sel.last_name}{sel.status !== 'active' && <span className="muted"> · past employee</span>}</h3>
              <Link to={`/employee/${sel.id}`}>View training records →</Link>
            </div>
            {msg && <div className="success" style={{ marginTop: 8 }}>{msg}</div>}
            <label>Access tier</label>
            <div className="row">
              {['employee', 'manager', 'admin'].map(t => (
                <button key={t} className={`small ${sel.tier === t ? '' : 'secondary'}`} onClick={() => setTier(t)} disabled={sel.id === profile.id}>{t}</button>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, marginTop: 12 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={!!sel.can_assess} onChange={e => toggleCanAssess(e.target.checked)} />
              Competent to assess / sign off practical training
            </label>
            {sel.tier === 'manager' && (<>
              <label>Manages locations</label>
              <div className="checkgrid">
                {locations.map(l => <label key={l.id}><input type="checkbox" checked={mla.includes(l.id)} onChange={() => toggleLoc(l.id)} />{l.name}</label>)}
              </div>
              <label>Capabilities</label>
              <div className="checkgrid">
                {CAPABILITIES.map(([c, lab]) => <label key={c}><input type="checkbox" checked={caps.includes(c)} onChange={() => toggleCap(c)} />{lab}</label>)}
              </div>
            </>)}
            {sel.id !== profile.id && (
              sel.status === 'active'
                ? <button className="danger small" style={{ marginTop: 16 }} onClick={deactivate}>Mark as past employee</button>
                : <button className="small" style={{ marginTop: 16 }} onClick={reactivate}>↩ Reactivate employee (restore access)</button>
            )}
          </>)}
        </div>
      </div>
    </div>
  )
}

function Organisation() {
  const [locations, setLocations] = useState([])
  const [roles, setRoles] = useState([])
  const [vehicles, setVehicles] = useState([])
  const [licTypes, setLicTypes] = useState([])
  const [nl, setNl] = useState(''); const [nr, setNr] = useState(''); const [nlt, setNlt] = useState('')
  const [nv, setNv] = useState({ name: '', rego: '', location_id: '' })

  async function load() {
    const [l, r, v, t] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('job_roles').select('*').order('name'),
      supabase.from('vehicles').select('*, locations(name)').order('name'),
      supabase.from('licence_types').select('*').order('name'),
    ])
    setLocations(l.data || []); setRoles(r.data || []); setVehicles(v.data || []); setLicTypes(t.data || [])
  }
  useEffect(() => { load() }, [])
  async function deleteVehicle(v) {
    if (!window.confirm(`Delete ${v.name || v.rego}? This can't be undone.`)) return
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id)
    if (error) { window.alert(/foreign key|violates/i.test(error.message) ? 'This vehicle has inductions assigned — set it Inactive on the Store page instead.' : error.message); return }
    load()
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="card">
        <h2>Locations</h2>
        <table><tbody>{locations.map(l => (
          <tr key={l.id}><td>{l.name}</td><td className="muted">{l.code}</td>
            <td style={{ textAlign: 'right' }}>
              <button className={`small ${l.active ? 'secondary' : ''}`} onClick={async () => { await supabase.from('locations').update({ active: !l.active }).eq('id', l.id); load() }}>{l.active ? 'Active' : 'Inactive'}</button>
            </td></tr>))}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="New location name" value={nl} onChange={e => setNl(e.target.value)} />
          <button className="small" onClick={async () => { if (nl.trim()) { await supabase.from('locations').insert({ name: nl.trim() }); setNl(''); load() } }}>Add</button>
        </div>
      </div>
      <div className="card">
        <h2>Roles</h2>
        <table><tbody>{roles.map(r => <tr key={r.id}><td>{r.name}</td><td className="muted">{r.description}</td></tr>)}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="New role name" value={nr} onChange={e => setNr(e.target.value)} />
          <button className="small" onClick={async () => { if (nr.trim()) { await supabase.from('job_roles').insert({ name: nr.trim() }); setNr(''); load() } }}>Add</button>
        </div>
      </div>
      <div className="card">
        <h2>Vehicles</h2>
        <table><tbody>{vehicles.map(v => <tr key={v.id}><td className="muted">{v.type || '—'}</td><td>{v.name}</td><td>{v.rego}</td><td className="muted">{v.locations?.name}</td><td style={{ textAlign: 'right' }}><button className="small" style={{ color: '#b00020' }} onClick={() => deleteVehicle(v)}>Delete</button></td></tr>)}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input style={{ width: 140 }} placeholder="Name" value={nv.name} onChange={e => setNv({ ...nv, name: e.target.value })} />
          <input style={{ width: 110 }} placeholder="Rego" value={nv.rego} onChange={e => setNv({ ...nv, rego: e.target.value })} />
          <select style={{ width: 150 }} value={nv.location_id} onChange={e => setNv({ ...nv, location_id: e.target.value })}>
            <option value="">Location…</option>
            {locations.filter(l => l.active).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="small" onClick={async () => { if (nv.name && nv.rego) { await supabase.from('vehicles').insert({ ...nv, location_id: nv.location_id || null }); setNv({ name: '', rego: '', location_id: '' }); load() } }}>Add</button>
        </div>
      </div>
      <div className="card">
        <h2>Licence types</h2>
        <table><tbody>{licTypes.map(t => <tr key={t.id}><td>{t.name}</td><td className="muted">remind {t.reminder_days}d before expiry</td></tr>)}</tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input placeholder="New licence type" value={nlt} onChange={e => setNlt(e.target.value)} />
          <button className="small" onClick={async () => { if (nlt.trim()) { await supabase.from('licence_types').insert({ name: nlt.trim() }); setNlt(''); load() } }}>Add</button>
        </div>
      </div>
    </div>
  )
}
