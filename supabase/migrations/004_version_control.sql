-- Version lifecycle for controlled documents.
alter table document_versions add column if not exists status text not null default 'published';
alter table document_versions add column if not exists change_note text;
alter table document_versions add column if not exists approved_by uuid references profiles(id);
alter table document_versions add column if not exists approved_at timestamptz;
