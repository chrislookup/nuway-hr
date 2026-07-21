import { useEffect, useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import FormBuilder from '../components/FormBuilder'
import QuestionBuilder from '../components/QuestionBuilder'
import RichText from '../components/RichText'
import SignaturePad from '../components/SignaturePad'
import FormRenderer from '../components/FormRenderer'
const PdfFieldFiller = lazy(() => import('../components/PdfFieldFiller'))
const PdfFieldEditor = lazy(() => import('../components/PdfFieldEditor'))
import ConditionsBuilder from '../components/ConditionsBuilder'
import { supabase, CAPABILITIES, fmtDate, catRank, loadCatOrder } from '../lib/supabase'

const DOC_TYPES = [
  ['standard', 'Standard — view & sign'],
  ['acknowledge', 'Acknowledge — read, tick & sign'],
  ['web_form', 'Web form (fill in fields)'],
  ['pdf_form', 'PDF form (sign on the PDF)'],
  ['media', 'Video / online module'],
  ['upload', 'Upload evidence (staff upload a file)'],
  ['manual', 'Manual / reference'],
  ['test', 'Test only'],
  ['task', 'Task'],
]

const TABS = ['Documents', 'People', 'Organisation', 'Test accounts'] // 'Packs' retired — assignment is now allocator-driven

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
      {tab === 'Test accounts' && <TestAccounts />}
    </div>
  )
}

