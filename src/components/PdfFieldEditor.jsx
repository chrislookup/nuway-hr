import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const TYPES = [
  { v: 'signature', label: 'Signature' },
  { v: 'initials', label: 'Initials' },
  { v: 'date', label: 'Date' },
  { v: 'text', label: 'Text' },
  { v: 'checkbox', label: 'Checkbox' },
]
const SIGNERS = [
  { v: 'employee', label: 'Employee', color: '#1a73e8' },
  { v: 'competent', label: 'Competent person', color: '#137333' },
]
const DEF = {
  signature: { w: 0.22, h: 0.055 }, initials: { w: 0.09, h: 0.045 },
  date: { w: 0.15, h: 0.035 }, text: { w: 0.22, h: 0.035 }, checkbox: { w: 0.028, h: 0.024 },
}
const signerColor = s => (SIGNERS.find(x => x.v === s) || SIGNERS[0]).color
const uid = () => Math.random().toString(36).slice(2, 9)

export default function PdfFieldEditor({ pdfUrl, value, onChange }) {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState(null)
  const [newType, setNewType] = useState('signature')
  const [newSigner, setNewSigner] = useState('employee')
  const [placing, setPlacing] = useState(false)
  const dragRef = useRef(null)
  const fields = value || []

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
          out.push({ num: i, ratio: vp.height / vp.width, url: canvas.toDataURL('image/png') })
        }
        if (!cancel) setPages(out)
      } catch (e) { if (!cancel) setErr(e.message || String(e)) }
      if (!cancel) setLoading(false)
    }
    if (pdfUrl) render()
    return () => { cancel = true }
  }, [pdfUrl])

  function update(id, patch) { onChange(fields.map(f => (f.id === id ? { ...f, ...patch } : f))) }
  function remove(id) { onChange(fields.filter(f => f.id !== id)); setSel(null) }

  function pageClick(e, pageNum) {
    if (!placing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const d = DEF[newType]
    const f = {
      id: uid(), page: pageNum, type: newType, signer: newSigner,
      x: Math.max(0, Math.min(1 - d.w, x - d.w / 2)), y: Math.max(0, Math.min(1 - d.h, y - d.h / 2)),
      w: d.w, h: d.h, label: '', required: true,
    }
    onChange([...fields, f]); setSel(f.id); setPlacing(false)
  }

  function startDrag(e, f, mode) {
    e.stopPropagation(); e.preventDefault()
    setSel(f.id)
    const rect = e.currentTarget.closest('.pfe-page').getBoundingClientRect()
    dragRef.current = { id: f.id, mode, rect, sx: e.clientX, sy: e.clientY, orig: { ...f } }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', endDrag)
  }
  function onMove(e) {
    const d = dragRef.current; if (!d) return
    const dx = (e.clientX - d.sx) / d.rect.width, dy = (e.clientY - d.sy) / d.rect.height
    if (d.mode === 'move') {
      update(d.id, {
        x: Math.max(0, Math.min(1 - d.orig.w, d.orig.x + dx)),
        y: Math.max(0, Math.min(1 - d.orig.h, d.orig.y + dy)),
      })
    } else {
      update(d.id, {
        w: Math.max(0.02, Math.min(1 - d.orig.x, d.orig.w + dx)),
        h: Math.max(0.015, Math.min(1 - d.orig.y, d.orig.h + dy)),
      })
    }
  }
  function endDrag() {
    dragRef.current = null
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', endDrag)
  }

  const selField = fields.find(f => f.id === sel)

  if (err) return <p className="muted" style={{ color: '#b00020' }}>Couldn't render the PDF: {err}</p>
  if (loading) return <p className="muted">Rendering PDF…</p>

  return (
    <div className="pfe">
      <div className="pfe-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="muted" style={{ fontSize: 13 }}>Add field:</span>
        <select value={newType} onChange={e => setNewType(e.target.value)} style={{ width: 'auto' }}>
          {TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <select value={newSigner} onChange={e => setNewSigner(e.target.value)} style={{ width: 'auto' }}>
          {SIGNERS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <button type="button" className={`small ${placing ? '' : 'secondary'}`} onClick={() => setPlacing(p => !p)}>
          {placing ? 'Click the form to place…' : '+ Place on form'}
        </button>
        <span style={{ flex: 1 }} />
        {SIGNERS.map(s => (
          <span key={s.v} style={{ fontSize: 12, color: s.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 10, height: 10, background: s.color, opacity: .25, border: `1px solid ${s.color}`, display: 'inline-block' }} />{s.label}
          </span>
        ))}
      </div>

      {selField && (
        <div className="pfe-props" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, background: '#f5f7f5', padding: 8, borderRadius: 6 }}>
          <b style={{ fontSize: 13 }}>Selected {selField.type}</b>
          <select value={selField.signer} onChange={e => update(selField.id, { signer: e.target.value })} style={{ width: 'auto' }}>
            {SIGNERS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <input placeholder="Label (optional, e.g. Print name)" value={selField.label || ''} onChange={e => update(selField.id, { label: e.target.value })} style={{ width: 220 }} />
          <label style={{ fontWeight: 400, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!selField.required} onChange={e => update(selField.id, { required: e.target.checked })} />Required
          </label>
          <button type="button" className="small" style={{ color: '#b00020' }} onClick={() => remove(selField.id)}>Delete field</button>
        </div>
      )}

      {pages.map(pg => (
        <div key={pg.num} className="pfe-page" onMouseDown={e => pageClick(e, pg.num)}
          style={{ position: 'relative', width: '100%', maxWidth: 820, margin: '0 auto 14px', border: '1px solid #ddd', cursor: placing ? 'crosshair' : 'default' }}>
          <img src={pg.url} alt={`page ${pg.num}`} style={{ width: '100%', display: 'block' }} draggable={false} />
          {fields.filter(f => f.page === pg.num).map(f => {
            const c = signerColor(f.signer)
            const on = f.id === sel
            return (
              <div key={f.id} data-field="1"
                onMouseDown={e => startDrag(e, f, 'move')}
                onClick={e => { e.stopPropagation(); setSel(f.id) }}
                style={{
                  position: 'absolute', left: `${f.x * 100}%`, top: `${f.y * 100}%`,
                  width: `${f.w * 100}%`, height: `${f.h * 100}%`,
                  background: `${c}22`, border: `1.5px solid ${c}`, boxShadow: on ? `0 0 0 2px ${c}55` : 'none',
                  cursor: 'move', fontSize: 10, color: c, overflow: 'hidden', boxSizing: 'border-box',
                }}>
                <span style={{ padding: '0 2px', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                  {(TYPES.find(t => t.v === f.type) || {}).label}{f.label ? ` · ${f.label}` : ''}
                </span>
                <span onMouseDown={e => startDrag(e, f, 'resize')}
                  style={{ position: 'absolute', right: -5, bottom: -5, width: 11, height: 11, background: c, borderRadius: 2, cursor: 'nwse-resize' }} />
              </div>
            )
          })}
        </div>
      ))}
      <p className="muted" style={{ fontSize: 12 }}>
        Pick a type + who signs it, hit “Place on form”, then click where it goes. Drag to move, drag the corner to resize, click a field to change it. {fields.length} field{fields.length === 1 ? '' : 's'} placed.
      </p>
    </div>
  )
}
