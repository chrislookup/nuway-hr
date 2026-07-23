alter table documents add column if not exists library text;      -- null | 'form' | 'resource'
alter table documents add column if not exists recipients jsonb;  -- [{label,email}] for forms

CREATE OR REPLACE FUNCTION public.assign_role_packs(emp uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n int; sd date; et text; dob date;
begin
  select coalesce(start_date, current_date), employment_type, date_of_birth into sd, et, dob from profiles where id = emp;
  insert into assignments (employee_id, document_id, source, status, due_date)
  select emp, d.id, 'role_pack', 'not_started', sd + coalesce(d.due_days, 14)
  from documents d
  where d.active and coalesce(d.pre_employment,false)=false and not coalesce(d.manual_only,false) and d.library is null
    and not exists (select 1 from assignments a where a.employee_id=emp and a.document_id=d.id)
    and (
      d.conditions is null
      or (
        (not d.conditions ? 'employment_type' or et in (select jsonb_array_elements_text(d.conditions->'employment_type')))
        and (not d.conditions ? 'roles' or exists (select 1 from employee_job_roles ejr join job_roles jr on jr.id=ejr.job_role_id where ejr.employee_id=emp and jr.name in (select jsonb_array_elements_text(d.conditions->'roles'))))
        and (not d.conditions ? 'age_under' or (dob is not null and extract(year from age(dob)) < (d.conditions->>'age_under')::int))
        and (not d.conditions ? 'locations' or exists (select 1 from employee_locations el join locations l on l.id=el.location_id where el.employee_id=emp and l.name in (select jsonb_array_elements_text(d.conditions->'locations'))))
        and not d.conditions ? 'agency_hire'
        and not d.conditions ? 'if_held'
      )
    );
  get diagnostics n = row_count;
  return n;
end; $function$;

CREATE OR REPLACE FUNCTION public.rollout_document(doc uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare n int;
begin
  if not exists (select 1 from profiles where id = auth.uid() and tier = 'admin') then
    raise exception 'Not authorized';
  end if;
  insert into assignments (employee_id, document_id, source, status, due_date)
  select p.id, doc, 'role_pack', 'not_started', current_date + coalesce(d.due_days, 14)
  from profiles p, documents d
  where d.id = doc and d.active and coalesce(d.pre_employment,false)=false and not coalesce(d.manual_only,false) and d.library is null
    and p.status = 'active'
    and not exists (select 1 from assignments a where a.employee_id=p.id and a.document_id=doc)
    and (
      d.conditions is null
      or (
        (not d.conditions ? 'employment_type' or p.employment_type in (select jsonb_array_elements_text(d.conditions->'employment_type')))
        and (not d.conditions ? 'roles' or exists (select 1 from employee_job_roles ejr join job_roles jr on jr.id=ejr.job_role_id where ejr.employee_id=p.id and jr.name in (select jsonb_array_elements_text(d.conditions->'roles'))))
        and (not d.conditions ? 'age_under' or (p.date_of_birth is not null and extract(year from age(p.date_of_birth)) < (d.conditions->>'age_under')::int))
        and (not d.conditions ? 'locations' or exists (select 1 from employee_locations el join locations l on l.id=el.location_id where el.employee_id=p.id and l.name in (select jsonb_array_elements_text(d.conditions->'locations'))))
        and not d.conditions ? 'agency_hire'
        and not d.conditions ? 'if_held'
      )
    );
  get diagnostics n = row_count;
  return n;
end; $function$;
