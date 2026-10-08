import Modal from '../ui/Modal';
import { Button } from '../ui/Button';
import { getStatusStyle, normalizeUserProjectStatus } from '../../lib/projectStatus';
import { formatPercentage } from '../../lib/percentageFormat';

const SURFACE_COLORS = { Concrete: '#0ea5e9', Asphalt: '#8b5cf6', Gravel: '#f59e0b', Earth: '#a8a29e' };

function Fact({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

const km = (v) => (v === null || v === undefined || v === '' ? 'N/A' : `${Number(v).toFixed(2)} km`);

export default function RoadInventoryDetailDialog({ road, linkedProjects = [], onSelectProject, onClose }) {
  const surfaces = (road.surfaces || []).filter((s) => Number(s.length) > 0);
  const places = Array.isArray(road.placeChain) && road.placeChain.length > 0 ? road.placeChain : [road.barangay].filter(Boolean);
  const sitios = Array.isArray(road.sitios) ? road.sitios.filter(Boolean) : [];

  return (
    <Modal
      onClose={onClose}
      title={road.roadName || 'Road details'}
      description={[road.classification, places.join(' → ')].filter(Boolean).join(' · ')}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Fact label="Total length" value={km(road.lengthKm)} />
          <Fact label="Paved" value={km(road.pavedKm)} />
          <Fact label="Unpaved" value={km(road.unpavedKm)} />
          <Fact label="Dominant surface" value={road.surfaceType || 'Unknown'} />
          <Fact label="Overall condition" value={road.condition || 'N/A'} />
          <Fact label="Right of way" value={road.row ? `${Number(road.row).toFixed(2)} m` : 'N/A'} />
          <Fact label="Year constructed" value={road.yearConstructed || 'N/A'} />
          {Number(road.unpavedKm) > 0 && (
            <Fact label="Unpaved gap" value={[road.unpavedType, road.unpavedCondition].filter(Boolean).join(', ') || 'N/A'} />
          )}
        </div>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Surface breakdown</h3>
          {surfaces.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No surveyed segments recorded for this road.</p>
          ) : (
            <>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                {surfaces.map((s) => (
                  <div key={s.type} style={{ width: `${s.pct || 0}%`, background: SURFACE_COLORS[s.type] || '#94a3b8' }} />
                ))}
              </div>
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th scope="col" className="py-2 font-medium">Surface</th>
                    <th scope="col" className="py-2 text-right font-medium">Length</th>
                    <th scope="col" className="py-2 text-right font-medium">Share</th>
                    <th scope="col" className="py-2 pl-4 font-medium">Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {surfaces.map((s) => (
                    <tr key={s.type}>
                      <td className="py-2 text-slate-800">
                        <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: SURFACE_COLORS[s.type] || '#94a3b8' }} aria-hidden="true" />
                        {s.type}
                      </td>
                      <td className="py-2 text-right tabular-nums text-slate-700">{km(s.length)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-700">{s.pct ?? 'N/A'}%</td>
                      <td className="py-2 pl-4 text-slate-700">{s.condition || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {(places.length > 0 || sitios.length > 0) && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Areas served</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {places.map((p) => (
                <span key={`b-${p}`} className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Brgy. {p}</span>
              ))}
              {sitios.map((s) => (
                <span key={`s-${s}`} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-700">Sitio {s}</span>
              ))}
            </div>
            {road.barangaySource === 'name-parse' && (
              <p className="mt-2 text-[11px] text-slate-500">Barangays are read from the surveyed road name.</p>
            )}
            {road.barangayNote && <p className="mt-1 text-[11px] text-slate-500">{road.barangayNote}</p>}
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">FMR projects on this road</h3>
          {linkedProjects.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No DA FMR project is recorded on this road.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {linkedProjects.map((p) => {
                const status = normalizeUserProjectStatus(p.status);
                const style = getStatusStyle(status);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onSelectProject(p)}
                      className="w-full rounded-xl border border-slate-200 p-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900">{p.project_name}</p>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style.badge}`}>{status}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {[p.year_funded && `Funded ${p.year_funded}`, status !== 'Proposed' && `${formatPercentage(p.accomplishment ?? 0)} accomplished`, 'View project details']
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
