import { useEffect, useState } from 'react'
import { listOutbox, flushOutbox } from '../lib/outbox'

// Orange bar shown while documents signed offline are waiting on this device to upload.
// Tries to send them whenever the connection comes back, and every 20 seconds.
export default function OutboxBar({ profile }) {
  const [items, setItems] = useState([])
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const refresh = () => listOutbox().then(setItems)
    const tryFlush = () => flushOutbox().finally(refresh)
    const on = () => { setOnline(true); tryFlush() }, off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    window.addEventListener('nuwayhr-outbox', refresh)
    tryFlush()
    const t = setInterval(tryFlush, 20000)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('nuwayhr-outbox', refresh); clearInterval(t) }
  }, [profile.id])
  const mine = items.filter(i => i.user_id === profile.id)
  const others = items.length - mine.length
  if (!items.length) return null
  const failed = mine.filter(i => i.lastError)
  return (
    <div style={{ background: '#fff3e0', border: '1px solid #f0a040', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 14 }}>
      {mine.length > 0 && <div>
        ⏳ <b>{mine.length} signed document{mine.length === 1 ? '' : 's'} waiting to upload</b> from this tablet
        {online ? ' — uploading…' : ' — will upload automatically when back on wifi (or turn on a phone hotspot).'} Please stay signed in until this bar disappears.
        {failed.length > 0 && <div style={{ color: '#b00020', marginTop: 4 }}>Couldn't upload {failed.map(f => f.label).join(', ')}: {failed[0].lastError}. It will keep retrying — tell your manager if this stays.</div>}
      </div>}
      {others > 0 && <div className="muted">{others} other item{others === 1 ? '' : 's'} on this tablet are waiting for the person who signed them to sign in here again.</div>}
    </div>
  )
}
