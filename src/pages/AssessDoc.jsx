import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'
import SignaturePad from '../components/SignaturePad'
import FormRenderer, { validateGuided } from '../components/FormRenderer'

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

  useEffect(() => {
    (async () => {
      const { data: asg } = await supabase.from('assignments')
        .select('*, documents(*, document_categories(name))').eq('id', assignmentId).single()
      setA(asg)
      if (!asg) return
      const { data: e } = await supabase.from('profiles').select('first_name, last_name').eq('id', asg.employee_id).single()
      setEmp(e)
      const vid = asg.documents?.current_version_id
      if (vid) { const { data: v } = await supabase.from('document_versions').select('*').eq('id', vid).single(); setVersion(v) }
      const { data: c } = await supabase.from('completions').select('*').eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setComp(c || null)
    })()
  }, [assignmentId])

  if (!a) return <p className="muted">Loading…</p>
  const doc = a.documents
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

      {assessorPages.length === 0
        ? <p className="muted">This document has no competent-person section to complete.</p>
        : <FormRenderer schema={assessorSchema} values={values} onChange={setValues} assessorMode />}

      <div className="card">
        <h2>Competent person — confirm &amp; sign</h2>
        <label>Your full name</label>
        <input value={signedName} onChange={e => setSignedName(e.target.value)} placeholder="Type your full name" />
        <label>Signature</label>
        <SignaturePad onChange={setSig} />
        {err && <div className="error">{err}</div>}
        <button style={{ marginTop: 14 }} onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Confirm competency & sign off'}</button>
      </div>
    </div>
  )
}
