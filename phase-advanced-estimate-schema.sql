-- Adds fields for the Advanced Estimate pricing engine (ported from the
-- Excel Advanced PM Bid Worksheet) to service_quotes.
-- Run in the Supabase SQL Editor. Safe to re-run.

ALTER TABLE service_quotes
  ADD COLUMN IF NOT EXISTS pricing_engine text,
  ADD COLUMN IF NOT EXISTS frequency text,
  ADD COLUMN IF NOT EXISTS building_count numeric;
