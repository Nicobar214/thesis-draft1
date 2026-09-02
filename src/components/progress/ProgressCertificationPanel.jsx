/* ProgressCertificationPanel.jsx — field engineer certification of contractor
 * progress, per DA Region VI:
 *
 *   "The contractor reports the accomplishment, but it must be measured and
 *    verified/certified by the supervising or implementing engineer before it
 *    is recognized for payment."
 *
 * The engineer records what they actually measured on site. That figure is
 * stored separately from the contractor's own claim — it never overwrites it —
 * and downstream payment/valuation views prefer the certified number.
 *
 * Writes go through the certify_progress_update_engineer RPC (SECURITY
 * DEFINER, role-checked) rather than a direct table update, matching how every
 * other privileged action in this app is enforced.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { getWorkflowMeta } from '../../lib/progressWorkflow';

const inputCls =
  'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

const fmtDate = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

/* Labels come from the shared workflow module so the engineer, the contractor
   and the admin all read the same words for the same state. */
const statusBadge = (update) => getWorkflowMeta(update);

export default function ProgressCertificationPanel({ onCountChange, showNotification }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [measured, setMeasured] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);

  /* Advanced Filter, Sort & Pagination States */
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('progress_updates')
      .select('*, fmr_projects(project_name, municipality)')
      .order('submitted_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Failed to load progress updates for certification', error);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  /* Anything an engineer still has to act on. */
  const pending = useMemo(
    () => rows.filter((r) => r.status === 'pending' && r.certification_status !== 'certified'),
    [rows]
  );
  const settled = useMemo(
    () => rows.filter((r) => !(r.status === 'pending' && r.certification_status !== 'certified')),
    [rows]
  );

  useEffect(() => { onCountChange?.(pending.length); }, [pending.length, onCountChange]);

  const [isDisputing, setIsDisputing] = useState(false);
  const [rating, setRating] = useState(5);

  // Dynamic Municipalities List
  const availableMunicipalities = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => {
      const mun = r.fmr_projects?.municipality;
      if (mun?.trim()) set.add(mun.trim());
    });
    return Array.from(set).sort();
  }, [rows]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(searchQuery.trim() || selectedMunicipality !== 'all' || sortBy !== 'newest');
  }, [searchQuery, selectedMunicipality, sortBy]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedMunicipality('all');
    setSortBy('newest');
    setCurrentPage(1);
  };

  // Reset pagination on filter or tab change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedMunicipality, sortBy, activeTab]);

  // Memoized Filter & Sort Engine
  const filteredAndSortedRows = useMemo(() => {
    let list = [...rows];

    // Status Tab Filter
    if (activeTab === 'pending') {
      list = list.filter((r) => r.status === 'pending' && r.certification_status !== 'certified');
    } else if (activeTab === 'settled') {
      list = list.filter((r) => !(r.status === 'pending' && r.certification_status !== 'certified'));
    }

    // Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((r) => {
        const projName = (r.fmr_projects?.project_name || '').toLowerCase();
        const mun = (r.fmr_projects?.municipality || '').toLowerCase();
        const rem = (r.remarks || '').toLowerCase();
        const certRem = (r.certification_remarks || '').toLowerCase();
        return projName.includes(q) || mun.includes(q) || rem.includes(q) || certRem.includes(q);
      });
    }

    // Municipality Filter
    if (selectedMunicipality !== 'all') {
      list = list.filter((r) => (r.fmr_projects?.municipality || '').toLowerCase() === selectedMunicipality.toLowerCase());
    }

    // Sorting Engine
    list.sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.submitted_at || a.created_at || 0) - new Date(b.submitted_at || b.created_at || 0);
      }
      if (sortBy === 'reported') {
        return Number(b.reported_accomplishment || 0) - Number(a.reported_accomplishment || 0);
      }
      if (sortBy === 'billed') {
        return Number(b.amount_this_billing || 0) - Number(a.amount_this_billing || 0);
      }
      // Default: newest
      return new Date(b.submitted_at || b.created_at || 0) - new Date(a.submitted_at || a.created_at || 0);
    });

    return list;
  }, [rows, activeTab, searchQuery, selectedMunicipality, sortBy]);

  // Pagination Slice
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedRows.slice(start, start + pageSize);
  }, [filteredAndSortedRows, currentPage, pageSize]);

  const openRow = (row) => {
    setOpenId((id) => (id === row.id ? null : row.id));
    setIsDisputing(false);
    setRating(5);
    setMeasured(String(row.certified_accomplishment ?? row.reported_accomplishment ?? ''));
    setRemarks(row.certification_remarks || '');
  };

  const handlePercentChange = (val) => {
    const cleaned = val.replace(/%/g, '').trim();
    setMeasured(cleaned);
  };

  const submit = async (row, disputeMode) => {
    if (disputeMode && !remarks.trim()) {
      showNotification?.('Remarks are required when disputing a reported accomplishment.', 'error');
      return;
    }

    const valToCertify = disputeMode ? Number(measured) : Number(row.reported_accomplishment ?? 0);

    if (!disputeMode && (valToCertify < 0 || valToCertify > 100)) {
      showNotification?.('Reported accomplishment is invalid.', 'error');
      return;
    }
    if (disputeMode && (measured === '' || Number(measured) < 0 || Number(measured) > 100 || Number.isNaN(Number(measured)))) {
      showNotification?.('Enter a valid measured accomplishment between 0 and 100.', 'error');
      return;
    }

    const ratingLabels = { 5: '5/5 Excellent', 4: '4/5 Good', 3: '3/5 Satisfactory', 2: '2/5 Substandard', 1: '1/5 Defective' };
    const ratingText = ratingLabels[rating] || `${rating}/5`;
    const formattedRemarks = remarks.trim()
      ? `[Site Rating: ⭐ ${ratingText}] ${remarks.trim()}`
      : `[Site Rating: ⭐ ${ratingText}] Verified on site.`;

    setSaving(true);
    try {
      const { error } = await supabase.rpc('certify_progress_update_engineer', {
        progress_update_id: row.id,
        p_certified_accomplishment: disputeMode ? Number(measured) : Number(row.reported_accomplishment),
        p_remarks: formattedRemarks,
        p_dispute: disputeMode,
      });
      if (error) throw error;
      showNotification?.(disputeMode ? 'Reported accomplishment disputed.' : 'Accomplishment certified.', 'success');
      setOpenId(null);
      await fetchRows();
    } catch (err) {
      console.error('Certification failed', err);
      showNotification?.(err.message || 'Certification failed. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center shadow-xs">
        <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
        <p className="text-sm font-semibold text-slate-500">Loading progress submissions…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* DA Regulation Callout */}
      <div className="bg-teal-50/80 border border-teal-200/80 rounded-2xl p-4 flex items-start gap-3">
        <div className="p-2 rounded-xl bg-teal-600 text-white shrink-0 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
        </div>
        <div>
          <h4 className="text-xs font-bold text-teal-900 uppercase tracking-wider">DA Region VI Engineering Protocol</h4>
          <p className="text-xs text-teal-800 mt-0.5 leading-relaxed">
            Contractor accomplishments must be physically measured and certified by the supervising engineer on-site before payment recognition.
          </p>
        </div>
      </div>

      {/* Header Tabs & Filters Control Panel */}
      <div className="bg-white rounded-3xl border border-slate-200/80 p-5 shadow-sm space-y-4">
        {/* Status Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900">Contractor Progress Submissions</h3>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-200">
              {filteredAndSortedRows.length} Total
            </span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {[
              { id: 'pending', label: 'Awaiting Certification', count: pending.length },
              { id: 'settled', label: 'Already Actioned', count: settled.length },
              { id: 'all', label: 'All Submissions', count: rows.length },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                    active
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>{tab.count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-medium">
          {/* Search Box */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search project name, municipality..."
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-medium placeholder-slate-400"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
            </svg>
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600">
                ✕
              </button>
            )}
          </div>

          {/* Municipality Selector */}
          <div>
            <select
              value={selectedMunicipality}
              onChange={(e) => setSelectedMunicipality(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
            >
              <option value="all">All Municipalities ({availableMunicipalities.length})</option>
              {availableMunicipalities.map((mun) => (
                <option key={mun} value={mun}>{mun}</option>
              ))}
            </select>
          </div>

          {/* Sort Selector */}
          <div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
            >
              <option value="newest">Sort: Newest Submitted</option>
              <option value="oldest">Sort: Oldest Submitted</option>
              <option value="reported">Sort: Highest Reported %</option>
              <option value="billed">Sort: Highest Billed Amount</option>
            </select>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
            <span className="text-slate-500 font-medium">
              Showing <strong className="text-slate-800">{filteredAndSortedRows.length}</strong> of <strong className="text-slate-800">{rows.length}</strong> submissions
            </span>
            <button onClick={resetFilters} className="text-xs text-rose-600 font-bold hover:underline">
              Reset All Filters
            </button>
          </div>
        )}
      </div>

      {/* Tabular Data Table or Empty State */}
      {filteredAndSortedRows.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-xs">
          <p className="font-bold text-slate-800 text-base">No progress submissions match your criteria</p>
          <p className="text-xs text-slate-500 mt-1">Try adjusting search query or active filter selections.</p>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="mt-3 text-xs font-bold text-teal-600 hover:underline">
              Clear Active Filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
          {/* Tabular Table */}
          <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Project & Location</th>
                  <th className="py-3 px-4">Billing Period</th>
                  <th className="py-3 px-4">Contractor Claim</th>
                  <th className="py-3 px-4">Engineer Certified</th>
                  <th className="py-3 px-4">Amount Billed</th>
                  <th className="py-3 px-4">Status</th>
                  {activeTab === 'pending' && <th className="py-3 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedRows.map((row) => {
                  const badge = statusBadge(row);
                  const project = row.fmr_projects || {};
                  const reported = Number(row.reported_accomplishment ?? 0);
                  const certified = row.certified_accomplishment;
                  const isOpen = openId === row.id;

                  return (
                    <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <p className="font-bold text-slate-900">
                          {project.project_name || `Project #${row.fmr_project_id}`}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{project.municipality || '—'}</p>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                        {fmtDate(row.period_start)} – {fmtDate(row.period_end)}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-800 whitespace-nowrap">
                        {reported.toFixed(1)}%
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold whitespace-nowrap">
                        <span className={certified === null || certified === undefined ? 'text-slate-300' : 'text-teal-700'}>
                          {certified === null || certified === undefined ? '—' : `${Number(certified).toFixed(1)}%`}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {row.amount_this_billing != null
                          ? `₱${Number(row.amount_this_billing).toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${badge.tone}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                      </td>
                      {activeTab === 'pending' && (
                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openRow(row)}
                            className={`px-3.5 py-1.5 rounded-xl font-bold text-[11px] cursor-pointer transition-all active:scale-95 shadow-xs ${
                              isOpen
                                ? 'bg-slate-800 text-white border border-slate-800'
                                : 'bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-600 hover:text-white hover:border-teal-600 hover:shadow-md'
                            }`}
                          >
                            {isOpen ? 'Close' : 'Review & Certify →'}
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Action Form Drawer / Modal for active open row */}
          {openId && (() => {
            const row = rows.find(r => r.id === openId);
            if (!row) return null;
            const reported = Number(row.reported_accomplishment ?? 0);
            const workItems = Array.isArray(row.work_items) ? row.work_items : [];

            return (
              <div className="border border-slate-200 rounded-2xl p-5 bg-slate-50/70 space-y-4 shadow-sm animate-fadeIn">
                <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      Certify: {row.fmr_projects?.project_name || `Project #${row.fmr_project_id}`}
                    </h4>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Period: {fmtDate(row.period_start)} – {fmtDate(row.period_end)} &middot; Contractor Claim: <strong className="text-slate-800">{reported.toFixed(1)}%</strong>
                    </p>
                  </div>
                  <button onClick={() => setOpenId(null)} className="p-1 text-slate-400 hover:text-slate-600">✕</button>
                </div>

                {row.remarks && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Contractor remarks</p>
                    <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200">{row.remarks}</p>
                  </div>
                )}

                {workItems.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">Reported scope of work</p>
                    <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-50 text-slate-500 border-b border-slate-200">
                            <th className="text-left font-semibold py-2 px-3">Item</th>
                            <th className="text-left font-semibold py-2 px-3">Unit</th>
                            <th className="text-right font-semibold py-2 px-3">Plan</th>
                            <th className="text-right font-semibold py-2 px-3">Done</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {workItems.map((item, i) => (
                            <tr key={i} className="text-slate-700">
                              <td className="py-2 px-3">{item.item}</td>
                              <td className="py-2 px-3">{item.unit || '—'}</td>
                              <td className="py-2 px-3 text-right font-mono">{item.planned_qty ?? '—'}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-teal-700">{item.accomplished_qty ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {row.remaining_scope && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">Remaining workload</p>
                    <p className="text-xs text-slate-700 bg-white p-3 rounded-xl border border-slate-200">{row.remaining_scope}</p>
                  </div>
                )}

                {row.photo_url && (
                  <img src={row.photo_url} alt="Site" className="w-full max-h-56 object-cover rounded-xl border border-slate-200" />
                )}

                {row.status !== 'pending' ? (
                  <p className="text-xs text-slate-500 bg-white border border-slate-200 rounded-xl px-3 py-2">
                    This submission is closed ({row.status}) and can no longer be certified.
                  </p>
                ) : (
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-xl p-3 shadow-xs">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold ${
                          !isDisputing ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-rose-100 text-rose-800 border border-rose-200'
                        }`}>
                          {!isDisputing ? 'Certifying Contractor Claim' : 'Disputing Contractor Accomplishment'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setIsDisputing(!isDisputing);
                          if (!isDisputing) setMeasured(String(reported));
                        }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${
                          !isDisputing
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {!isDisputing ? 'Dispute Percentage' : 'Revert to Contractor Claim'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Measured accomplishment % <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative flex items-center">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={!isDisputing}
                            value={isDisputing ? measured : reported}
                            onChange={(e) => handlePercentChange(e.target.value)}
                            placeholder="e.g. 15.5"
                            className={`${inputCls} pr-8 font-mono ${
                              !isDisputing ? 'bg-slate-100 text-slate-700 font-bold border-slate-300 cursor-not-allowed' : 'bg-white font-bold'
                            }`}
                          />
                          <span className="absolute right-3 text-slate-400 font-bold text-sm pointer-events-none">%</span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {!isDisputing ? 'Locked to contractor claim. Click "Dispute Percentage" to edit.' : 'Auto-adds % symbol. Enter actual verified % on site.'}
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                          Site Quality Rating
                        </label>
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-2 h-[42px]">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRating(star)}
                              className={`flex-1 py-1 rounded-lg transition-all flex items-center justify-center ${
                                rating >= star ? 'text-amber-500 scale-110' : 'text-slate-300 hover:text-amber-300'
                              }`}
                              title={`${star} Star${star > 1 ? 's' : ''}`}
                            >
                              <svg className="w-5 h-5 fill-current" viewBox="0 0 20 20">
                                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                              </svg>
                            </button>
                          ))}
                          <span className="text-xs font-bold text-slate-600 ml-1 whitespace-nowrap min-w-[45px]">
                            {rating}/5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-1">Quick 1-click site inspection rating.</p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Certification remarks {isDisputing && <span className="text-rose-500">*</span>}
                      </label>
                      <textarea
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        rows={2}
                        placeholder={isDisputing ? "Reason for dispute is required..." : "Optional site inspection notes..."}
                        className={inputCls + ' resize-none'}
                      />
                    </div>

                    {/* Submit Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      {!isDisputing ? (
                        <button
                          type="button"
                          onClick={() => submit(row, false)}
                          disabled={saving}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-500/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {saving ? 'Saving…' : `Certify Accomplishment (${reported.toFixed(1)}%)`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => submit(row, true)}
                          disabled={saving}
                          className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md shadow-rose-500/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2 cursor-pointer"
                        >
                          {saving ? 'Submitting Dispute…' : `Submit Dispute (${measured || '0'}%)`}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setOpenId(null)}
                        disabled={saving}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Pagination Controls Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span>
                Showing <strong className="text-slate-800">{Math.min((currentPage - 1) * pageSize + 1, filteredAndSortedRows.length)}</strong> to{' '}
                <strong className="text-slate-800">{Math.min(currentPage * pageSize, filteredAndSortedRows.length)}</strong> of{' '}
                <strong className="text-slate-800">{filteredAndSortedRows.length}</strong> submissions
              </span>
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                  className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 cursor-pointer"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
              </div>
            </div>

            {/* Pagination Page Number Buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
              >
                ‹ Prev
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className={`w-7 h-7 rounded-xl font-bold text-xs transition ${
                      currentPage === pg
                        ? 'bg-teal-600 text-white shadow-xs'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {pg}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
              >
                Next ›
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
