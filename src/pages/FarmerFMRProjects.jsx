/* FarmerFMRProjects.jsx - FMR projects directory for farmers, at /farmer/fmr-projects
 * A trimmed port of UserFMRProjects.jsx (citizen portal): same shared list
 * components (FmrProjectListParts.jsx) and detail dialog, without the
 * citizen-only CSV export, date-range filter, and "Following" feature.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabaseFarmer as supabase } from "../lib/supabase";
import { notify } from "../lib/toast";
import Icons from "../components/Icons";
import FmrProjectDetailDialog from "../components/FmrProjectDetailDialog";
import { getPaginationRange } from "../lib/paginationUtils";
import { normalizeUserProjectStatus, isProjectOverdue } from "../lib/projectStatus";
import { getProjectBudgetSummary } from "../lib/budgetEstimate";
import { StatCard, FMRProjectCard, ProjectSkeleton, FMRProjectTable } from "../components/fmrProjects/FmrProjectListParts";

const statusFilters = ["On-Going", "Proposed", "Completed", "Overdue"];
const VIEW_MODE_STORAGE_KEY = "farmer-fmr-projects-view";
const ROWS_PER_PAGE_OPTIONS = [10, 25, 50];

export default function FarmerFMRProjects() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [tranchesByProjectId, setTranchesByProjectId] = useState({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("On-Going");
  const [yearFilter, setYearFilter] = useState("All");
  const [municipalityFilter, setMunicipalityFilter] = useState("All");
  const [sortBy, setSortBy] = useState("latest");
  const [selectedProject, setSelectedProject] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === "cards" || saved === "table") return saved;
    } catch {
      // storage unavailable: use the screen-size default
    }
    return typeof window !== "undefined" && window.innerWidth < 768 ? "cards" : "table";
  });
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const projectsPerPage = viewMode === "table" ? rowsPerPage : 9;

  const fetchProjects = async () => {
    try {
      setFetchError(null);
      const [{ data, error }, { data: tranchesData }] = await Promise.all([
        supabase.from("fmr_projects").select("*").order("status", { ascending: true }).order("accomplishment", { ascending: false }),
        supabase.from("project_tranches").select("id, project_id, tranche_order, tranche_name, percentage, amount, required_progress, status, released_amount, released_date").order("tranche_order", { ascending: true }),
      ]);
      if (error) {
        setFetchError(error.message);
        throw error;
      }
      const tMap = {};
      (tranchesData || []).forEach((t) => {
        if (!tMap[t.project_id]) tMap[t.project_id] = [];
        tMap[t.project_id].push(t);
      });
      setTranchesByProjectId(tMap);
      setProjects(data || []);
    } catch (e) {
      setFetchError(e.message || "Failed to load FMR projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
    const channel = supabase
      .channel("farmer-fmr-projects")
      .on("postgres_changes", { event: "*", schema: "public", table: "fmr_projects" }, fetchProjects)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  // /farmer/fmr-projects?project=<id> opens that project once the list has loaded.
  useEffect(() => {
    if (loading) return;
    const id = searchParams.get("project");
    if (!id) return;
    const match = projects.find((p) => String(p.id) === id);
    if (match) setSelectedProject(match);
    else notify("That project is no longer available.", "warning");
  }, [loading, projects, searchParams]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, yearFilter, municipalityFilter, sortBy, rowsPerPage, viewMode]);

  const getProjectDate = (project) => {
    const candidates = [project.updated_at, project.created_at, project.date_completed, project.target_completion_date];
    for (const value of candidates) {
      if (!value) continue;
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
  };

  const stats = {
    total: projects.length,
    ongoing: projects.filter((p) => normalizeUserProjectStatus(p.status) === "On-Going").length,
    proposed: projects.filter((p) => normalizeUserProjectStatus(p.status) === "Proposed").length,
    completed: projects.filter((p) => normalizeUserProjectStatus(p.status) === "Completed").length,
    overdue: projects.filter((p) => isProjectOverdue(p)).length,
    totalKm: projects.reduce((sum, p) => sum + (p.project_length_km || 0), 0).toFixed(2),
  };
  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  const yearOptions = [...new Set(projects.map((p) => Number(p.year_funded)).filter((y) => y && !Number.isNaN(y)))].sort((a, b) => b - a);
  const municipalityOptions = [...new Set(projects.map((p) => p.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const filtered = projects.filter((p) => {
    const name = (p.project_name || "").toLowerCase();
    const loc = (p.location || "").toLowerCase();
    const muni = (p.municipality || "").toLowerCase();
    const q = search.toLowerCase();

    const matchesSearch = !q || name.includes(q) || loc.includes(q) || muni.includes(q);
    const matchesStatus = statusFilter === "Overdue" ? isProjectOverdue(p) : normalizeUserProjectStatus(p.status) === statusFilter;
    const matchesYear = yearFilter === "All" || String(Number(p.year_funded)) === yearFilter;
    const matchesMunicipality = municipalityFilter === "All" || p.municipality === municipalityFilter;
    return matchesSearch && matchesStatus && matchesYear && matchesMunicipality;
  }).sort((a, b) => {
    if (sortBy === "name-asc") return (a.project_name || "").localeCompare(b.project_name || "");
    if (sortBy === "name-desc") return (b.project_name || "").localeCompare(a.project_name || "");
    if (sortBy === "progress-desc") return (Number(b.accomplishment) || 0) - (Number(a.accomplishment) || 0);
    if (sortBy === "progress-asc") return (Number(a.accomplishment) || 0) - (Number(b.accomplishment) || 0);
    if (sortBy === "budget-desc" || sortBy === "budget-asc") {
      const aBudget = getProjectBudgetSummary(a, tranchesByProjectId[a.id] || []).totalBudget || 0;
      const bBudget = getProjectBudgetSummary(b, tranchesByProjectId[b.id] || []).totalBudget || 0;
      return sortBy === "budget-desc" ? bBudget - aBudget : aBudget - bBudget;
    }
    if (sortBy === "year-desc" || sortBy === "year-asc") {
      const aYear = Number(a.year_funded) || 0;
      const bYear = Number(b.year_funded) || 0;
      return sortBy === "year-desc" ? bYear - aYear : aYear - bYear;
    }
    const aDate = getProjectDate(a)?.getTime() || 0;
    const bDate = getProjectDate(b)?.getTime() || 0;
    return bDate - aDate;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / projectsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const paginatedProjects = filtered.slice((safeCurrentPage - 1) * projectsPerPage, safeCurrentPage * projectsPerPage);

  return (
    <>
      <div className="space-y-6">
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200/60 animate-pulse">
                <div className="size-10 bg-zinc-200 rounded-xl mb-3" />
                <div className="h-8 w-12 bg-zinc-200 rounded mb-2" />
                <div className="h-4 w-20 bg-zinc-200 rounded" />
              </div>
            ))
          ) : (
            <>
              <StatCard icon={<Icons.Road />} value={stats.total} label="Total Projects" variant="emerald" />
              <StatCard icon={<Icons.Clock />} value={stats.ongoing} label="On-Going" variant="amber" />
              <StatCard icon={<Icons.Lightbulb />} value={stats.proposed} label="Proposed" variant="violet" />
              <StatCard icon={<Icons.CheckCircle />} value={stats.completed} label="Completed" variant="sky" />
              <StatCard icon={<Icons.Ruler />} value={`${stats.totalKm} km`} label="Total Road Length" variant="default" />
            </>
          )}
        </section>

        {!loading && (
          <section className="bg-white rounded-2xl border border-slate-200/60 p-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
              <div className="flex-1">
                <div className="h-7 w-full rounded-xl overflow-hidden border border-slate-100 flex bg-slate-100">
                  <div className="h-full bg-teal-500 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap" style={{ width: `${stats.total ? (stats.completed / stats.total) * 100 : 0}%` }}>
                    {stats.total ? `${Math.round((stats.completed / stats.total) * 100)}%` : "0%"}
                  </div>
                  <div className="h-full bg-amber-500 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap" style={{ width: `${stats.total ? (stats.ongoing / stats.total) * 100 : 0}%` }}>
                    {stats.total ? `${Math.round((stats.ongoing / stats.total) * 100)}%` : "0%"}
                  </div>
                  <div className="h-full bg-sky-500 text-white text-[11px] font-semibold flex items-center justify-center whitespace-nowrap" style={{ width: `${stats.total ? (stats.proposed / stats.total) * 100 : 0}%` }}>
                    {stats.total ? `${Math.round((stats.proposed / stats.total) * 100)}%` : "0%"}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-teal-500" />Completed</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-amber-500" />On-Going</span>
                  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-sky-500" />Proposed</span>
                </div>
              </div>
              <p className="text-sm font-bold text-slate-800 whitespace-nowrap">Overall Completion Rate: {completionRate}%</p>
            </div>
          </section>
        )}

        {fetchError && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
            <Icons.Warning />
            <div>
              <p className="font-medium">Unable to load FMR projects</p>
              <p className="mt-0.5 text-red-600">{fetchError}</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                <Icons.Search />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search projects"
                placeholder="Search by name, municipality, location..."
                className="w-full pl-10 pr-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"
              />
            </div>

            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} aria-label="Filter by year" className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[140px]">
              <option value="All">All Years</option>
              {yearOptions.map((year) => <option key={year} value={String(year)}>FY {year}</option>)}
            </select>

            <select value={municipalityFilter} onChange={(e) => setMunicipalityFilter(e.target.value)} aria-label="Filter by municipality" className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]">
              <option value="All">All Municipalities</option>
              {municipalityOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>

            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort projects" className="px-4 py-2.5 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none min-w-[170px]">
              <option value="latest">Sort: Latest</option>
              <option value="name-asc">Sort: Name A-Z</option>
              <option value="name-desc">Sort: Name Z-A</option>
              <option value="progress-desc">Sort: Progress High to Low</option>
              <option value="progress-asc">Sort: Progress Low to High</option>
              <option value="budget-desc">Sort: Budget High to Low</option>
              <option value="budget-asc">Sort: Budget Low to High</option>
              <option value="year-desc">Sort: Fiscal Year Newest</option>
              <option value="year-asc">Sort: Fiscal Year Oldest</option>
            </select>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {statusFilters.map((s) => {
              const count = s === "On-Going" ? stats.ongoing : s === "Proposed" ? stats.proposed : s === "Completed" ? stats.completed : stats.overdue;
              return (
                <button
                  key={s}
                  onClick={() => { setStatusFilter(s); setCurrentPage(1); }}
                  className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    statusFilter === s
                      ? s === "Overdue" ? "bg-red-600 text-white shadow-sm" : "bg-teal-600 text-white shadow-sm"
                      : s === "Overdue" ? "bg-white text-red-600 border border-red-200 hover:bg-red-50" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {s} {!loading && <span className="text-xs opacity-75">({count})</span>}
                </button>
              );
            })}
          </div>

          {(search || statusFilter !== "On-Going" || yearFilter !== "All" || municipalityFilter !== "All" || sortBy !== "latest") && (
            <div className="flex justify-end">
              <button
                onClick={() => { setSearch(""); setStatusFilter("On-Going"); setYearFilter("All"); setMunicipalityFilter("All"); setSortBy("latest"); setCurrentPage(1); }}
                className="px-3 py-2 rounded-lg text-sm font-medium text-teal-700 hover:text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-500">{filtered.length} project{filtered.length !== 1 ? "s" : ""} found</p>
          <div className="flex gap-1.5 p-1 bg-slate-100 rounded-2xl w-fit">
            {[{ id: "table", label: "Table", icon: <Icons.List /> }, { id: "cards", label: "Cards", icon: <Icons.Dashboard /> }].map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setViewMode(v.id);
                  try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, v.id); } catch { /* storage unavailable */ }
                }}
                aria-pressed={viewMode === v.id}
                title={`${v.label} view`}
                className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 ${
                  viewMode === v.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {v.icon}
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {!loading && filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
            <div className="mx-auto size-14 bg-slate-100 rounded-xl grid place-items-center text-slate-500 mb-3">
              <Icons.Road />
            </div>
            <p className="font-medium text-slate-900">{search || statusFilter !== "On-Going" ? "No matching FMR projects" : "No FMR projects loaded"}</p>
            <p className="text-sm text-slate-500 mt-1">{search || statusFilter !== "On-Going" ? "Try adjusting your search or filters" : "Check back soon"}</p>
          </div>
        ) : viewMode === "table" ? (
          <FMRProjectTable projects={paginatedProjects} loading={loading} onSelect={setSelectedProject} tranchesByProjectId={tranchesByProjectId} sortBy={sortBy} onSortChange={setSortBy} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <ProjectSkeleton key={i} />)
              : paginatedProjects.map((p) => <FMRProjectCard key={p.id} project={p} onClick={() => setSelectedProject(p)} tranches={tranchesByProjectId[p.id] || []} />)}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-500">
                Showing <span className="font-semibold text-slate-700">{(safeCurrentPage - 1) * projectsPerPage + 1}</span> to{" "}
                <span className="font-semibold text-slate-700">{Math.min(safeCurrentPage * projectsPerPage, filtered.length)}</span> of{" "}
                <span className="font-semibold text-slate-700">{filtered.length}</span> project{filtered.length !== 1 ? "s" : ""}
              </p>
              {viewMode === "table" && (
                <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} aria-label="Rows per page" title="Rows per page" className="px-3 py-2 border border-zinc-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none">
                  {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  Previous
                </button>
                {getPaginationRange(safeCurrentPage, totalPages).map((page, idx) => (
                  page === "..." ? (
                    <span key={`dots-${idx}`} className="px-3 py-2 text-slate-500 text-sm font-semibold select-none">...</span>
                  ) : (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                        safeCurrentPage === page ? "bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25" : "border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm"
                      }`}
                    >
                      {page}
                    </button>
                  )
                ))}
                <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && projects.length > 0 && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-center">
            <p className="text-xs text-slate-500">
              Data from Department of Agriculture &mdash; RAED Region VI &middot; Farm-to-Market Road Development Program (FMRDP)
            </p>
          </div>
        )}
      </div>

      {selectedProject && (
        <FmrProjectDetailDialog
          project={selectedProject}
          tranches={tranchesByProjectId[selectedProject.id] || []}
          onClose={() => setSelectedProject(null)}
        />
      )}
    </>
  );
}
