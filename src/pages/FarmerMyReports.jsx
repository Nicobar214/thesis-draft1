/* FarmerMyReports.jsx - Track the farmer's own submitted road reports, at /farmer/reports */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardListIcon, TriangleAlertIcon } from "lucide-react";
import { supabaseFarmer as supabase } from "../lib/supabase";
import { useFarmerReports } from "../lib/useFarmerReports";
import Icons from "../components/Icons";
import DAResolutionCertificate from "../components/publicReports/DAResolutionCertificate";
import PublicReportRouteMapPanel from "../components/publicReports/PublicReportRouteMapPanel";

export default function FarmerMyReports() {
  const navigate = useNavigate();
  const { reports: myReports } = useFarmerReports();
  const [searchParams] = useSearchParams();

  const [expandedMapReportId, setExpandedMapReportId] = useState(null);
  const [mapProjectByReportId, setMapProjectByReportId] = useState({});
  const [mapRouteByReportId, setMapRouteByReportId] = useState({});

  const [selectedReportCert, setSelectedReportCert] = useState(null);
  const [certFieldFinding, setCertFieldFinding] = useState(null);
  const [certResolution, setCertResolution] = useState(null);
  const [showCertModal, setShowCertModal] = useState(false);

  const [focusReportId, setFocusReportId] = useState(null);

  // /farmer/reports?report=<id> (from a notification) opens that report once the list has loaded.
  useEffect(() => {
    const id = searchParams.get("report");
    if (!id || myReports.length === 0) return;
    const match = myReports.find((r) => String(r.id) === id);
    if (match) setFocusReportId(match.id);
  }, [searchParams, myReports]);

  // Scroll to, and briefly highlight, the report a notification pointed at.
  useEffect(() => {
    if (!focusReportId) return undefined;
    const scrollTimer = setTimeout(() => {
      document.getElementById("farmer-report-" + focusReportId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = setTimeout(() => setFocusReportId(null), 5000);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [focusReportId]);

  // Resolve the FMR project for a report and toggle its inline route map.
  // project_id on public_reports can be stored as a prefixed string (e.g.
  // "fmr-<uuid>") rather than the raw fmr_projects.id, so a direct id match
  // can miss -- always fall back to matching by project name.
  const toggleReportMap = async (rpt) => {
    if (expandedMapReportId === rpt.id) {
      setExpandedMapReportId(null);
      return;
    }
    setExpandedMapReportId(rpt.id);
    if (mapProjectByReportId[rpt.id] !== undefined) return;

    try {
      let projectRow = null;
      if (rpt.project_id) {
        const { data } = await supabase.from("fmr_projects").select("*").eq("id", rpt.project_id).maybeSingle();
        projectRow = data || null;
      }
      if (!projectRow && rpt.project_name) {
        const { data } = await supabase.from("fmr_projects").select("*").ilike("project_name", String(rpt.project_name)).limit(1).maybeSingle();
        projectRow = data || null;
      }
      setMapProjectByReportId((prev) => ({ ...prev, [rpt.id]: projectRow }));

      if (projectRow?.id) {
        const { data: routeRow } = await supabase.from("project_routes").select("*").eq("project_id", projectRow.id).maybeSingle();
        setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: routeRow || null }));
      } else {
        setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: null }));
      }
    } catch {
      setMapProjectByReportId((prev) => ({ ...prev, [rpt.id]: null }));
      setMapRouteByReportId((prev) => ({ ...prev, [rpt.id]: null }));
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-900 text-base sm:text-lg">My Submitted Road Reports</h3>
            <p className="text-xs text-slate-500 mt-0.5">Track the status of damage reports submitted from your account.</p>
          </div>
          <button
            onClick={() => navigate("/farmer/report")}
            className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 w-full sm:w-auto"
          >
            <span><TriangleAlertIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />Submit New Report</span>
          </button>
        </div>

        {myReports.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <ClipboardListIcon className="size-9 mx-auto text-slate-300" aria-hidden="true" />
            <p className="font-semibold text-slate-700 text-sm">No reports submitted yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">If you encounter issues on your FMR access road, click "Submit New Report" to alert your LGU and DA engineers.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {myReports.map((rpt) => {
              const statusCls =
                rpt.status === "resolved" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                rpt.status === "reviewed" ? "bg-blue-100 text-blue-800 border-blue-200" :
                "bg-amber-100 text-amber-800 border-amber-200";

              return (
                <div key={rpt.id} id={"farmer-report-" + rpt.id} className={"p-4 rounded-xl border bg-slate-50/50 hover:bg-white transition-all space-y-2 " + (rpt.id === focusReportId ? "border-amber-300 ring-2 ring-amber-300" : "border-slate-200")}>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <span className="font-bold text-slate-900 text-sm sm:text-base block">{rpt.project_name || "FMR Road Issue"}</span>
                      <p className="text-xs text-slate-500">{rpt.barangay || "N/A"}, {rpt.municipality || "Leon"}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold border uppercase tracking-wider ${statusCls}`}>
                        {rpt.status || "Pending"}
                      </span>
                    </div>
                  </div>

                  {rpt.description && (
                    <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200/80 italic">
                      "{rpt.description}"
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50 gap-2">
                    <span>Submitted: {new Date(rpt.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                    <span>Category: <strong className="text-slate-700 capitalize">{rpt.category || "Road Issue"}</strong></span>
                    <span>Verification: <strong className="text-emerald-700 font-semibold">{rpt.verification || "Reported"}</strong></span>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleReportMap(rpt)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 transition-all"
                  >
                    <Icons.MapPin />
                    <span>{expandedMapReportId === rpt.id ? "Hide Report Pin & Project Route" : "View Report Pin & Project Route"}</span>
                  </button>

                  {expandedMapReportId === rpt.id && (
                    mapProjectByReportId[rpt.id] === undefined ? (
                      <p className="text-xs text-slate-400 text-center py-3">Loading project route…</p>
                    ) : (
                      <PublicReportRouteMapPanel
                        project={mapProjectByReportId[rpt.id]}
                        routeRecord={mapRouteByReportId[rpt.id]}
                        reportLatitude={rpt.latitude}
                        reportLongitude={rpt.longitude}
                        heightClass="h-56"
                        title="Report Pin & Project Route"
                        showLegend={false}
                      />
                    )
                  )}

                  {rpt.status === "resolved" ? (
                    <button
                      onClick={async () => {
                        setSelectedReportCert(rpt);
                        const [res1, res2] = await Promise.all([
                          supabase.from("public_report_field_findings_citizen_view").select("*").eq("report_id", rpt.id).order("submitted_at", { ascending: false }).limit(1).maybeSingle(),
                          supabase.from("public_report_resolutions_citizen_view").select("*").eq("report_id", rpt.id).order("resolved_at", { ascending: false }).limit(1).maybeSingle(),
                        ]);
                        setCertFieldFinding(res1?.data || null);
                        setCertResolution(res2?.data || null);
                        setShowCertModal(true);
                      }}
                      className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                    >
                      <Icons.Document />
                      <span>View Official DA Resolution Certificate</span>
                    </button>
                  ) : (
                    <div className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-500 rounded-xl text-xs font-semibold border border-slate-200">
                      <Icons.Clock />
                      <span>Resolution certificate is issued once the DA settles this road issue</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showCertModal && selectedReportCert && (
        <DAResolutionCertificate
          report={selectedReportCert}
          fieldFinding={certFieldFinding}
          resolution={certResolution}
          onClose={() => setShowCertModal(false)}
        />
      )}
    </>
  );
}
