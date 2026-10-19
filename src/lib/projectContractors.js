/*
 * projectContractors.js — the contractor's name for an FMR project, for the
 * public project details (landing page, citizen and farmer portals).
 *
 * Names come from the public_project_contractors() database function
 * (supabase_public_project_contractors.sql), which returns only the project id
 * and contractor name. Loaded once and shared by every dialog; a project with
 * no contractor simply has no entry. If the function isn't installed yet, no
 * contractor row is shown.
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

let request = null;

function loadContractors() {
  if (!request) {
    request = supabase.rpc('public_project_contractors').then(({ data, error }) => {
      if (error) {
        request = null; // try again next time (e.g. after the SQL is run)
        return new Map();
      }
      return new Map((data || []).map((row) => [String(row.project_id), row.contractor_name]));
    }, () => {
      request = null;
      return new Map();
    });
  }
  return request;
}

/** The contractor's name for the project, or null (none assigned / not loaded yet). */
export function useProjectContractor(projectId) {
  const [names, setNames] = useState(null);
  useEffect(() => {
    let alive = true;
    loadContractors().then((map) => { if (alive) setNames(map); });
    return () => { alive = false; };
  }, []);
  if (!names || projectId === null || projectId === undefined) return null;
  return names.get(String(projectId)) || null;
}
