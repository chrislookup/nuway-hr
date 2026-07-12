-- ============================================================
-- NUWAY HR / WHS SUITE — DATABASE SCHEMA  v1.0
-- Run in the SQL editor of the NEW dedicated Supabase project.
-- Safe to run once on an empty project.
-- ============================================================

-- ---------- ENUMS ----------
create type access_tier as enum ('employee', 'manager', 'admin');
create type employee_status as enum ('active', 'inactive', 'terminated');
create type doc_type as enum ('web_form', 'pdf_form', 'media', 'test', 'manual');
create type assignment_source as enum ('role_pack', 'manual', 'migration');
create type assignment_status as enum ('not_started', 'in_progress', 'awaiting_review', 'completed', 'overdue', 'expired');
create type review_outcome as enum ('pending', 'approved_retry', 'retraining_required', 'passed_off');
create type notification_kind as enum ('due_soon', 'overdue', 'licence_expiring', 'licence_expired', 'test_failed_review', 'assignment_new');
create type notification_channel as enum ('dashboard', 'email', 'sms');
create type manager_capability as enum (
  'view_employees',      -- see employee profiles & progress
  'assign_documents',    -- assign docs/packs to employees
  'sign_off_training',   -- verify/sign off completions & failed tests
  'manage_employees',    -- create/edit employees at their locations
  'view_reports',        -- location roll-up reports
  'manage_licences'      -- record/verify licences
);

-- ---------- CORE: LOCATIONS / PEOPLE / ROLES ----------
create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,                 -- short code e.g. 'LOG'
  is_head_office boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- profiles extends supabase auth.users 1:1
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  email text unique,
  mobile text,                      -- E.164 for Twilio e.g. +614...
  tier access_tier not null default 'employee',
  status employee_status not null default 'active',
  start_date date,
  end_date date,
  legacy_folder_path text,          -- Dropbox path for migrated staff
  notify_email boolean not null default true,
  notify_sms boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table job_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,        -- Sales, Driver, Yard, custom...
  description text,
  active boolean not null default true
);

-- employees can hold multiple roles and locations
create table employee_job_roles (
  employee_id uuid not null references profiles (id) on delete cascade,
  job_role_id uuid not null references job_roles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (employee_id, job_role_id)
);

create table employee_locations (
  employee_id uuid not null references profiles (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  is_primary boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (employee_id, location_id)
);

-- per-manager configurable access: which locations + which capabilities
create table manager_location_access (
  manager_id uuid not null references profiles (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  primary key (manager_id, location_id)
);

create table manager_capabilities (
  manager_id uuid not null references profiles (id) on delete cascade,
  capability manager_capability not null,
  primary key (manager_id, capability)
);

-- ---------- DOCUMENTS / TRAINING CONTENT ----------
create table document_categories (
  id uuid primary key default gen_random_uuid(),
  code text unique,                 -- WHS module number e.g. '5.0'
  name text not null                -- e.g. 'Induction, Training, Skill and Competencies'
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  code text,                        -- policy number e.g. '3.1'
  title text not null,
  category_id uuid references document_categories (id),
  doc_type doc_type not null,
  requires_signature boolean not null default true,
  recurrence_months int,            -- null = one-time; e.g. 12 = annual refresher
  vehicle_id uuid,                  -- set for vehicle inductions (fk added below)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  version_no int not null default 1,
  form_schema jsonb,                -- web_form: field definitions
  pdf_path text,                    -- pdf_form: storage path of master PDF
  pdf_field_map jsonb,              -- pdf_form: overlay field coordinates
  media_url text,                   -- media: mp4 on nuway.com.au, or storage path
  notes text,
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  unique (document_id, version_no)
);

alter table documents
  add column current_version_id uuid references document_versions (id);

-- tests attached to a document version
create table tests (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions (id) on delete cascade,
  pass_mark numeric not null default 80,   -- percent
  questions jsonb not null,                -- [{q, options[], answer, points}]
  shuffle boolean not null default true
);

-- document packs (e.g. 'New Hire — Driver')
create table document_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true
);

create table pack_documents (
  pack_id uuid not null references document_packs (id) on delete cascade,
  document_id uuid not null references documents (id) on delete cascade,
  sort_order int not null default 0,
  primary key (pack_id, document_id)
);

-- packs auto-assigned when an employee gets a job role
create table job_role_packs (
  job_role_id uuid not null references job_roles (id) on delete cascade,
  pack_id uuid not null references document_packs (id) on delete cascade,
  primary key (job_role_id, pack_id)
);

-- ---------- ASSIGNMENTS & COMPLETIONS ----------
create table assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles (id) on delete cascade,
  document_id uuid not null references documents (id),
  source assignment_source not null default 'manual',
  status assignment_status not null default 'not_started',
  due_date date,
  assigned_by uuid references profiles (id),
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at date,                  -- next refresher due (recurrence)
  unique (employee_id, document_id, assigned_at)
);

