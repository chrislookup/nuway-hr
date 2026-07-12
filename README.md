# Nuway HR Suite

Digital HR / WHS training & compliance portal for Nuway. React + Supabase.

- `src/` — web app (Vite + React, deployed to GitHub Pages / nuway.com.au)
- `supabase/functions/` — edge functions (create-employee, reminders)
- Database schema & migrations: see nuway_hr_schema.sql / nuway_hr_migration_002_onboarding.sql

Three access tiers: employee, manager (per-manager configurable locations + capabilities), admin.
Documents, packs, roles, locations, due-days and conditions are all data — editable in the Admin UI.
