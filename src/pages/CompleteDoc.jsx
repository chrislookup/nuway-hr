import { useEffect, useState, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import SignaturePad from '../components/SignaturePad'
import FormRenderer, { validateGuided } from '../components/FormRenderer'
const PdfFieldFiller = lazy(() => import('../components/PdfFieldFiller'))

export default function CompleteDoc({ profile }) {
  const { assignmentId } = useParams()
  const nav = useNavigate()
  const [a, setA] = useState(null)
  const [version, setVersion] = useState(null)
  const [test, setTest] = useState(null)
  const [values, setValues] = useState({})
  const [answers, setAnswers] = useState({})
  const [sig, setSig] = useState(null)
  const [signedName, setSignedName] = useState('')
  const [agree, setAgree] = useState(false)
  const [file, setFile] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfVals, setPdfVals] = useState({})

  useEffect(() => {
    (async () => {
      const { data: asg } = await supabase.from('assignments')
        .select('*, documents(*, document_categories(name))')
        .eq('id', assignmentId).single()
      setA(asg)
      if (!asg) return
      const vid = asg.documents.current_version_id
      if (vid) {
        const { data: v } = await supabase.from('document_versions').select('*').eq('id', vid).single()
        setVersion(v)
        if (v?.pdf_path) {
          const { data: s } = await supabase.storage.from('masters').createSignedUrl(v.pdf_path, 3600)
          setPdfUrl(s?.signedUrl || null)
        }
        const { data: t } = await supabase.from('tests').select('*').eq('document_version_id', vid).maybeSingle()
        setTest(t)
      }
      if (asg.status === 'not_started' && asg.employee_id === profile.id) {
        supabase.from('assignments').update({ status: 'in_progress' }).eq('id', asg.id).then(() => {})
      }
    })()
  }, [assignmentId, profile.id])

  if (!a) return <p className="muted">Loading…</p>
  const doc = a.documents
  const isUpload = doc.doc_type === 'upload'
  const needsSig = doc.requires_signature
  const mine = a.employee_id === profile.id

  const guided = !!version?.form_schema?.pages
  const assessorIdx = (version?.form_schema?.pages || []).map((p, i) => (p.assessor ? i : -1)).filter(i => i >= 0)
  const hasAssessor = assessorIdx.length > 0
  const pdfFields = version?.pdf_field_map || []
  const isPdfForm = doc.doc_type === 'pdf_form' && pdfFields.length > 0 && !!pdfUrl
  const empFields = pdfFields.filter(f => f.signer === 'employee')
  const compFields = pdfFields.filter(f => f.signer === 'competent')

  async function submitPdf() {
    setErr('')
    for (const f of empFields) {
      if (!f.required) continue
      const val = pdfVals[f.id]
      if (f.type === 'checkbox' ? !val : (!val || (typeof val === 'string' && !val.trim()))) { setErr('Please complete all required fields on the form (marked *).'); return }
    }
    if (needsSig && !signedName.trim()) { setErr('Please type your full name to sign.'); return }
    if (needsSig && !agree) { setErr('Please tick the acknowledgement box.'); return }
    setBusy(true)
    try {
      const persist = {}, flat = {}
      let sigPath = null
      for (const f of empFields) {
        const val = pdfVals[f.id]
        if (val === undefined || val === '' || val === false) continue
        if (f.type === 'signature' || f.type === 'initials') {
          const blob = await (await fetch(val)).blob()
          const p = `${a.employee_id}/${a.id}-emp-${f.id}.png`
          const { error } = await supabase.storage.from('signatures').upload(p, blob, { upsert: true })
          if (error) throw error
          persist[f.id] = p; flat[f.id] = val
          if (!sigPath && f.type === 'signature') sigPath = p
        } else { persist[f.id] = val; flat[f.id] = val }
      }
      const needComp = compFields.length > 0 && doc.requires_assessor_signoff
      let completed_pdf_path = null
      if (!needComp) {
        const masterBytes = await (await fetch(pdfUrl)).arrayBuffer()
        const { flattenPdf } = await import('../lib/flattenPdf')
        const bytes = await flattenPdf(masterBytes, pdfFields, flat)
        completed_pdf_path = `${a.employee_id}/${a.id}-completed.pdf`
        const { error: fe } = await supabase.storage.from('completed-docs').upload(completed_pdf_path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true })
        if (fe) throw fe
      }
      const { error: ce } = await supabase.from('completions').insert({
        assignment_id: a.id, document_version_id: version?.id,
        form_data: { pdf: { values: persist }, uploaded_file: null },
        signature_path: sigPath, signed_name: signedName || null,
        signed_at: new Date().toISOString(), completed_pdf_path,
        user_agent: navigator.userAgent,
      })
      if (ce) throw ce
      let status = 'completed'
      if (needComp || doc.requires_manager_signoff || doc.requires_admin_signoff) status = 'awaiting_review'
      const upd = { status, rejection_reason: null }
      if (status === 'completed') {
        upd.completed_at = new Date().toISOString()
        if (doc.recurrence_months) { const d = new Date(); d.setMonth(d.getMonth() + doc.recurrence_months); upd.expires_at = d.toISOString().slice(0, 10) }
      }
      const { error: ae } = await supabase.from('assignments').update(upd).eq('id', a.id)
      if (ae) throw ae
      nav('/')
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }
  async function submit() {
    setErr('')
    if (guided) { const gerr = validateGuided(version.form_schema, values); if (gerr) { setErr(gerr); return } }
    if (needsSig && (!sig || !signedName.trim())) { setErr('Please type your full name and sign before submitting.'); return }
    if (needsSig && !guided && !agree) { setErr('Please tick the acknowledgement box.'); return }
    for (const pi of assessorIdx) { if (!values[`cp_${pi}_sig`] || !String(values[`cp_${pi}_name`] || '').trim()) { setErr('Each competent-person section needs the competent person’s name and signature.'); return } }
    if (isUpload && !file) { setErr('Please choose a file to upload.'); return }
    if (test) {
      const qs = test.questions || []
      if (qs.some((_, i) => answers[i] === undefined)) { setErr('Please answer every test question.'); return }
    }
    setBusy(true)
    try {
      let signature_path = null
      if (sig) {
        const blob = await (await fetch(sig)).blob()
        signature_path = `${a.employee_id}/${a.id}-signature.png`
        const { error: se } = await supabase.storage.from('signatures').upload(signature_path, blob, { upsert: true })
        if (se) throw se
      }
      const verifier_data = {}
      let firstName = null, firstPath = null
      for (const pi of assessorIdx) {
        const cblob = await (await fetch(values[`cp_${pi}_sig`])).blob()
        const cpath = `${a.employee_id}/${a.id}-cp-${pi}.png`
        const { error: ve } = await supabase.storage.from('signatures').upload(cpath, cblob, { upsert: true })
        if (ve) throw ve
        verifier_data[String(pi)] = { name: String(values[`cp_${pi}_name`]).trim(), sig: cpath }
        if (!firstName) { firstName = verifier_data[String(pi)].name; firstPath = cpath }
      }
      const cleanValues = Object.fromEntries(Object.entries(values).filter(([k]) => !k.startsWith('cp_')))
      let uploadedPath = null
      if (file) {
        uploadedPath = `${a.employee_id}/${a.id}-${file.name.replace(/[^\w.\-]+/g, '_')}`
        const { error: fe } = await supabase.storage.from('completed-docs').upload(uploadedPath, file, { upsert: true })
        if (fe) throw fe
      }
      let passed = null, score = null
      if (test) {
        const qs = test.questions || []
        const pts = qs.reduce((s, q, i) => s + (answers[i] === q.answer ? (q.points || 1) : 0), 0)
        const total = qs.reduce((s, q) => s + (q.points || 1), 0)
        score = total ? Math.round(pts / total * 100) : 0
        passed = score >= Number(test.pass_mark || 80)
      }
      const { data: comp, error: ce } = await supabase.from('completions').insert({
        assignment_id: a.id,
        document_version_id: version?.id,
        form_data: { ...cleanValues, uploaded_file: uploadedPath },
        signature_path, signed_name: signedName || null,
        signed_at: needsSig ? new Date().toISOString() : null,
        verifier_name: firstName, verifier_signature_path: firstPath,
        verifier_data: assessorIdx.length ? verifier_data : null,
        verified_at: assessorIdx.length ? new Date().toISOString() : null,
        user_agent: navigator.userAgent,
      }).select().single()
      if (ce) throw ce
      if (test) {
        const { error: te } = await supabase.from('test_attempts').insert({
          assignment_id: a.id, test_id: test.id, answers, score, passed,
          review: passed ? 'passed_off' : 'pending',
        })
        if (te) throw te
      }
      let status = 'completed'
      if (test && !passed) status = 'awaiting_review'
      else if (doc.requires_manager_signoff || doc.requires_admin_signoff || (doc.requires_assessor_signoff && !hasAssessor)) status = 'awaiting_review'
      const upd = { status, rejection_reason: null }
      if (status === 'completed') {
        upd.completed_at = new Date().toISOString()
        if (doc.recurrence_months) {
          const d = new Date(); d.setMonth(d.getMonth() + doc.recurrence_months)
          upd.expires_at = d.toISOString().slice(0, 10)
        }
      }
      const { error: ae } = await supabase.from('assignments').update(upd).eq('id', a.id)
      if (ae) throw ae
      nav('/')
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  return (
    <div>
      <a onClick={() => nav(-1)} style={{ cursor: 'pointer' }}>&larr; Back</a>
      <h1>{doc.code} — {doc.title}</h1>
      <p className="muted">{doc.document_categories?.name} · due {fmtDate(a.due_date)}</p>

      {a.status === 'rejected' && (
        <div className="error" style={{ marginBottom: 12 }}>
          <b>This was returned for correction.</b>{a.rejection_reason ? ` Reason: ${a.rejection_reason}` : ''} Please review and submit again.
        </div>
      )}

      <div className="doc-content">
        {version?.media_url && (
          version.media_url.match(/\.(mp4|webm)(\?|$)/i)
            ? <video src={version.media_url} controls />
            : <p><a href={version.media_url} target="_blank" rel="noreferrer">Open training material ↗</a></p>
        )}
        {pdfUrl && <p><a href={pdfUrl} target="_blank" rel="noreferrer">Open document (PDF) ↗</a></p>}
        {isPdfForm && mine && !['completed'].includes(a.status) && (
          <Suspense fallback={<p className="muted">Loading form…</p>}>
            <p className="muted" style={{ fontSize: 13 }}>Fill your fields on the form below{compFields.length ? ', then submit — a competent person signs their part after' : ''}.</p>
            <PdfFieldFiller pdfUrl={pdfUrl} fields={pdfFields} role="employee" values={pdfVals} onChange={setPdfVals} />
          </Suspense>
        )}
        {!version?.media_url && !pdfUrl && !version?.form_schema && !isUpload && (
          <p className="muted">Content for this document hasn't been uploaded yet. You can still read the printed copy and sign below — or check back later.</p>
        )}
        {version?.form_schema && <FormRenderer schema={version.form_schema} values={values} onChange={setValues} />}
        {isUpload && (<><label>Upload file (photo or PDF)</label>
          <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files[0])} /></>)}
      </div>

      {test && (
        <div className="card">
          <h2>Test — pass mark {Number(test.pass_mark)}%</h2>
          {(test.questions || []).map((q, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <p><b>{i + 1}. {q.q}</b></p>
              {(q.options || []).map(o => (
                <label key={o} style={{ display: 'flex', gap: 8, fontWeight: 400, margin: '4px 0' }}>
                  <input type="radio" style={{ width: 'auto' }} name={`q${i}`}
                    checked={answers[i] === o} onChange={() => setAnswers({ ...answers, [i]: o })} /> {o}
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      {mine && !['completed'].includes(a.status) && (
        <div className="card">
          {needsSig && (<>
            <h2>Sign &amp; acknowledge</h2>
            {!guided && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400 }}>
                <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={agree} onChange={e => setAgree(e.target.checked)} />
                I confirm I have read and understood this document, and my electronic signature below is my agreement to comply with it.
              </label>
            )}
            <label>Full name</label>
            <input value={signedName} onChange={e => setSignedName(e.target.value)} placeholder="Type your full legal name" />
            {!isPdfForm && (<><label>Signature</label>
            <SignaturePad onChange={setSig} /></>)}
          </>)}
          {err && <div className="error">{err}</div>}
          <button style={{ marginTop: 14 }} onClick={isPdfForm ? submitPdf : submit} disabled={busy}>
            {busy ? 'Submitting…' : doc.requires_manager_signoff ? 'Submit for manager sign-off' : 'Submit'}
          </button>
        </div>
      )}
      {a.status === 'completed' && <div className="success">Completed {fmtDate(a.completed_at)}{a.expires_at ? ` — next due ${fmtDate(a.expires_at)}` : ''}</div>}
    </div>
  )
}
