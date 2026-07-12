-- Competent-person (assessor) sign-off. Apply in Supabase SQL editor when dashboard is available.
alter table documents add column if not exists requires_assessor_signoff boolean not null default false;

create or replace function is_assessor() returns boolean
language sql stable security definer set search_path=public as $fn$
  select exists (select 1 from profiles where id = auth.uid() and can_assess);
$fn$;

create policy asg_assessor_read on assignments for select to authenticated
  using (status='awaiting_review' and is_assessor()
         and exists (select 1 from documents d where d.id=document_id and d.requires_assessor_signoff));
create policy asg_assessor_write on assignments for update to authenticated
  using (is_assessor() and exists (select 1 from documents d where d.id=document_id and d.requires_assessor_signoff))
  with check (is_assessor());
create policy comp_assessor_read on completions for select to authenticated
  using (is_assessor() and exists (select 1 from assignments a join documents d on d.id=a.document_id where a.id=assignment_id and d.requires_assessor_signoff));
create policy comp_assessor_verify on completions for update to authenticated
  using (is_assessor() and exists (select 1 from assignments a join documents d on d.id=a.document_id where a.id=assignment_id and d.requires_assessor_signoff));
create policy prof_assessor_read on profiles for select to authenticated
  using (is_assessor() and exists (select 1 from assignments a join documents d on d.id=a.document_id where a.employee_id = profiles.id and a.status='awaiting_review' and d.requires_assessor_signoff));
