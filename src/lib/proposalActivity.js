import { supabase } from './supabase';

const ACTION_TYPE_LABELS = {
  submitted: { label: 'Submitted', icon: 'submitted' },
  resubmitted: { label: 'Resubmitted', icon: 'resubmitted' },
  validated: { label: 'Validated', icon: 'validated' },
  rejected: { label: 'Rejected', icon: 'rejected' },
  revision_requested: { label: 'Revision Requested', icon: 'revision_requested' },
  published: { label: 'Published', icon: 'published' },
};

export function describeActionType(actionType) {
  return ACTION_TYPE_LABELS[actionType] || { label: actionType || 'Activity', icon: 'activity' };
}

export function formatActivityActor(log) {
  return log.actor_name || log.actor_email || 'System';
}

export async function fetchProposalActivity(proposalId) {
  const { data, error } = await supabase
    .from('lgu_project_proposal_activity_logs')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
