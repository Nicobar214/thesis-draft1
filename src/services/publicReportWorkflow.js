function assertRpc(error, fallbackMessage) {
  if (!error) return;
  throw new Error(error.message || fallbackMessage);
}

export async function reviewPublicReport(client, { reportId, priority = null, inspectionTargetDate = null }) {
  const { data, error } = await client.rpc('review_public_report', {
    p_report_id: reportId,
    p_priority: priority,
    p_inspection_target_date: inspectionTargetDate,
  });
  assertRpc(error, 'Failed to review public report');
  return data;
}

export async function assignPublicReportEngineer(client, { reportId, engineerId }) {
  const { data, error } = await client.rpc('assign_public_report_engineer', {
    p_report_id: reportId,
    p_engineer_id: engineerId,
  });
  assertRpc(error, 'Failed to assign field engineer');
  return data;
}

export async function unassignPublicReportEngineer(client, { reportId, reason }) {
  const { data, error } = await client.rpc('unassign_public_report_engineer', {
    p_report_id: reportId,
    p_reason: reason,
  });
  assertRpc(error, 'Failed to unassign field engineer');
  return data;
}

export async function startPublicReportInspection(client, { reportId }) {
  const { data, error } = await client.rpc('start_public_report_inspection', {
    p_report_id: reportId,
  });
  assertRpc(error, 'Failed to start inspection');
  return data;
}

export async function submitPublicReportInspection(client, {
  reportId,
  conditionObserved,
  recommendedAction,
  siteRating,
  fieldPhotoUrl,
  certified,
  estimatedCostRange = null,
  latitude = null,
  longitude = null,
  gpsAccuracyMeters = null,
}) {
  const { data, error } = await client.rpc('submit_public_report_inspection', {
    p_report_id: reportId,
    p_condition_observed: conditionObserved,
    p_recommended_action: recommendedAction,
    p_site_rating: siteRating,
    p_field_photo_url: fieldPhotoUrl,
    p_certified: certified,
    p_estimated_cost_range: estimatedCostRange,
    p_inspection_latitude: latitude,
    p_inspection_longitude: longitude,
    p_gps_accuracy_meters: gpsAccuracyMeters,
  });
  assertRpc(error, 'Failed to submit inspection');
  return data;
}

export async function rejectPublicReportInspection(client, { reportId, inspectionId, reason }) {
  const { data, error } = await client.rpc('reject_public_report_inspection', {
    p_report_id: reportId,
    p_inspection_id: inspectionId,
    p_reason: reason,
  });
  assertRpc(error, 'Failed to reject inspection');
  return data;
}

export async function validatePublicReportInspection(client, { reportId, inspectionId }) {
  const { data, error } = await client.rpc('validate_public_report_inspection', {
    p_report_id: reportId,
    p_inspection_id: inspectionId,
  });
  assertRpc(error, 'Failed to validate inspection');
  return data;
}

export async function dismissPublicReport(client, { reportId, reason }) {
  const { data, error } = await client.rpc('dismiss_public_report', {
    p_report_id: reportId,
    p_reason: reason,
  });
  assertRpc(error, 'Failed to close public report');
  return data;
}

export async function resolvePublicReport(client, { reportId, resolutionType = 'other', resolutionSummary }) {
  const { data, error } = await client.rpc('resolve_public_report', {
    p_report_id: reportId,
    p_resolution_type: resolutionType,
    p_resolution_summary: resolutionSummary,
  });
  assertRpc(error, 'Failed to resolve public report');
  return data;
}

/* Repair tracking — a separate record beside the report. Every transition is an
 * RPC; the table has no client write policies. */
export async function planPublicReportRepair(client, { reportId, responsibleParty, targetDate = null, note = null }) {
  const { data, error } = await client.rpc('plan_public_report_repair', {
    p_report_id: reportId,
    p_responsible_party: responsibleParty,
    p_target_date: targetDate,
    p_note: note,
  });
  assertRpc(error, 'Failed to plan the repair');
  return data;
}

export async function completePublicReportRepair(client, { actionId, note }) {
  const { data, error } = await client.rpc('complete_public_report_repair', {
    p_action_id: actionId,
    p_note: note,
  });
  assertRpc(error, 'Failed to record the repair as completed');
  return data;
}

export async function verifyPublicReportRepair(client, {
  actionId,
  photoUrl,
  latitude,
  longitude,
  accuracyMeters = null,
  note = null,
  capturedAt = null,
}) {
  const { data, error } = await client.rpc('verify_public_report_repair', {
    p_action_id: actionId,
    p_photo_url: photoUrl,
    p_latitude: latitude,
    p_longitude: longitude,
    p_accuracy_m: accuracyMeters,
    p_note: note,
    p_captured_at: capturedAt,
  });
  assertRpc(error, 'Failed to verify the repair');
  return data;
}

export async function cancelPublicReportRepair(client, { actionId, reason }) {
  const { data, error } = await client.rpc('cancel_public_report_repair', {
    p_action_id: actionId,
    p_reason: reason,
  });
  assertRpc(error, 'Failed to cancel the follow-up');
  return data;
}

export async function updatePublicReportWorkflowMeta(client, { reportId, priority = null, visitDeadline = null }) {
  const { data, error } = await client.rpc('update_public_report_workflow_meta', {
    p_report_id: reportId,
    p_priority: priority,
    p_visit_deadline: visitDeadline,
  });
  assertRpc(error, 'Failed to update report workflow metadata');
  return data;
}
