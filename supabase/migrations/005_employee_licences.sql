-- Employee licence self-service: conditions field + allow employees to add their own licence.
alter table licences add column if not exists conditions text;
create policy lic_self_ins on licences for insert to authenticated with check (employee_id = auth.uid());
