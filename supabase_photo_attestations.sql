-- ============================================================
-- Tamper-evident geotagged photos (DA PRDP-style).
--
-- The DA's PRDP geotagging camera stamps each photo with a watermark and a
-- unique code carrying time, date and location taken from GPS, and a DA-only
-- scanner confirms the geotag, because contractors were altering phone clocks
-- and photo metadata (GMA News, 10 June 2014).
--
-- KalsaTrack does the same for every geotagged photo it captures:
--   1. the app stamps the photo with date/time, GPS, project, a random
--      12-character code and a QR code linking to /verify/<code>;
--   2. it fingerprints the stamped photo (SHA-256) and registers the code here;
--      the SERVER records registered_at, so a changed phone clock shows up;
--   3. scanning the QR opens /verify/<code>, which shows this record and the
--      original stored photo, and can check whether a given file is identical.
--
-- Rows are written and read only through the two functions below.
-- Safe to re-run.
-- ============================================================

create table if not exists public.photo_attestations (
  code            text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  kind            text not null check (kind in ('citizen_report', 'field_inspection', 'repair_verification', 'contractor_progress')),
  record_id       text,
  label           text,
  storage_bucket  text,
  storage_path    text,
  latitude        double precision,
  longitude       double precision,
  accuracy_m      double precision,
  captured_at     timestamptz,                       -- the device's clock (can be wrong or altered)
  registered_at   timestamptz not null default now(),-- the server's clock
  registered_by   uuid default auth.uid()
);

create index if not exists photo_attestations_record_idx on public.photo_attestations (kind, record_id);

alter table public.photo_attestations enable row level security;
-- No policies: nobody reads or writes the table directly.

-- Register a stamped photo. A code can be registered once; re-registering the
-- same code with the same fingerprint is a no-op (offline retries are safe).
create or replace function public.register_photo_attestation(
  p_code text,
  p_sha256 text,
  p_kind text,
  p_record_id text default null,
  p_label text default null,
  p_storage_bucket text default null,
  p_storage_path text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null,
  p_captured_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  select sha256 into v_existing from public.photo_attestations where code = upper(p_code);
  if found then
    if v_existing <> lower(p_sha256) then
      raise exception 'This verification code is already registered to a different photo';
    end if;
    -- Same photo retried: fill in the record link if it was missing.
    update public.photo_attestations
       set record_id = coalesce(record_id, p_record_id),
           storage_path = coalesce(storage_path, p_storage_path)
     where code = upper(p_code);
    return;
  end if;

  insert into public.photo_attestations (
    code, sha256, kind, record_id, label, storage_bucket, storage_path,
    latitude, longitude, accuracy_m, captured_at
  ) values (
    upper(p_code), lower(p_sha256), p_kind, p_record_id, left(p_label, 200), p_storage_bucket, p_storage_path,
    p_latitude, p_longitude, p_accuracy_m, p_captured_at
  );
end;
$$;

-- Public lookup used by /verify/<code>. Returns no names or account ids.
create or replace function public.verify_photo_attestation(p_code text)
returns table (
  code text,
  sha256 text,
  kind text,
  label text,
  storage_bucket text,
  storage_path text,
  latitude double precision,
  longitude double precision,
  accuracy_m double precision,
  captured_at timestamptz,
  registered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.code, a.sha256, a.kind, a.label,
         a.storage_bucket,
         -- Only photos in public buckets are shown on the open verify page.
         case when a.storage_bucket = 'public-report-photos' then a.storage_path end,
         a.latitude, a.longitude, a.accuracy_m, a.captured_at, a.registered_at
  from public.photo_attestations a
  where a.code = upper(btrim(p_code));
$$;

revoke all on function public.register_photo_attestation(text, text, text, text, text, text, text, double precision, double precision, double precision, timestamptz) from public;
grant execute on function public.register_photo_attestation(text, text, text, text, text, text, text, double precision, double precision, double precision, timestamptz) to anon, authenticated;
revoke all on function public.verify_photo_attestation(text) from public;
grant execute on function public.verify_photo_attestation(text) to anon, authenticated;
