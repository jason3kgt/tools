-- ============================================================================
-- NTD Hub — Supabase schema  (schema.sql)
-- Project: mngilvenfclopyfzaghq   |   Exported from the live database 2026-10-01
-- ============================================================================
--
-- WHAT THIS IS
--   The full database structure behind NTD Hub and the field tools: 15 tables,
--   keys, indexes, Row Level Security, policies, grants, and the ntd-files
--   storage bucket. NO DATA — just structure.
--
-- WHEN TO USE IT
--   Only to rebuild the Hub in a FRESH, EMPTY Supabase project
--   (SQL Editor -> paste -> Run). It refuses to run if it detects the NTD
--   tables already exist, so running it against the live project by mistake
--   changes nothing.
--
-- HOW ACCESS WORKS TODAY (reproduced exactly as live)
--   There is no login yet, so every tool talks to Supabase with the public
--   anon key. Policies let anon read, insert, and update every table.
--   Anon can DELETE only on: service_tickets, notifications, team_calendar.
--   Every other delete has to be done from the Supabase dashboard.
--   Grants are written out explicitly per table (Supabase's Oct 30, 2026 rule:
--   new tables get no automatic grants). "grant all" here = exactly what the
--   live tables have: select, insert, update, delete, truncate, references,
--   trigger, maintain — for anon, authenticated, and service_role.
--
-- THINGS TO KNOW
--   * Deleting a facility CASCADES: its documents, equipment, jobs (and their
--     job_units), PM records (and pm_unit_results), PM/service quotes, and
--     startup records are deleted with it. Re-point those rows to the
--     surviving facility BEFORE deleting a duplicate facility.
--     (service_records, service_tickets, team_calendar, notifications and
--     model_library have no foreign key — they are left behind, not deleted.)
--   * No database functions, triggers, or views. ntdStore.js sets id, ts,
--     created_at and updated_at itself on every write.
--   * 2026-10-01: service_tickets.project_id changed from uuid to text on
--     live (project ids are text, e.g. "jobs_lq2x8abcd"; the uuid type was
--     rejecting tickets linked to a project).
--
-- KEEPING IT CURRENT
--   Whenever a table/column/policy is added in Supabase, add the same SQL here
--   (CREATE TABLE + RLS + policies + GRANTs together, per the project rule),
--   or re-run the export query and regenerate this file.
-- ============================================================================

begin;

-- Safety guard: stop immediately if this is not an empty project.
do $$
begin
  if to_regclass('public.facilities') is not null then
    raise exception 'NTD tables already exist in this project. schema.sql is only for a fresh, empty Supabase project. Nothing was changed.';
  end if;
end $$;

-- ── Extensions (already installed on every Supabase project; no-ops there) ──
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ── documents ─────────────────────────────────────────────────────────────
create table public.documents (
  id text not null,
  facility_id text,
  form_type text,
  description text,
  file_path text,
  file_url text,
  date text,
  tech text,
  unit_count integer,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  job_id text,
  equipment_id text
);
alter table public.documents add constraint documents_pkey PRIMARY KEY (id);
alter table public.documents enable row level security;
create policy "anon insert" on public.documents as permissive for insert to public with check (true);
create policy "anon select" on public.documents as permissive for select to public using (true);
create policy "anon update" on public.documents as permissive for update to public using (true) with check (true);
grant all on table public.documents to anon, authenticated, service_role;

-- ── equipment ─────────────────────────────────────────────────────────────
create table public.equipment (
  id text not null,
  facility_id text,
  tag text,
  type text,
  condition text,
  install_year text,
  repl_cost numeric,
  repl_year text,
  notes text,
  job_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  manufacturer text,
  model text,
  serial text,
  tonnage text,
  filter_size text,
  belt_size text,
  area text,
  refrigerant text,
  pm_frequency text,
  pm_covered boolean default false,
  warranty_expiration date,
  warranty_notes text
);
alter table public.equipment add constraint equipment_pkey PRIMARY KEY (id);
alter table public.equipment enable row level security;
create policy "anon insert" on public.equipment as permissive for insert to public with check (true);
create policy "anon select" on public.equipment as permissive for select to public using (true);
create policy "anon update" on public.equipment as permissive for update to public using (true) with check (true);
grant all on table public.equipment to anon, authenticated, service_role;

