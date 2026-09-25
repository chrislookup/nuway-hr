// Offline outbox — lets a document be completed and signed with no internet (e.g. a truck
// induction out in the yard on a wifi-only tablet). The finished submission, including the
// signature images and any photos, is kept in this device's IndexedDB and uploaded
// automatically once the connection is back. Items belong to the user who signed them and
// are only ever sent while that same user is signed in (the database rules require it).
import { supabase } from './supabase'

const DB = 'nuwayhr-outbox', STORE = 'items'
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function tx(mode, fn) {
  const db = await open()
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => res(out?.result ?? out)
    t.onerror = () => rej(t.error)
  })
}
export const listOutbox = () => tx('readonly', s => s.getAll()).catch(() => [])
export const addOutbox = item => tx('readwrite', s => s.put(item)).then(() => ping())
const removeOutbox = id => tx('readwrite', s => s.delete(id)).then(() => ping())
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16) }))
const ping = () => window.dispatchEvent(new Event('nuwayhr-outbox'))

// Browsers report network failures as TypeErrors ("Failed to fetch", "Load failed", …)
export function isNetworkError(e) {
  if (!navigator.onLine) return true
  const m = String(e?.message || e || '')
  return e instanceof TypeError || /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(m)
}

// Sends one prepared submission. Every step is safe to repeat (uploads use fixed paths with
// upsert, and the completion row is skipped if this submission already created it), so a
// connection that drops half-way just gets retried later.
export async function sendSubmission(p) {
  if (p.kind === 'attempt') {
    const { error } = await supabase.from('test_attempts').upsert(p.attempt, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
    return
  }
  const up = async (bucket, path, blob) => {
    const { error } = await supabase.storage.from(bucket).upload(path, blob, { upsert: true })
    if (error) throw error
  }
  if (p.sig) await up('signatures', p.sig.path, p.sig.blob)
  for (const c of p.cpSigs || []) await up('signatures', c.path, c.blob)
  if (p.upload) {
    let blob = p.upload.blob
    if (!blob && p.upload.files) {
      const { filesToPdf } = await import('./filesToPdf')
      const files = p.upload.files.map(f => new File([f.blob], f.name, { type: f.type }))
      blob = new Blob([await filesToPdf(files)], { type: 'application/pdf' })
    }
    await up('completed-docs', p.upload.path, blob)
  }
  // completion id is made on the device, so a retry after a dropped connection can't double up
  const { data: existing } = await supabase.from('completions').select('id').eq('id', p.completion.id).maybeSingle()
  if (!existing) {
    const { error } = await supabase.from('completions').insert(p.completion)
    if (error) throw error
  }
  if (p.attempt) {
    const { error } = await supabase.from('test_attempts').upsert(p.attempt, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
  }
  const { error: ae } = await supabase.from('assignments').update(p.assignmentUpdate).eq('id', p.completion.assignment_id)
  if (ae) throw ae
}

let flushing = false
export async function flushOutbox() {
  if (flushing || !navigator.onLine) return
  flushing = true
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (session.expires_at && session.expires_at * 1000 < Date.now() + 60000) await supabase.auth.refreshSession()
    const items = (await listOutbox()).filter(i => i.user_id === session.user.id).sort((a, b) => a.created - b.created)
    for (const it of items) {
      try { await sendSubmission(it); await removeOutbox(it.id) } catch (e) {
        if (isNetworkError(e)) break
        await tx('readwrite', s => s.put({ ...it, lastError: String(e.message || e) })); ping()
      }
    }
  } finally { flushing = false }
}
