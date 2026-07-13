import { STATUS_LABELS, isOverdue } from '../lib/supabase'

export default function StatusBadge({ assignment }) {
  const st = assignment.suspended ? 'suspended' : isOverdue(assignment) ? 'overdue' : assignment.status
  return <span className={`badge ${st}`}>{STATUS_LABELS[st] || st}</span>
}
