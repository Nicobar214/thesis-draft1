import { useEffect, useState } from 'react';
import { withOfflineCache } from './offlineCache';

/**
 * Who responded to a citizen report: the DA field engineer's name and the
 * contractor company or LGU that fixed it, with key dates (names only; see
 * supabase_public_report_responders.sql). null until someone is assigned, or
 * when the database function is not installed yet.
 */
export default function useReportResponders(client, reportId) {
  const [row, setRow] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!reportId) return undefined;
    withOfflineCache(`citizen:report:${reportId}:responders`, () => client.rpc('public_report_responders', { p_report_id: reportId }))
      .then(({ data, error }) => {
        if (alive) setRow(error ? null : (Array.isArray(data) ? data[0] : data) || null);
      })
      .catch(() => { if (alive) setRow(null); });
    return () => { alive = false; };
  }, [client, reportId]);
  return row;
}
