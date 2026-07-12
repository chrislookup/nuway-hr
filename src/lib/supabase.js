import { createClient } from '@supabase/supabase-js'

// Public URL where the app is deployed (GitHub Pages). Used for auth email redirects.
export const APP_URL = 'https://chrislookup.github.io/nuway-hr/'

export const supabase = createClient(
  'https://qaxuyvmftvbkvgdwhlkp.supabase.co',
  'sb_publishable_I-hZVyI6F6HgYJ4aaqvcxA_y7Yq92ME'
)

export const STATUS_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_review: 'Awaiting review',
  completed: 'Completed',
  overdue: 'Overdue',
  expired: 'Expired',
}

export const CAPABILITIES = [
  ['view_employees', 'View employees & progress'],
  ['assign_documents', 'Assign documents'],
  ['sign_off_training', 'Sign off training & tests'],
  ['manage_employees', 'Create / edit employees'],
  ['view_reports', 'View reports'],
  ['manage_licences', 'Manage licences'],
]

export function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function isOverdue(a) {
  return a.due_date && !['completed', 'expired'].includes(a.status) && new Date(a.due_date) < new Date()
}