create table completions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments (id) on delete cascade,
  document_version_id uuid not null references document_versions (id),
  form_data jsonb,                  -- filled field values
  signature_path text,              -- storage path of drawn/typed signature image
  signed_name text,
  signed_at timestamptz,
  ip_address inet,
  user_agent text,
  completed_pdf_path text,          -- rendered PDF of record in storage
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table test_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments (id) on delete cascade,
  test_id uuid not null references tests (id),
  answers jsonb not null,
  score numeric not null,
  passed boolean not null,
  review review_outcome not null default 'pending',
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

-- ---------- LICENCES & VEHICLES ----------
create table licence_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,        -- Driver Licence, Forklift (LF), Loader...
  reminder_days int not null default 60
);

create table licences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles (id) on delete cascade,
  licence_type_id uuid not null references licence_types (id),
  licence_number text,
  state text,                       -- QLD, NSW...
  licence_class text,
  issue_date date,
  expiry_date date,
  front_image_path text,
  back_image_path text,
  verified_by uuid references profiles (id),
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rego text unique,
  location_id uuid references locations (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table documents
  add constraint documents_vehicle_fk
  foreign key (vehicle_id) references vehicles (id);

-- ---------- NOTIFICATIONS & AUDIT ----------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles (id) on delete cascade,
  kind notification_kind not null,
  channel notification_channel not null,
  assignment_id uuid references assignments (id) on delete cascade,
  licence_id uuid references licences (id) on delete cascade,
  message text not null,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid references profiles (id),
  action text not null,             -- e.g. 'assignment.completed'
  entity text not null,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- ---------- INDEXES ----------
create index on assignments (employee_id, status);
create index on assignments (due_date) where status not in ('completed','expired');
create index on licences (expiry_date) where active;
create index on notifications (employee_id, read_at);
create index on employee_locations (location_id);
create index on completions (assignment_id);

-- ---------- HELPER FUNCTIONS (used by RLS) ----------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and tier = 'admin');
$$;

create or replace function has_capability(cap manager_capability) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1 from manager_capabilities
    where manager_id = auth.uid() and capability = cap);
$$;

