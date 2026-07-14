import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BENEFICIARY_CROPS,
  BENEFICIARY_VALIDATION_STATUSES,
  LGU_SUBMITTERS,
} from '../../utils/farmerBeneficiaryData';
import FarmerBeneficiaryDetailModal from './FarmerBeneficiaryDetailModal';

const rowsPerPage = 10;
const cardClass = 'bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm';
const chartCardClass = 'bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow';

function formatDate(dateValue) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
}

function StatusPill({ status }) {
  const tones = {
    'For Verification': 'bg-amber-50 text-amber-700 border-amber-200',
    Validated: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Needs Correction': 'bg-orange-50 text-orange-700 border-orange-200',
    'Duplicate Record': 'bg-purple-50 text-purple-700 border-purple-200',
    Rejected: 'bg-red-50 text-red-700 border-red-200',
    Archived: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${tones[status] || tones.Archived}`}>
      {status}
    </span>
  );
}

function EmptyBeneficiaries({ onReset }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
        <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 18.75h-9m9 0a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3h-9a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3m9 0v1.5a.75.75 0 0 1-.75.75h-7.5a.75.75 0 0 1-.75-.75v-1.5M8.25 10.5h7.5M8.25 13.5h4.5" />
        </svg>
      </div>
      <p className="text-base font-bold text-slate-900">No beneficiary records found</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">Try adjusting the validation queue filters or search for another RSBSA number, farmer name, or linked FMR project.</p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-700"
      >
        Reset Filters
      </button>
    </div>
  );
}

export default function FarmerBeneficiariesTab({ beneficiaries, onUpdateBeneficiary, onExportCsv, loading = false }) {
  const [search, setSearch] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [barangayFilter, setBarangayFilter] = useState('All');
  const [cropFilter, setCropFilter] = useState('All');
  const [validationFilter, setValidationFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [lguFilter, setLguFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState(null);

  const municipalityOptions = useMemo(() => [...new Set(beneficiaries.map((item) => item.municipality).filter(Boolean))].sort(), [beneficiaries]);
  const barangayOptions = useMemo(() => {
    return [...new Set(beneficiaries
      .filter((item) => municipalityFilter === 'All' || item.municipality === municipalityFilter)
      .map((item) => item.barangay)
      .filter(Boolean))]
      .sort();
  }, [beneficiaries, municipalityFilter]);
  const projectOptions = useMemo(() => [...new Set(beneficiaries.map((item) => item.linkedProject).filter(Boolean))].sort(), [beneficiaries]);
  const lguOptions = useMemo(() => {
    const derived = [...new Set(beneficiaries.map((item) => item.submittedByLgu).filter(Boolean))].sort();
    return derived.length ? derived : LGU_SUBMITTERS;
  }, [beneficiaries]);

  const filteredBeneficiaries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return beneficiaries.filter((item) => {
      const matchesSearch = !query || [
        item.beneficiaryId,
        item.id,
        item.fullName,
        item.rsbsaNumber,
        item.municipality,
        item.barangay,
        item.crop,
        item.linkedProject,
        item.submittedByLgu,
      ].some((field) => String(field || '').toLowerCase().includes(query));

      return matchesSearch
        && (municipalityFilter === 'All' || item.municipality === municipalityFilter)
        && (barangayFilter === 'All' || item.barangay === barangayFilter)
        && (cropFilter === 'All' || item.crop === cropFilter)
        && (validationFilter === 'All' || item.validationStatus === validationFilter)
        && (projectFilter === 'All' || item.linkedProject === projectFilter)
        && (lguFilter === 'All' || item.submittedByLgu === lguFilter);
    });
  }, [beneficiaries, search, municipalityFilter, barangayFilter, cropFilter, validationFilter, projectFilter, lguFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredBeneficiaries.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedBeneficiaries = filteredBeneficiaries.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  const kpis = useMemo(() => {
    const total = filteredBeneficiaries.length;
    const validated = filteredBeneficiaries.filter((item) => item.validationStatus === 'Validated').length;
    const forVerification = filteredBeneficiaries.filter((item) => item.validationStatus === 'For Verification').length;
    const needsCorrection = filteredBeneficiaries.filter((item) => item.validationStatus === 'Needs Correction').length;
    const hectares = filteredBeneficiaries.reduce((sum, item) => sum + Number(item.farmAreaHa || 0), 0);
    const activeProjects = new Set(filteredBeneficiaries.filter((item) => ['On-Going', 'Ongoing', 'Active'].includes(item.linkedProjectStatus)).map((item) => item.linkedProject)).size;
    const cropCounts = filteredBeneficiaries.reduce((acc, item) => {
      acc[item.crop] = (acc[item.crop] || 0) + 1;
      return acc;
    }, {});
    const topCrop = Object.keys(cropCounts).sort((a, b) => cropCounts[b] - cropCounts[a])[0] || 'N/A';

    return { total, validated, forVerification, needsCorrection, hectares, topCrop, activeProjects };
  }, [filteredBeneficiaries]);

  const cropDistribution = useMemo(() => BENEFICIARY_CROPS.map((crop) => ({
    name: crop,
    value: filteredBeneficiaries.filter((item) => item.crop === crop).length,
  })), [filteredBeneficiaries]);

  const beneficiariesPerMunicipality = useMemo(() => {
    const counts = filteredBeneficiaries.reduce((acc, item) => {
      acc[item.municipality] = (acc[item.municipality] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([municipality, count]) => ({ municipality, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredBeneficiaries]);

  const submissionsByYear = useMemo(() => {
    const yearly = filteredBeneficiaries.reduce((acc, item) => {
      const year = new Date(item.submittedDate).getFullYear();
      if (!Number.isNaN(year)) acc[year] = (acc[year] || 0) + 1;
      return acc;
    }, {});
    return Object.keys(yearly)
      .sort((a, b) => Number(a) - Number(b))
      .map((year) => ({ year, beneficiaries: yearly[year] }));
  }, [filteredBeneficiaries]);

  const hectaresByYear = useMemo(() => {
    const yearly = filteredBeneficiaries.reduce((acc, item) => {
      const year = new Date(item.submittedDate).getFullYear();
      if (!Number.isNaN(year)) acc[year] = (acc[year] || 0) + Number(item.farmAreaHa || 0);
      return acc;
    }, {});
    return Object.keys(yearly)
      .sort((a, b) => Number(a) - Number(b))
      .map((year) => ({ year, hectares: Number(yearly[year].toFixed(2)) }));
  }, [filteredBeneficiaries]);

  const resetFilters = () => {
    setSearch('');
    setMunicipalityFilter('All');
    setBarangayFilter('All');
    setCropFilter('All');
    setValidationFilter('All');
    setProjectFilter('All');
    setLguFilter('All');
    setPage(1);
  };

  const handleExport = () => {
    const rows = filteredBeneficiaries.map((item) => ({
      beneficiary_id: item.beneficiaryId,
      full_name: item.fullName,
      rsbsa_number: item.rsbsaNumber,
      municipality: item.municipality,
      barangay: item.barangay,
      crop: item.crop,
      farm_area_ha: item.farmAreaHa,
      linked_fmr_project: item.linkedProject,
      distance_to_fmr_km: item.distanceToFmrKm,
      beneficiary_status: item.beneficiaryStatus,
      validation_status: item.validationStatus,
      submitted_by_lgu: item.submittedByLgu,
      submitted_date: formatDate(item.submittedDate),
      latest_admin_remarks: item.adminRemarks,
    }));
    onExportCsv?.(rows, 'farmer_beneficiaries.csv');
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Total Submitted</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.total}</p>
          <p className="mt-1 text-sm text-slate-500">LGU-submitted beneficiaries</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Validated</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.validated}</p>
          <p className="mt-1 text-sm text-slate-500">Approved for DA monitoring</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Validation Queue</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.forVerification}</p>
          <p className="mt-1 text-sm text-slate-500">For verification</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Correction Required</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.needsCorrection}</p>
          <p className="mt-1 text-sm text-slate-500">Needs LGU update</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Farm Area Served</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.hectares.toFixed(1)} ha</p>
          <p className="mt-1 text-sm text-slate-500">Total hectares linked to FMRs</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Top Commodity</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.topCrop}</p>
          <p className="mt-1 text-sm text-slate-500">Most common crop served</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Active FMR Links</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{kpis.activeProjects}</p>
          <p className="mt-1 text-sm text-slate-500">On-going project links</p>
        </div>
        <div className={cardClass}>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">DA Role</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">Review</p>
          <p className="mt-1 text-sm text-slate-500">LGU submits, DA validates</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        <div className="border-b border-slate-200/60 px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Farmer Beneficiary Registry</h2>
              <p className="mt-1 text-sm text-slate-500">LGU-submitted farmer beneficiaries linked to FMR project service areas for DA review.</p>
            </div>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="px-6 py-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
            <input
              type="text"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search name, beneficiary ID, RSBSA, or project..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 lg:col-span-2"
            />
            <select value={municipalityFilter} onChange={(event) => { setMunicipalityFilter(event.target.value); setBarangayFilter('All'); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20">
              <option value="All">All Municipalities</option>
              {municipalityOptions.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
            </select>
            <select value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20">
              <option value="All">All Barangays</option>
              {barangayOptions.map((barangay) => <option key={barangay} value={barangay}>{barangay}</option>)}
            </select>
            <select value={cropFilter} onChange={(event) => { setCropFilter(event.target.value); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20">
              <option value="All">All Commodities</option>
              {BENEFICIARY_CROPS.map((crop) => <option key={crop} value={crop}>{crop}</option>)}
            </select>
            <select value={validationFilter} onChange={(event) => { setValidationFilter(event.target.value); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20">
              <option value="All">All DA Review Status</option>
              {BENEFICIARY_VALIDATION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 lg:col-span-3">
              <option value="All">All Linked FMR Projects</option>
              {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
            <select value={lguFilter} onChange={(event) => { setLguFilter(event.target.value); setPage(1); }} className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 text-sm text-slate-700 shadow-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 lg:col-span-3">
              <option value="All">All LGU Submitters</option>
              {lguOptions.map((lgu) => <option key={lgu} value={lgu}>{lgu}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-500">Loading farmer beneficiary records...</div>
        ) : (
          <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr className="bg-slate-50/60">
                {[
                  'Beneficiary',
                  'RSBSA / Registry No.',
                  'Location',
                  'Crop / Farm Area',
                  'Linked FMR Project',
                  'DA Review Status',
                  'Submitted By',
                  'Last Updated',
                  'Action',
                ].map((label, index) => (
                  <th key={label} className={`${index === 0 ? 'px-8' : 'px-6'} py-4 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500`}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paginatedBeneficiaries.map((beneficiary) => (
                <tr key={beneficiary.id} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-8 py-4">
                    <p className="text-sm font-semibold text-slate-900">{beneficiary.fullName}</p>
                    <p className="text-xs text-slate-400">{beneficiary.beneficiaryId}</p>
                  </td>
                  <td className="px-6 py-4 text-sm font-mono text-slate-700">{beneficiary.rsbsaNumber}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    <p>{beneficiary.barangay}</p>
                    <p className="text-xs text-slate-400">{beneficiary.municipality}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">{beneficiary.crop}</p>
                    <p className="text-xs text-slate-500">{Number(beneficiary.farmAreaHa || 0).toFixed(2)} ha</p>
                  </td>
                  <td className="max-w-[260px] px-6 py-4 text-sm text-slate-700">
                    <p className="line-clamp-2 font-medium text-slate-900">{beneficiary.linkedProject}</p>
                    <p className="mt-1 text-xs text-slate-500">{beneficiary.distanceToFmrKm} km - {beneficiary.serviceArea}</p>
                  </td>
                  <td className="px-6 py-4"><StatusPill status={beneficiary.validationStatus} /></td>
                  <td className="px-6 py-4 text-sm text-slate-700">{beneficiary.submittedByLgu}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{formatDate(beneficiary.lastUpdated)}</td>
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => setSelectedBeneficiary(beneficiary)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredBeneficiaries.length === 0 && <EmptyBeneficiaries onReset={resetFilters} />}

          </>
        )}

        <div className="flex flex-col items-center justify-between gap-5 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white px-8 py-5 sm:flex-row">
          <p className="text-sm text-slate-500">
            Showing <span className="font-bold text-slate-700">{filteredBeneficiaries.length ? (safePage - 1) * rowsPerPage + 1 : 0}</span> to{' '}
            <span className="font-bold text-slate-700">{Math.min(safePage * rowsPerPage, filteredBeneficiaries.length)}</span> of{' '}
            <span className="font-bold text-slate-700">{filteredBeneficiaries.length}</span> beneficiaries
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={safePage === 1} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
              Previous
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 8).map((pageNumber) => (
              <button
                key={pageNumber}
                onClick={() => setPage(pageNumber)}
                className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200 ${
                  safePage === pageNumber
                    ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                    : 'border border-slate-200 shadow-sm hover:border-slate-300 hover:bg-white'
                }`}
              >
                {pageNumber}
              </button>
            ))}
            <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className={chartCardClass}>
          <h3 className="text-lg font-bold text-slate-900">Commodity Distribution</h3>
          <p className="mb-4 text-sm text-slate-500">Share of beneficiaries per main commodity</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={cropDistribution} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                  {cropDistribution.map((entry, index) => {
                    const palette = ['#0d9488', '#22c55e', '#f59e0b', '#0ea5e9', '#a855f7', '#ef4444'];
                    return <Cell key={`crop-${entry.name}`} fill={palette[index % palette.length]} />;
                  })}
                </Pie>
                <Legend verticalAlign="bottom" height={36} />
                <RechartsTooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={chartCardClass}>
          <h3 className="text-lg font-bold text-slate-900">Beneficiaries per Municipality</h3>
          <p className="mb-4 text-sm text-slate-500">Top municipalities by submitted beneficiaries</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={beneficiariesPerMunicipality} margin={{ top: 8, right: 8, left: -12, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="municipality" tick={{ fill: '#64748b', fontSize: 11 }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <RechartsTooltip />
                <Bar dataKey="count" fill="#0d9488" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={chartCardClass}>
          <h3 className="text-lg font-bold text-slate-900">LGU Submissions by Year</h3>
          <p className="mb-4 text-sm text-slate-500">Beneficiary registry submission trend</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={submissionsByYear} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                <defs>
                  <linearGradient id="beneficiarySubmissionGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0d9488" stopOpacity={0.45} />
                    <stop offset="95%" stopColor="#0d9488" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                <RechartsTooltip />
                <Area type="monotone" dataKey="beneficiaries" stroke="#0d9488" fill="url(#beneficiarySubmissionGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={chartCardClass}>
          <h3 className="text-lg font-bold text-slate-900">Farm Area Served by Year</h3>
          <p className="mb-4 text-sm text-slate-500">Hectares connected to FMR service areas</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hectaresByYear} margin={{ top: 8, right: 12, left: -12, bottom: 8 }}>
                <defs>
                  <linearGradient id="beneficiaryHectareGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.06} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 11 }} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                <RechartsTooltip formatter={(value) => [`${value} ha`, 'Farm Area Served']} />
                <Area type="monotone" dataKey="hectares" stroke="#0ea5e9" fill="url(#beneficiaryHectareGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {selectedBeneficiary && (
        <FarmerBeneficiaryDetailModal
          key={selectedBeneficiary.id}
          beneficiary={selectedBeneficiary}
          onClose={() => setSelectedBeneficiary(null)}
          onUpdate={(id, updates) => {
            onUpdateBeneficiary?.(id, updates);
            setSelectedBeneficiary((current) => (current && current.id === id ? { ...current, ...updates } : current));
          }}
        />
      )}
    </div>
  );
}
