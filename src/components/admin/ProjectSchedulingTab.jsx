import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import {
  CATEGORY_STYLES,
  MILESTONE_STYLE,
  SUSPENDED_STYLE,
  getCategoryStyle,
  isTaskDelayed,
} from '../../lib/scheduleUtils';

const CATEGORY_OPTIONS = Object.keys(CATEGORY_STYLES);
const TASK_STATUS_OPTIONS = ['not_started', 'in_progress', 'completed', 'delayed', 'suspended'];

function InfoCard({ label, value, helper }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1.5 text-base font-semibold text-slate-900">{value ?? 'N/A'}</p>
      {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </div>
  );
}

function CloseButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
      <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
}

function monthKey(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function buildMonthRange(tasks, milestones, suspensions) {
  const dates = [];
  tasks.forEach((t) => { dates.push(safeDate(t.planned_start)); dates.push(safeDate(t.planned_end)); });
  milestones.forEach((m) => dates.push(safeDate(m.milestone_date)));
  suspensions.forEach((s) => { dates.push(safeDate(s.suspension_start)); dates.push(safeDate(s.suspension_end) || new Date()); });
  const valid = dates.filter(Boolean);
  if (valid.length === 0) {
    const now = new Date();
    return [{ year: now.getFullYear(), month: now.getMonth() }];
  }
  const min = new Date(Math.min(...valid.map((d) => d.getTime())));
  const max = new Date(Math.max(...valid.map((d) => d.getTime())));
  const months = [];
  const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth(), 1);
  while (cursor <= end) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function monthIndexOf(months, date) {
  const d = safeDate(date);
  if (!d) return -1;
  return months.findIndex((m) => m.year === d.getFullYear() && m.month === d.getMonth());
}

function resolveProfileName(profiles, id) {
  if (!id) return 'Unassigned';
  const p = (profiles || []).find((c) => c.id === id);
  if (!p) return String(id).slice(0, 8);
  return p.full_name || p.email || String(id).slice(0, 8);
}

const emptyTaskForm = {
  task_name: '', category: 'mobilization', sequence_order: '0',
  planned_start: '', planned_end: '', duration_cd: '', assigned_to: '', status: 'not_started', remarks: '',
};
const emptyMilestoneForm = {
  milestone_name: '', milestone_date: '', contract_days_at_point: '', approved_by: '', remarks: '',
};
const emptySuspensionForm = {
  suspension_start: '', suspension_end: '', reason: '', time_extension_ref: '',
};

export default function ProjectSchedulingTab({ fmrProjects, contractors, progressUpdates, showNotification }) {
  const [projectSearch, setProjectSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [view, setView] = useState('calendar');

  const [tasks, setTasks] = useState([]);
  const [milestones, setMilestones] = useState([]);
  const [suspensions, setSuspensions] = useState([]);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState(null); // { type, record }
  const [taskForm, setTaskForm] = useState(null); // null closed, {} new, record editing
  const [milestoneForm, setMilestoneForm] = useState(null);
  const [suspensionForm, setSuspensionForm] = useState(null);

  const [taskStatusFilter, setTaskStatusFilter] = useState('All');
  const [taskAssignedFilter, setTaskAssignedFilter] = useState('All');
  const [taskDateFrom, setTaskDateFrom] = useState('');
  const [taskDateTo, setTaskDateTo] = useState('');

  const notifiedTaskIds = useRef(new Set());

  const fetchTasks = useCallback(async () => {
    const { data, error } = await supabase.from('project_tasks').select('*').order('sequence_order', { ascending: true });
    if (!error) setTasks(data || []);
  }, []);
  const fetchMilestones = useCallback(async () => {
    const { data, error } = await supabase.from('project_milestones').select('*').order('milestone_date', { ascending: true });
    if (!error) setMilestones(data || []);
  }, []);
  const fetchSuspensions = useCallback(async () => {
    const { data, error } = await supabase.from('project_suspensions').select('*').order('suspension_start', { ascending: true });
    if (!error) setSuspensions(data || []);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchTasks(), fetchMilestones(), fetchSuspensions()]).finally(() => setLoading(false));

    const channel = supabase
      .channel('admin-scheduling-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_tasks' }, fetchTasks)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_milestones' }, fetchMilestones)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_suspensions' }, fetchSuspensions)
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [fetchTasks, fetchMilestones, fetchSuspensions]);

  // Notify admins once per session when a task is first observed as delayed.
  useEffect(() => {
    const delayed = tasks.filter((t) => isTaskDelayed(t) && !notifiedTaskIds.current.has(t.id));
    if (delayed.length === 0) return;
    delayed.forEach((t) => notifiedTaskIds.current.add(t.id));

    (async () => {
      try {
        const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
        if (!Array.isArray(admins) || admins.length === 0) return;
        const rows = [];
        delayed.forEach((t) => {
          const project = fmrProjects.find((p) => p.id === t.project_id);
          admins.forEach((a) => rows.push({
            user_id: a.id,
            type: 'schedule_task_delayed',
            title: 'Project task delayed',
            message: `"${t.task_name}" for ${project?.project_name || 'a project'} is past its planned end date (${t.planned_end}).`,
            schedule_task_id: t.id,
            is_read: false,
            created_at: new Date().toISOString(),
          }));
        });
        if (rows.length > 0) await supabase.from('notifications').insert(rows);
      } catch {
        // Non-critical -- keep the schedule view working if notifications fail.
      }
    })();
  }, [tasks, fmrProjects]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return fmrProjects || [];
    return (fmrProjects || []).filter((p) =>
      String(p.project_name || '').toLowerCase().includes(q) ||
      String(p.municipality || '').toLowerCase().includes(q)
    );
  }, [fmrProjects, projectSearch]);

  const selectedProject = useMemo(
    () => (fmrProjects || []).find((p) => p.id === selectedProjectId) || null,
    [fmrProjects, selectedProjectId]
  );

  const projectTasks = useMemo(() => tasks.filter((t) => t.project_id === selectedProjectId), [tasks, selectedProjectId]);
  const projectMilestones = useMemo(() => milestones.filter((m) => m.project_id === selectedProjectId), [milestones, selectedProjectId]);
  const projectSuspensions = useMemo(() => suspensions.filter((s) => s.project_id === selectedProjectId), [suspensions, selectedProjectId]);

  const categorizedTasks = useMemo(
    () => projectTasks.filter((t) => t.category !== 'general_requirements'),
    [projectTasks]
  );
  const generalReqTasks = useMemo(
    () => projectTasks.filter((t) => t.category === 'general_requirements'),
    [projectTasks]
  );

  const months = useMemo(
    () => buildMonthRange(projectTasks, projectMilestones, projectSuspensions),
    [projectTasks, projectMilestones, projectSuspensions]
  );

  const latestProgress = useCallback((projectId) => {
    const matches = (progressUpdates || []).filter((u) => u.fmr_project_id === projectId);
    if (matches.length === 0) return null;
    return [...matches].sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];
  }, [progressUpdates]);

  const filteredTableTasks = useMemo(() => {
    return projectTasks.filter((t) => {
      if (taskStatusFilter !== 'All' && t.status !== taskStatusFilter) return false;
      if (taskAssignedFilter !== 'All' && t.assigned_to !== taskAssignedFilter) return false;
      if (taskDateFrom && t.planned_start < taskDateFrom) return false;
      if (taskDateTo && t.planned_end > taskDateTo) return false;
      return true;
    });
  }, [projectTasks, taskStatusFilter, taskAssignedFilter, taskDateFrom, taskDateTo]);

  const submitTaskForm = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const payload = {
      project_id: selectedProjectId,
      task_name: taskForm.task_name.trim(),
      category: taskForm.category,
      sequence_order: parseInt(taskForm.sequence_order) || 0,
      planned_start: taskForm.planned_start,
      planned_end: taskForm.planned_end,
      duration_cd: parseInt(taskForm.duration_cd) || 0,
      assigned_to: taskForm.assigned_to || null,
      status: taskForm.status,
      remarks: taskForm.remarks || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (taskForm.id) {
        const { error } = await supabase.from('project_tasks').update(payload).eq('id', taskForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_tasks').insert(payload);
        if (error) throw error;
      }
      await fetchTasks();
      setTaskForm(null);
      showNotification('Task saved.');
    } catch (err) {
      showNotification(`Failed to save task: ${err.message}`, 'error');
    }
  };

  const submitMilestoneForm = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const payload = {
      project_id: selectedProjectId,
      milestone_name: milestoneForm.milestone_name.trim(),
      milestone_date: milestoneForm.milestone_date,
      contract_days_at_point: milestoneForm.contract_days_at_point ? parseInt(milestoneForm.contract_days_at_point) : null,
      approved_by: milestoneForm.approved_by || null,
      remarks: milestoneForm.remarks || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (milestoneForm.id) {
        const { error } = await supabase.from('project_milestones').update(payload).eq('id', milestoneForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_milestones').insert(payload);
        if (error) throw error;
      }
      await fetchMilestones();
      setMilestoneForm(null);
      showNotification('Milestone saved.');
    } catch (err) {
      showNotification(`Failed to save milestone: ${err.message}`, 'error');
    }
  };

  const submitSuspensionForm = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    const payload = {
      project_id: selectedProjectId,
      suspension_start: suspensionForm.suspension_start,
      suspension_end: suspensionForm.suspension_end || null,
      reason: suspensionForm.reason.trim(),
      time_extension_ref: suspensionForm.time_extension_ref || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (suspensionForm.id) {
        const { error } = await supabase.from('project_suspensions').update(payload).eq('id', suspensionForm.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('project_suspensions').insert(payload);
        if (error) throw error;
      }
      await fetchSuspensions();
      setSuspensionForm(null);
      showNotification('Suspension saved.');
    } catch (err) {
      showNotification(`Failed to save suspension: ${err.message}`, 'error');
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="space-y-4">
        <ProjectPicker
          projectSearch={projectSearch}
          setProjectSearch={setProjectSearch}
          filteredProjects={filteredProjects}
          onSelect={setSelectedProjectId}
        />
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-lg font-semibold text-slate-800">No Project Selected</p>
          <p className="text-sm text-slate-500 mt-2">Search and select an FMR project above to view or edit its schedule.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold text-teal-900">{selectedProject?.project_name || 'Unknown project'}</p>
            <p className="text-xs text-teal-600">{selectedProject?.municipality}</p>
          </div>
          <button type="button" onClick={() => setSelectedProjectId(null)} className="text-xs font-semibold text-teal-700 hover:underline">
            Change project
          </button>
        </div>

        <div className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit">
          {[
            { id: 'calendar', label: 'Calendar' },
            { id: 'gantt', label: 'Gantt' },
            { id: 'table', label: 'Table' },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${view === v.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            const nextSequence = projectTasks.reduce((max, t) => Math.max(max, t.sequence_order || 0), 0) + 1;
            setTaskForm({ ...emptyTaskForm, sequence_order: String(nextSequence) });
          }}
          className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold"
        >
          + Task
        </button>
        <button type="button" onClick={() => setMilestoneForm({ ...emptyMilestoneForm })} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold">
          + Milestone
        </button>
        <button type="button" onClick={() => setSuspensionForm({ ...emptySuspensionForm })} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold">
          + Suspension
        </button>
      </div>

      <CategoryLegend />

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading schedule...</div>
      ) : view === 'calendar' ? (
        <CalendarView
          months={months}
          categorizedTasks={categorizedTasks}
          generalReqTasks={generalReqTasks}
          milestones={projectMilestones}
          suspensions={projectSuspensions}
          contractors={contractors}
          onOpenDetail={setDetail}
        />
      ) : view === 'gantt' ? (
        <GanttView months={months} tasks={projectTasks} onOpenDetail={setDetail} />
      ) : (
        <TableView
          tasks={filteredTableTasks}
          contractors={contractors}
          statusFilter={taskStatusFilter}
          setStatusFilter={setTaskStatusFilter}
          assignedFilter={taskAssignedFilter}
          setAssignedFilter={setTaskAssignedFilter}
          dateFrom={taskDateFrom}
          setDateFrom={setTaskDateFrom}
          dateTo={taskDateTo}
          setDateTo={setTaskDateTo}
          onOpenDetail={setDetail}
          onEdit={setTaskForm}
        />
      )}

      {detail && (
        <ScheduleDetailModal
          detail={detail}
          contractors={contractors}
          latestProgress={detail.type === 'task' ? latestProgress(selectedProjectId) : null}
          onClose={() => setDetail(null)}
          onEdit={() => {
            if (detail.type === 'task') setTaskForm(detail.record);
            if (detail.type === 'milestone') setMilestoneForm(detail.record);
            if (detail.type === 'suspension') setSuspensionForm(detail.record);
            setDetail(null);
          }}
        />
      )}

      {taskForm && (
        <TaskFormModal form={taskForm} setForm={setTaskForm} contractors={contractors} onSubmit={submitTaskForm} onClose={() => setTaskForm(null)} />
      )}
      {milestoneForm && (
        <MilestoneFormModal form={milestoneForm} setForm={setMilestoneForm} contractors={contractors} onSubmit={submitMilestoneForm} onClose={() => setMilestoneForm(null)} />
      )}
      {suspensionForm && (
        <SuspensionFormModal form={suspensionForm} setForm={setSuspensionForm} onSubmit={submitSuspensionForm} onClose={() => setSuspensionForm(null)} />
      )}
    </div>
  );
}

