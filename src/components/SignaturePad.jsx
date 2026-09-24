import { useRef, useEffect, useState } from 'react'

const H = 160 // css height of the pad

export default function SignaturePad({ onChange }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)
  const [empty, setEmpty] = useState(true)

  // size the drawing surface to the pad's current on-screen width. Called on load and
  // whenever the screen changes size — e.g. a tablet rotated between portrait and landscape —
  // otherwise the ink lands away from the finger. Any signature already drawn is kept, rescaled.
  function fit() {
    const c = ref.current
    if (!c) return
    const w = c.offsetWidth
    if (!w || c.width === w * 2) return
    let keep = null
    if (hasInk.current) { keep = document.createElement('canvas'); keep.width = c.width; keep.height = c.height; keep.getContext('2d').drawImage(c, 0, 0) }
    c.width = w * 2
    c.height = H * 2
    const ctx = c.getContext('2d')
    if (keep) ctx.drawImage(keep, 0, 0, c.width, c.height)
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1d2620'
  }

  useEffect(() => {
    fit()
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
    if (ro) ro.observe(ref.current)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      if (ro) ro.disconnect()
    }
  }, [])

  function pos(e) {
    const r = ref.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  function start(e) {
    e.preventDefault()
    fit()
    drawing.current = true
    const ctx = ref.current.getContext('2d')
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
  }
  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = ref.current.getContext('2d')
    const p = pos(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!hasInk.current) { hasInk.current = true; setEmpty(false) }
  }
  function end() {
    if (!drawing.current) return
    drawing.current = false
    onChange(hasInk.current ? ref.current.toDataURL('image/png') : null)
  }
  function clear() {
    const c = ref.current
    const ctx = c.getContext('2d')
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore()
    hasInk.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <canvas ref={ref} className="sigpad" style={{ height: H, width: '100%', touchAction: 'none' }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="muted">{empty ? 'Sign above with mouse or finger' : 'Signed — tap Clear to redo'}</span>
        <button type="button" className="secondary small" onClick={clear}>Clear</button>
      </div>
    </div>
  )
}
