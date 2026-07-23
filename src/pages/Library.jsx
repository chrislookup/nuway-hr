import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormRenderer, { validateGuided } from '../components/FormRenderer'

function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }
function bytesToB64(bytes) { let bin = ''; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)); return btoa(bin) }

function formToHtml(schema, values, title, sender) {
  let rows = ''
  for (const pg of (schema?.pages || [])) {
    if (pg.title) rows += `<tr><td colspan="2" style="background:#0F6E6E;color:#fff;padding:6px 10px;font-weight:bold">${esc(pg.title)}</td></tr>`
    for (const b of (pg.blocks || [])) {
      if (b.type === 'field') {
        const v = values[b.name]
        const disp = b.input === 'checkbox' ? (v ? 'Yes' : 'No') : (v ?? '')
        rows += `<tr><td style="padding:5px 10px;border-bottom:1px solid #eee;color:#555;width:45%;vertical-align:top">${esc(b.label || '')}</td><td style="padding:5px 10px;border-bottom:1px solid #eee">${esc(disp)}</td></tr>`
      } else if (b.type === 'ack') {
        rows += `<tr><td style="padding:5px 10px;border-bottom:1px solid #eee;color:#555">${esc(b.text || '')}</td><td style="padding:5px 10px;border-bottom:1px solid #eee">${values[b.name] ? 'Acknowledged' : '—'}</td></tr>`
      } else if (b.type === 'heading') {
        rows += `<tr><td colspan="2" style="padding:8px 10px;font-weight:bold">${esc(b.text || '')}</td></tr>`
      }
    }
  }
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;max-width:680px"><h3 style="color:#0F6E6E;margin:0 0 4px">${esc(title)}</h3><p style="color:#666;font-size:12px;margin:0 0 10px">Submitted by ${esc(sender)} on ${new Date().toLocaleString('en-AU')}</p><table style="border-collapse:collapse;width:100%">${rows}</table></div>`
}