function ProjectPicker({ projectSearch, setProjectSearch, filteredProjects, onSelect }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <label className="block text-xs font-semibold text-slate-700 mb-2">Search FMR Project</label>
      <input
        type="text"
        value={projectSearch}
        onChange={(e) => setProjectSearch(e.target.value)}
        placeholder="Search by project name or municipality..."
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none"
      />
      <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
        {filteredProjects.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No projects match your search.</p>
        ) : (
          filteredProjects.slice(0, 50).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <p className="text-sm font-semibold text-slate-900">{p.project_name}</p>
              <p className="text-xs text-slate-500">{p.municipality} &middot; {p.status}</p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function CategoryLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORY_OPTIONS.map((cat) => (
        <span key={cat} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${CATEGORY_STYLES[cat].chip}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_STYLES[cat].swatch}`} />
          {CATEGORY_STYLES[cat].label}
        </span>
      ))}
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${MILESTONE_STYLE.chip}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${MILESTONE_STYLE.swatch}`} /> {MILESTONE_STYLE.label}
      </span>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${SUSPENDED_STYLE.chip}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${SUSPENDED_STYLE.swatch}`} /> {SUSPENDED_STYLE.label}
      </span>
    </div>
  );
}

function CalendarView({ months, categorizedTasks, generalReqTasks, milestones, suspensions, contractors, onOpenDetail }) {
  const gridStyle = { display: 'grid', gridTemplateColumns: `repeat(${months.length}, minmax(160px, 1fr))` };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto space-y-3">
      {/* Month header */}
      <div style={gridStyle} className="gap-2">
        {months.map((m) => (
          <div key={monthKey(m.year, m.month)} className="text-xs font-bold text-slate-600 text-center pb-2 border-b border-slate-200">
            {monthLabel(m.year, m.month)}
          </div>
        ))}
      </div>

      {/* Suspension banners -- full width, never interleaved with task cards */}
      {suspensions.map((s) => {
        const startIdx = Math.max(monthIndexOf(months, s.suspension_start), 0);
        const endIdx = s.suspension_end ? monthIndexOf(months, s.suspension_end) : months.length - 1;
        const span = Math.max(endIdx, startIdx) - startIdx + 1;
        return (
          <div key={s.id} style={gridStyle} className="gap-2">
            <button
              type="button"
              onClick={() => onOpenDetail({ type: 'suspension', record: s })}
              style={{ gridColumn: `${startIdx + 1} / span ${span}` }}
              className={`text-left rounded-lg border px-3 py-2 text-xs font-semibold ${SUSPENDED_STYLE.chip}`}
            >
              🚫 Suspended{s.time_extension_ref ? ` (${s.time_extension_ref})` : ''} — {s.reason}
            </button>
          </div>
        );
      })}

      {/* General requirements banners -- also full width, run for the whole duration */}
      {generalReqTasks.map((t) => {
        const startIdx = Math.max(monthIndexOf(months, t.planned_start), 0);
        const endIdx = Math.max(monthIndexOf(months, t.planned_end), startIdx);
        const span = endIdx - startIdx + 1;
        return (
          <div key={t.id} style={gridStyle} className="gap-2">
            <button
              type="button"
              onClick={() => onOpenDetail({ type: 'task', record: t })}
              style={{ gridColumn: `${startIdx + 1} / span ${span}` }}
              className={`text-left rounded-lg border px-3 py-2 text-xs font-semibold ${CATEGORY_STYLES.general_requirements.chip}`}
            >
              {t.task_name}
            </button>
          </div>
        );
      })}

      {/* Milestone markers */}
      {milestones.length > 0 && (
        <div style={gridStyle} className="gap-2">
          {months.map((m) => {
            const inMonth = milestones.filter((ms) => {
              const d = safeDate(ms.milestone_date);
              return d && d.getFullYear() === m.year && d.getMonth() === m.month;
            });
            return (
              <div key={monthKey(m.year, m.month)} className="space-y-1">
                {inMonth.map((ms) => (
                  <button
                    key={ms.id}
                    type="button"
                    onClick={() => onOpenDetail({ type: 'milestone', record: ms })}
                    className={`w-full text-left rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${MILESTONE_STYLE.chip}`}
                  >
                    ◆ {ms.milestone_name} — {ms.milestone_date}{ms.contract_days_at_point ? ` (${ms.contract_days_at_point} CD)` : ''}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Per-month categorized task cards */}
      <div style={gridStyle} className="gap-2 items-start">
        {months.map((m) => {
          const inMonth = categorizedTasks.filter((t) => monthIndexOf(months, t.planned_start) === months.indexOf(m));
          return (
            <div key={monthKey(m.year, m.month)} className="space-y-1.5 min-h-[3rem]">
              {inMonth.map((t) => {
                const style = getCategoryStyle(t.category);
                const delayed = isTaskDelayed(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onOpenDetail({ type: 'task', record: t })}
                    className={`w-full text-left rounded-lg border px-2 py-1.5 text-[11px] ${style.chip} ${delayed ? 'ring-2 ring-red-400' : ''}`}
                  >
                    <p className="font-semibold truncate">{t.task_name}</p>
                    <p className="text-[10px] opacity-80 truncate">{resolveProfileName(contractors, t.assigned_to)}</p>
                    {delayed && <p className="text-[10px] font-bold text-red-600">Delayed</p>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GanttView({ months, tasks, onOpenDetail }) {
  const gridStyle = { display: 'grid', gridTemplateColumns: `repeat(${months.length}, minmax(120px, 1fr))` };
  const ordered = [...tasks].sort((a, b) => (a.sequence_order || 0) - (b.sequence_order || 0));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto space-y-2">
      <div style={gridStyle} className="gap-2">
        {months.map((m) => (
          <div key={monthKey(m.year, m.month)} className="text-xs font-bold text-slate-600 text-center pb-2 border-b border-slate-200">
            {monthLabel(m.year, m.month)}
          </div>
        ))}
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No tasks yet for this project.</p>
      ) : (
        ordered.map((t) => {
          const startIdx = Math.max(monthIndexOf(months, t.planned_start), 0);
          const endIdx = Math.max(monthIndexOf(months, t.planned_end), startIdx);
          const span = endIdx - startIdx + 1;
          const style = getCategoryStyle(t.category);
          const delayed = isTaskDelayed(t);
          return (
            <div key={t.id} style={gridStyle} className="gap-2 items-center">
              <button
                type="button"
                onClick={() => onOpenDetail({ type: 'task', record: t })}
                style={{ gridColumn: `${startIdx + 1} / span ${span}`, backgroundColor: style.line }}
                className={`text-left rounded-lg px-3 py-2 text-[11px] font-semibold text-white ${delayed ? 'ring-2 ring-red-500' : ''}`}
              >
                {t.task_name} ({t.duration_cd} CD)
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function TableView({ tasks, contractors, statusFilter, setStatusFilter, assignedFilter, setAssignedFilter, dateFrom, setDateFrom, dateTo, setDateTo, onOpenDetail, onEdit }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="All">All Statuses</option>
          {TASK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={assignedFilter} onChange={(e) => setAssignedFilter(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <option value="All">All Assignees</option>
          {(contractors || []).map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
              <th className="py-2 pr-3">Task</th>
              <th className="py-2 pr-3">Category</th>
              <th className="py-2 pr-3">Assigned To</th>
              <th className="py-2 pr-3">Start</th>
              <th className="py-2 pr-3">End</th>
              <th className="py-2 pr-3">CD</th>
              <th className="py-2 pr-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.length === 0 ? (
              <tr><td colSpan={7} className="py-6 text-center text-slate-500">No tasks match the current filters.</td></tr>
            ) : (
              tasks.map((t) => {
                const style = getCategoryStyle(t.category);
                const delayed = isTaskDelayed(t);
                return (
                  <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpenDetail({ type: 'task', record: t })}>
                    <td className="py-2 pr-3 font-medium text-slate-900">{t.task_name}</td>
                    <td className="py-2 pr-3"><span className={`px-2 py-0.5 rounded-full text-xs border ${style.chip}`}>{style.label}</span></td>
                    <td className="py-2 pr-3">{resolveProfileName(contractors, t.assigned_to)}</td>
                    <td className="py-2 pr-3">{t.planned_start}</td>
                    <td className="py-2 pr-3">{t.planned_end}</td>
                    <td className="py-2 pr-3">{t.duration_cd}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${delayed ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                        {delayed ? 'Delayed' : t.status.replace(/_/g, ' ')}
                      </span>
                      <button type="button" onClick={(e) => { e.stopPropagation(); onEdit(t); }} className="ml-2 text-xs font-semibold text-teal-600 hover:underline">Edit</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScheduleDetailModal({ detail, contractors, latestProgress, onClose, onEdit }) {
  const { type, record } = detail;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {type === 'task' ? 'Task' : type === 'milestone' ? 'Milestone' : 'Suspension'}
          </p>
          <CloseButton onClick={onClose} />
        </div>
        <div className="p-6 space-y-4">
          {type === 'task' && (
            <>
              <h3 className="text-lg font-bold text-slate-900">{record.task_name}</h3>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Category" value={getCategoryStyle(record.category).label} />
                <InfoCard label="Status" value={isTaskDelayed(record) ? 'Delayed' : record.status.replace(/_/g, ' ')} />
                <InfoCard label="Planned Start" value={record.planned_start} />
                <InfoCard label="Planned End" value={record.planned_end} />
                <InfoCard label="Duration" value={`${record.duration_cd} CD`} />
                <InfoCard label="Assigned To" value={resolveProfileName(contractors, record.assigned_to)} />
              </div>
              {latestProgress && (
                <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
                  <p className="text-xs font-semibold uppercase text-teal-700">Actual Reported Progress</p>
                  <p className="text-sm text-teal-900 mt-1">{latestProgress.reported_accomplishment}% as of {new Date(latestProgress.submitted_at).toLocaleDateString()}</p>
                </div>
              )}
              {record.remarks && <p className="text-sm text-slate-600">{record.remarks}</p>}
            </>
          )}
          {type === 'milestone' && (
            <>
              <h3 className="text-lg font-bold text-slate-900">{record.milestone_name}</h3>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Date" value={record.milestone_date} />
                <InfoCard label="Contract Days" value={record.contract_days_at_point ? `${record.contract_days_at_point} CD` : 'N/A'} />
                <InfoCard label="Approved By" value={resolveProfileName(contractors, record.approved_by)} />
              </div>
              {record.remarks && <p className="text-sm text-slate-600">{record.remarks}</p>}
            </>
          )}
          {type === 'suspension' && (
            <>
              <h3 className="text-lg font-bold text-slate-900">Suspension</h3>
              <div className="grid grid-cols-2 gap-3">
                <InfoCard label="Start" value={record.suspension_start} />
                <InfoCard label="End" value={record.suspension_end || 'Ongoing'} />
                <InfoCard label="Time Extension Ref" value={record.time_extension_ref || 'N/A'} />
              </div>
              <p className="text-sm text-slate-600">{record.reason}</p>
            </>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button>
          <button type="button" onClick={onEdit} className="rounded-xl bg-teal-600 hover:bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white">Edit</button>
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({ form, setForm, contractors, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">{form.id ? 'Edit Task' : 'New Task'}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-3">
          <input required value={form.task_name} onChange={(e) => setForm((c) => ({ ...c, task_name: e.target.value }))} placeholder="Task name *" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_STYLES[c].label}</option>)}
            </select>
            <select value={form.status} onChange={(e) => setForm((c) => ({ ...c, status: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {TASK_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Planned Start *</label>
              <input required type="date" value={form.planned_start} onChange={(e) => setForm((c) => ({ ...c, planned_start: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Planned End *</label>
              <input required type="date" value={form.planned_end} onChange={(e) => setForm((c) => ({ ...c, planned_end: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="number" min="0" value={form.duration_cd} onChange={(e) => setForm((c) => ({ ...c, duration_cd: e.target.value }))} placeholder="Duration (CD)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <input type="number" value={form.sequence_order} onChange={(e) => setForm((c) => ({ ...c, sequence_order: e.target.value }))} placeholder="Sequence order" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          </div>
          <select value={form.assigned_to} onChange={(e) => setForm((c) => ({ ...c, assigned_to: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Unassigned</option>
            {(contractors || []).map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email}</option>)}
          </select>
          <textarea value={form.remarks} onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))} rows={2} placeholder="Remarks" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" className="rounded-xl bg-teal-600 hover:bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white">Save Task</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MilestoneFormModal({ form, setForm, contractors, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">{form.id ? 'Edit Milestone' : 'New Milestone'}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-3">
          <input required value={form.milestone_name} onChange={(e) => setForm((c) => ({ ...c, milestone_name: e.target.value }))} placeholder="Milestone label * (e.g. Original target completion)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date *</label>
              <input required type="date" value={form.milestone_date} onChange={(e) => setForm((c) => ({ ...c, milestone_date: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <input type="number" min="0" value={form.contract_days_at_point} onChange={(e) => setForm((c) => ({ ...c, contract_days_at_point: e.target.value }))} placeholder="Contract days (CD)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm self-end" />
          </div>
          <select value={form.approved_by} onChange={(e) => setForm((c) => ({ ...c, approved_by: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">Approved by...</option>
            {(contractors || []).map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email}</option>)}
          </select>
          <textarea value={form.remarks} onChange={(e) => setForm((c) => ({ ...c, remarks: e.target.value }))} rows={2} placeholder="Remarks" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" className="rounded-xl bg-amber-600 hover:bg-amber-700 px-5 py-2.5 text-sm font-semibold text-white">Save Milestone</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SuspensionFormModal({ form, setForm, onSubmit, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h3 className="text-lg font-bold text-slate-900">{form.id ? 'Edit Suspension' : 'New Suspension'}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start *</label>
              <input required type="date" value={form.suspension_start} onChange={(e) => setForm((c) => ({ ...c, suspension_start: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End (blank = ongoing)</label>
              <input type="date" value={form.suspension_end} onChange={(e) => setForm((c) => ({ ...c, suspension_end: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
          </div>
          <input value={form.time_extension_ref} onChange={(e) => setForm((c) => ({ ...c, time_extension_ref: e.target.value }))} placeholder="Time extension ref (e.g. T.E. #1)" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <textarea required value={form.reason} onChange={(e) => setForm((c) => ({ ...c, reason: e.target.value }))} rows={3} placeholder="Reason for suspension *" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" className="rounded-xl bg-red-600 hover:bg-red-700 px-5 py-2.5 text-sm font-semibold text-white">Save Suspension</button>
          </div>
        </form>
      </div>
    </div>
  );
}
