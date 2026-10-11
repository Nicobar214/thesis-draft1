import { useMemo, useState } from 'react';
import { UsersIcon, LandPlotIcon, WheatIcon, RouteIcon, MapPinIcon, SearchIcon, XIcon, AlertCircleIcon, RefreshCwIcon } from 'lucide-react';
import HierarchyKpis from '../ui/HierarchyKpis';
import BeneficiaryAnalytics from './BeneficiaryAnalytics';
import { getMunicipalities } from '../../data/iloiloLocations';
import { summarizeBeneficiaries, groupCommodities, formatHa, formatPct } from '../../lib/beneficiaryAnalytics';
import { getPaginationRange } from '../../lib/paginationUtils';

const rowsPerPage = 10;
const filterSelectCls = 'h-10 w-full min-w-0 truncate rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm text-slate-700 outline-none transition hover:border-slate-300 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10';

function formatDate(dateValue) {
  if (!dateValue) return 'N/A';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString();
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
      <p className="mt-1 max-w-md text-sm text-slate-500">Try adjusting the filters or search for another RSBSA number, farmer name, or linked FMR project.</p>
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

export default function FarmerBeneficiariesTab({ beneficiaries, onExportCsv, loading = false, error = '', onRetry }) {
  const [search, setSearch] = useState('');
  const [municipalityFilter, setMunicipalityFilter] = useState('All');
  const [barangayFilter, setBarangayFilter] = useState('All');
  const [cropFilter, setCropFilter] = useState('All');
  const [projectFilter, setProjectFilter] = useState('All');
  const [lguFilter, setLguFilter] = useState('All');
  const [page, setPage] = useState(1);

  const municipalityOptions = useMemo(() => [...new Set(beneficiaries.map((item) => item.municipality).filter(Boolean))].sort(), [beneficiaries]);
  const barangayOptions = useMemo(() => {
    const counts = new Map();
    beneficiaries
      .filter((item) => municipalityFilter === 'All' || item.municipality === municipalityFilter)
      .forEach((item) => { if (item.barangay) counts.set(item.barangay, (counts.get(item.barangay) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [beneficiaries, municipalityFilter]);
  const projectOptions = useMemo(() => [...new Set(beneficiaries.map((item) => item.linkedProject).filter(Boolean))].sort(), [beneficiaries]);
  const lguOptions = useMemo(() => [...new Set(beneficiaries.map((item) => item.submittedByLgu).filter(Boolean))].sort(), [beneficiaries]);
  const cropOptions = useMemo(() => [...new Set(beneficiaries.map((item) => String(item.crop || '').trim()).filter(Boolean))].sort(), [beneficiaries]);

  const filteredBeneficiaries = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = beneficiaries.filter((item) => {
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
        && (projectFilter === 'All' || item.linkedProject === projectFilter)
        && (lguFilter === 'All' || item.submittedByLgu === lguFilter);
    });

    // Sort descending by farm area (more coverage to lowest)
    return [...filtered].sort((a, b) => Number(b.farmAreaHa || 0) - Number(a.farmAreaHa || 0));
  }, [beneficiaries, search, municipalityFilter, barangayFilter, cropFilter, projectFilter, lguFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredBeneficiaries.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const paginatedBeneficiaries = filteredBeneficiaries.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  // Every analytics number comes from one summary (lib/beneficiaryAnalytics.js),
  // computed from the same filtered list as the registry table.
  const municipalityMaster = useMemo(() => getMunicipalities(), []);
  const analytics = useMemo(
    () => summarizeBeneficiaries(filteredBeneficiaries, { municipalityMaster }),
    [filteredBeneficiaries, municipalityMaster],
  );
  const overall = useMemo(
    () => summarizeBeneficiaries(beneficiaries, { municipalityMaster }),
    [beneficiaries, municipalityMaster],
  );
  const commodityGroups = useMemo(() => groupCommodities(analytics.commodities, 6), [analytics.commodities]);
  const activeProjects = useMemo(
    () => new Set(filteredBeneficiaries
      .filter((item) => ['On-Going', 'Ongoing', 'Active'].includes(item.linkedProjectStatus) && item.linkedProject)
      .map((item) => item.linkedProject)).size,
    [filteredBeneficiaries],
  );

  const resetFilters = () => {
    setSearch('');
    setMunicipalityFilter('All');
    setBarangayFilter('All');
    setCropFilter('All');
    setProjectFilter('All');
    setLguFilter('All');
    setPage(1);
  };

  const activeFilterChips = [
    search.trim() && { key: 'search', label: `“${search.trim()}”`, clear: () => { setSearch(''); setPage(1); } },
    municipalityFilter !== 'All' && { key: 'muni', label: municipalityFilter, clear: () => { setMunicipalityFilter('All'); setBarangayFilter('All'); setPage(1); } },
    barangayFilter !== 'All' && { key: 'brgy', label: `Brgy. ${barangayFilter}`, clear: () => { setBarangayFilter('All'); setPage(1); } },
    cropFilter !== 'All' && { key: 'crop', label: cropFilter, clear: () => { setCropFilter('All'); setPage(1); } },
    projectFilter !== 'All' && { key: 'project', label: `Project: ${projectFilter}`, clear: () => { setProjectFilter('All'); setPage(1); } },
    lguFilter !== 'All' && { key: 'lgu', label: `By ${lguFilter}`, clear: () => { setLguFilter('All'); setPage(1); } },
  ].filter(Boolean);

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
      submitted_by_lgu: item.submittedByLgu,
      submitted_date: formatDate(item.submittedDate),
      latest_admin_remarks: item.adminRemarks,
    }));
    onExportCsv?.(rows, 'farmer_beneficiaries.csv');
  };

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-red-800">Farmer beneficiaries could not be loaded</p>
            <p className="mt-0.5 text-sm text-red-700">{error}</p>
          </div>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">
            <RefreshCwIcon className="size-4" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    );
  }

  const isFiltered = activeFilterChips.length > 0;
  const lead = analytics.leadingCommodity;
  const pending = analytics.validation['For Verification'];
  const validatedPct = analytics.total ? (analytics.validation.Validated / analytics.total) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* 1. Filters — they drive the cards, the charts and the registry alike. */}
      <section aria-label="Filter farmer beneficiaries" className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-xs">
        <div className="flex flex-col gap-2.5 p-4 xl:flex-row xl:items-center">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search name, beneficiary ID, RSBSA or project"
              aria-label="Search farmers"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:bg-white focus:ring-4 focus:ring-teal-500/10"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:flex xl:flex-nowrap">
            <select aria-label="Municipality" value={municipalityFilter} onChange={(event) => { setMunicipalityFilter(event.target.value); setBarangayFilter('All'); setPage(1); }} className={`${filterSelectCls} xl:w-40`}>
              <option value="All">All municipalities</option>
              {municipalityOptions.map((municipality) => <option key={municipality} value={municipality}>{municipality}</option>)}
            </select>
            <select aria-label="Barangay" value={barangayFilter} onChange={(event) => { setBarangayFilter(event.target.value); setPage(1); }} className={`${filterSelectCls} xl:w-40`}>
              <option value="All">All barangays</option>
              {barangayOptions.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
            </select>
            <select aria-label="Commodity" value={cropFilter} onChange={(event) => { setCropFilter(event.target.value); setPage(1); }} className={`${filterSelectCls} xl:w-40`}>
              <option value="All">All commodities</option>
              {cropOptions.map((crop) => <option key={crop} value={crop}>{crop}</option>)}
            </select>
            <select aria-label="Linked FMR project" value={projectFilter} onChange={(event) => { setProjectFilter(event.target.value); setPage(1); }} className={`${filterSelectCls} xl:w-48`}>
              <option value="All">All FMR projects</option>
              {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
            </select>
            <select aria-label="Submitted by" value={lguFilter} onChange={(event) => { setLguFilter(event.target.value); setPage(1); }} className={`${filterSelectCls} col-span-2 sm:col-span-1 xl:w-40`}>
              <option value="All">All submitters</option>
              {lguOptions.map((lgu) => <option key={lgu} value={lgu}>{lgu}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <p className="mr-1 text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{filteredBeneficiaries.length.toLocaleString()}</span> of {beneficiaries.length.toLocaleString()} registered farmers
          </p>
          {activeFilterChips.map((chip) => (
            <span key={chip.key} className="inline-flex max-w-[16rem] items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs font-medium text-slate-700">
              <span className="truncate">{chip.label}</span>
              <button type="button" onClick={chip.clear} aria-label={`Remove filter ${chip.label}`} className="grid size-5 place-items-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {isFiltered && (
            <button type="button" onClick={resetFilters} className="ml-auto text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline">
              Clear all
            </button>
          )}
        </div>
      </section>

      {/* 2. Headline numbers */}
      <HierarchyKpis
        dense
        loading={loading}
        ariaLabel="Farmer registry summary"
        lead={{
          label: 'Registered Farmers',
          value: analytics.total.toLocaleString(),
          note: analytics.total === 0 ? (
            <span>No farmers match {isFiltered ? 'these filters' : 'the registry yet'}</span>
          ) : (
            <span>
              {pending === 0 && analytics.validation.Validated === analytics.total ? (
                <span className="font-semibold text-emerald-700">All validated</span>
              ) : (
                <><span className="font-semibold text-emerald-700">{formatPct(validatedPct / 100)} validated</span> · {pending.toLocaleString()} waiting</>
              )}
              {isFiltered && overall.total > 0 && (
                <> · {formatPct(analytics.total / overall.total)} of all {overall.total.toLocaleString()} farmers</>
              )}
            </span>
          ),
          icon: <UsersIcon className="size-6" aria-hidden="true" />,
          iconTone: 'bg-emerald-100 text-emerald-700',
          segments: [
            { label: 'Validated', value: analytics.validation.Validated, bar: 'bg-emerald-500' },
            { label: 'For Verification', value: pending, bar: 'bg-amber-500' },
            { label: 'Needs Correction', value: analytics.validation['Needs Correction'], bar: 'bg-rose-500' },
            { label: 'Other status', value: analytics.validation.Other, bar: 'bg-slate-400' },
          ].filter((seg) => seg.value > 0),
        }}
        items={[
          {
            icon: <LandPlotIcon className="size-4" aria-hidden="true" />,
            label: 'Registered Farm Area',
            value: `${formatHa(analytics.hectares)} ha`,
            hint: analytics.areaMissing
              ? `${analytics.areaMissing.toLocaleString()} without area recorded`
              : null,
            chip: 'bg-teal-50 text-teal-700',
          },
          {
            icon: <WheatIcon className="size-4" aria-hidden="true" />,
            label: 'Leading Commodity',
            value: !lead ? '—' : lead.names.length > 1 ? `${lead.names.length}-way tie` : lead.names[0],
            hint: !lead
              ? 'No commodity recorded'
              : `${lead.count.toLocaleString()} farmer${lead.count === 1 ? '' : 's'}${lead.names.length > 1 ? ' each' : ''} · ${formatPct(lead.share)}`,
            chip: 'bg-amber-50 text-amber-700',
          },
          {
            icon: <MapPinIcon className="size-4" aria-hidden="true" />,
            label: 'Municipal Coverage',
            value: analytics.coverage.masterTotal
              ? `${analytics.coverage.withFarmers} of ${analytics.coverage.masterTotal}`
              : analytics.coverage.withFarmers,
            hint: analytics.coverage.masterTotal ? 'Iloilo municipalities' : null,
            chip: 'bg-sky-50 text-sky-700',
          },
          {
            icon: <RouteIcon className="size-4" aria-hidden="true" />,
            label: 'Active FMR Links',
            value: activeProjects,
            hint: 'On-going projects',
            chip: 'bg-slate-100 text-slate-600',
          },
        ]}
      />

      {/* 3. Analytics */}
      <BeneficiaryAnalytics
        analytics={analytics}
        commodityGroups={commodityGroups}
        loading={loading}
        isFiltered={isFiltered}
        overall={overall}
        selectedBarangay={barangayFilter !== 'All' ? barangayFilter : null}
        onClearFilters={resetFilters}
      />

      <div className="rounded-2xl border border-slate-200/60 bg-white shadow-sm">
        <div className="border-b border-slate-200/60 px-6 py-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Farmer Beneficiary Registry</h2>
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
                  'Submitted By',
                  'Last Updated',
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
                  <td className="px-6 py-4 text-sm text-slate-700">{beneficiary.submittedByLgu}</td>
                  <td className="px-6 py-4 text-sm text-slate-700">{formatDate(beneficiary.lastUpdated)}</td>
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
            {getPaginationRange(safePage, totalPages).map((pageNumber, index) =>
              pageNumber === '...' ? (
                <span key={`dots-${index}`} className="px-2 text-sm text-slate-400 select-none">…</span>
              ) : (
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
              )
            )}
            <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={safePage === totalPages} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
