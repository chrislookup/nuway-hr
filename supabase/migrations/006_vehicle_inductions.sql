-- Vehicle inductions: per-vehicle induction doc, assignment ties to a specific vehicle, manager store access.
alter table vehicles add column if not exists type text;
alter table vehicles add column if not exists induction_document_id uuid references documents(id);
alter table assignments add column if not exists vehicle_id uuid references vehicles(id);

-- everyone can read vehicles (needed to show rego on an induction row + store settings)
create policy veh_read on vehicles for select to authenticated using (true);
-- managers assigned to a store can manage that store's vehicles; admins all
create policy veh_mgr_write on vehicles for all to authenticated
  using (is_admin() or exists (select 1 from manager_location_access m where m.manager_id = auth.uid() and m.location_id = vehicles.location_id))
  with check (is_admin() or exists (select 1 from manager_location_access m where m.manager_id = auth.uid() and m.location_id = vehicles.location_id));
