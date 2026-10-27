/* Who answered a road report and what they said, for anyone viewing it in
 * Community Feedback: the field engineer's finding (the cause on site and what
 * should be done), the contractor's or LGU's repair, and the DA's final word.
 * Only what the citizen views expose (submitted findings, never drafts).
 *
 *   <ReportResponses client={supabase} report={report} finding={finding} repair={repair} resolution={resolution} /> */
import { HardHatIcon, ShieldCheckIcon, WrenchIcon } from 'lucide-react';
import useReportResponders from '../../lib/useReportResponders';
import { repairCitizenLine, repairStatusInfo, responsiblePartyLabel, siteRatingLabel } from '../../lib/publicReportStatus';
import ZoomablePhoto from '../ui/ZoomablePhoto';

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Row({ label, children }) {
  if (!children) return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function Response({ icon, tone, who, role, date, children }) {
  return (
    <li className={`rounded-xl border p-3.5 ${tone}`}>
      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
        {icon}
        <span className="font-semibold text-slate-900">{who}</span>
        <span className="text-slate-500">· {role}</span>
        {date && <span className="ml-auto text-xs text-slate-500">{date}</span>}
      </p>
      <dl className="mt-2 space-y-2">{children}</dl>
    </li>
  );
}

export default function ReportResponses({ client, report, finding, repair, resolution }) {
  const responders = useReportResponders(client, report?.id);
  const repairInfo = repair ? repairStatusInfo(repair.status) : null;
  const closedReason = report?.citizen_closed_reason;
  if (!finding && !repairInfo && !resolution && !closedReason) return null;

  const party = repair ? responsiblePartyLabel(repair.responsible_party) || 'Contractor' : null;
  const afterPhoto = repair ? repair.verification_photo_url || repair.work_photo_url : null;
  return (
    <section aria-label="Responses to this report">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Responses</p>
      <ol className="space-y-3">
        {finding && (
          <Response
            icon={<HardHatIcon className="size-4 shrink-0" aria-hidden="true" />}
            tone="border-emerald-200 bg-emerald-50/40"
            who={responders?.engineer_name || finding.inspected_by_name || 'Field engineer'}
            role="DA field engineer"
            date={fmtDate(finding.submitted_at)}
          >
            <Row label="What was found on site (cause)">{finding.condition_observed}</Row>
            <Row label="Recommended action">{finding.recommended_action}</Row>
            <Row label="Road condition">{siteRatingLabel(finding.site_rating) && `${siteRatingLabel(finding.site_rating)} (${finding.site_rating} of 5)`}</Row>
            <Row label="Estimated repair cost">{finding.estimated_cost_range && `${finding.estimated_cost_range} (estimate only)`}</Row>
            <div className="space-y-2">
              {finding.field_photo_url && (
                <ZoomablePhoto src={finding.field_photo_url} alt="Engineer's on-site photo" wrapperClassName="w-40 rounded-lg border border-emerald-200" className="aspect-[4/3] w-full object-cover" />
              )}
              <p className="text-xs text-slate-500">{finding.validated_at ? 'Checked and verified by the DA.' : 'Waiting for the DA to verify.'}</p>
            </div>
          </Response>
        )}

        {repairInfo && (
          <Response
            icon={<WrenchIcon className="size-4 shrink-0" aria-hidden="true" />}
            tone="border-slate-200 bg-white"
            who={responders?.handler_name || repair.repaired_by_name || party}
            role={party}
            date={fmtDate(repair.work_submitted_at || repair.started_at || repair.created_at)}
          >
            <Row label="Status">{`${repairInfo.staff} — ${repairCitizenLine(repair)}`}</Row>
            <Row label="Target date">{repair.status === 'planned' && fmtDate(repair.target_date)}</Row>
            <Row label="Recorded done">{fmtDate(repair.completed_at)}</Row>
            <Row label="Confirmed on site">{repair.verified_at && `${fmtDate(repair.verified_at)}${repair.verified_by_name ? ` by ${repair.verified_by_name}` : ''}`}</Row>
            {afterPhoto && (
              <div>
                <ZoomablePhoto src={afterPhoto} alt="The site after the work" wrapperClassName="w-40 rounded-lg border border-slate-200" className="aspect-[4/3] w-full object-cover" />
              </div>
            )}
          </Response>
        )}

        {(resolution || closedReason) && (
          <Response
            icon={<ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />}
            tone="border-sky-200 bg-sky-50/50"
            who="Department of Agriculture"
            role={resolution ? 'final decision' : 'closed'}
            date={fmtDate(resolution?.resolved_at || report?.dismissed_at)}
          >
            <Row label="Decision">{resolution?.summary || closedReason}</Row>
          </Response>
        )}
      </ol>
    </section>
  );
}
