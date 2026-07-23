// Category/status color conventions for the Project Scheduling feature
// (Project Management -> Timeline tab). Single source of truth shared by
// the Calendar, Gantt, and Table views so colors never drift between them.

export const CATEGORY_STYLES = {
  mobilization: {
    label: 'Mobilization',
    swatch: 'bg-green-500',
    chip: 'bg-green-50 text-green-700 border-green-200',
    line: '#22c55e',
  },
  earthworks: {
    label: 'Earthworks',
    swatch: 'bg-teal-500',
    chip: 'bg-teal-50 text-teal-700 border-teal-200',
    line: '#14b8a6',
  },
  subbase_base: {
    label: 'Subbase / Base',
    swatch: 'bg-blue-500',
    chip: 'bg-blue-50 text-blue-700 border-blue-200',
    line: '#3b82f6',
  },
  surface_course: {
    label: 'Surface Course',
    swatch: 'bg-purple-500',
    chip: 'bg-purple-50 text-purple-700 border-purple-200',
    line: '#a855f7',
  },
  bridge_works: {
    label: 'Bridge Works',
    swatch: 'bg-orange-500',
    chip: 'bg-orange-50 text-orange-700 border-orange-200',
    line: '#f97316',
  },
  general_requirements: {
    label: 'General Requirements',
    swatch: 'bg-slate-400',
    chip: 'bg-slate-100 text-slate-600 border-slate-200',
    line: '#94a3b8',
  },
};

export const MILESTONE_STYLE = {
  label: 'Milestones',
  swatch: 'bg-amber-500',
  chip: 'bg-amber-50 text-amber-700 border-amber-200',
  line: '#f59e0b',
};

export const SUSPENDED_STYLE = {
  label: 'Suspended',
  swatch: 'bg-red-500',
  chip: 'bg-red-50 text-red-700 border-red-200',
  line: '#ef4444',
};

export function getCategoryStyle(category) {
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.general_requirements;
}

// Task-scoped delayed check for the Project Scheduling feature only.
// Deliberately independent of isOverdueProject (mapRouteUtils.js) and the
// local isPastDate/classifiedFmrProjects in Dashboard.jsx -- same
// "midnight-normalized planned_end vs. today" style, third scope.
export function isTaskDelayed(task) {
  if (!task?.planned_end) return false;
  if (task.status === 'completed' || task.status === 'suspended') return false;
  const end = new Date(task.planned_end);
  if (Number.isNaN(end.getTime())) return false;
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}
