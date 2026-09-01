// Works out which vehicle inductions a person looks like they need, so managers get
// prompted instead of having to remember. Suggestions only — a manager still confirms,
// because not every yard hand operates every machine at the store.

const TRUCK_CLASSES = /^(LR|MR|HR|HC|MC)$/i

export function machineNeeds({ roles = [], licences = [] }) {
  const names = licences.map(l => l.licence_types?.name || '')
  const has = re => names.some(n => re.test(n))
  const role = re => roles.some(r => re.test(r))
  const needs = {}
  if (has(/^Forklift \(/i)) needs.Forklift = 'holds a forklift licence'
  else if (has(/^Forklift Logbook/i)) needs.Forklift = 'is on a forklift logbook'
  else if (role(/yard/i)) needs.Forklift = 'works in the yard'

  if (has(/^Front End Loader/i)) needs.Loader = 'holds a loader licence'
  else if (has(/^Loader Logbook/i)) needs.Loader = 'is on a loader logbook'
  else if (role(/yard/i)) needs.Loader = 'works in the yard'

  const dl = licences.find(l => /^Driver Licence/i.test(l.licence_types?.name || ''))
  if (dl && TRUCK_CLASSES.test((dl.licence_class || '').trim())) needs.Truck = `holds a ${dl.licence_class.toUpperCase()} licence`
  else if (role(/driver/i)) needs.Truck = 'is a driver'
  return needs
}

// vehicles: [{id, rego, type, induction_document_id}] at the person's store(s)
// assignedVehicleIds: vehicle ids they already have an induction for
export function suggestInductions({ roles, licences, vehicles = [], assignedVehicleIds = [] }) {
  const needs = machineNeeds({ roles, licences })
  return vehicles
    .filter(v => v.type && needs[v.type] && !assignedVehicleIds.includes(v.id))
    .map(v => ({ vehicle: v, reason: needs[v.type] }))
}
