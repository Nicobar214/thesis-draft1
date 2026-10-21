/* FarmerMyReports.jsx - the farmer's own road reports, at /farmer/reports.
 *
 * Same page as the citizen's My Reports (descriptions, filters, details with
 * the progress track, who responded, before/after photos and the certificate),
 * run with the farmer's sign-in. "New report" opens the farmer portal's own
 * report form, which also queues reports offline.
 */
import { useOutletContext } from 'react-router-dom';
import { supabaseFarmer as supabase } from '../lib/supabase';
import UserReports from './UserReports';

export default function FarmerMyReports() {
  const { openReport } = useOutletContext();
  return <UserReports client={supabase} embedded onNewReport={openReport} />;
}