-- manager can act on employee if they share a permitted location
create or replace function manages_employee(emp uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or exists (
    select 1
    from manager_location_access mla
    join employee_locations el on el.location_id = mla.location_id
    where mla.manager_id = auth.uid() and el.employee_id = emp);
$$;

-- ---------- ROW LEVEL SECURITY ----------
alter table locations enable row level security;
alter table profiles enable row level security;
alter table job_roles enable row level security;
alter table employee_job_roles enable row level security;
alter table employee_locations enable row level security;
alter table manager_location_access enable row level security;
alter table manager_capabilities enable row level security;
alter table document_categories enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table tests enable row level security;
alter table document_packs enable row level security;
alter table pack_documents enable row level security;
alter table job_role_packs enable row level security;
alter table assignments enable row level security;
alter table completions enable row level security;
alter table test_attempts enable row level security;
alter table licence_types enable row level security;
alter table licences enable row level security;
alter table vehicles enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- reference data: readable by all signed-in users, writable by admin
create policy ref_read on locations for select to authenticated using (true);
create policy ref_admin on locations for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on job_roles for select to authenticated using (true);
create policy ref_admin on job_roles for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on document_categories for select to authenticated using (true);
create policy ref_admin on document_categories for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on documents for select to authenticated using (true);
create policy ref_admin on documents for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on document_versions for select to authenticated using (true);
create policy ref_admin on document_versions for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on tests for select to authenticated using (true);
create policy ref_admin on tests for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on document_packs for select to authenticated using (true);
create policy ref_admin on document_packs for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on pack_documents for select to authenticated using (true);
create policy ref_admin on pack_documents for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on job_role_packs for select to authenticated using (true);
create policy ref_admin on job_role_packs for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on licence_types for select to authenticated using (true);
create policy ref_admin on licence_types for all to authenticated using (is_admin()) with check (is_admin());
create policy ref_read on vehicles for select to authenticated using (true);
create policy ref_admin on vehicles for all to authenticated using (is_admin()) with check (is_admin());

-- profiles: self-read/limited self-update; managers read their people; admin all
create policy prof_self_read on profiles for select to authenticated using (id = auth.uid());
create policy prof_mgr_read on profiles for select to authenticated using (manages_employee(id) and has_capability('view_employees'));
create or replace function current_tier() returns access_tier
language sql stable security definer set search_path = public as $$
  select tier from profiles where id = auth.uid();
$$;
create policy prof_self_update on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and tier = current_tier());
create policy prof_mgr_write on profiles for update to authenticated using (manages_employee(id) and has_capability('manage_employees'));
create policy prof_admin on profiles for all to authenticated using (is_admin()) with check (is_admin());

-- role/location joins: visible to self + manager, writable by manage_employees/admin
create policy ejr_read on employee_job_roles for select to authenticated using (employee_id = auth.uid() or manages_employee(employee_id));
create policy ejr_write on employee_job_roles for all to authenticated using (is_admin() or (manages_employee(employee_id) and has_capability('manage_employees'))) with check (is_admin() or (manages_employee(employee_id) and has_capability('manage_employees')));
create policy el_read on employee_locations for select to authenticated using (employee_id = auth.uid() or manages_employee(employee_id));
create policy el_write on employee_locations for all to authenticated using (is_admin() or (manages_employee(employee_id) and has_capability('manage_employees'))) with check (is_admin() or (manages_employee(employee_id) and has_capability('manage_employees')));

-- manager permission tables: admin manages; managers can read their own
create policy mla_self on manager_location_access for select to authenticated using (manager_id = auth.uid());
create policy mla_admin on manager_location_access for all to authenticated using (is_admin()) with check (is_admin());
create policy mcap_self on manager_capabilities for select to authenticated using (manager_id = auth.uid());
create policy mcap_admin on manager_capabilities for all to authenticated using (is_admin()) with check (is_admin());

-- assignments: employee sees own & updates own status; managers per capability
create policy asg_self_read on assignments for select to authenticated using (employee_id = auth.uid());
create policy asg_self_update on assignments for update to authenticated using (employee_id = auth.uid()) with check (employee_id = auth.uid());
create policy asg_mgr_read on assignments for select to authenticated using (manages_employee(employee_id) and has_capability('view_employees'));
create policy asg_mgr_write on assignments for all to authenticated using (is_admin() or (manages_employee(employee_id) and has_capability('assign_documents'))) with check (is_admin() or (manages_employee(employee_id) and has_capability('assign_documents')));

-- completions: employee inserts/reads own; manager verify; admin all
create policy comp_self on completions for select to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and a.employee_id = auth.uid()));
create policy comp_self_ins on completions for insert to authenticated with check (exists (select 1 from assignments a where a.id = assignment_id and a.employee_id = auth.uid()));
create policy comp_mgr on completions for select to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and manages_employee(a.employee_id) and has_capability('view_employees')));
create policy comp_mgr_verify on completions for update to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and manages_employee(a.employee_id) and has_capability('sign_off_training')));
create policy comp_admin on completions for all to authenticated using (is_admin()) with check (is_admin());