export default function Library({ profile, kind }) {
  const isForm = kind === 'form'
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)      // { doc, version }
  const [values, setValues] = useState({})
  const [pdfUrl, setPdfUrl] = useState('')
  const [recipIdx, setRecipIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [sent, setSent] = useState(false)
  const [files, setFiles] = useState([])

  useEffect(() => {
    setOpen(null); setSent(false); setMsg(''); setValues({}); setPdfUrl(''); setRecipIdx(0); setFiles([])
    ;(async () => {
      setLoading(true)
      const { data: rr } = await supabase.from('employee_job_roles').select('job_roles(name)').eq('employee_id', profile.id)
      const myRoles = (rr || []).map(r => r.job_roles?.name).filter(Boolean)
      const { data } = await supabase.from('documents').select('*').eq('library', kind).eq('active', true).order('code')
      const vis = (data || []).filter(d => {
        const roles = d.conditions?.roles
        if (!roles || !roles.length) return true
        if (profile.tier === 'admin' || profile.tier === 'manager') return true
        return roles.some(r => myRoles.includes(r))
      })
      setItems(vis); setLoading(false)
    })()
  }, [kind, profile])

  async function openItem(doc) {
    setMsg(''); setSent(false); setValues({}); setRecipIdx(0); setPdfUrl(''); setFiles([])
    let version = null
    if (doc.current_version_id) {
      const { data: v } = await supabase.from('document_versions').select('*').eq('id', doc.current_version_id).single()
      version = v
      if (v?.pdf_path) {
        const { data: s } = await supabase.storage.from('masters').createSignedUrl(v.pdf_path, 3600)
        setPdfUrl(s?.signedUrl || '')
      }
    }
    setOpen({ doc, version })
  }

  const senderName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || (profile.email || 'A staff member')
  const guided = !!open?.version?.form_schema?.pages
  const recips = open?.doc?.recipients || []

  function printForm() {
    const html = guided ? formToHtml(open.version.form_schema, values, open.doc.title, senderName) : ''
    if (!guided && pdfUrl) { window.open(pdfUrl, '_blank'); return }
    const w = window.open('', '_blank'); if (!w) return
    w.document.write(html + '<script>window.onload=function(){window.print()}<\/script>'); w.document.close()
  }

  async function send() {
    setMsg('')
    if (guided) { const err = validateGuided(open.version.form_schema, values); if (err) { setMsg(err); return } }
    if (!recips.length) { setMsg('This form has no recipient set up yet — please tell an admin.'); return }
    const to = recips[recipIdx]
    if (!to?.email) { setMsg('Choose who to send this to.'); return }
    setBusy(true)
    const html = guided ? formToHtml(open.version.form_schema, values, open.doc.title, senderName)
      : `<div style="font-family:Arial,sans-serif"><p>${esc(senderName)} has submitted the form <b>${esc(open.doc.title)}</b>.</p></div>`
    let attB64 = null, attName = null
    if (files.length) {
      try { const { filesToPdf } = await import('../lib/filesToPdf'); const bytes = await filesToPdf(files); attB64 = bytesToB64(bytes); attName = `${open.doc.title} - attachments.pdf` }
      catch (e) { setBusy(false); setMsg('Could not process the attached files: ' + (e.message || e)); return }
    }
    const { error } = await supabase.rpc('send_form_email', {
      p_to: to.email, p_to_label: to.label || '', p_subject: `${open.doc.title}${to.label ? ` — ${to.label}` : ''} — Nuway HR`,
      p_html: html, p_confirm_to: profile.email || '', p_form_title: open.doc.title,
      p_attach_b64: attB64, p_attach_name: attName,
    })
    setBusy(false)
    if (error) setMsg('Could not send: ' + error.message)
    else setSent(true)
  }

  if (open) {
    const doc = open.doc
    return (
      <div>
        <button className="secondary small" onClick={() => setOpen(null)}>← Back to {isForm ? 'forms' : 'resources'}</button>
        <h1 style={{ marginTop: 10 }}>{doc.code ? doc.code + ' — ' : ''}{doc.title}</h1>
        {open.version?.instructions && <div className="card" dangerouslySetInnerHTML={{ __html: open.version.instructions }} />}

        {pdfUrl && (
          <div className="card">
            <div className="row between"><b>Document</b><a href={pdfUrl} target="_blank" rel="noreferrer">Open full screen / print ↗</a></div>
            <iframe title="doc" src={pdfUrl} style={{ width: '100%', height: 560, border: '1px solid var(--line)', borderRadius: 8, background: '#fff', marginTop: 8 }} />
          </div>
        )}

        {guided && !sent && (
          <div style={{ marginTop: 12 }}>
            <FormRenderer schema={open.version.form_schema} values={values} onChange={setValues} />
          </div>
        )}

        {sent ? (
          <div className="success" style={{ marginTop: 12 }}>Sent to {recips[recipIdx]?.label || recips[recipIdx]?.email}. A copy has been emailed to you{profile.email ? ` (${profile.email})` : ''}.</div>
        ) : isForm ? (
          <>
          {open.doc.allow_attachments !== false && (
          <div className="card" style={{ marginTop: 12 }}>
            <label>Attach photos or files <span className="muted" style={{ fontWeight: 400 }}>(optional — e.g. receipts. On a phone you can take a photo. They're combined into one PDF and attached.)</span></label>
            <input type="file" accept="image/*,application/pdf" multiple onChange={e => { setFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = '' }} />
            {files.length > 0 && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {files.map((fl, i) => <li key={i} style={{ fontSize: 13 }}>{fl.name} <button type="button" className="small danger" style={{ marginLeft: 6 }} onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button></li>)}
              </ul>
            )}
          </div>
          )}
          <div className="card" style={{ marginTop: 12 }}>
            <h2>Send this form</h2>
            {recips.length === 0 && <p className="muted">No recipient has been set up for this form yet.</p>}
            {recips.length === 1 && <p className="muted">Sends to <b>{recips[0].label || recips[0].email}</b> ({recips[0].email}).</p>}
            {recips.length > 1 && (<>
              <label>Send to</label>
              <select value={recipIdx} onChange={e => setRecipIdx(Number(e.target.value))}>
                {recips.map((r, i) => <option key={i} value={i}>{r.label ? `${r.label} — ${r.email}` : r.email}</option>)}
              </select>
            </>)}
            {msg && <div className="error" style={{ marginTop: 8 }}>{msg}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={send} disabled={busy || !recips.length}>{busy ? 'Sending…' : 'Send'}</button>
              <button className="secondary" onClick={printForm}>Print</button>
            </div>
          </div>
          </>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="secondary" onClick={printForm}>Print / open</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h1>{isForm ? 'Forms' : 'Procedures & Resources'}</h1>
      <p className="muted">{isForm ? 'Fill in and send, or print. These are not tracked on your dashboard.' : 'Reference documents to view and print. Not tracked or required.'}</p>
      {loading ? <p className="muted">Loading…</p> : items.length === 0 ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <div className="card"><table><tbody>
          {items.map(d => (
            <tr key={d.id}>
              <td className="muted" style={{ width: 90 }}>{d.code}</td>
              <td>{d.title}</td>
              <td style={{ textAlign: 'right' }}><button className="small" onClick={() => openItem(d)}>{isForm ? 'Open' : 'View'}</button></td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  )
}
