import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { Panel, EmptyState, UnavailableState } from './analyticsParts';
import { fmtInt } from '../../lib/lguAnalytics';

const ACCENT = '#0d9488';
const TOP_CROPS = 8;
const tooltipStyle = { borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,.08)', fontSize: 12 };
const kgTick = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : String(v));

function HarvestByCrop({ summary, unavailable }) {
  const shown = summary.byCrop.slice(0, TOP_CROPS);
  const subtitle = summary.byCrop.length > TOP_CROPS
    ? `Top ${TOP_CROPS} of ${summary.byCrop.length} crops, in kilograms`
    : 'Total farmer-reported harvest per crop, in kilograms';

  return (
    <Panel title="Reported Harvest by Crop" subtitle={unavailable ? undefined : subtitle}>
      {unavailable ? (
        <UnavailableState>Harvest records could not be loaded.</UnavailableState>
      ) : shown.length === 0 ? (
        <EmptyState>No reported harvest data available for this selection.</EmptyState>
      ) : (
        <div style={{ height: Math.max(160, shown.length * 34) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={shown} layout="vertical" margin={{ top: 0, right: 56, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" tickFormatter={kgTick} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="crop" width={96} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#f8fafc' }} formatter={(v) => [`${fmtInt(Math.round(v))} kg`, 'Reported harvest']} />
              <Bar dataKey="kg" fill={ACCENT} radius={[0, 4, 4, 0]} barSize={16} isAnimationActive={false}>
                <LabelList dataKey="kg" position="right" formatter={(v) => fmtInt(Math.round(v))} style={{ fontSize: 11, fill: '#334155' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

function HarvestTrend({ summary, unavailable }) {
  return (
    <Panel title="Reported Harvest Trend" subtitle={unavailable ? undefined : 'Monthly total of farmer-reported harvest, in kilograms'}>
      {unavailable ? (
        <UnavailableState>Harvest records could not be loaded.</UnavailableState>
      ) : summary.records === 0 ? (
        <EmptyState>No reported harvest data available for this selection.</EmptyState>
      ) : summary.trend === null ? (
        <EmptyState>Not enough history for a trend yet. Harvests need to be reported in at least two different months.</EmptyState>
      ) : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={summary.trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tickFormatter={kgTick} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${fmtInt(Math.round(v))} kg`, 'Reported harvest']} />
              <Line type="monotone" dataKey="kg" stroke={ACCENT} strokeWidth={2} dot={{ r: 3, fill: ACCENT }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

export default function LguHarvestAnalytics({ summary, unavailable, unattributedHarvest }) {
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-2">
        <HarvestByCrop summary={summary} unavailable={unavailable} />
        <HarvestTrend summary={summary} unavailable={unavailable} />
      </div>
      {!unavailable && unattributedHarvest > 0 && (
        <p className="mt-3 text-[11px] text-slate-500">
          {fmtInt(unattributedHarvest)} harvest record{unattributedHarvest === 1 ? ' is' : 's are'} excluded because the farmer isn&rsquo;t in this municipality&rsquo;s beneficiary registry.
        </p>
      )}
    </>
  );
}
