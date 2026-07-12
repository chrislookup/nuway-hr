-- Competent-person captures name + drawn signature + their section answers.
alter table completions add column if not exists verifier_signature_path text;
alter table completions add column if not exists verifier_name text;
alter table completions add column if not exists verifier_data jsonb;

-- assessors may write their signature into the employee's folder for awaiting assessor-required docs
create policy store_assessor_write on storage.objects for insert to authenticated
  with check (bucket_id in ('signatures','completed-docs') and is_assessor()
    and exists (select 1 from assignments a join documents d on d.id=a.document_id
                where a.employee_id = ((storage.foldername(name))[1])::uuid
                and a.status='awaiting_review' and d.requires_assessor_signoff));