-- test attempts: employee inserts/reads own; manager reviews
create policy ta_self on test_attempts for select to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and a.employee_id = auth.uid()));
create policy ta_self_ins on test_attempts for insert to authenticated with check (exists (select 1 from assignments a where a.id = assignment_id and a.employee_id = auth.uid()));
create policy ta_mgr on test_attempts for select to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and manages_employee(a.employee_id) and has_capability('view_employees')));
create policy ta_mgr_review on test_attempts for update to authenticated using (exists (select 1 from assignments a where a.id = assignment_id and manages_employee(a.employee_id) and has_capability('sign_off_training')));
create policy ta_admin on test_attempts for all to authenticated using (is_admin()) with check (is_admin());

-- licences: self read; manager per capability; admin all
create policy lic_self on licences for select to authenticated using (employee_id = auth.uid());
create policy lic_mgr on licences for all to authenticated using (is_admin() or (manages_employee(employee_id) and has_capability('manage_licences'))) with check (is_admin() or (manages_employee(employee_id) and has_capability('manage_licences')));

-- notifications: own only (service role writes)
create policy notif_self on notifications for select to authenticated using (employee_id = auth.uid());
create policy notif_self_read on notifications for update to authenticated using (employee_id = auth.uid()) with check (employee_id = auth.uid());
create policy notif_mgr on notifications for select to authenticated using (manages_employee(employee_id) and has_capability('view_employees'));

-- audit log: admin read; inserts happen via service role / triggers
create policy audit_admin on audit_log for select to authenticated using (is_admin());

-- ---------- STORAGE BUCKETS (private) ----------
insert into storage.buckets (id, name, public) values
  ('masters', 'masters', false),          -- master PDFs / form assets
  ('completed-docs', 'completed-docs', false), -- rendered signed PDFs
  ('signatures', 'signatures', false),
  ('licences', 'licences', false);        -- ID scans: most sensitive

-- storage policies: employee accesses own folder (path = <employee_id>/...), managers via helper, admin all
create policy store_self_read on storage.objects for select to authenticated
  using (bucket_id in ('completed-docs','signatures','licences') and (storage.foldername(name))[1] = auth.uid()::text);
create policy store_self_write on storage.objects for insert to authenticated
  with check (bucket_id in ('completed-docs','signatures','licences') and (storage.foldername(name))[1] = auth.uid()::text);
create policy store_mgr_read on storage.objects for select to authenticated
  using (bucket_id in ('completed-docs','signatures','licences')
         and manages_employee(((storage.foldername(name))[1])::uuid)
         and has_capability('view_employees'));
create policy store_masters_read on storage.objects for select to authenticated
  using (bucket_id = 'masters');
create policy store_admin on storage.objects for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---------- TRIGGER: auto-create profile on signup ----------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, first_name, last_name, email, mobile)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'first_name',''),
          coalesce(new.raw_user_meta_data->>'last_name',''),
          new.email,
          new.phone)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- SEED DATA ----------
insert into locations (name, code, is_head_office) values
  ('Logan','LOG',false), ('Chandler','CHA',false), ('Redlands','RED',false),
  ('Westerns','WES',false), ('Forestdale','FOR',false), ('Pine Rivers','PIN',false),
  ('Mango Hill','MAN',false), ('Burpengary','BUR',false), ('Buderim','BUD',false),
  ('Ormeau','ORM',false), ('Ashmore','ASH',false), ('Stone & Outdoor','STO',false),
  ('Corporation','CORP',true);

insert into job_roles (name, description) values
  ('Sales','Sales / counter staff'),
  ('Driver','Delivery drivers'),
  ('Yard','Yard persons'),
  ('Manager','Store managers'),
  ('Corp','Head office staff');

insert into licence_types (name, reminder_days) values
  ('Driver Licence', 60), ('Forklift (LF)', 90), ('Front End Loader (LL)', 90),
  ('First Aid Certificate', 60), ('White Card', 90);

