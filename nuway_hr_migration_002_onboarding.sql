-- ============================================================
-- MIGRATION 002-A — onboarding pack support (DDL)
-- ============================================================
alter type doc_type add value if not exists 'upload';
alter type doc_type add value if not exists 'task';

alter table documents add column if not exists completed_by text not null default 'employee'
  check (completed_by in ('employee','manager','both'));
alter table documents add column if not exists requires_manager_signoff boolean not null default false;
alter table documents add column if not exists conditions jsonb;
alter table pack_documents add column if not exists due_days int;
alter table profiles add column if not exists employment_type text
  check (employment_type in ('casual','part_time','full_time','salary'));
alter table profiles add column if not exists date_of_birth date;
alter table profiles add column if not exists commencement_approved_by text;

insert into document_categories (code, name) values
  ('F5.0','New Employee Forms & Administration'),
  ('SWP','Safe Work Procedures'),
  ('P1','Training, Culture & Manuals')
on conflict (code) do nothing;

-- ============================================================
-- MIGRATION 002-B — documents, packs, role links (run second)
-- ============================================================
-- new documents
with cat as (select id, code from document_categories)
insert into documents (code, title, category_id, doc_type, requires_signature, completed_by, requires_manager_signoff, conditions)
select v.code, v.title, cat.id, v.dt::doc_type, v.sig, v.who, v.mgr, v.cond::jsonb
from (values
  -- Administration
  ('F5.1.1','Application for Employment','F5.0','web_form',true,'employee',false,null),
  ('F5.1.2','Interview Questions','F5.0','web_form',true,'manager',false,null),
  ('F5.1.3','Form 1 - Medical Self Report','F5.0','web_form',true,'employee',false,null),
  ('F5.0.1.1','Contract Terms of Employment - Casual','F5.0','pdf_form',true,'both',true,'{"employment_type":["casual"]}'),
  ('F5.0.1.2','Contract Terms of Employment - Salary','F5.0','pdf_form',true,'both',true,'{"employment_type":["salary"]}'),
  ('F5.0.1.3','Contract Terms of Employment - Full-Time','F5.0','pdf_form',true,'both',true,'{"employment_type":["full_time"]}'),
  ('F5.0.1.4','Contract Terms of Employment - Part-Time','F5.0','pdf_form',true,'both',true,'{"employment_type":["part_time"]}'),
  ('F5.0.6.1','ATO Tax File Declaration','F5.0','pdf_form',true,'employee',false,null),
  ('F5.0.2','Superannuation Choice Form','F5.0','pdf_form',true,'employee',false,null),
  ('F5.1.7a','New Employee Uniform Order','F5.0','web_form',false,'manager',false,null),
  ('LIC-DL','Driver Licence Upload (Front & Back)','F5.0','upload',false,'employee',false,null),
  ('CV','Resume / CV Upload','F5.0','upload',false,'employee',false,null),
  ('F5.0.3.1','Under 16 - Parent''s Consent','F5.0','web_form',true,'employee',false,'{"age_under":16}'),
  ('F5.0.3.2','Under 18 Consent','F5.0','web_form',true,'employee',false,'{"age_under":18}'),
  ('F5.1.6','Employment Agency Authority to Contact','F5.0','web_form',true,'employee',false,'{"agency_hire":true}'),
  ('F5.0.5.2c','Fair Work Information Statement','F5.0','media',true,'employee',false,null),
  ('F5.0.5.4c','Casual Employment Information Statement','F5.0','media',true,'employee',false,'{"employment_type":["casual"]}'),
  ('F5.0.4.3','Casual Conversion Notification','F5.0','media',true,'employee',false,'{"employment_type":["casual"]}'),
  ('F5.0.4.1','Casual Level 3 - Store Copy','F5.0','media',true,'employee',false,'{"employment_type":["casual"]}'),
  -- WHS extras
  ('17.2','SWP - Manual Handling (with supervisor)','SWP','media',true,'employee',true,null),
  ('FWC-SH','Fair Work Commission Online Module - Workplace Sexual Harassment (certificate upload)','5.0','upload',false,'employee',false,null),
  ('SWP-5.0','SWP - Truck Hand Unloads','SWP','media',true,'employee',false,null),
  ('SWP-19.3','SWP - Customer Interactions','SWP','media',true,'employee',false,null),
  ('SWP-19.4','SWP - Workers and Other Interactions','SWP','media',true,'employee',false,null),
  ('SWP-21.8','SWP - Communicable Disease Containment','SWP','media',true,'employee',false,null),
  ('SWP-SNAKE','SWP - Snake Bite Prevention','SWP','media',true,'employee',false,null),
  ('SWP-ENV','SWP - Working in Diverse Environmental Conditions','SWP','media',true,'employee',false,null),
  ('SWP-LOADER','SWP - Safe Operation of Loader in Landscape Yard','SWP','media',true,'employee',false,null),
  ('SWP-FORKLIFT','SWP - Safe Operation of Forklift in Landscape Yard','SWP','media',true,'employee',false,null),
  ('19.5','Health and Wellbeing Support Services Guide','19.0','media',false,'employee',false,null),
  ('19.7','Family & Domestic Violence Support Services Contact List','19.0','media',false,'employee',false,null),
  ('5.4','Workplace Representative','5.0','media',false,'employee',false,null),
  -- Driver extras
  ('F5.1.4-2','Form 2 - Driver Questionnaire','F5.0','web_form',true,'employee',false,null),
  ('F5.1.4-3','Form 3 - Driver Appraisal','F5.0','web_form',true,'manager',false,null),
  ('F5.0.7.1a','Traffic History Report (Qld Transport)','F5.0','upload',false,'employee',false,null),
  ('F5.0.7.1b','Licence History Report (Qld Transport)','F5.0','upload',false,'employee',false,null),
  ('F5.1.8','Form 4 - Traffic History Reimbursement','F5.0','web_form',true,'employee',false,null),
  -- Licences / vehicle inductions
  ('LIC-FL','Forklift Licence Upload','F5.0','upload',false,'employee',false,'{"if_held":true}'),
  ('LIC-LD','Loader Licence Upload','F5.0','upload',false,'employee',false,'{"if_held":true}'),
  ('11.3','Loader or Forklift Induction (per vehicle)','11.0','pdf_form',true,'both',true,null),
  ('11.4','Truck Induction (per vehicle)','11.0','pdf_form',true,'both',true,null),
  -- Training & culture
  ('P1.2.1','New Employee Manual (explained)','P1','manual',true,'both',true,null),
  ('P1.2.3','A-Z Product Info Training Manual (explained)','P1','manual',true,'both',true,null),
  ('P1.2.4','Paver & Wall Training Manual (explained)','P1','manual',true,'both',true,null),
  ('P2.1','Sales Manual - 12 Week Skills Sign-off','P1','manual',true,'both',true,null),
  ('P4.1','Yardperson Procedure Manual','P1','manual',true,'both',true,null),
  ('P5.1','Driver Procedure Manual','P1','manual',true,'both',true,null),
  ('P5.2','Driver Rules & Regulations','P1','manual',true,'both',true,null),
  ('P1.3.1','What is Cultural Framework','P1','media',true,'employee',true,null),
  ('P1.3.2','Nuway Values (Leadership, Exceptional, Collaborate, Accountability, Communication, Growth)','P1','media',true,'employee',true,null),
  ('P1.1','Customer Service Guide - Full Set','P1','media',true,'employee',true,null),
  -- Management pack
  ('P1.2.0','New Employee Induction Procedure (manager training)','P1','manual',true,'employee',false,null),
  ('MGMT-BANK','Banking / End-of-Day Procedure','P1','media',true,'employee',false,null),
  ('MGMT-KEYS','Store Keys & Alarm Codes Register Acknowledgement','P1','web_form',true,'employee',false,null),
  ('MGMT-TOOLS','Managers Tools Pack','P1','media',false,'employee',false,null),
  ('MGMT-TBT','Toolbox Talk Delivery Training','P1','media',true,'employee',true,null),
  ('MGMT-INV','Incident Investigation - Manager Responsibilities (4.1)','P1','media',true,'employee',false,null),
  ('MGMT-INSP','Workplace Inspections - Monthly Store Inspection Procedure (12.0)','P1','media',true,'employee',false,null),
  ('MGMT-ERC','Emergency Response Coordinator Duties (6.0)','P1','media',true,'employee',false,null),
  ('MGMT-HRS','HR Suite Administration Training','P1','media',true,'employee',false,null),
  ('MGMT-COR','Chain of Responsibility - Manager Obligations (11.2)','P1','media',true,'employee',false,null),
  ('MGMT-3MO','First 3 Months Onboarding Guide - Oversight','P1','task',false,'employee',false,null)
) as v(code, title, cat_code, dt, sig, who, mgr, cond)
join cat on cat.code = v.cat_code;

