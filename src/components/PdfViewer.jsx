import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// Shows a PDF as a stack of page images that always fit the screen width.
// The browser's built-in PDF viewer (an <iframe>) behaves badly on tablets — a fixed
// desktop-size page on Android, a single non-scrolling page on iPad — which is what
// forced staff to pinch-zoom. Images at 100% width reflow for portrait or landscape.
export default function PdfViewer({ url, onFullyViewed, maxHeight }) {
  const [pages, setPages] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const endRef = useRef(null)
  const told = useRef(false)

  useEffect(() => {
    let cancel = false
    const made = []
    setPages([]); setStatus('loading'); told.current = false
    ;(async () => {
      try {
        const pdf = await pdfjsLib.getDocument({ url }).promise
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const vp = page.getViewport({ scale: 2.2 }) // sharp on high-density tablet screens
          const canvas = document.createElement('canvas')
          canvas.width = vp.width; canvas.height = vp.height
          await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
          const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88))
          const src = URL.createObjectURL(blob)
          made.push(src)
          if (cancel) return
          setPages(p => [...p, { num: i, src, ratio: vp.height / vp.width }])
        }
        if (!cancel) setStatus('ready')
      } catch (e) { if (!cancel) setStatus('error') }
    })()
    return () => { cancel = true; made.forEach(u => URL.revokeObjectURL(u)) }
  }, [url])

  // report once the reader has scrolled to the end of the last page
  useEffect(() => {
    if (status !== 'ready' || !onFullyViewed || !endRef.current) return
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting) && !told.current) { told.current = true; onFullyViewed() }
    }, { threshold: 0.1 })
    io.observe(endRef.current)
    return () => io.disconnect()
  }, [status, onFullyViewed])

  if (status === 'error') {
    return <iframe title="document" src={url} style={{ width: '100%', height: 620, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} />
  }

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, background: '#eef1ef', padding: 6,
      ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}) }}>
      {pages.map(p => (
        <img key={p.num} src={p.src} alt={`Page ${p.num}`} draggable={false}
          style={{ display: 'block', width: '100%', height: 'auto', background: '#fff', marginBottom: 6, borderRadius: 3, boxShadow: '0 1px 3px rgba(0,0,0,.12)' }} />
      ))}
      {status === 'loading' && <p className="muted" style={{ textAlign: 'center', padding: 20 }}>Loading page {pages.length + 1}…</p>}
      <div ref={endRef} style={{ height: 1 }} />
    </div>
  )
}
