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
  const [acks, setAcks] = useState({})
  const [cpName, setCpName] = useState('')
  const [draftMsg, setDraftMsg] = useState('')
  const [opened, setOpened] = useState(false)
  const [raUrl, setRaUrl] = useState(null)
  const [raAck, setRaAck] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: asg } = await supabase.from('assignments')
        .select('*, documents(*, document_categories(name))')
        .eq('id', assignmentId).single()
      setA(asg)
      if (!asg) return
      try { const d = JSON.parse(localStorage.getItem(`nuwayhr_draft_${asg.id}`) || 'null'); if (d) { setPdfVals(d.pdfVals || {}); setSignedName(d.signedName || ''); setAgree(!!d.agree); setCpName(d.cpName || '') } } catch (e) { /* ignore */ }
      if (asg.vehicle_id) {
        const { data: veh } = await supabase.from('vehicles').select('rego, risk_assessment_path').eq('id', asg.vehicle_id).single()
        if (veh?.risk_assessment_path) { const { data: rs } = await supabase.storage.from('masters').createSignedUrl(veh.risk_assessment_path, 3600); setRaUrl(rs?.signedUrl || null) }
      }
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
  const isStandard = doc.doc_type === 'standard'
  const masterPath = version?.pdf_path || ''
  const masterIsPdf = /\.pdf(\?|$)/i.test(masterPath)
  const masterIsImg = /\.(png|jpe?g|webp|gif)(\?|$)/i.test(masterPath)
  const masterName = masterPath ? masterPath.split('/').pop() : 'document'
  const needsRead = !!pdfUrl && doc.doc_type !== 'pdf_form'
  const ackList = test?.ack_statements || []
  const hasQuiz = (test?.questions || []).length > 0
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
    if (ackList.length && ackList.some((_, i) => !acks[i])) { setErr('Please tick all the acknowledgement statements to confirm.'); return }
    if (compFields.length) {
      for (const f of compFields) { if (!f.required) continue; const val = pdfVals[f.id]; if (f.type === 'checkbox' ? !val : (!val || (typeof val === 'string' && !val.trim()))) { setErr('The competent person still needs to complete their fields (marked *). Not available now? Use “Save draft” and come back.'); return } }
      if (!cpName.trim()) { setErr('Please enter the competent person’s name.'); return }
    }
    setBusy(true)
    try {
      const persist = {}, flat = {}
      let sigPath = null, verPath = null
      const active = compFields.length ? [...empFields, ...compFields] : empFields
      for (const f of active) {
        const val = pdfVals[f.id]
        if (val === undefined || val === '' || val === false) continue
        if (f.type === 'signature' || f.type === 'initials') {
          const blob = await (await fetch(val)).blob()
          const p = `${a.employee_id}/${a.id}-${f.signer}-${f.id}.png`
          const { error } = await supabase.storage.from('signatures').upload(p, blob, { upsert: true })
          if (error) throw error
          persist[f.id] = p; flat[f.id] = val
          if (f.type === 'signature') { if (f.signer === 'employee' && !sigPath) sigPath = p; if (f.signer === 'competent' && !verPath) verPath = p }
        } else { persist[f.id] = val; flat[f.id] = val }
      }
      const masterBytes = await (await fetch(pdfUrl)).arrayBuffer()
      const { flattenPdf } = await import('../lib/flattenPdf')
      const bytes = await flattenPdf(masterBytes, pdfFields, flat)
      const completed_pdf_path = `${a.employee_id}/${a.id}-completed.pdf`
      const { error: fe } = await supabase.storage.from('completed-docs').upload(completed_pdf_path, new Blob([bytes], { type: 'application/pdf' }), { upsert: true })
      if (fe) throw fe
      const { error: ce } = await supabase.from('completions').insert({
        assignment_id: a.id, document_version_id: version?.id,
        form_data: { pdf: { values: persist }, uploaded_file: null, ack: ackList.length ? ackList : null },
        signature_path: sigPath, signed_name: signedName || null,
        signed_at: new Date().toISOString(), completed_pdf_path,
        verifier_name: compFields.length ? cpName.trim() : null,
        verifier_signature_path: verPath,
        verified_at: compFields.length ? new Date().toISOString() : null,
        user_agent: navigator.userAgent,
      })
      if (ce) throw ce
      let status = 'completed'
      if (doc.requires_manager_signoff || doc.requires_admin_signoff) status = 'awaiting_review'
      const upd = { status, rejection_reason: null }
      if (status === 'completed') {
        upd.completed_at = new Date().toISOString()
        if (doc.recurrence_months) { const d = new Date(); d.setMonth(d.getMonth() + doc.recurrence_months); upd.expires_at = d.toISOString().slice(0, 10) }
      }
      const { error: ae } = await supabase.from('assignments').update(upd).eq('id', a.id)
      if (ae) throw ae
      try { localStorage.removeItem(`nuwayhr_draft_${a.id}`) } catch (e) { /* ignore */ }
      nav('/')
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }
  function saveDraft() {
    try {
      localStorage.setItem(`nuwayhr_draft_${a.id}`, JSON.stringify({ pdfVals, signedName, agree, cpName }))
      setErr(''); setDraftMsg('Draft saved on this device — reopen this document anytime to finish with the competent person.')
      setTimeout(() => setDraftMsg(''), 6000)
    } catch (e) { setErr('Could not save draft: ' + (e.message || e)) }
  }
  async function submit() {
    setErr('')
    if (guided) { const gerr = validateGuided(version.form_schema, values); if (gerr) { setErr(gerr); return } }
    if (needsRead && !opened) { setErr('Please open and read the document first (use the “Open full screen” button).'); return }
    if (raUrl && !raAck) { setErr('Please read and tick to acknowledge the vehicle risk assessment.'); return }
    if (needsSig && (!sig || !signedName.trim())) { setErr('Please type your full name and sign before submitting.'); return }
    const showAgree = needsSig && !guided && !isPdfForm && !isStandard
    if (showAgree && !agree) { setErr('Please tick the acknowledgement box.'); return }
    if (ackList.length && ackList.some((_, i) => !acks[i])) { setErr('Please tick all the acknowledgement statements to confirm.'); return }
    for (const pi of assessorIdx) { if (!values[`cp_${pi}_sig`] || !String(values[`cp_${pi}_name`] || '').trim()) { setErr('Each competent-person section needs the competent person’s name and signature.'); return } }
    if (isUpload && !file) { setErr('Please choose a file to upload.'); return }
    if (hasQuiz) {
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
      if (hasQuiz) {
        const qs = test.questions || []
        const pts = qs.reduce((s, q, i) => s + (answers[i] === q.answer ? (q.points || 1) : 0), 0)
        const total = qs.reduce((s, q) => s + (q.points || 1), 0)
        score = total ? Math.round(pts / total * 100) : 0
        passed = score >= Number(test.pass_mark || 80)
      }
      const { data: comp, error: ce } = await supabase.from('completions').insert({
        assignment_id: a.id,
        document_version_id: version?.id,
        form_data: { ...cleanValues, uploaded_file: uploadedPath, ack: ackList.length ? ackList : null, ra_ack: raUrl ? true : null },
        signature_path, signed_name: signedName || null,
        signed_at: needsSig ? new Date().toISOString() : null,
        verifier_name: firstName, verifier_signature_path: firstPath,
        verifier_data: assessorIdx.length ? verifier_data : null,
        verified_at: assessorIdx.length ? new Date().toISOString() : null,
        user_agent: navigator.userAgent,
      }).select().single()
      if (ce) throw ce
      if (hasQuiz) {
        const { error: te } = await supabase.from('test_attempts').insert({
          assignment_id: a.id, test_id: test.id, answers, score, passed,
          review: passed ? 'passed_off' : 'pending',
        })
        if (te) throw te
      }
      let status = 'completed'
      if (hasQuiz && !passed) status = 'awaiting_review'
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
      {doc.instructions && <div className="ackbox" style={{ marginBottom: 14 }} dangerouslySetInnerHTML={{ __html: String(doc.instructions).replace(/<script[\s\S]*?<\/script>/gi, '') }} />}

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
        {pdfUrl && !isPdfForm && (
          <div style={{ marginBottom: 4 }}>
            <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
              <b style={{ fontSize: 15 }}>📄 Read this document</b>
              <a href={pdfUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}><button type="button" className="small secondary">Open full screen ↗</button></a>
            </div>
            {masterIsPdf
              ? <iframe title="document" src={pdfUrl} style={{ width: '100%', height: 620, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
              : masterIsImg
                ? <img src={pdfUrl} alt="document" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8 }} />
                : <a href={pdfUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)} style={{ textDecoration: 'none' }}>
                    <div className="card" style={{ borderColor: 'var(--teal)', background: '#f0fafb', textAlign: 'center', margin: 0 }}>
                      <div style={{ fontSize: 30 }}>📄</div>
                      <b>Open and read this document</b>
                      <p className="muted" style={{ margin: '4px 0 10px' }}>{masterName}</p>
                      <button type="button">Open document ↗</button>
                    </div>
                  </a>}
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>Please read the full document above before confirming and signing below.</p>
          </div>
        )}
        {pdfUrl && isPdfForm && <p><a href={pdfUrl} target="_blank" rel="noreferrer">Open document (PDF) ↗</a></p>}
        {isPdfForm && mine && !['completed'].includes(a.status) && (
          <Suspense fallback={<p className="muted">Loading form…</p>}>
            <p className="muted" style={{ fontSize: 13 }}>Fill your fields on the form below.{compFields.length ? ' The blue fields are yours; the green fields are for the competent person to complete and sign with you before you submit.' : ''}</p>
            <PdfFieldFiller pdfUrl={pdfUrl} fields={pdfFields} roles={compFields.length ? ['employee', 'competent'] : ['employee']} values={pdfVals} onChange={setPdfVals} />
          </Suspense>
        )}
        {!version?.media_url && !pdfUrl && !version?.form_schema && !isUpload && (
          <p className="muted">Content for this document hasn't been uploaded yet. You can still read the printed copy and sign below — or check back later.</p>
        )}
        {raUrl && (
          <div style={{ marginBottom: 12 }}>
            <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
              <b style={{ fontSize: 15 }}>⚠️ Vehicle risk assessment — read &amp; acknowledge</b>
              <a href={raUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}><button type="button" className="small secondary">Open full screen ↗</button></a>
            </div>
            <iframe title="risk assessment" src={raUrl} style={{ width: '100%', height: 500, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400, marginTop: 8 }}>
              <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={raAck} onChange={e => setRaAck(e.target.checked)} /> I have read and understood the risk assessment for this vehicle.
            </label>
          </div>
        )}
        {version?.form_schema && <FormRenderer schema={version.form_schema} values={values} onChange={setValues} />}
        {isUpload && (<><label>Upload file (photo or PDF)</label>
          <input type="file" accept="image/*,.pdf" onChange={e => setFile(e.target.files[0])} /></>)}
      </div>

      {hasQuiz && (
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

      {ackList.length > 0 && mine && a.status !== 'completed' && (
        <div className="card">
          <h2>Please confirm</h2>
          {ackList.map((st, i) => (
            <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontWeight: 400, margin: '6px 0' }}>
              <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={!!acks[i]} onChange={e => setAcks({ ...acks, [i]: e.target.checked })} /> {st}
            </label>
          ))}
        </div>
      )}

      {mine && !['completed'].includes(a.status) && (
        <div className="card">
          {needsSig && (<>
            <h2>Sign &amp; acknowledge</h2>
            {needsSig && !guided && !isPdfForm && !isStandard && (
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
          {isPdfForm && compFields.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e6e0' }}>
              <label>Competent person’s name (they complete &amp; sign the green fields with you)</label>
              <input value={cpName} onChange={e => setCpName(e.target.value)} placeholder="Full name of the supervisor / competent person" />
            </div>
          )}
          {draftMsg && <div className="success" style={{ marginTop: 10 }}>{draftMsg}</div>}
          {needsRead && !opened && <div className="muted" style={{ fontSize: 13, marginTop: 10 }}>🔒 Open the document above (the “Open full screen” button) before you can sign.</div>}
          {err && <div className="error">{err}</div>}
          <div className="row" style={{ marginTop: 14 }}>
            <button onClick={isPdfForm ? submitPdf : submit} disabled={busy || (needsRead && !opened)}>
              {busy ? 'Submitting…' : doc.requires_manager_signoff ? 'Submit for manager sign-off' : 'Submit'}
            </button>
            {isPdfForm && <button className="secondary" onClick={saveDraft} disabled={busy}>Save draft</button>}
          </div>
        </div>
      )}
      {a.status === 'completed' && <div className="success">Completed {fmtDate(a.completed_at)}{a.expires_at ? ` — next due ${fmtDate(a.expires_at)}` : ''}</div>}
    </div>
  )
}
