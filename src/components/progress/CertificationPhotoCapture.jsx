/* The field engineer's geotagged site photo for a progress certification.
 * Live camera only (no gallery, no file picker), stamped with GPS, time and a
 * verification QR, and checked against the project road: it must be taken
 * within MAX_DISTANCE_M of it with a precise fix (the server checks the same in
 * attach_progress_certification_photo).
 * value: { file, attestation, preview, check } or null. */
import { useEffect, useState } from 'react';
import { supabaseFieldEngineer as supabase } from '../../lib/supabase';
import { MAX_DISTANCE_M } from '../../lib/onSiteLocation';
import { buildRoutePoints } from '../../lib/mapRouteUtils';
import GeotagCamera from '../camera/GeotagCamera';
import GeotagPhotoPreview from '../camera/GeotagPhotoPreview';

/* The project's road as points, to measure how far the engineer is from it. */
function useProjectRoad(projectId) {
  const [state, setState] = useState({ projectId: null, points: [] });
  useEffect(() => {
    if (projectId == null) return undefined;
    let active = true;
    Promise.all([
      supabase.from('fmr_projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_routes').select('*').eq('project_id', projectId).maybeSingle(),
    ]).then(([p, r]) => {
      if (!active) return;
      const points = p.data ? buildRoutePoints(p.data, r.data || null).points : [];
      setState({ projectId, points });
    });
    return () => { active = false; };
  }, [projectId]);
  return state.projectId === projectId ? state.points : [];
}


export default function CertificationPhotoCapture({ value, onChange, projectId, projectName, disabled = false }) {
  const roadPoints = useProjectRoad(projectId);

  useEffect(() => () => {
    if (value?.preview) URL.revokeObjectURL(value.preview);
  }, [value?.preview]);

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
        Your site photo <span className="text-rose-500">*</span>
        <span className="ml-1 font-normal text-slate-400">live camera · geotagged · within {MAX_DISTANCE_M} m of the road</span>
      </label>
      {value ? (
        <GeotagPhotoPreview
          photo={value}
          place="the project road"
          onRemove={disabled ? null : () => onChange(null)}
          removeLabel="Retake photo"
        />
      ) : (
        <GeotagCamera
          roadPoints={roadPoints}
          kind="progress_certification"
          label={`Certification · ${projectName || 'FMR project'}`}
          place="the project road"
          onCaptured={onChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
