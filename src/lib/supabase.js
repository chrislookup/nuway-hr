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
  rejected: 'Returned',
  suspended: 'On hold',
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
  return a.due_date && !a.suspended && !['completed', 'expired'].includes(a.status) && new Date(a.due_date) < new Date()
}

export const CAT_ORDER = {
  'New Employee Forms & Administration': 0,
  'Company Policy': 2,
  'Risk Management and Hazard Reporting': 3,
  'Incident Reporting and Investigation': 4,
  'Induction, Training, Skill and Competencies': 5,
  'Emergency Response Management': 6,
  'First Aid Management': 7,
  'Hazardous Substances Management': 8,
  'Asbestos Management': 9,
  'Electrical Equipment Management': 10,
  'Plant and Equipment Safety Management': 11,
  'Workplace Inspections': 12,
  'Consultation Requirement': 13,
  'Traffic Management': 15,
  'Manual Handling Management': 17,
  'PPE Management': 18,
  'Health and Wellbeing Management': 19,
  'Safety Bulletins': 20,
  'Epidemic / Pandemic / COVID-19': 21,
  'Safe Work Procedures': 100,
  'Sales': 101,
  'Culture': 102,
}
export const catRank = (name) => (CAT_ORDER[name] ?? 200)
export const byCatRank = (a, b) => catRank(a) - catRank(b) || String(a).localeCompare(String(b))
