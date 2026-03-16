import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';

function monthKey(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function avgHours(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  return (to - from) / 3600000;
}

export default function LguAnalyticsTab({ reports, escalations, projects, findings }) {
  const monthly = useMemo(() => {
    const map = new Map();

    (reports || []).forEach((row) => {
      const key = monthKey(row.created_at);
      if (!key) return;
      if (!map.has(key)) map.set(key, { month: key, submitted: 0, resolved: 0, escalated: 0 });
      map.get(key).submitted += 1;
      if (row.status === 'resolved') map.get(key).resolved += 1;
    });

    (escalations || []).forEach((row) => {
      const key = monthKey(row.created_at || row.escalated_at);
      if (!key) return;
      if (!map.has(key)) map.set(key, { month: key, submitted: 0, resolved: 0, escalated: 0 });
      map.get(key).escalated += 1;
    });

    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }, [reports, escalations]);

  const progressRows = useMemo(() => {
    return (projects || []).map((p) => ({
      project: p.project_name || 'Unnamed',
      progress: Number(p.accomplishment || 0),
    })).sort((a, b) => b.progress - a.progress).slice(0, 12);
  }, [projects]);

  const engineerPerf = useMemo(() => {
    const findingByReport = new Map((findings || []).map((f) => [f.report_id, f]));
    const stats = new Map();

    (reports || []).forEach((row) => {
      if (!row.assigned_engineer_id) return;
      const key = row.assigned_engineer_id;
      if (!stats.has(key)) {
        stats.set(key, {
          engineer_id: key,
          engineer_name: row.assigned_engineer_name || 'Field Engineer',
          resolved_count: 0,
          total_response_hours: 0,
          response_samples: 0,
        });
      }

      const stat = stats.get(key);
      if (row.status === 'resolved') stat.resolved_count += 1;

      const finding = findingByReport.get(row.id);
      if (finding?.submitted_at && row.assigned_at) {
        const hrs = avgHours(row.assigned_at, finding.submitted_at);
        if (Number.isFinite(hrs)) {
          stat.total_response_hours += hrs;
          stat.response_samples += 1;
        }
      }
    });

    return Array.from(stats.values()).map((s) => ({
      ...s,
      avg_response_hours: s.response_samples > 0 ? Number((s.total_response_hours / s.response_samples).toFixed(2)) : null,
    })).sort((a, b) => b.resolved_count - a.resolved_count);
  }, [reports, findings]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900 mb-3">Monthly Reports Overview</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="submitted" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              <Bar dataKey="resolved" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="escalated" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900 mb-3">Project Progress Tracker</p>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={progressRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="project" hide />
              <YAxis domain={[0, 100]} />
              <Tooltip />
              <Line type="monotone" dataKey="progress" stroke="#0f766e" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 overflow-x-auto">
        <p className="text-sm font-semibold text-slate-900 mb-3">Field Engineer Performance</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2">Engineer</th>
              <th className="py-2">Resolved Reports</th>
              <th className="py-2">Avg Response Time (hrs)</th>
            </tr>
          </thead>
          <tbody>
            {engineerPerf.map((row) => (
              <tr key={row.engineer_id} className="border-b border-slate-100">
                <td className="py-2 text-slate-800">{row.engineer_name}</td>
                <td className="py-2 text-slate-700">{row.resolved_count}</td>
                <td className="py-2 text-slate-700">{row.avg_response_hours ?? 'N/A'}</td>
              </tr>
            ))}
            {engineerPerf.length === 0 && (
              <tr>
                <td className="py-3 text-slate-500" colSpan={3}>No engineer performance data yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