-- ── facilities ────────────────────────────────────────────────────────────
create table public.facilities (
  id text not null,
  name text not null,
  address text,
  city text,
  contact text,
  phone text,
  email text,
  contact2 text,
  phone2 text,
  email2 text,
  type text,
  notes text,
  pinned_note text,
  pm_contract boolean default false,
  contract jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  lat double precision,
  lng double precision
);
alter table public.facilities add constraint facilities_pkey PRIMARY KEY (id);
alter table public.facilities enable row level security;
create policy "anon insert" on public.facilities as permissive for insert to public with check (true);
create policy "anon select" on public.facilities as permissive for select to public using (true);
create policy "anon update" on public.facilities as permissive for update to public using (true) with check (true);
grant all on table public.facilities to anon, authenticated, service_role;

-- ── job_units ─────────────────────────────────────────────────────────────
create table public.job_units (
  id text not null,
  job_id text,
  facility_id text,
  tag text,
  type text,
  model text,
  serial text,
  tons numeric,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint
);
alter table public.job_units add constraint job_units_pkey PRIMARY KEY (id);
alter table public.job_units enable row level security;
create policy "anon insert" on public.job_units as permissive for insert to public with check (true);
create policy "anon select" on public.job_units as permissive for select to public using (true);
create policy "anon update" on public.job_units as permissive for update to public using (true) with check (true);
grant all on table public.job_units to anon, authenticated, service_role;

-- ── jobs ──────────────────────────────────────────────────────────────────
create table public.jobs (
  id text not null,
  facility_id text,
  type text,
  name text,
  status text,
  wo_number text,
  value text,
  start_date text,
  end_date text,
  sp_url text,
  notes text,
  agr_type text,
  agr_num text,
  agr_signed text,
  agr_status text,
  agr_url text,
  date text,
  tech text,
  equipment_type text,
  manufacturer text,
  project_number text,
  address text,
  units jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  job_id text,
  po_equip text,
  po_parts text,
  project_id text,
  assigned_pm text,
  apm text,
  superintendent text,
  hidden boolean default false,
  pdf_url text,
  signed_by text,
  signed_title text,
  signature_url text,
  phases jsonb default '[]'::jsonb,
  contacts jsonb default '[]'::jsonb
);
alter table public.jobs add constraint jobs_pkey PRIMARY KEY (id);
alter table public.jobs enable row level security;
create policy "anon insert" on public.jobs as permissive for insert to public with check (true);
create policy "anon select" on public.jobs as permissive for select to public using (true);
create policy "anon update" on public.jobs as permissive for update to public using (true) with check (true);
grant all on table public.jobs to anon, authenticated, service_role;

-- ── model_library ─────────────────────────────────────────────────────────
create table public.model_library (
  id text not null,
  model_key text not null,
  model_raw text,
  manufacturer text,
  tonnage text,
  refrigerant text,
  type text,
  ts bigint
);
alter table public.model_library add constraint model_library_model_key_key UNIQUE (model_key);
alter table public.model_library add constraint model_library_pkey PRIMARY KEY (id);
alter table public.model_library enable row level security;
create policy "Allow anon insert on model_library" on public.model_library as permissive for insert to public with check (true);
create policy "Allow anon select on model_library" on public.model_library as permissive for select to public using (true);
create policy "Allow anon update on model_library" on public.model_library as permissive for update to public using (true);
grant all on table public.model_library to anon, authenticated, service_role;

