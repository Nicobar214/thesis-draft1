import { useMemo } from 'react';
import { Marker, Popup } from 'react-leaflet';
import BaseTiles from '../map/BaseTiles';
import L from 'leaflet';

// Every project marker on this map already uses emerald (Completed), amber
// (On-Going) or blue (Proposed), so a report pin in any of those colors reads
// as "another project" at a glance. Pink/magenta doesn't appear anywhere else
// on the map (routes, gaps, legend), so a report pin is unmistakable on sight;
// status is still shown in the popup text rather than encoded by hue.
const REPORT_PIN_COLOR = '#db2777';

function pinIcon(color) {
  return new L.DivIcon({
    className: 'admin-report-pin',
    html: `<div style="background:${color};width:24px;height:24px;border-radius:9999px;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center"><div style="width:6px;height:6px;border-radius:9999px;background:#fff"></div></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

/** The selected theme's tiles (see lib/basemaps). */
export function AdminBaseTile({ basemap = 'street' }) {
  return <BaseTiles basemap={basemap} />;
}

/** Public reports as pins colored by status. Must render inside a MapContainer. */
export function AdminReportPins({ reports, visible, onOpen }) {
  const points = useMemo(() => (reports || [])
    .map((r) => {
      const lat = Number(r.latitude);
      const lng = Number(r.longitude);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { report: r, lat, lng } : null;
    })
    .filter(Boolean), [reports]);

  if (!visible) return null;
  return points.map(({ report, lat, lng }) => (
    <Marker key={`admin-report-pin-${report.id}`} position={[lat, lng]} icon={pinIcon(REPORT_PIN_COLOR)}>
      <Popup>
        <div className="space-y-1 p-1 text-xs">
          <p className="font-bold capitalize text-slate-900">{report.status || 'pending'}{report.verification ? ` · ${report.verification}` : ''}</p>
          <p className="text-slate-600">{report.description}</p>
          <p className="text-slate-500">{[report.barangay, report.municipality].filter(Boolean).join(', ')}</p>
          {report.project_name && <p className="text-slate-500">Project: {report.project_name}</p>}
          {onOpen && (
            <button type="button" onClick={() => onOpen(report)} className="mt-1 rounded-md bg-teal-600 px-2.5 py-1 font-semibold text-white hover:bg-teal-700">
              Open case file
            </button>
          )}
        </div>
      </Popup>
    </Marker>
  ));
}
