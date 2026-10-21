/* FarmerCommunity.jsx - everyone's road reports and feedback, at /farmer/community.
 * Same page as the citizen's Community Feedback, run with the farmer's sign-in;
 * its links open the farmer's own pages. */
import { supabaseFarmer as supabase } from '../lib/supabase';
import UserFeedback from './UserFeedback';

export default function FarmerCommunity() {
  return <UserFeedback client={supabase} embedded basePath="/farmer" />;
}