-- ── notifications ─────────────────────────────────────────────────────────
create table public.notifications (
  id text not null,
  recipient_name text not null,
  message text not null,
  related_id text,
  type text,
  read boolean default false not null,
  ts bigint,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.notifications enable row level security;
create policy "anon full access notifications" on public.notifications as permissive for all to public using (true) with check (true);
grant all on table public.notifications to anon, authenticated, service_role;

-- ── pm_quotes ─────────────────────────────────────────────────────────────
create table public.pm_quotes (
  id text not null,
  facility_id text,
  date text,
  frequency text,
  unit_count integer,
  annual_total text,
  quarterly_rate text,
  monthly_rate text,
  plans jsonb,
  units jsonb,
  renewal_date text,
  agreement_num text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  margin_pct numeric,
  total_cost text,
  gross_margin_dollars text,
  crew jsonb
);
alter table public.pm_quotes add constraint pm_quotes_pkey PRIMARY KEY (id);
alter table public.pm_quotes enable row level security;
create policy "anon insert" on public.pm_quotes as permissive for insert to public with check (true);
create policy "anon select" on public.pm_quotes as permissive for select to public using (true);
create policy "anon update" on public.pm_quotes as permissive for update to public using (true) with check (true);
grant all on table public.pm_quotes to anon, authenticated, service_role;

-- ── pm_records ────────────────────────────────────────────────────────────
create table public.pm_records (
  id text not null,
  facility_id text,
  date text,
  tech text,
  visit_label text,
  unit_count integer,
  good_count integer,
  fair_count integer,
  poor_count integer,
  notes text,
  units jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  pdf_url text
);
alter table public.pm_records add constraint pm_records_pkey PRIMARY KEY (id);
alter table public.pm_records enable row level security;
create policy "anon insert" on public.pm_records as permissive for insert to public with check (true);
create policy "anon select" on public.pm_records as permissive for select to public using (true);
create policy "anon update" on public.pm_records as permissive for update to public using (true) with check (true);
grant all on table public.pm_records to anon, authenticated, service_role;

-- ── pm_unit_results ───────────────────────────────────────────────────────
create table public.pm_unit_results (
  id text not null,
  pm_record_id text,
  facility_id text,
  tag text,
  type text,
  condition text,
  notes text,
  detail jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint
);
alter table public.pm_unit_results add constraint pm_unit_results_pkey PRIMARY KEY (id);
alter table public.pm_unit_results enable row level security;
create policy "anon insert" on public.pm_unit_results as permissive for insert to public with check (true);
create policy "anon select" on public.pm_unit_results as permissive for select to public using (true);
create policy "anon update" on public.pm_unit_results as permissive for update to public using (true) with check (true);
grant all on table public.pm_unit_results to anon, authenticated, service_role;

-- ── service_quotes ────────────────────────────────────────────────────────
create table public.service_quotes (
  id text not null,
  facility_id text,
  date text,
  job_type_id integer,
  items jsonb,
  base_total text,
  tax_total text,
  grand_total text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  pricing_engine text,
  frequency text,
  building_count numeric
);
alter table public.service_quotes add constraint service_quotes_pkey PRIMARY KEY (id);
alter table public.service_quotes enable row level security;
create policy "anon insert" on public.service_quotes as permissive for insert to public with check (true);
create policy "anon select" on public.service_quotes as permissive for select to public using (true);
create policy "anon update" on public.service_quotes as permissive for update to public using (true) with check (true);
grant all on table public.service_quotes to anon, authenticated, service_role;

-- ── service_records ───────────────────────────────────────────────────────
create table public.service_records (
  id text not null,
  ts bigint,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  facility_id text,
  ticket_id text,
  date text,
  tech text,
  arrival_time text,
  departure_time text,
  contact_name text,
  contact_phone text,
  po_number text,
  billing_type text,
  problem_reported text,
  diagnosis text,
  work_performed text,
  parts_used jsonb default '[]'::jsonb,
  units_serviced jsonb default '[]'::jsonb,
  resolution_status text,
  follow_up_note text,
  signed_name text,
  signed_title text,
  signed_date text,
  pdf_url text,
  job_photos jsonb default '[]'::jsonb
);
alter table public.service_records add constraint service_records_pkey PRIMARY KEY (id);
alter table public.service_records enable row level security;
create policy "anon insert service_records" on public.service_records as permissive for insert to anon with check (true);
create policy "anon select service_records" on public.service_records as permissive for select to anon using (true);
create policy "anon update service_records" on public.service_records as permissive for update to anon using (true) with check (true);
grant all on table public.service_records to anon, authenticated, service_role;

-- ── service_tickets ───────────────────────────────────────────────────────
create table public.service_tickets (
  id text not null,
  ts bigint,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ticket_number text,
  facility_id text,
  site_name_raw text,
  contact_name text,
  contact_phone text,
  contact_email text,
  po_number text,
  ticket_type text,
  priority text,
  call_source text,
  billing_type text,
  problem_description text,
  equipment_ids jsonb default '[]'::jsonb,
  status text default 'new'::text,
  requested_date text,
  scheduled_date text,
  time_window text,
  assigned_techs jsonb default '[]'::jsonb,
  dispatched_by text,
  entered_by text,
  dispatcher_notes text,
  linked_job_id text,
  linked_record_id text,
  resolution_summary text,
  follow_up_needed boolean default false,
  follow_up_note text,
  is_declined boolean default false,
  declined_by text,
  declined_reason text,
  source_followup_id text,
  source_followup_tag text,
  source_followup_source text,
  lead_tech text,
  linked_calendar_id text,
  project_id text
);
alter table public.service_tickets add constraint service_tickets_pkey PRIMARY KEY (id);
alter table public.service_tickets enable row level security;
create policy "anon delete service_tickets" on public.service_tickets as permissive for delete to anon using (true);
create policy "anon insert service_tickets" on public.service_tickets as permissive for insert to anon with check (true);
create policy "anon select service_tickets" on public.service_tickets as permissive for select to anon using (true);
create policy "anon update service_tickets" on public.service_tickets as permissive for update to anon using (true) with check (true);
grant all on table public.service_tickets to anon, authenticated, service_role;

-- ── startup_records ───────────────────────────────────────────────────────
create table public.startup_records (
  id text not null,
  facility_id text,
  job_id text,
  unit_num text,
  eq_type text,
  snapshot jsonb,
  notes text,
  followup text,
  sig_name text,
  sig_date text,
  tech text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ts bigint,
  followup_resolved boolean default false,
  pdf_url text
);
alter table public.startup_records add constraint startup_records_pkey PRIMARY KEY (id);
alter table public.startup_records enable row level security;
create policy "anon insert" on public.startup_records as permissive for insert to public with check (true);
create policy "anon select" on public.startup_records as permissive for select to public using (true);
create policy "anon update" on public.startup_records as permissive for update to public using (true) with check (true);
grant all on table public.startup_records to anon, authenticated, service_role;

-- ── team_calendar ─────────────────────────────────────────────────────────
create table public.team_calendar (
  id text not null,
  date date not null,
  entry_type text not null,
  title text not null,
  note text,
  facility_id text,
  entered_by text,
  ts bigint,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  status text default 'confirmed'::text not null,
  assigned_tech text,
  requested_by text,
  requested_by_contact text,
  synced_ticket_id text
);
alter table public.team_calendar add constraint team_calendar_pkey PRIMARY KEY (id);
alter table public.team_calendar enable row level security;
create policy "anon full access team_calendar" on public.team_calendar as permissive for all to public using (true) with check (true);
grant all on table public.team_calendar to anon, authenticated, service_role;

-- ── Foreign keys (added after all tables exist) ─────────────────────────
alter table public.documents add constraint documents_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.equipment add constraint equipment_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.job_units add constraint job_units_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.job_units add constraint job_units_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
alter table public.jobs add constraint jobs_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.pm_quotes add constraint pm_quotes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.pm_records add constraint pm_records_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.pm_unit_results add constraint pm_unit_results_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.pm_unit_results add constraint pm_unit_results_pm_record_id_fkey FOREIGN KEY (pm_record_id) REFERENCES pm_records(id) ON DELETE CASCADE;
alter table public.service_quotes add constraint service_quotes_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.startup_records add constraint startup_records_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE;
alter table public.startup_records add constraint startup_records_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX idx_service_records_facility ON public.service_records USING btree (facility_id);
CREATE INDEX idx_service_records_ticket ON public.service_records USING btree (ticket_id);
CREATE INDEX idx_service_tickets_facility ON public.service_tickets USING btree (facility_id);
CREATE INDEX idx_service_tickets_status ON public.service_tickets USING btree (status);
CREATE INDEX idx_service_tickets_ts ON public.service_tickets USING btree (ts DESC);
CREATE INDEX notifications_recipient_idx ON public.notifications USING btree (recipient_name, read);
CREATE INDEX team_calendar_date_idx ON public.team_calendar USING btree (date);
CREATE INDEX team_calendar_status_idx ON public.team_calendar USING btree (status);

-- ── Storage: ntd-files bucket (private) + access policies ────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('ntd-files', 'ntd-files', false, null, NULL) on conflict (id) do nothing;
create policy "anon storage insert" on storage.objects as permissive for insert to public with check ((bucket_id = 'ntd-files'::text));
create policy "anon storage select" on storage.objects as permissive for select to public using ((bucket_id = 'ntd-files'::text));
create policy "anon storage update" on storage.objects as permissive for update to public using ((bucket_id = 'ntd-files'::text));

commit;
