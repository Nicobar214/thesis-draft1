import { useEffect, useMemo, useState } from 'react';

import { computePriorityScores } from '../../lib/priorityScoring';

const legendItems = [
  { label: 'Volume 40%', tone: 'bg-blue-100 text-blue-700', icon: '🟦' },
  { label: 'Severity 35%', tone: 'bg-red-100 text-red-700', icon: '🟥' },
  { label: 'Crop Value 25%', tone: 'bg-amber-100 text-amber-700', icon: '🟨' },
];

function formatTimestamp(value) {
  if (!value) return 'Not calculated yet';
  return value.toLocaleString();
}

function scoreTone(score) {
  if (score >= 70) return 'text-red-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-emerald-600';
}

function rankTone(rank) {
  if (rank === 1) return 'bg-amber-100 text-amber-800 border border-amber-300';
  if (rank === 2) return 'bg-slate-200 text-slate-700 border border-slate-300';
  if (rank === 3) return 'bg-orange-100 text-orange-700 border border-orange-300';
  return 'bg-slate-100 text-slate-600 border border-slate-200';
}

function factorBarTone(key) {
  if (key === 'V') return 'bg-blue-500';
  if (key === 'S') return 'bg-red-500';
  return 'bg-amber-500';
}

export default function PriorityTab({ projects, reports, escalations, onViewReports }) {
  const computed = useMemo(
    () => computePriorityScores(projects, reports, escalations),
    [projects, reports, escalations]
  );

  const [rankings, setRankings] = useState(computed);
  const [lastCalculated, setLastCalculated] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  useEffect(() => {
    setRankings(computed);
    setLastCalculated(new Date());
    setCurrentPage(1);
  }, [computed]);

  const handleRecalculate = () => {
    setRankings(computePriorityScores(projects, reports, escalations));
    setLastCalculated(new Date());
  };

  if (!projects || projects.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <p className="text-lg font-semibold text-slate-800">No FMR projects found. Add projects first.</p>
        <p className="text-sm text-slate-500 mt-2">Priority rankings appear once projects are available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Road Priority Rankings</h2>
            <p className="text-sm text-slate-500 mt-1">Weighted by report volume (40%), severity (35%), and crop value (25%)</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <button
              type="button"
              onClick={handleRecalculate}
              className="px-4 py-2.5 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition"
            >
              Recalculate
            </button>
            <span className="text-xs text-slate-400">Last calculated: {formatTimestamp(lastCalculated)}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-yellow-50 border border-yellow-200 text-yellow-800">
            ⚠ Crop data is simulated - replace with real fmr_crop_data when available
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {legendItems.map((item) => (
          <span key={item.label} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${item.tone}`}>
            {item.icon} {item.label}
          </span>
        ))}
      </div>

      <div className="space-y-4">
        {(() => {
          const start = (currentPage - 1) * itemsPerPage;
          const end = start + itemsPerPage;
          return rankings.slice(start, end).map((entry) => {
            return entry;
          });
        })() && null}
        {rankings.slice((currentPage - 1) * itemsPerPage, (currentPage - 1) * itemsPerPage + itemsPerPage).map((entry) => {
          const { project, bySeverity, cropData, score, rank, reason, hasEscalation } = entry;
          const severityPills = [
            { key: 'safety', label: `Safety ×${bySeverity.safety}`, tone: 'bg-red-100 text-red-700' },
            { key: 'flood', label: `Flood ×${bySeverity.flood}`, tone: 'bg-sky-100 text-sky-700' },
            { key: 'issue', label: `Issue ×${bySeverity.issue}`, tone: 'bg-amber-100 text-amber-700' },
            { key: 'general', label: `General ×${bySeverity.general}`, tone: 'bg-slate-100 text-slate-600' },
          ].filter((item) => bySeverity[item.key] > 0);

          return (
            <div key={project.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex items-start gap-4 lg:w-2/3">
                  <div className={`h-14 w-14 rounded-2xl flex items-center justify-center text-2xl font-bold ${rankTone(rank)}`}>
                    {rank}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-lg font-semibold text-slate-900">{project.project_name}</p>
                      <p className="text-sm text-slate-500">
                        {(project.municipality || 'Unknown municipality')} · {(project.barangay || 'Unknown barangay')}
                      </p>
                    </div>
                    <p className="text-sm text-slate-500 italic">{reason}</p>
                    <div className="flex flex-wrap gap-2">
                      {severityPills.map((pill) => (
                        <span key={pill.key} className={`px-2.5 py-1 rounded-full text-xs font-semibold ${pill.tone}`}>
                          {pill.label}
                        </span>
                      ))}
                      {hasEscalation && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          ⚡ Escalated
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      Simulated: {cropData.primary_crop} · {cropData.hectares.toLocaleString()} ha
                    </p>
                  </div>
                </div>

                <div className="lg:w-1/3 lg:pl-6 lg:border-l lg:border-slate-100 space-y-3">
                  <div className="flex items-end justify-between">
                    <p className={`text-3xl font-bold ${scoreTone(score)}`}>{`${score}%`}</p>
                    <button
                      type="button"
                      onClick={() => onViewReports && onViewReports(project)}
                      className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      View Reports
                    </button>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${scoreTone(score)} bg-current`} style={{ width: `${score}%` }} />
                  </div>
                  <div className="space-y-2">
                    {[
                      { key: 'V', value: entry.V },
                      { key: 'S', value: entry.S },
                      { key: 'C', value: entry.C },
                    ].map((factor) => (
                      <div key={factor.key} className="flex items-center gap-2">
                        <span className="w-6 text-xs font-semibold text-slate-500">{factor.key}</span>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${factorBarTone(factor.key)}`}
                            style={{ width: `${factor.value}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-8 text-right">{`${factor.value}%`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {/* Pagination controls */}
        {rankings.length > itemsPerPage && (
          <div className="flex items-center justify-center gap-3 mt-2">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Previous
            </button>
            <div className="text-sm text-slate-600">Page {currentPage} of {Math.ceil(rankings.length / itemsPerPage)}</div>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(Math.ceil(rankings.length / itemsPerPage), p + 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-sm font-semibold hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
