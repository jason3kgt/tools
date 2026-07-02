-- Remove duplicate equipment records, keeping the most recent per facility+tag combination
DELETE FROM equipment
WHERE id NOT IN (
  SELECT DISTINCT ON (facility_id, tag, type) id
  FROM equipment
  ORDER BY facility_id, tag, type, ts DESC NULLS LAST
);

-- Remove duplicate asset survey jobs, keeping most recent per facility
DELETE FROM jobs
WHERE type = 'asset_survey'
AND id NOT IN (
  SELECT DISTINCT ON (facility_id) id
  FROM jobs
  WHERE type = 'asset_survey'
  ORDER BY facility_id, ts DESC NULLS LAST
);

-- Remove duplicate document records for same file path
DELETE FROM documents
WHERE id NOT IN (
  SELECT DISTINCT ON (facility_id, form_type, date) id
  FROM documents
  ORDER BY facility_id, form_type, date, ts DESC NULLS LAST
);