insert into document_categories (code, name) values
  ('2.0','Company Policy'), ('3.0','Risk Management and Hazard Reporting'),
  ('4.0','Incident Reporting and Investigation'),
  ('5.0','Induction, Training, Skill and Competencies'),
  ('6.0','Emergency Response Management'), ('7.0','First Aid Management'),
  ('8.0','Hazardous Substances Management'), ('9.0','Asbestos Management'),
  ('10.0','Electrical Equipment Management'), ('11.0','Plant and Equipment Safety Management'),
  ('12.0','Workplace Inspections'), ('13.0','Consultation Requirement'),
  ('15.0','Traffic Management'), ('17.0','Manual Handling Management'),
  ('18.0','PPE Management'), ('19.0','Health and Wellbeing Management'),
  ('20.0','Safety Bulletins'), ('21.0','Epidemic / Pandemic / COVID-19');

-- the 23 core policies every employee signs (doc_type placeholder: web_form)
with cat as (select id, code from document_categories)
insert into documents (code, title, category_id, doc_type, requires_signature)
select v.code, v.title, cat.id, 'web_form', true
from (values
  ('2.1','Work Health & Safety Policy','2.0'),
  ('3.1','Risk Management Procedure','3.0'),
  ('4.1','Incident Reporting and Investigating Procedure','4.0'),
  ('5.1','Induction and Training Procedure','5.0'),
  ('5.2','Workplace Health and Safety','5.0'),
  ('5.3','Nuway''s Health and Safety Rules','5.0'),
  ('6.0','Emergency Evacuation Procedure','6.0'),
  ('7.0','First Aid Procedure','7.0'),
  ('8.1','Hazardous Substances','8.0'),
  ('9.1','Asbestos Management Policy and Plan','9.0'),
  ('10.1','Electrical Equipment Procedure','10.0'),
  ('11.1','Plant Safety Procedure','11.0'),
  ('11.2','Chain of Responsibility Policy and Procedure','11.0'),
  ('13.1','Consultation Procedure','13.0'),
  ('15.1','Traffic Management Procedure','15.0'),
  ('17.1','Manual Handling Procedure','17.0'),
  ('18.1','PPE Management Procedure','18.0'),
  ('19.1','Health and Wellbeing Policy','19.0'),
  ('19.2','Workplace Harassment & Bullying Policy','19.0'),
  ('19.6','Family & Domestic Violence Support Policy','19.0'),
  ('19.8','Sexual Harassment Policy','19.0'),
  ('19.9','Right to Disconnect Policy','19.0'),
  ('21.1','Pandemic / COVID-19 Policy','21.0')
) as v(code, title, cat_code)
join cat on cat.code = v.cat_code;

-- core WHS pack containing all 23 policies, linked to every role
insert into document_packs (name, description) values
  ('Core WHS Policies','The 23 standard policies every employee signs');

insert into pack_documents (pack_id, document_id, sort_order)
select p.id, d.id, row_number() over (order by d.code)
from document_packs p, documents d
where p.name = 'Core WHS Policies';

insert into job_role_packs (job_role_id, pack_id)
select r.id, p.id from job_roles r, document_packs p
where p.name = 'Core WHS Policies';

-- role-specific starter packs (fill with docs later)
insert into document_packs (name, description) values
  ('New Hire — Sales','Sales-specific onboarding'),
  ('New Hire — Driver','Driver-specific onboarding incl. vehicle inductions'),
  ('New Hire — Yard','Yard-specific onboarding');

insert into job_role_packs (job_role_id, pack_id)
select r.id, p.id from job_roles r join document_packs p
  on (r.name='Sales'  and p.name='New Hire — Sales')
  or (r.name='Driver' and p.name='New Hire — Driver')
  or (r.name='Yard'   and p.name='New Hire — Yard');

-- ============================================================
-- END — after running: create your admin user in Auth, then:
--   update profiles set tier = 'admin' where email = 'chris@nuway.com.au';
-- ============================================================

