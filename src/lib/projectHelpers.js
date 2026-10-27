export function normalizeProjectName(project) {
  return project?.projectName || project?.project_name || 'Untitled';
}

/* Same road twice: the same name in the same municipality, ignoring case and
 * extra spaces (supabase_fmr_unique_project_name.sql enforces the same rule). */
const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The existing project this name + municipality would duplicate, or null. */
export function findDuplicateProject(projects, name, municipality, excludeId = null) {
  const key = nameKey(name);
  if (!key) return null;
  const town = nameKey(municipality);
  return (projects || []).find((p) => String(p.id) !== String(excludeId)
    && nameKey(p.project_name) === key && nameKey(p.municipality) === town) || null;
}
