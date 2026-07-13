import { useEffect, useState, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import SignaturePad from '../components/SignaturePad'
import FormRenderer, { validateGuided } from '../components/FormRenderer'
const PdfFieldFiller = lazy(() => import('../components/PdfFieldFiller'))

export default function AssessDoc({ profile }) {
  const { assignmentId } = useParams()
  const nav = useNavigate()
  const [a, setA] = useState(null)
  const [emp, setEmp] = useState(null)
  const [version, setVersion] = useState(null)
  const [comp, setComp] = useState(null)
  const [values, setValues] = useState({})
  const [sig, setSig] = useState(null)
  const [signedName, setSignedName] = useState(`${profile.first_name || ''} ${profile.last_name || ''}`.trim())
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfVals, setPdfVals] = useState({})

  useEffect(() => {
    (async () => {
      const { data: asg } = await supabase.from('assignments')
        .select('*, documents(*, document_categories(name))').eq('id', assignmentId).single()
      setA(asg)
      if (!asg) return
      const { data: e } = await supabase.from('profiles').select('first_name, last_name').eq('id', asg.employee_id).single()
      setEmp(e)
      const vid = asg.documents?.current_version_id
      let v = null
      if (vid) { const r = await supabase.from('document_versions').select('*').eq('id', vid).single(); v = r.data; setVersion(v) }
      if (v?.pdf_path) { const { data: su } = await supabase.storage.from('masters').createSignedUrl(v.pdf_path, 3600); setPdfUrl(su?.signedUrl || null) }
      const { data: c } = await supabase.from('completions').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setComp(c || null)
      if (asg.documents?.doc_type === 'pdf_form' && (v?.pdf_field_map || []).length) {
        const stored = c?.form_data?.pdf?.values || {}
        const init = {}
        for (const fld of v.pdf_field_map) {
          const val = stored[fld.id]
          if (val === undefined) continue
          if ((fld.type === 'signature' || fld.type === 'initials') && typeof val === 'string' && !/^https?:|^data:/.test(val)) {
            const { data: s2 } = await supabase.storage.from('signatures').createSignedUrl(val, 3600)
            init[fld.id] = s2?.signedUrl || val
          } else init[fld.id] = val
        }
        setPdfVals(init)
      }
    })()
  }, [assignmentId])

  if (!a) return <p className="muted">Loading…</p>
  const doc = a.documents
  const pdfFields = version?.pdf_field_map || []
  const isPdfForm = doc.doc_type === 'pdf_form' && pdfFields.length > 0 && !!pdfUrl
  const compFields = pdfFields.filter(f => f.signer === 'competent')

  async function submitPdf() {
    setErr('')
    for (const f of compFields) {
      if (!f.required) continue
      const val = pdfVals[f.id]
      if (f.type === 'checkbox' ? !val : (!val || (typeof val === 'string' && !val.trim()))) { setErr('Please complete all required competent-person fields (marked *).'); return }
    }
    if (!signedName.trim()) { setErr('Please type your full name to confirm.'); return }
    setBusy(true)
    try {
      const persist = { ...(comp?.form_data?.pdf?.values || {}) }
      let verPath = null
      for (const f of compFields) {
        const val = pdfVals[f.id]
        if (val === undefined || val === '' || val === false) continue
        if (f.type === 'signature' || f.type === 'initials') {
          const blob = await (await fetch(val)).blob()
          const p = `${a.employee_id}/${a.id}-cp-${f.id}.png`
          const { error } = await supabase.storage.from('signatures').upload(p, blob, { upsert: true })
          if (error) throw error
          persist[f.id] = p
          if (!verPath && f.type === 'signature') verPath = p
        } else persist[f.id] = val
      }
      const masterBytes = await (await fetch(pdfUrl)).arrayBuffer()
      const { flattenPdf } = await import('../lib/flattenPdf')
      const bytes = await flattenPdf(masterBytes, pdfFields, pdfVals)
      const outPath = `${a.employee_id}/${a.id}-completed.pdf`
      const { error: fe } = await supabase.storage.from('completed-docs').upload(outPath, new Blob([bytes], { type: 'application/pdf' }), { upsert: true })
      if (fe) throw fe
      const { error: ce } = await supabase.from('completions').update({
        form_data: { pdf: { values: persist }, uploaded_file: null },
        verifier_signature_path: verPath, verifier_name: signedName.trim(),
        verified_by: profile.id, verified_at: new Date().toISOString(),
        completed_pdf_path: outPath,
      }).eq('id', comp.id)
      if (ce) throw ce
      const { error: ae } = await supabase.from('assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', a.id)
      if (ae) throw ae
      nav('/')
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }
  const assessorPages = (version?.form_schema?.pages || []).filter(p => p.assessor)
  const assessorSchema = { type: 'guided', pages: assessorPages }
  const empName = emp ? `${emp.first_name} ${emp.last_name}` : 'the employee'

  async function submit() {
    setErr('')
    const gerr = validateGuided(assessorSchema, values, true)
    if (gerr) { setErr(gerr); return }
    if (!sig || !signedName.trim()) { setErr('Please type your name and sign to confirm.'); return }
    setBusy(true)
    try {
      const blob = await (await fetch(sig)).blob()
      const path = `${a.employee_id}/${a.id}-assessor.png`
      const { error: se } = await supabase.storage.from('signatures').upload(path, blob, { upsert: true })
      if (se) throw se
      const upd = {
        verifier_data: values, verifier_signature_path: path, verifier_name: signedName.trim(),
        verified_by: profile.id, verified_at: new Date().toISOString(),
      }
      if (comp?.id) {
        const { error: ce } = await supabase.from('completions').update(upd).eq('id', comp.id)
        if (ce) throw ce
      }
      const { error: ae } = await supabase.from('assignments').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', a.id)
      if (ae) throw ae
      nav('/')
    } catch (e) { setErr(e.message || String(e)) }
    setBusy(false)
  }

  return (
    <div>
      <a onClick={() => nav(-1)} style={{ cursor: 'pointer' }}>&larr; Back</a>
      <h1>{doc.code} — {doc.title}</h1>
      <p className="muted">Competent-person sign-off for <b>{empName}</b> · {doc.document_categories?.name}</p>

      <div className="note-assessor" style={{ marginBottom: 12 }}>
        Complete the supervised section(s) with {empName}, then add your name and signature to confirm they have demonstrated the competency.
      </div>

      {isPdfForm
        ? <Suspense fallback={<p className="muted">Loading form…</p>}>
            <p className="muted" style={{ fontSize: 13 }}>Complete your fields on the form below (the employee's entries are shown for reference), then sign off.</p>
            <PdfFieldFiller pdfUrl={pdfUrl} fields={pdfFields} role="competent" values={pdfVals} onChange={setPdfVals} />
          </Suspense>
        : assessorPages.length === 0
          ? <p className="muted">This document has no competent-person section to complete.</p>
          : <FormRenderer schema={assessorSchema} values={values} onChange={setValues} assessorMode />}

      <div className="card">
        <h2>Competent person — confirm &amp; sign</h2>
        <label>Your full name</label>
        <input value={signedName} onChange={e => setSignedName(e.target.value)} placeholder="Type your full name" />
        {!isPdfForm && (<><label>Signature</label>
        <SignaturePad onChange={setSig} /></>)}
        {err && <div className="error">{err}</div>}
        <button style={{ marginTop: 14 }} onClick={isPdfForm ? submitPdf : submit} disabled={busy}>{busy ? 'Saving…' : 'Confirm competency & sign off'}</button>
      </div>
    </div>
  )
}
