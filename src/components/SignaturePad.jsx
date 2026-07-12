import { useRef, useEffect, useState } from 'react'

export default function SignaturePad({ onChange }) {
  const ref = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = ref.current
    c.width = c.offsetWidth * 2
    c.height = 320
    const ctx = c.getContext('2d')
    ctx.scale(2, 2)
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1d2620'
  }, [])

  function pos(e) {
    const r = ref.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
  function start(e) {
    e.preventDefault()
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
    if (empty) setEmpty(false)
  }
  function end() {
    if (!drawing.current) return
    drawing.current = false
    onChange(empty ? null : ref.current.toDataURL('image/png'))
  }
  function clear() {
    const c = ref.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <canvas ref={ref} className="sigpad" style={{ height: 160 }}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="muted">Sign above with mouse or finger</span>
        <button type="button" className="secondary small" onClick={clear}>Clear</button>
      </div>
    </div>
  )
}
