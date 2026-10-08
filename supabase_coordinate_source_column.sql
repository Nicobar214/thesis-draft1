-- ============================================================
-- KalsaTrack - Record where a project's coordinates came from
--
-- WHY: the maps decided whether a project's location was approximate by doing
-- `remarks.includes('auto-geocoded')` -- string-matching a free-text column that
-- DA staff use for their own notes. To make that work, the background geocoder
-- appended "(Auto-geocoded to Barangay center)" to every row it touched, so
-- machine output ended up mixed into human records and shown in the UI.
--
-- Provenance now lives in its own column. `remarks` goes back to being notes.
-- ============================================================

ALTER TABLE public.fmr_projects
  ADD COLUMN IF NOT EXISTS coordinate_source TEXT;

COMMENT ON COLUMN public.fmr_projects.coordinate_source IS
  'How start/end coordinates were obtained: da-records (supplied by DA-RAED), '
  'nominatim-barangay (geocoded to the barangay centre, approximate), '
  'osm-local-graph (derived from a surveyed route), or NULL when unknown.';

-- Backfill from the marker the geocoder used to leave in remarks.
UPDATE public.fmr_projects
SET coordinate_source = 'nominatim-barangay'
WHERE coordinate_source IS NULL
  AND remarks ILIKE '%auto-geocoded%';

-- Projects whose geometry came from the OSM route generator are not approximate.
UPDATE public.fmr_projects AS p
SET coordinate_source = r.route_source
FROM public.project_routes AS r
WHERE p.id = r.project_id
  AND r.route_source IS NOT NULL
  AND (p.coordinate_source IS NULL OR p.coordinate_source = 'nominatim-barangay');

-- Anything else that has coordinates came from the DA's own records.
UPDATE public.fmr_projects
SET coordinate_source = 'da-records'
WHERE coordinate_source IS NULL
  AND start_latitude IS NOT NULL
  AND start_longitude IS NOT NULL;

-- Strip the machine-written marker back out of remarks, preserving any real note
-- that was written alongside it.
UPDATE public.fmr_projects
SET remarks = NULLIF(
  btrim(
    regexp_replace(
      remarks,
      '\s*\(?Auto-geocoded to Barangay center\)?\.?',
      '',
      'gi'
    )
  ),
  ''
)
WHERE remarks ILIKE '%auto-geocoded%';

-- Verification: expect zero rows still carrying the marker, and a sensible spread
-- across the provenance values.
-- SELECT coordinate_source, count(*) FROM public.fmr_projects GROUP BY 1 ORDER BY 2 DESC;
-- SELECT count(*) FROM public.fmr_projects WHERE remarks ILIKE '%auto-geocoded%';
