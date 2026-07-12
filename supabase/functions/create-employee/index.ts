import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(token)
    if (!user) return json({ error: 'Not signed in' }, 401)

    const { data: caller } = await admin.from('profiles').select('tier').eq('id', user.id).single()
    let allowed = caller?.tier === 'admin'
    if (!allowed && caller?.tier === 'manager') {
      const { data: cap } = await admin.from('manager_capabilities')
        .select('capability').eq('manager_id', user.id).eq('capability', 'manage_employees')
      allowed = !!cap?.length
    }
    if (!allowed) return json({ error: 'No permission to create employees' }, 403)

    const b = await req.json()
    if (!b.email || !b.first_name || !b.last_name) return json({ error: 'Missing required fields' }, 400)

    const { data: created, error: ue } = await admin.auth.admin.inviteUserByEmail(b.email, {
      data: { first_name: b.first_name, last_name: b.last_name },
      redirectTo: 'https://chrislookup.github.io/nuway-hr/',
    })
    if (ue) return json({ error: ue.message }, 400)
    const uid = created.user.id

    await admin.from('profiles').update({
      first_name: b.first_name, last_name: b.last_name, mobile: b.mobile || null,
      employment_type: b.employment_type || null, date_of_birth: b.date_of_birth || null,
      start_date: b.start_date || null, commencement_approved_by: b.commencement_approved_by || null,
    }).eq('id', uid)

    if (b.locations?.length) {
      await admin.from('employee_locations').insert(
        b.locations.map((l: string, i: number) => ({ employee_id: uid, location_id: l, is_primary: i === 0 })))
    }
    if (b.roles?.length) {
      await admin.from('employee_job_roles').insert(
        b.roles.map((r: string) => ({ employee_id: uid, job_role_id: r })))
    }
    const { data: n } = await admin.rpc('assign_role_packs', { emp: uid })
    const { count } = await admin.from('assignments').select('*', { count: 'exact', head: true }).eq('employee_id', uid)
    return json({ ok: true, employee_id: uid, assigned: count ?? n ?? 0 })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
