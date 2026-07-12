import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, fmtDate } from '../lib/supabase'

export default function SignedRecord() {
  const { assignmentId } = useParams()
  const nav = useNavigate()
  const [a, setA] = useState(null)
  const [emp, setEmp] = useState(null)
  const [comp, setComp] = useState(null)
  const [version, setVersion] = useState(null)
  const [sigUrl, setSigUrl] = useState(null)
  const [verifierSigUrl, setVerifierSigUrl] = useState(null)
  const [fileUrl, setFileUrl] = useState(null)
  const [notfound, setNotfound] = useState(false)

  useEffect(() => {
    (async () => {
      const { data: asg } = await supabase.from('assignments')
        .select('*, documents(code, title, document_categories(name))').eq('id', assignmentId).single()
      if (!asg) { setNotfound(true); return }
      setA(asg)
      const { data: e } = await supabase.from('profiles').select('first_name, last_name, email').eq('id', asg.employee_id).single()
      setEmp(e)
      const { data: c } = await supabase.from('completions').select('*')
        .eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      setComp(c || null)
      const vid = c?.document_version_id || asg.documents?.current_version_id
      if (vid) { const { data: v } = await supabase.from('document_versions').select('*').eq('id', vid).single(); setVersion(v) }
      if (c?.signature_path) { const { data: s } = await supabase.storage.from('signatures').createSignedUrl(c.signature_path, 3600); setSigUrl(s?.signedUrl || null) }
      if (c?.verifier_signature_path) { const { data: vs } = await supabase.storage.from('signatures').createSignedUrl(c.verifier_signature_path, 3600); setVerifierSigUrl(vs?.signedUrl || null) }
      const up = c?.completed_pdf_path || c?.form_data?.uploaded_file
      if (up) { const { data: f } = await supabase.storage.from('completed-docs').createSignedUrl(up, 3600); setFileUrl(f?.signedUrl || null) }
    })()
  }, [assignmentId])

  if (notfound) return <p className="muted">This record isn’t available to you.</p>
  if (!a) return <p className="muted">Loading…</p>
  const doc = a.documents
  const fd = comp?.form_data || {}
  const pages = version?.form_schema?.pages

  return (
    <div>
      <div className="no-print row between" style={{ marginBottom: 10 }}>
        <a onClick={() => nav(-1)} style={{ cursor: 'pointer' }}>&larr; Back</a>
        <button className="small" onClick={() => window.print()}>🖨 Print / Save PDF</button>
      </div>

      <div className="record">
        <div className="record-head">
          <h1>{doc?.code} — {doc?.title}</h1>
          <p className="muted">{doc?.document_categories?.name}</p>
          <table className="record-meta"><tbody>
            <tr><td>Employee</td><td>{emp ? `${emp.first_name} ${emp.last_name}` : '—'}{emp?.email ? ` · ${emp.email}` : ''}</td></tr>
            <tr><td>Status</td><td>{a.status}</td></tr>
            <tr><td>Completed</td><td>{fmtDate(a.completed_at)}</td></tr>
          </tbody></table>
        </div>

        {pages && pages.map((pg, pi) => {
          const pfd = fd
          return (
          <section key={pi} style={{ marginTop: 16 }}>
            {pg.title && <h2>{pg.title}</h2>}
            {pg.assessor && <div className="note-assessor" style={{ marginBottom: 6 }}>Competent-person section{pg.assessorNote ? ` — ${pg.assessorNote}` : ''}</div>}
            {(pg.blocks || []).map((b, bi) => {
              if (b.type === 'heading') return <h3 key={bi}>{b.text}</h3>
              if (b.type === 'clause') return <p key={bi} className="clause">{b.text}</p>
              if (b.type === 'note') return <p key={bi} className="muted" style={{ fontSize: 13 }}>{b.text}</p>
              if (b.type === 'field') return <p key={bi} className="filled"><b>{b.label}:</b> {b.input === 'checkbox' ? (pfd[b.name] ? '☑ Yes' : '☐ No') : (pfd[b.name] || b.default || <span className="muted">—</span>)}</p>
              if (b.type === 'ack') return (
                <p key={bi} className="filled">
                  {pfd[b.name] ? '☑' : '☐'} {b.text}
                  {b.initials && <b> — initials: {pfd[b.name + '_initials'] || '—'}</b>}
                </p>
              )
              return null
            })}
          </section>
          )
        })}

        {!pages && Object.keys(fd).length > 0 && (
          <table className="record-meta"><tbody>
            {Object.entries(fd).filter(([k]) => k !== 'uploaded_file').map(([k, v]) => (
              <tr key={k}><td>{k}</td><td>{String(v)}</td></tr>
            ))}
          </tbody></table>
        )}

        {fileUrl && <p className="no-print" style={{ marginTop: 16 }}><a href={fileUrl} target="_blank" rel="noreferrer">Open uploaded signed document ↗</a></p>}

        <div className="record-sign">
          <h3>Electronic signature</h3>
          {sigUrl
            ? <img src={sigUrl} alt="signature" className="sig-img" />
            : <p className="muted">No drawn signature on file{fileUrl ? ' (see uploaded document above)' : ''}.</p>}
          <table className="record-meta"><tbody>
            <tr><td>Signed by</td><td>{comp?.signed_name || (emp ? `${emp.first_name} ${emp.last_name}` : '—')}</td></tr>
            <tr><td>Signed at</td><td>{comp?.signed_at ? new Date(comp.signed_at).toLocaleString('en-AU') : '—'}</td></tr>
            {comp?.verified_at && <tr><td>Verified</td><td>{new Date(comp.verified_at).toLocaleString('en-AU')}</td></tr>}
          </tbody></table>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            This is an electronically completed record generated by the Nuway HR system. The signature above was captured at the time and IP recorded against this record.
          </p>
        </div>

        {(comp?.verifier_name || verifierSigUrl) && (
          <div className="record-sign">
            <h3>Competent-person verification</h3>
            {verifierSigUrl && <img src={verifierSigUrl} alt="competent person signature" className="sig-img" />}
            <table className="record-meta"><tbody>
              <tr><td>Verified by</td><td>{comp?.verifier_name || '—'}</td></tr>
              <tr><td>Signed at</td><td>{comp?.verified_at ? new Date(comp.verified_at).toLocaleString('en-AU') : '—'}</td></tr>
            </tbody></table>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>A competent person confirmed the employee demonstrated this competency in the supervised section(s) above.</p>
          </div>
        )}
      </div>
    </div>
  )
}
