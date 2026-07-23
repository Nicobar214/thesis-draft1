import { supabase } from './supabase';

const ACTION_TYPE_LABELS = {
  submitted: { label: 'Submitted', icon: '📤' },
  resubmitted: { label: 'Resubmitted', icon: '🔄' },
  validated: { label: 'Validated', icon: '✅' },
  rejected: { label: 'Rejected', icon: '❌' },
  revision_requested: { label: 'Revision Requested', icon: '✏️' },
  published: { label: 'Published', icon: '📢' },
};

export function describeActionType(actionType) {
  return ACTION_TYPE_LABELS[actionType] || { label: actionType || 'Activity', icon: '•' };
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