-- flags on already-seeded WHS policies
update documents set requires_manager_signoff = true where code in ('5.2','18.1');
update documents set conditions = '{"locations":["Logan","Ashmore","Westerns"]}'::jsonb where code = '9.1';

-- new packs
insert into document_packs (name, description) values
  ('Administration - All Roles','Section 1 admin, contracts, tax, super, uniform, consents, legislation'),
  ('SWP - Common','Safe work procedures required by every role'),
  ('SWP - Plant','Loader & forklift SWPs for Yard and Driver'),
  ('Driver Extras','Driver questionnaire, appraisal, Qld Transport reports, reimbursement'),
  ('Licences & Vehicle Inductions','Licence uploads and per-vehicle inductions for Yard and Driver'),
  ('Training & Culture - Common','Section 3 manuals, culture, customer service'),
  ('Management Onboarding','Manager-specific induction (DRAFT)');

-- pack contents (+ due days from start date)
insert into pack_documents (pack_id, document_id, sort_order, due_days)
select p.id, d.id, v.ord, v.due
from (values
  ('Administration - All Roles','F5.1.1',1,1),('Administration - All Roles','F5.1.2',2,1),
  ('Administration - All Roles','F5.1.3',3,1),('Administration - All Roles','F5.0.1.1',4,1),
  ('Administration - All Roles','F5.0.1.2',5,1),('Administration - All Roles','F5.0.1.3',6,1),
  ('Administration - All Roles','F5.0.1.4',7,1),('Administration - All Roles','F5.0.6.1',8,1),
  ('Administration - All Roles','F5.0.2',9,1),('Administration - All Roles','F5.1.7a',10,0),
  ('Administration - All Roles','LIC-DL',11,1),('Administration - All Roles','CV',12,1),
  ('Administration - All Roles','F5.0.3.1',13,1),('Administration - All Roles','F5.0.3.2',14,1),
  ('Administration - All Roles','F5.1.6',15,1),('Administration - All Roles','F5.0.5.2c',16,1),
  ('Administration - All Roles','F5.0.5.4c',17,1),('Administration - All Roles','F5.0.4.3',18,1),
  ('Administration - All Roles','F5.0.4.1',19,1),
  ('SWP - Common','SWP-5.0',1,1),('SWP - Common','SWP-19.3',2,1),('SWP - Common','SWP-19.4',3,1),
  ('SWP - Common','SWP-21.8',4,1),('SWP - Common','SWP-SNAKE',5,1),('SWP - Common','SWP-ENV',6,1),
  ('SWP - Common','17.2',7,1),('SWP - Common','FWC-SH',8,7),
  ('SWP - Plant','SWP-LOADER',1,1),('SWP - Plant','SWP-FORKLIFT',2,1),
  ('Driver Extras','F5.1.4-2',1,1),('Driver Extras','F5.1.4-3',2,7),
  ('Driver Extras','F5.0.7.1a',3,7),('Driver Extras','F5.0.7.1b',4,7),('Driver Extras','F5.1.8',5,7),
  ('Licences & Vehicle Inductions','LIC-FL',1,1),('Licences & Vehicle Inductions','LIC-LD',2,1),
  ('Licences & Vehicle Inductions','11.3',3,3),('Licences & Vehicle Inductions','11.4',4,3),
  ('Training & Culture - Common','P1.2.1',1,3),('Training & Culture - Common','P1.2.3',2,3),
  ('Training & Culture - Common','P1.2.4',3,3),('Training & Culture - Common','P1.3.1',4,5),
  ('Training & Culture - Common','P1.3.2',5,5),('Training & Culture - Common','P1.1',6,7),
  ('Training & Culture - Common','19.5',7,7),('Training & Culture - Common','19.7',8,7),
  ('Training & Culture - Common','5.4',9,7),
  ('New Hire — Sales','P2.1',1,84),
  ('New Hire — Yard','P4.1',1,3),
  ('New Hire — Driver','P4.1',1,3),('New Hire — Driver','P5.1',2,3),('New Hire — Driver','P5.2',3,3),
  ('Management Onboarding','P1.2.0',1,3),('Management Onboarding','MGMT-BANK',2,7),
  ('Management Onboarding','MGMT-KEYS',3,1),('Management Onboarding','MGMT-TOOLS',4,14),
  ('Management Onboarding','MGMT-TBT',5,14),('Management Onboarding','MGMT-INV',6,14),
  ('Management Onboarding','MGMT-INSP',7,14),('Management Onboarding','MGMT-ERC',8,14),
  ('Management Onboarding','MGMT-HRS',9,14),('Management Onboarding','MGMT-COR',10,14),
  ('Management Onboarding','MGMT-3MO',11,84)
) as v(pack, code, ord, due)
join document_packs p on p.name = v.pack
join documents d on d.code = v.code;

-- role -> pack links
insert into job_role_packs (job_role_id, pack_id)
select r.id, p.id
from (values
  ('Sales','Administration - All Roles'),('Driver','Administration - All Roles'),
  ('Yard','Administration - All Roles'),('Manager','Administration - All Roles'),
  ('Corp','Administration - All Roles'),
  ('Sales','SWP - Common'),('Driver','SWP - Common'),('Yard','SWP - Common'),('Manager','SWP - Common'),
  ('Driver','SWP - Plant'),('Yard','SWP - Plant'),
  ('Driver','Driver Extras'),
  ('Driver','Licences & Vehicle Inductions'),('Yard','Licences & Vehicle Inductions'),
  ('Sales','Training & Culture - Common'),('Driver','Training & Culture - Common'),
  ('Yard','Training & Culture - Common'),('Manager','Training & Culture - Common'),
  ('Manager','Management Onboarding')
) as v(role, pack)
join job_roles r on r.name = v.role
join document_packs p on p.name = v.pack
on conflict do nothing;
