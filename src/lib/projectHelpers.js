export function normalizeProjectName(project) {
  return project?.projectName || project?.project_name || 'Untitled';
}
