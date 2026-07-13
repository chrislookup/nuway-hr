import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import SignaturePad from './SignaturePad'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const SIGNER_COLOR = { employee: '#1a73e8', competent: '#137333' }
const today = () => new Date().toISOString().slice(0, 10)

// role = 'employee' | 'competent'  → those fields are interactive; others show read-only.
export default function PdfFieldFiller({ pdfUrl, fields, role, values, onChange }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [signing, setSigning] = useState(null) // field being signed
  const [tmpSig, setTmpSig] = useState(null)
  const flds = fields || []
  const vals = values || {}

  useEffect(() => {
    let cancel = false
    async function render() {
      setLoading(true); setErr('')
      try {
        const pdf = await pdfjsLib.getDocument({ url: pdfUrl }).promise
        const out = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 1.6 })
          const canvas = document.createElement('canvas')
          canvas.width = vp.width; canvas.height = vp.height
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
          out.push({ num: i, url: canvas.toDataURL('image/png') })
        }
        if (!cancel) setPages(out)
      } catch (e) { if (!cancel) setErr(e.message || String(e)) }
      if (!cancel) setLoading(false)
    }
    if (pdfUrl) render()
    return () => { cancel = true }
  }, [pdfUrl])

  // default this role's date fields to today
  useEffect(() => {
    const patch = {}
    for (const f of flds) if (f.signer === role && f.type === 'date' && !vals[f.id]) patch[f.id] = today()
    if (Object.keys(patch).length) onChange({ ...vals, ...patch })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length])

  function set(id, v) { onChange({ ...vals, [id]: v }) }

  if (err) return <p className="muted" style={{ color: '#b00020' }}>Couldn't render the PDF: {err}</p>
  if (loading) return <p className="muted">Loading document…</p>

  return (
    <div className="pff">
      {pages.map(pg => (
        <div key={pg.num} style={{ position: 'relative', width: '100%', maxWidth: 820, margin: '0 auto 14px', border: '1px solid #ddd' }}>
          <img src={pg.url} alt={`page ${pg.num}`} style={{ width: '100%', display: 'block' }} draggable={false} />
          {flds.filter(f => f.page === pg.num).map(f => {
            const c = SIGNER_COLOR[f.signer] || '#666'
            const mine = f.signer === role
            const v = vals[f.id]
            const box = {
              position: 'absolute', left: `${f.x * 100}%`, top: `${f.y * 100}%`,
              width: `${f.w * 100}%`, height: `${f.h * 100}%`, boxSizing: 'border-box',
            }
            // read-only (other signer)
            if (!mine) {
              return (
                <div key={f.id} style={{ ...box, border: `1px dashed ${c}88`, background: `${c}11`, overflow: 'hidden' }}>
                  {(f.type === 'signature' || f.type === 'initials') && typeof v === 'string' && v.startsWith('data:')
                    ? <img src={v} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 10, color: c, padding: '0 2px' }}>{f.type === 'checkbox' ? (v ? '✓' : '') : (v || '')}</span>}
                </div>
              )
            }
            // interactive (this signer)
            if (f.type === 'signature' || f.type === 'initials') {
              return (
                <div key={f.id} style={{ ...box, border: `1.5px solid ${c}`, background: v ? '#fff' : `${c}18`, cursor: 'pointer', overflow: 'hidden' }}
                  onClick={() => { setTmpSig(null); setSigning(f) }}>
                  {v ? <img src={v} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 10, color: c, padding: 2, display: 'block' }}>✎ {f.type === 'initials' ? 'Initial' : 'Sign'}{f.required ? ' *' : ''}</span>}
                </div>
              )
            }
            if (f.type === 'checkbox') {
              return (
                <div key={f.id} style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <input type="checkbox" style={{ width: '90%', height: '90%', margin: 0, accentColor: c }} checked={!!v} onChange={e => set(f.id, e.target.checked)} />
                </div>
              )
            }
            return (
              <input key={f.id} type={f.type === 'date' ? 'date' : 'text'} value={v || ''} placeholder={f.label || ''}
                onChange={e => set(f.id, e.target.value)}
                style={{ ...box, border: `1.5px solid ${c}`, background: '#fff', fontSize: 12, padding: '0 3px', margin: 0 }} />
            )
          })}
        </div>
      ))}

      {signing && (
        <div style={{ position: 'fixed', inset: 0, background: '#0006', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setSigning(null)}>
          <div style={{ background: '#fff', padding: 16, borderRadius: 10, width: 'min(520px, 92vw)' }} onClick={e => e.stopPropagation()}>
            <b>{signing.type === 'initials' ? 'Initial' : 'Sign'} here{signing.label ? ` — ${signing.label}` : ''}</b>
            <div style={{ marginTop: 8 }}><SignaturePad onChange={setTmpSig} /></div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="small" disabled={!tmpSig} onClick={() => { set(signing.id, tmpSig); setSigning(null) }}>Use signature</button>
              <button className="small secondary" onClick={() => setSigning(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
