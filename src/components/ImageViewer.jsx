import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Shows licence photos inside the app instead of opening a signed link in a new tab.
// A new tab would leave the URL in the tablet's browser history, and those links keep
// working for anyone who finds them — even after sign-out. Fetching the file and
// showing it from memory leaves nothing addressable behind.
export default function ImageViewer({ bucket = 'licences', path, title, onClose }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let objectUrl
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.storage.from(bucket).download(path)
      if (cancelled) return
      if (error) { setErr(error.message); return }
      objectUrl = URL.createObjectURL(data)
      setUrl(objectUrl)
    })()
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [bucket, path])

  const isPdf = /\.pdf($|\?)/i.test(path || '')

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(12,25,20,.8)', zIndex: 9998,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" onClick={e => e.stopPropagation()}
        style={{ maxWidth: 900, width: '100%', maxHeight: '92vh', overflow: 'auto', margin: 0 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <b>{title || 'Licence'}</b>
          <button className="secondary small" onClick={onClose}>Close</button>
        </div>
        {err && <div className="error">{err}</div>}
        {!url && !err && <p className="muted">Loading…</p>}
        {url && (isPdf
          ? <iframe title="document" src={url} style={{ width: '100%', height: '70vh', border: '1px solid var(--line)', borderRadius: 8 }} />
          : <img src={url} alt={title || 'Licence'} style={{ width: '100%', borderRadius: 8 }} />)}
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Shown inside the app for privacy — this image isn't saved to the browser's history or downloads.
        </p>
      </div>
    </div>
  )
}