function Documents({ profile }) {
  const [docs, setDocs] = useState([])
  const [cats, setCats] = useState([])
  const [edit, setEdit] = useState(null)
  const [version, setVersion] = useState(null)
  const [preview, setPreview] = useState(null)  // { url, kind }
  const [showPreview, setShowPreview] = useState(false)
  const [file, setFile] = useState(null)
  const [pdfFields, setPdfFields] = useState([])
  const [pdfEditUrl, setPdfEditUrl] = useState('')
  const [pdfEditorOpen, setPdfEditorOpen] = useState(true)
  const [mediaUrl, setMediaUrl] = useState('')
  const [pages, setPages] = useState([])
  const [test, setTest] = useState(null)
  const [versions, setVersions] = useState([])
  const [saveAsk, setSaveAsk] = useState(false)
  const [changeNote, setChangeNote] = useState('')
  const [reassign, setReassign] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [dueNum, setDueNum] = useState('')
  const [dueUnit, setDueUnit] = useState('days')

  async function load() {
    await loadCatOrder()
    const { data } = await supabase.from('documents').select('*, document_categories(name)').order('code')
    const sorted = (data || []).filter(d => !d.pre_employment).sort((a, b) => catRank(a.document_categories?.name) - catRank(b.document_categories?.name) || (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
    setDocs(sorted)
    const { data: c } = await supabase.from('document_categories').select('*').order('sort_order')
    setCats(c || [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    let revoke
    async function mk() {
      if (edit?.doc_type !== 'pdf_form') { setPdfEditUrl(''); return }
      if (file && /pdf$/i.test(file.type || file.name)) { const u = URL.createObjectURL(file); revoke = u; setPdfEditUrl(u); return }
      if (version?.pdf_path) { const { data } = await supabase.storage.from('masters').createSignedUrl(version.pdf_path, 3600); setPdfEditUrl(data?.signedUrl || ''); return }
      setPdfEditUrl('')
    }
    mk()
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [edit?.doc_type, file, version?.pdf_path])

  useEffect(() => {
    let revoke
    async function mk() {
      const isImg = n => /\.(png|jpe?g|gif|webp)$/i.test(n || '')
      const isPdf = n => /\.pdf$/i.test(n || '') || /pdf/i.test(n || '')
      if (file) {
        const u = URL.createObjectURL(file); revoke = u
        setPreview({ url: u, kind: isImg(file.name) || (file.type || '').startsWith('image') ? 'image' : isPdf(file.type || file.name) ? 'pdf' : 'other', name: file.name })
        return
      }
      if (version?.pdf_path) {
        const { data } = await supabase.storage.from('masters').createSignedUrl(version.pdf_path, 3600)
        setPreview(data?.signedUrl ? { url: data.signedUrl, kind: isImg(version.pdf_path) ? 'image' : 'pdf', name: version.pdf_path.split('/').pop() } : null)
        return
      }
      setPreview(null)
    }
    mk()
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [file, version?.pdf_path])

  async function openEdit(d) {
    setMsg(''); setFile(null); setEdit(d); setVersion(null); setMediaUrl(''); setPages([]); setTest(null); setSaveAsk(false); setChangeNote(''); setReassign(false)
    { const dd = d?.due_days; if (dd && dd % 7 === 0) { setDueUnit('weeks'); setDueNum(dd / 7) } else { setDueUnit('days'); setDueNum(dd ?? '') } }
    if (d?.current_version_id) {
      const { data: v } = await supabase.from('document_versions').select('*').eq('id', d.current_version_id).single()
      setVersion(v || null); setMediaUrl(v?.media_url || ''); setPages(v?.form_schema?.pages || []); setPdfFields(v?.pdf_field_map || []); setPdfEditorOpen(!((v?.pdf_field_map || []).length))
      const { data: tst } = await supabase.from('tests').select('*').eq('document_version_id', d.current_version_id).maybeSingle()
      setTest(tst || null)
      const { data: vs } = await supabase.from('document_versions').select('*').eq('document_id', d.id).order('version_no', { ascending: false })
      setVersions(vs || [])
    } else { setVersions([]); setPdfFields([]); setPdfEditorOpen(true) }
  }
  function newDoc() {
    setMsg(''); setFile(null); setVersion(null); setMediaUrl(''); setPages([]); setTest(null); setVersions([]); setSaveAsk(false); setPdfFields([]); setPdfEditorOpen(true); setDueNum(''); setDueUnit('days')
    setEdit({ code: '', title: '', doc_type: 'standard', pre_employment: false, requires_signature: true, requires_manager_signoff: false, requires_admin_signoff: false, requires_assessor_signoff: false, completed_by: 'employee', active: true, category_id: cats[0]?.id })
  }
  async function viewMaster() {
    if (!version?.pdf_path) return
    const { data } = await supabase.storage.from('masters').createSignedUrl(version.pdf_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function archiveDoc(d, active) {
    await supabase.from('documents').update({ active }).eq('id', d.id)
    setMsg(active ? `Restored “${d.code} ${d.title}”.` : `Archived “${d.code} ${d.title}”.`); load()
  }
  async function deleteDoc(d) {
    const { data: asg } = await supabase.from('assignments').select('id').eq('document_id', d.id)
    const ids = (asg || []).map(x => x.id)
    let compCount = 0
    if (ids.length) { const { count } = await supabase.from('completions').select('id', { count: 'exact', head: true }).in('assignment_id', ids); compCount = count || 0 }
    if (compCount > 0) { window.alert(`Can't delete “${d.code} ${d.title}” — it has ${compCount} signed record(s). Keep it archived so those records stay intact.`); return }
    if (!window.confirm(`Permanently delete “${d.code} ${d.title}” and all its versions? This can't be undone.`)) return
    try {
      const { data: vs } = await supabase.from('document_versions').select('id').eq('document_id', d.id)
      const vids = (vs || []).map(v => v.id)
      if (vids.length) await supabase.from('tests').delete().in('document_version_id', vids)
      if (ids.length) await supabase.from('assignments').delete().eq('document_id', d.id)
      await supabase.from('pack_documents').delete().eq('document_id', d.id)
      await supabase.from('documents').update({ current_version_id: null }).eq('id', d.id)
      if (vids.length) await supabase.from('document_versions').delete().eq('document_id', d.id)
      const { error } = await supabase.from('documents').delete().eq('id', d.id)
      if (error) throw error
      setMsg(`Deleted “${d.code} ${d.title}”.`); load()
    } catch (e) { window.alert('Delete failed: ' + (e.message || e)) }
  }

  async function rolloutDoc(id, silent) {
    const { data, error } = await supabase.rpc('rollout_document', { doc: id })
    if (error) { if (!silent) setMsg('Roll-out failed: ' + error.message); return null }
    return data || 0
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
    if (versionId && (file || mediaUrl || version || edit.doc_type === 'web_form' || edit.doc_type === 'pdf_form')) {
      const vpatch = { pdf_path, media_url: mediaUrl || null }
      if (edit.doc_type === 'web_form') vpatch.form_schema = pages.length ? { type: 'guided', pages } : null
      if (edit.doc_type === 'pdf_form') vpatch.pdf_field_map = pdfFields
      await supabase.from('document_versions').update(vpatch).eq('id', versionId)
    }
    // understanding questions (tests)
    if (versionId) {
      const cleanQs = (test?.questions || []).filter(q => q.q && (q.options || []).length >= 2 && q.answer)
      const cleanAck = (test?.ack_statements || []).map(x => (x || '').trim()).filter(Boolean)
      if (cleanQs.length || cleanAck.length) {
        const payload = { pass_mark: Number(test?.pass_mark) || 80, questions: cleanQs, shuffle: test?.shuffle ?? true, ack_statements: cleanAck }
        if (test?.id) await supabase.from('tests').update(payload).eq('id', test.id)
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
        pdf_field_map: edit.doc_type === 'pdf_form' ? pdfFields : (version?.pdf_field_map || null),
      }).select('*').single()
      if (ie) throw ie
      if (file) { const { error: fe } = await supabase.storage.from('masters').upload(pdf_path, file, { upsert: true }); if (fe) throw fe }
      const cleanQs = (test?.questions || []).filter(q => q.q && (q.options || []).length >= 2 && q.answer)
      const cleanAck = (test?.ack_statements || []).map(x => (x || '').trim()).filter(Boolean)
      if (cleanQs.length || cleanAck.length) await supabase.from('tests').insert({ document_version_id: nv.id, pass_mark: Number(test?.pass_mark) || 80, questions: cleanQs, shuffle: test?.shuffle ?? true, ack_statements: cleanAck })
      await supabase.from('documents').update({ current_version_id: nv.id }).eq('id', edit.id)
      let reassigned = 0
      if (reassign) {
        const { data: rows } = await supabase.from('assignments').select('employee_id, profiles!assignments_employee_id_fkey(status)').eq('document_id', edit.id)
        const ids = [...new Set((rows || []).filter(r => r.profiles?.status === 'active').map(r => r.employee_id))]
        const due = new Date(Date.now() + ((edit.due_days || 14) * 864e5)).toISOString().slice(0, 10)
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
                {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div style={{ width: 150 }}><label>Refresher (months)</label>
              <input type="number" value={edit.recurrence_months || ''} onChange={e => setEdit({ ...edit, recurrence_months: e.target.value ? Number(e.target.value) : null })} /></div>
            <div style={{ width: 190 }}><label>Due after assigning</label>
              <div className="row" style={{ gap: 6, margin: 0 }}>
                <input type="number" min="0" style={{ width: 70 }} value={dueNum}
                  onChange={e => { const n = e.target.value === '' ? '' : Number(e.target.value); setDueNum(n); setEdit({ ...edit, due_days: n === '' ? null : n * (dueUnit === 'weeks' ? 7 : 1) }) }} />
                <select value={dueUnit} onChange={e => { const u = e.target.value; setDueUnit(u); setEdit({ ...edit, due_days: dueNum === '' ? null : Number(dueNum) * (u === 'weeks' ? 7 : 1) }) }}>
                  <option value="days">days</option>
                  <option value="weeks">weeks</option>
                </select>
              </div>
              <p className="muted" style={{ fontSize: 11, margin: '2px 0 0' }}>Blank = default 14 days</p></div>
          </div>

          <label style={{ marginTop: 10 }}>Who must e-sign</label>
          <div className="checkgrid">
            <label><input type="checkbox" checked={!!edit.requires_signature} onChange={e => setEdit({ ...edit, requires_signature: e.target.checked })} />Employee e-signature</label>
            <label><input type="checkbox" checked={!!edit.requires_manager_signoff} onChange={e => setEdit({ ...edit, requires_manager_signoff: e.target.checked })} />Manager sign-off</label>
            <label><input type="checkbox" checked={!!edit.requires_admin_signoff} onChange={e => setEdit({ ...edit, requires_admin_signoff: e.target.checked })} />Admin sign-off</label>
            <label><input type="checkbox" checked={!!edit.active} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Active</label>
          </div>

          <label style={{ marginTop: 12 }}>Instructions for staff <span className="muted" style={{ fontWeight: 400 }}>(optional — shown at the top when they open the document)</span></label>
          <RichText value={edit.instructions || ''} onChange={html => setEdit({ ...edit, instructions: html })} placeholder="e.g. Read the attached policy, then tick each statement and sign." />

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

          {preview && (
            <div className="fb-section" style={{ marginTop: 10 }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Document preview{file ? ' (new file — save to keep)' : ''}</label>
                <a href={preview.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open full screen ↗</a>
              </div>
              {preview.kind === 'pdf' && <iframe title="preview" src={preview.url} style={{ width: '100%', height: 520, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', marginTop: 6 }} />}
              {preview.kind === 'image' && <img src={preview.url} alt="preview" style={{ maxWidth: '100%', border: '1px solid var(--line)', borderRadius: 8, marginTop: 6 }} />}
              {preview.kind === 'other' && <p className="muted" style={{ marginTop: 6 }}>{preview.name} — can’t preview this file type here. Use “Open full screen”.</p>}
            </div>
          )}

          {edit.doc_type === 'web_form' && (
            <div style={{ marginTop: 14 }}>
              <label>Form content (no code — build the sections your staff will complete)</label>
              <FormBuilder pages={pages} onChange={setPages} />
            </div>
          )}

          {edit.doc_type === 'pdf_form' && (
            <div style={{ marginTop: 14 }}>
              <div className="row between" style={{ alignItems: 'center' }}>
                <label style={{ margin: 0 }}>PDF fields — drop signature / date / text onto the form and tag who fills each{pdfFields.length ? ` · ${pdfFields.length} placed` : ''}</label>
                {pdfEditUrl && <button type="button" className="small secondary" onClick={() => setPdfEditorOpen(o => !o)}>{pdfEditorOpen ? 'Hide form' : 'Show / edit fields'}</button>}
              </div>
              {!pdfEditUrl
                ? <p className="muted">Upload a PDF master above (then Save), and the form appears here to place fields on.</p>
                : pdfEditorOpen
                  ? <Suspense fallback={<p className="muted">Loading field tool…</p>}><PdfFieldEditor pdfUrl={pdfEditUrl} value={pdfFields} onChange={setPdfFields} /></Suspense>
                  : <p className="muted" style={{ marginTop: 6 }}>{pdfFields.length} field{pdfFields.length === 1 ? '' : 's'} placed. Form hidden to keep things fast — click “Show / edit fields” to view or change them.</p>}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <label>Understanding questions (optional — checks the employee understood before it counts as complete)</label>
            <QuestionBuilder test={test} onChange={setTest} />
          </div>

          <div style={{ marginTop: 14 }}>
            <label>Acknowledgement statements (optional — staff must tick each to confirm)</label>
            {((test?.ack_statements) || []).map((st, i) => (
              <div key={i} className="row" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <input value={st} onChange={e => { const arr = [...(test?.ack_statements || [])]; arr[i] = e.target.value; setTest({ ...(test || { pass_mark: 80, questions: [] }), ack_statements: arr }) }} placeholder="e.g. I understand I must wear PPE at all times" />
                <button type="button" className="danger small" onClick={() => setTest({ ...(test || { pass_mark: 80, questions: [] }), ack_statements: (test?.ack_statements || []).filter((_, j) => j !== i) })}>✕</button>
              </div>
            ))}
            <button type="button" className="small secondary" onClick={() => setTest({ ...(test || { pass_mark: 80, questions: [] }), ack_statements: [...((test?.ack_statements) || []), ''] })}>+ Add statement</button>
          </div>

          <label style={{ marginTop: 10 }}>Who does this apply to? <span className="muted" style={{ fontWeight: 400 }}>(auto-assigned to new hires who match)</span></label>
          <ConditionsBuilder value={edit.conditions} onChange={c => setEdit({ ...edit, conditions: c })} />

          {edit.id && (
            <div className="fb-section" style={{ marginTop: 12 }}>
              <button type="button" className="small secondary" disabled={busy} onClick={async () => { setBusy(true); setMsg(''); const n = await rolloutDoc(edit.id, false); setBusy(false); if (n != null) setMsg(`Assigned to ${n} current staff member${n === 1 ? '' : 's'} (already-assigned staff skipped).`) }}>Roll out to current staff now</button>
              <span className="muted" style={{ fontSize: 12, marginLeft: 8 }}>Assigns this document to current staff who match the rules above (new hires get it automatically). Save any changes first.</span>
            </div>
          )}

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
              <button type="button" className="secondary" onClick={() => setShowPreview(true)}>👁 Preview as employee</button>
            </div>
          )}
          {showPreview && (
            <PreviewModal doc={edit} catName={cats.find(c => c.id === edit.category_id)?.name || 'Other'} preview={preview} mediaUrl={mediaUrl} pages={pages} pdfFields={pdfFields} test={test} onClose={() => setShowPreview(false)} />
          )}
        </div>
      )}
      <table>
        <thead><tr><th>Code</th><th>Title</th><th>Category</th><th>Type</th><th>Emp</th><th>Mgr</th><th>Adm</th><th /></tr></thead>
        <tbody>
          {docs.filter(d => d.active).map(d => (
            <tr key={d.id}>
              <td><b>{d.code}</b></td><td>{d.title}</td>
              <td className="muted">{d.document_categories?.name}</td>
              <td className="muted">{d.doc_type}</td>
              <td>{d.requires_signature ? '\u2713' : ''}</td>
              <td>{d.requires_manager_signoff ? '\u2713' : ''}</td>
              <td>{d.requires_admin_signoff ? '\u2713' : ''}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="secondary small" onClick={() => openEdit(d)}>Edit</button>{' '}
                <button className="small" onClick={() => archiveDoc(d, false)}>Archive</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {docs.some(d => !d.active) && (
        <div className="fb-section" style={{ marginTop: 18 }}>
          <h3 style={{ margin: '0 0 4px' }}>Archived documents</h3>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Hidden from staff and not assigned to new hires. Restore to bring one back, or delete permanently.</p>
          <table>
            <thead><tr><th>Code</th><th>Title</th><th>Category</th><th>Type</th><th /></tr></thead>
            <tbody>
              {docs.filter(d => !d.active).map(d => (
                <tr key={d.id} style={{ opacity: .7 }}>
                  <td><b>{d.code}</b></td><td>{d.title}</td>
                  <td className="muted">{d.document_categories?.name}</td>
                  <td className="muted">{d.doc_type}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="secondary small" onClick={() => openEdit(d)}>View</button>{' '}
                    <button className="small" onClick={() => archiveDoc(d, true)}>Restore</button>{' '}
                    <button className="small" style={{ color: '#b00020' }} onClick={() => deleteDoc(d)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const [cats, setCats] = useState([])
  const [nc, setNc] = useState({ code: '', name: '' })
  const [editCat, setEditCat] = useState(null)

  async function load() {
    const [l, r, v, t, cc] = await Promise.all([
      supabase.from('locations').select('*').order('name'),
      supabase.from('job_roles').select('*').order('name'),
      supabase.from('vehicles').select('*, locations(name)').order('name'),
      supabase.from('licence_types').select('*').order('name'),
      supabase.from('document_categories').select('*').order('sort_order'),
    ])
    setLocations(l.data || []); setRoles(r.data || []); setVehicles(v.data || []); setLicTypes(t.data || []); setCats(cc.data || [])
  }
  useEffect(() => { load() }, [])
  async function deleteVehicle(v) {
    if (!window.confirm(`Delete ${v.name || v.rego}? This can't be undone.`)) return
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id)
    if (error) { window.alert(/foreign key|violates/i.test(error.message) ? 'This vehicle has inductions assigned — set it Inactive on the Store page instead.' : error.message); return }
    load()
  }
  async function addCat() {
    if (!nc.name.trim()) return
    const max = Math.max(0, ...cats.map(c => c.sort_order || 0))
    const { error } = await supabase.from('document_categories').insert({ code: nc.code.trim() || null, name: nc.name.trim(), sort_order: max + 1 })
    if (error) { window.alert(error.message); return }
    setNc({ code: '', name: '' }); load()
  }
  async function saveCat() {
    const { error } = await supabase.from('document_categories').update({ code: editCat.code?.trim() || null, name: editCat.name.trim() }).eq('id', editCat.id)
    if (error) { window.alert(error.message); return }
    setEditCat(null); load()
  }
  async function delCat(c) {
    const { count } = await supabase.from('documents').select('id', { count: 'exact', head: true }).eq('category_id', c.id)
    if (count) { window.alert(`${count} document(s) use “${c.name}”. Move them to another category first.`); return }
    if (!window.confirm(`Delete category “${c.name}”?`)) return
    const { error } = await supabase.from('document_categories').delete().eq('id', c.id)
    if (error) { window.alert(error.message); return }
    load()
  }
  async function moveCat(c, dir) {
    const arr = [...cats]; const i = arr.findIndex(x => x.id === c.id); const j = i + dir
    if (j < 0 || j >= arr.length) return
    const a = arr[i], b = arr[j]
    await supabase.from('document_categories').update({ sort_order: b.sort_order }).eq('id', a.id)
    await supabase.from('document_categories').update({ sort_order: a.sort_order }).eq('id', b.id)
    load()
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <h2>Document categories</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>This order controls how categories are grouped everywhere in the app. Use ▲▼ to reorder.</p>
        <table><tbody>
          {cats.map((c, i) => (
            <tr key={c.id}>
              {editCat?.id === c.id ? (
                <>
                  <td style={{ width: 90 }}><input value={editCat.code || ''} onChange={e => setEditCat({ ...editCat, code: e.target.value })} placeholder="Code" /></td>
                  <td><input value={editCat.name} onChange={e => setEditCat({ ...editCat, name: e.target.value })} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><button className="small" onClick={saveCat}>Save</button> <button className="small secondary" onClick={() => setEditCat(null)}>Cancel</button></td>
                </>
              ) : (
                <>
                  <td className="muted" style={{ width: 90 }}>{c.code}</td>
                  <td>{c.name}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="small secondary" disabled={i === 0} onClick={() => moveCat(c, -1)}>▲</button>{' '}
                    <button className="small secondary" disabled={i === cats.length - 1} onClick={() => moveCat(c, 1)}>▼</button>{' '}
                    <button className="small secondary" onClick={() => setEditCat({ id: c.id, code: c.code, name: c.name })}>Edit</button>{' '}
                    <button className="small" style={{ color: '#b00020' }} onClick={() => delCat(c)}>Delete</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody></table>
        <div className="row" style={{ marginTop: 10 }}>
          <input style={{ width: 90 }} placeholder="Code" value={nc.code} onChange={e => setNc({ ...nc, code: e.target.value })} />
          <input placeholder="New category name" value={nc.name} onChange={e => setNc({ ...nc, name: e.target.value })} />
          <button className="small" onClick={addCat} disabled={!nc.name.trim()}>Add</button>
        </div>
      </div>
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


function TestAccounts() {
  const [roles, setRoles] = useState([])
  const [locs, setLocs] = useState([])
  const [accts, setAccts] = useState([])
  const [f, setF] = useState({ first: '', last: '', tier: 'employee', role: '', store: '', email: '', pw: 'Nuway4207' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function load() {
    const [r, l, a] = await Promise.all([
      supabase.from('job_roles').select('id, name').eq('active', true).order('name'),
      supabase.from('locations').select('id, name').eq('active', true).order('name'),
      supabase.from('profiles').select('id, first_name, last_name, email, tier').eq('is_test', true).order('created_at'),
    ])
    setRoles(r.data || []); setLocs(l.data || []); setAccts(a.data || [])
  }
  useEffect(() => { load() }, [])
  function quick(kind) {
    const store = locs[0]?.id || ''
    if (kind === 'manager') setF({ first: 'Test', last: 'Manager', tier: 'manager', role: roles.find(r => r.name === 'Manager')?.id || '', store, email: 'testmanager@nuway.test', pw: 'Nuway4207' })
    else setF({ first: 'Test', last: 'Employee', tier: 'employee', role: roles.find(r => r.name === 'Yard')?.id || '', store, email: 'testemployee@nuway.test', pw: 'Nuway4207' })
  }
  async function create() {
    if (!f.first.trim() || !f.last.trim() || !f.email.trim() || !f.pw) { setMsg('Fill in name, email and password.'); return }
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('create_test_account', { p_first: f.first.trim(), p_last: f.last.trim(), p_email: f.email.trim(), p_tier: f.tier, p_role: f.role || null, p_store: f.store || null, p_pw: f.pw })
    setBusy(false)
    if (error) { setMsg('Failed: ' + error.message); return }
    setMsg(`Created ${f.first} ${f.last}. Log in at the app with ${f.email.trim()} / ${f.pw}`)
    setF({ first: '', last: '', tier: 'employee', role: '', store: '', email: '', pw: 'Nuway4207' }); load()
  }
  async function del(a) {
    if (!window.confirm(`Delete test account ${a.first_name} ${a.last_name} (${a.email})? This removes the login and all their data.`)) return
    const { error } = await supabase.rpc('delete_test_account', { p_uid: a.id })
    if (error) { setMsg('Failed: ' + error.message); return }
    setMsg('Test account deleted.'); load()
  }
  return (
    <div className="card">
      <h2>Test accounts</h2>
      <p className="muted">Create throwaway logins to test the manager and employee portals. They log in immediately with the email &amp; password below — no invite email. Delete them before you add real staff.</p>
      {msg && <div className="success">{msg}</div>}
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <button className="small secondary" onClick={() => quick('manager')}>Prefill Test Manager</button>
        <button className="small secondary" onClick={() => quick('employee')}>Prefill Test Employee</button>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div><label>First name</label><input value={f.first} onChange={e => setF({ ...f, first: e.target.value })} /></div>
        <div><label>Last name</label><input value={f.last} onChange={e => setF({ ...f, last: e.target.value })} /></div>
        <div><label>Access level</label>
          <select value={f.tier} onChange={e => setF({ ...f, tier: e.target.value })}><option value="employee">Employee</option><option value="manager">Manager</option></select></div>
        <div><label>Job role</label>
          <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}><option value="">—</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <div><label>Store</label>
          <select value={f.store} onChange={e => setF({ ...f, store: e.target.value })}><option value="">—</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 220 }}><label>Login email</label><input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="testmanager@nuway.test" /></div>
        <div><label>Password</label><input value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} /></div>
        <div style={{ alignSelf: 'flex-end' }}><button onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create test account'}</button></div>
      </div>
      <table style={{ marginTop: 16 }}>
        <thead><tr><th>Name</th><th>Access</th><th>Login email</th><th></th></tr></thead>
        <tbody>
          {accts.map(a => (
            <tr key={a.id}>
              <td>{a.first_name} {a.last_name}</td>
              <td className="muted">{a.tier}</td>
              <td>{a.email}</td>
              <td style={{ textAlign: 'right' }}><button className="small" style={{ color: '#b00020' }} onClick={() => del(a)}>Delete</button></td>
            </tr>
          ))}
          {accts.length === 0 && <tr><td colSpan={4} className="muted">No test accounts yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}


function PreviewModal({ doc, catName, preview, mediaUrl, pages, pdfFields, test, onClose }) {
  const [values, setValues] = useState({})
  const [pdfVals, setPdfVals] = useState({})
  const [answers, setAnswers] = useState({})
  const [acks, setAcks] = useState({})
  const [, setSig] = useState(null)
  const [name, setName] = useState('')
  const guided = doc.doc_type === 'web_form'
  const isPdfForm = doc.doc_type === 'pdf_form'
  const isUpload = doc.doc_type === 'upload'
  const isStandard = doc.doc_type === 'standard'
  const needsSig = !!doc.requires_signature
  const schema = guided ? ((pages && pages.length) ? { type: 'guided', pages } : null) : null
  const qs = (test?.questions || []).filter(q => q.q && (q.options || []).length >= 2)
  const acksList = (test?.ack_statements || []).map(x => (x || '').trim()).filter(Boolean)
  const compFields = (pdfFields || []).filter(f => f.role === 'competent')
  const afterSign = [doc.requires_manager_signoff && 'manager', doc.requires_admin_signoff && 'admin', doc.requires_assessor_signoff && 'competent-person'].filter(Boolean)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 2000, overflow: 'auto', padding: '24px 12px' }} onClick={onClose}>
      <div style={{ maxWidth: 840, margin: '0 auto', background: '#f4f6f4', borderRadius: 12, padding: 20 }} onClick={e => e.stopPropagation()}>
        <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 12 }}>👁 Employee portal preview — nothing here is saved</span>
          <button className="small secondary" onClick={onClose}>Close ✕</button>
        </div>
        <h1 style={{ marginTop: 0 }}>{doc.code} — {doc.title}</h1>
        <p className="muted">{catName} · due (example date)</p>
        {doc.instructions && <div className="ackbox" style={{ marginBottom: 14 }} dangerouslySetInnerHTML={{ __html: String(doc.instructions).replace(/<script[\s\S]*?<\/script>/gi, '') }} />}
        <div className="doc-content">
          {mediaUrl && (/\.(mp4|webm)(\?|$)/i.test(mediaUrl)
            ? <video src={mediaUrl} controls style={{ maxWidth: '100%' }} />
            : <p><a href={mediaUrl} target="_blank" rel="noreferrer">Open training material ↗</a></p>)}
          {preview && !isPdfForm && (
            <div style={{ marginBottom: 4 }}>
              <b style={{ fontSize: 15 }}>📄 Read this document</b>
              {preview.kind === 'pdf' && <iframe title="doc" src={preview.url} style={{ width: '100%', height: 560, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', marginTop: 6 }} />}
              {preview.kind === 'image' && <img src={preview.url} alt="doc" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, marginTop: 6 }} />}
              {preview.kind === 'other' && <p className="muted">Attachment: {preview.name}</p>}
              <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Please read the full document above before confirming and signing below.</p>
            </div>
          )}
          {isPdfForm && preview && (
            <Suspense fallback={<p className="muted">Loading form…</p>}>
              <PdfFieldFiller pdfUrl={preview.url} fields={pdfFields} roles={compFields.length ? ['employee', 'competent'] : ['employee']} values={pdfVals} onChange={setPdfVals} />
            </Suspense>
          )}
          {isPdfForm && !preview && <p className="muted">Upload the PDF master to preview the fillable form.</p>}
          {schema && <FormRenderer schema={schema} values={values} onChange={setValues} />}
          {isUpload && (<>
            <label>Upload evidence <span className="muted" style={{ fontWeight: 400 }}>(take photos or choose files — several allowed)</span></label>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              <span className="btnfile">📷 Take photo</span><span className="btnfile">📎 Choose file(s)</span>
            </div>
          </>)}
        </div>
        {qs.length > 0 && (
          <div className="card"><h2>Test — pass mark {Number(test?.pass_mark) || 80}%</h2>
            {qs.map((q, i) => (
              <div key={i} style={{ marginBottom: 12 }}><p><b>{i + 1}. {q.q}</b></p>
                {(q.options || []).map(o => (
                  <label key={o} style={{ display: 'flex', gap: 8, fontWeight: 400, margin: '4px 0' }}>
                    <input type="radio" style={{ width: 'auto' }} name={'pq' + i} checked={answers[i] === o} onChange={() => setAnswers({ ...answers, [i]: o })} /> {o}
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        {acksList.length > 0 && (
          <div className="card"><h2>Please confirm</h2>
            {acksList.map((st, i) => (
              <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400, margin: '6px 0' }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!acks[i]} onChange={e => setAcks({ ...acks, [i]: e.target.checked })} /> {st}
              </label>
            ))}
          </div>
        )}
        {needsSig && (
          <div className="card"><h2>Sign &amp; acknowledge</h2>
            {!guided && !isPdfForm && !isStandard && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} readOnly /> I confirm I have read and understood this document, and my electronic signature below is my agreement to comply with it.
              </label>
            )}
            <label>Full name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="Type your full legal name" />
            {!isPdfForm && <><label>Signature</label><SignaturePad onChange={setSig} /></>}
            {isPdfForm && compFields.length > 0 && <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e6e0' }}><label>Competent person’s name</label><input placeholder="Supervisor / competent person" /></div>}
          </div>
        )}
        {afterSign.length > 0 && <p className="muted" style={{ fontSize: 13 }}>After the employee submits, this also needs {afterSign.join(' + ')} sign-off before it counts as complete.</p>}
        <div className="row" style={{ marginTop: 12 }}><button className="secondary" onClick={onClose}>Close preview</button></div>
      </div>
    </div>
  )
}
