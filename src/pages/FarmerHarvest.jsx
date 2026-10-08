/* FarmerHarvest.jsx - Log and track harvests, at /farmer/harvest */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { supabaseFarmer as supabase } from "../lib/supabase";
import { notify } from "../lib/toast";
import { useFarmerRecord } from "../lib/useFarmerRecord";
import { BENEFICIARY_CROPS } from "../utils/farmerBeneficiaryData";
import { yieldPerHectare, formatYield, compareToPrevious } from "../lib/harvestMath";
import Icons from "../components/Icons";
import FarmerHarvestDetailModal from "../components/farmer/FarmerHarvestDetailModal";

const PHOTO_BUCKET = "farmer-harvest-photos";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB
const QUALITY_GRADES = ["Grade A", "Grade B", "Grade C"];

function emptyForm(defaultCrop) {
  return {
    crop: defaultCrop || "",
    quantityKg: "",
    areaHa: "",
    harvestDate: new Date().toISOString().split("T")[0],
    qualityGrade: "",
    remarks: "",
  };
}

function extensionFor(file) {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

/**
 * Sorts harvest entries for the history list display (does not mutate
 * `logs`). Entries with no computable yield (missing/zero area) always
 * sink to the bottom on "yield-*" sorts, in either direction.
 */
function sortHarvestLogs(logs, sortBy) {
  const withYield = (h) => yieldPerHectare(h.quantity_kg, h.area_ha);
  // Entries with no yield (missing/zero area) always sink to the bottom,
  // regardless of sort direction -- "lowest yield" shouldn't mean "no data".
  const byYield = (a, b, dir) => {
    const ya = withYield(a);
    const yb = withYield(b);
    if (ya === null && yb === null) return 0;
    if (ya === null) return 1;
    if (yb === null) return -1;
    return dir * (ya - yb);
  };

  const sorted = [...logs];
  switch (sortBy) {
    case "oldest":
      sorted.sort((a, b) => new Date(a.harvest_date) - new Date(b.harvest_date));
      break;
    case "qty-desc":
      sorted.sort((a, b) => Number(b.quantity_kg) - Number(a.quantity_kg));
      break;
    case "qty-asc":
      sorted.sort((a, b) => Number(a.quantity_kg) - Number(b.quantity_kg));
      break;
    case "yield-desc":
      sorted.sort((a, b) => byYield(a, b, -1));
      break;
    case "yield-asc":
      sorted.sort((a, b) => byYield(a, b, 1));
      break;
    case "newest":
    default:
      sorted.sort((a, b) => new Date(b.harvest_date) - new Date(a.harvest_date));
  }
  return sorted;
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl sm:text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function FarmerHarvest() {
  const { user, farmerRecord } = useFarmerRecord();
  const [harvestLogs, setHarvestLogs] = useState([]);
  const [harvestLoading, setHarvestLoading] = useState(false);
  const [cropFilter, setCropFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [gradeFilter, setGradeFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");
  const [editingId, setEditingId] = useState(null);
  const [harvestForm, setHarvestForm] = useState(emptyForm());
  const [photoFile, setPhotoFile] = useState(null);
  const [photoError, setPhotoError] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);

  // Pre-fill crop (farmer's registered crop) and area (the whole farm's
  // area, as a sensible default -- editable, since one harvest may not
  // cover the whole farm) once the farmer's own record has loaded.
  useEffect(() => {
    if (!farmerRecord || editingId) return;
    setHarvestForm((prev) => ({
      ...prev,
      crop: prev.crop || farmerRecord.crop || "",
      areaHa: prev.areaHa || (farmerRecord.farm_area_ha ? String(farmerRecord.farm_area_ha) : ""),
    }));
  }, [farmerRecord, editingId]);

  const fetchHarvestLogs = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("farmer_harvest_logs")
      .select("*")
      .eq("farmer_id", user.id)
      .order("harvest_date", { ascending: true });
    if (error) {
      notify("We couldn't load your harvest records. Please try again.", "error");
      return;
    }
    setHarvestLogs(data || []);
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;
    fetchHarvestLogs();
    const subHarvests = supabase
      .channel("farmer-harvests")
      .on("postgres_changes", { event: "*", schema: "public", table: "farmer_harvest_logs", filter: `farmer_id=eq.${user.id}` }, fetchHarvestLogs)
      .subscribe();
    return () => supabase.removeChannel(subHarvests);
  }, [user, fetchHarvestLogs]);

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    setPhotoError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("That photo is too large (max 5MB).");
      return;
    }
    setPhotoFile(file);
  };

  const startEdit = (entry) => {
    setSelectedEntry(null);
    setEditingId(entry.id);
    setPhotoFile(null);
    setPhotoError("");
    setHarvestForm({
      crop: entry.crop || "",
      quantityKg: String(entry.quantity_kg ?? ""),
      areaHa: entry.area_ha != null ? String(entry.area_ha) : "",
      harvestDate: entry.harvest_date,
      qualityGrade: entry.quality_grade || "",
      remarks: entry.remarks || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setPhotoFile(null);
    setPhotoError("");
    setHarvestForm(emptyForm(farmerRecord?.crop));
  };

  const handleHarvestSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    const qty = Number(harvestForm.quantityKg);
    if (!qty || qty <= 0) {
      notify("Please enter a valid harvest quantity.", "error");
      return;
    }
    const area = harvestForm.areaHa.trim() ? Number(harvestForm.areaHa) : null;
    if (area !== null && (!Number.isFinite(area) || area <= 0)) {
      notify("Harvest area must be a positive number, or left blank.", "error");
      return;
    }

    setHarvestLoading(true);
    let photoWarning = false;
    try {
      let photoPath = editingId ? undefined : null; // undefined = "don't touch" on edit unless a new file was chosen
      if (photoFile) {
        try {
          const path = `harvests/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(photoFile)}`;
          const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, photoFile, { contentType: photoFile.type });
          if (upErr) throw upErr;
          photoPath = path;
        } catch {
          photoWarning = true;
          photoPath = editingId ? undefined : null;
        }
      }

      const payload = {
        crop: harvestForm.crop || farmerRecord?.crop,
        quantity_kg: qty,
        area_ha: area,
        harvest_date: harvestForm.harvestDate,
        quality_grade: harvestForm.qualityGrade || null,
        remarks: harvestForm.remarks.trim(),
      };
      if (photoPath !== undefined) payload.photo_path = photoPath;

      if (editingId) {
        payload.updated_at = new Date().toISOString();
        const { error } = await supabase.from("farmer_harvest_logs").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("farmer_harvest_logs").insert({ ...payload, farmer_id: user.id });
        if (error) throw error;
      }

      notify(
        photoWarning
          ? `Harvest ${editingId ? "updated" : "saved"}, but the photo could not be attached.`
          : `Harvest ${editingId ? "updated" : "logged"} successfully!`,
        photoWarning ? "warning" : "success"
      );
      setEditingId(null);
      setPhotoFile(null);
      setHarvestForm((prev) => ({ ...emptyForm(farmerRecord?.crop), areaHa: prev.areaHa }));
    } catch (err) {
      notify("Your harvest could not be saved. Please check your information and try again.", "error");
      console.error("[harvest] save failed:", err);
    } finally {
      setHarvestLoading(false);
    }
  };

  // RLS (farmer_id = auth.uid()) already limits this to the farmer's own
  // entries; the realtime subscription refreshes the list automatically.
  const handleDeleteHarvest = async (id) => {
    try {
      const { error } = await supabase.from("farmer_harvest_logs").delete().eq("id", id);
      if (error) throw error;
    } catch (err) {
      notify("This harvest record could not be deleted. Please try again.", "error");
      console.error("[harvest] delete failed:", err);
    }
  };

  // Only the crops actually logged -- not the full BENEFICIARY_CROPS list,
  // which would mostly offer crops with nothing to show.
  const loggedCrops = useMemo(
    () => [...new Set(harvestLogs.map((h) => h.crop).filter(Boolean))].sort(),
    [harvestLogs]
  );
  const loggedYears = useMemo(
    () => [...new Set(harvestLogs.map((h) => new Date(h.harvest_date).getFullYear()))].sort((a, b) => b - a),
    [harvestLogs]
  );
  const loggedGrades = useMemo(
    () => [...new Set(harvestLogs.map((h) => h.quality_grade || "Ungraded"))].sort(),
    [harvestLogs]
  );

  // Crop/year/grade apply to both the chart and the list; the chart stays
  // chronological (as fetched) regardless of sortBy, which only reorders
  // the list below it.
  const filteredLogs = useMemo(() => {
    return harvestLogs.filter((h) => {
      if (cropFilter !== "All" && h.crop !== cropFilter) return false;
      if (yearFilter !== "All" && String(new Date(h.harvest_date).getFullYear()) !== yearFilter) return false;
      if (gradeFilter !== "All" && (h.quality_grade || "Ungraded") !== gradeFilter) return false;
      return true;
    });
  }, [harvestLogs, cropFilter, yearFilter, gradeFilter]);

  const filteredTotalKg = useMemo(
    () => filteredLogs.reduce((sum, h) => sum + (Number(h.quantity_kg) || 0), 0),
    [filteredLogs]
  );

  const filtersActive = cropFilter !== "All" || yearFilter !== "All" || gradeFilter !== "All" || sortBy !== "newest";

  const clearFilters = () => {
    setCropFilter("All");
    setYearFilter("All");
    setGradeFilter("All");
    setSortBy("newest");
  };

  const sortedLogs = useMemo(() => sortHarvestLogs(filteredLogs, sortBy), [filteredLogs, sortBy]);

  // harvestLogs is already fetched ascending by harvest_date, so each
  // crop's bucket stays ascending too -- what compareToPrevious needs.
  const logsByCropAsc = useMemo(() => {
    const map = {};
    harvestLogs.forEach((h) => {
      if (!map[h.crop]) map[h.crop] = [];
      map[h.crop].push(h);
    });
    return map;
  }, [harvestLogs]);

  const selectedComparison = useMemo(() => {
    if (!selectedEntry) return null;
    const sameCrop = logsByCropAsc[selectedEntry.crop] || [];
    const idx = sameCrop.findIndex((h) => h.id === selectedEntry.id);
    return idx >= 0 ? compareToPrevious(sameCrop.slice(0, idx + 1)) : null;
  }, [selectedEntry, logsByCropAsc]);

  // Portfolio-wide, independent of the crop filter below -- "how am I doing
  // overall" shouldn't change just because the history list is narrowed.
  const summary = useMemo(() => {
    const totalKg = harvestLogs.reduce((sum, h) => sum + (Number(h.quantity_kg) || 0), 0);
    const thisYear = new Date().getFullYear();
    const thisYearKg = harvestLogs
      .filter((h) => new Date(h.harvest_date).getFullYear() === thisYear)
      .reduce((sum, h) => sum + (Number(h.quantity_kg) || 0), 0);
    const yields = harvestLogs.map((h) => yieldPerHectare(h.quantity_kg, h.area_ha)).filter((v) => v !== null);
    const avgYield = yields.length > 0 ? yields.reduce((s, v) => s + v, 0) / yields.length : null;
    return { totalKg, thisYearKg, records: harvestLogs.length, avgYield };
  }, [harvestLogs]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-emerald-700 via-emerald-800 to-teal-800 text-white rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-base sm:text-lg flex items-center gap-2">
          <Icons.Wheat />
          Keep track of what you grow
        </h3>
        <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
          Every time you harvest, log the crop, how much, and when. This page keeps a running history and a simple chart so you can see your output over time — nothing is sent anywhere else.
        </p>
      </div>

      {harvestLogs.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Total Harvest" value={`${summary.totalKg.toLocaleString()} kg`} />
          <SummaryCard label="This Year" value={`${summary.thisYearKg.toLocaleString()} kg`} />
          <SummaryCard label="Harvest Records" value={summary.records} />
          <SummaryCard label="Average Yield" value={formatYield(summary.avgYield)} />
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">
              {editingId ? "Edit Harvest" : "1. Log a Harvest"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {editingId ? "Update the details below, then save." : 'Fill in the details below, then press "Log Harvest" to save it.'}
            </p>
          </div>
          {editingId && (
            <button type="button" onClick={cancelEdit} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
              Cancel
            </button>
          )}
        </div>

        <form onSubmit={handleHarvestSubmit} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Crop</label>
              <select
                value={harvestForm.crop}
                onChange={(e) => setHarvestForm((prev) => ({ ...prev, crop: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {BENEFICIARY_CROPS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Quantity (kg)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={harvestForm.quantityKg}
                onChange={(e) => setHarvestForm((prev) => ({ ...prev, quantityKg: e.target.value }))}
                placeholder="0"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Area (ha) <span className="font-normal text-slate-400">optional</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={harvestForm.areaHa}
                onChange={(e) => setHarvestForm((prev) => ({ ...prev, areaHa: e.target.value }))}
                placeholder="e.g. 1.5"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Harvest Date</label>
              <input
                type="date"
                value={harvestForm.harvestDate}
                onChange={(e) => setHarvestForm((prev) => ({ ...prev, harvestDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Quality / Grade <span className="font-normal text-slate-400">optional</span></label>
              <select
                value={harvestForm.qualityGrade}
                onChange={(e) => setHarvestForm((prev) => ({ ...prev, qualityGrade: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">Ungraded</option>
                {QUALITY_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Photo <span className="font-normal text-slate-400">optional</span></label>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoChange}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
              />
              {photoFile && <p className="mt-1 text-[11px] text-emerald-700">{photoFile.name} selected</p>}
              {photoError && <p className="mt-1 text-[11px] text-red-600">{photoError}</p>}
              {editingId && !photoFile && (
                <p className="mt-1 text-[11px] text-slate-400">Leave blank to keep the current photo.</p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Remarks <span className="font-normal text-slate-400">optional</span></label>
            <input
              type="text"
              value={harvestForm.remarks}
              onChange={(e) => setHarvestForm((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="e.g. sold at Leon Public Market"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={harvestLoading}
              className="w-full sm:w-auto px-6 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-bold text-sm py-2.5 rounded-xl transition-colors"
            >
              {harvestLoading ? "Saving..." : editingId ? "Save Changes" : "Log Harvest"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <h3 className="font-bold text-slate-900 text-base sm:text-lg flex items-center gap-1.5">
          <Icons.Chart />
          2. Your Harvest History
        </h3>

        {harvestLogs.length > 1 && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
              <select
                value={cropFilter}
                onChange={(e) => setCropFilter(e.target.value)}
                aria-label="Filter by crop"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium bg-white"
              >
                <option value="All">All Crops</option>
                {loggedCrops.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                aria-label="Filter by year"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium bg-white"
              >
                <option value="All">All Years</option>
                {loggedYears.map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                aria-label="Filter by grade"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium bg-white"
              >
                <option value="All">All Grades</option>
                {loggedGrades.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort by"
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium bg-white"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="qty-desc">Highest Quantity</option>
                <option value="qty-asc">Lowest Quantity</option>
                <option value="yield-desc">Highest Yield</option>
                <option value="yield-asc">Lowest Yield</option>
              </select>
            </div>
            {filtersActive && (
              <div className="flex justify-end">
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {harvestLogs.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs sm:text-sm">
            No harvest records yet. Start recording your harvest to keep track of your production and monitor your yield over time.
          </div>
        ) : sortedLogs.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs sm:text-sm space-y-2">
            <p className="font-semibold text-slate-500">No harvests found</p>
            <p>Try changing your filters to see other harvest records.</p>
            <button type="button" onClick={clearFilters} className="text-emerald-700 font-semibold hover:underline">
              Clear Filters
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 -mt-1">
              {filtersActive ? (
                <>Showing {sortedLogs.length} of {harvestLogs.length} harvest record{harvestLogs.length === 1 ? "" : "s"} &middot; <span className="font-bold text-slate-800">{filteredTotalKg.toLocaleString()} kg</span></>
              ) : (
                <>Total: <span className="font-bold text-slate-800">{filteredTotalKg.toLocaleString()} kg</span> across {filteredLogs.length} entr{filteredLogs.length === 1 ? "y" : "ies"}</>
              )}
            </p>
            <p className="text-[11px] text-slate-400 -mt-2">Each point is one harvest record on its date — not a running total.</p>
            <div className="h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredLogs.map((h) => ({
                  ...h,
                  dateLabel: new Date(h.harvest_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                }))}>
                  <defs>
                    <linearGradient id="harvestFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d97706" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#d97706" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="dateLabel" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={40} />
                  <RechartsTooltip formatter={(value) => [`${value} kg`, "Harvest on this date"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="quantity_kg" stroke="#d97706" strokeWidth={2} fill="url(#harvestFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="divide-y divide-slate-100 border-t border-slate-100 pt-2">
              {sortedLogs.map((h) => (
                <div
                  key={h.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedEntry(h)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedEntry(h); } }}
                  className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50/80 rounded-lg px-1.5 -mx-1.5 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {h.crop} &middot; {Number(h.quantity_kg).toLocaleString()} kg
                      {h.photo_path && (
                        <span className="inline-flex align-middle ml-1.5 text-slate-400" title="Has a photo" aria-hidden="true">
                          <Icons.Photo />
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(h.harvest_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      {h.area_ha ? ` · ${formatYield(yieldPerHectare(h.quantity_kg, h.area_ha))}` : ""}
                      {h.remarks ? ` · ${h.remarks}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleDeleteHarvest(h.id); }}
                    aria-label={`Delete harvest entry from ${h.harvest_date}`}
                    className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Icons.X />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedEntry && (
        <FarmerHarvestDetailModal
          entry={selectedEntry}
          comparison={selectedComparison}
          onClose={() => setSelectedEntry(null)}
          onEdit={startEdit}
          onDelete={handleDeleteHarvest}
        />
      )}
    </div>
  );
}
