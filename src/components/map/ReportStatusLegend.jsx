/* ReportStatusLegend.jsx — the "Your reports" legend section shared by the
 * citizen maps. One entry per status the citizen actually has a pin for, in
 * workflow order (submitted -> ... -> resolved / closed), with its count and the
 * same color the pin uses -- so every pin color on the map is explained.
 */
import { useMemo } from 'react';
import { LegendGroup, LegendDot } from './MapPanels';
import { CITIZEN_STATUS, getCitizenStatus } from '../../lib/publicReportStatus';
import { CITIZEN_STATUS_HEX } from '../../lib/useMyReports';

const STATUS_ORDER = Object.values(CITIZEN_STATUS)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  .map((s) => s.key);

export default function ReportStatusLegend({ reports, label = 'Your reports' }) {
  const counts = useMemo(() => {
    const c = new Map();
    (reports || []).forEach((r) => {
      const st = getCitizenStatus(r);
      c.set(st.key, { label: st.label, n: (c.get(st.key)?.n || 0) + 1 });
    });
    return c;
  }, [reports]);

  return (
    <LegendGroup label={label}>
      {STATUS_ORDER.filter((key) => counts.has(key)).map((key) => (
        <LegendDot
          key={key}
          style={{ background: CITIZEN_STATUS_HEX[key] || '#64748b' }}
          label={counts.get(key).label}
          count={counts.get(key).n}
        />
      ))}
    </LegendGroup>
  );
}
