/* ContractorProgressForm.jsx – Modal for submitting a progress update
 * - Auto-fills project info (locked)
 * - Contractor inputs: new accomplishment %, remarks, optional photo
 * - INSERT into progress_updates; does NOT update fmr_projects directly
 * - Photo uploaded to 'progress-photos' storage bucket
 */
import { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';

const inputCls =
  'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm ' +
  'focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition';

export default function ContractorProgressForm({ project, user, onClose }) {
  const currentAccomplishment = Number(project.accomplishment || 0);

  const [newAccomplishment, setNewAccomplishment] = useState(currentAccomplishment);
  const [remarks, setRemarks]   = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const projectName = project.project_name || project.projectName || 'Unnamed Project';
  const municipality = project.municipality || '';

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const clearPhoto = () => {
    setPhotoFile(null);
    if (photoPreview) { URL.revokeObjectURL(photoPreview); setPhotoPreview(null); }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!remarks.trim()) { setError('Remarks are required.'); return; }
    if (newAccomplishment < currentAccomplishment) {
      setError(`New accomplishment (${newAccomplishment}%) cannot be less than current (${currentAccomplishment}%).`);
      return;
    }
    if (newAccomplishment > 100) { setError('Accomplishment cannot exceed 100%.'); return; }

    setSubmitting(true);
    try {
      const { data: existingPending, error: pendingErr } = await supabase
        .from('progress_updates')
        .select('id, status')
        .eq('fmr_project_id', project.id)
        .eq('contractor_id', user.id)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: false })
        .limit(1);
      if (pendingErr) throw pendingErr;
      if (existingPending?.length) {
        throw new Error('There is already a pending progress update for this project. Wait for admin review before submitting another.');
      }

      let photoUrl = null;

      // Upload photo if provided
      if (photoFile) {
        const ext  = photoFile.name.split('.').pop() || 'jpg';
        const path = `updates/${user.id}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('progress-photos')
          .upload(path, photoFile, { contentType: photoFile.type || 'image/jpeg' });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('progress-photos').getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      const { error: insErr } = await supabase.from('progress_updates').insert({
        fmr_project_id:          project.id,
        contractor_id:           user.id,
        reported_accomplishment: newAccomplishment,
        remarks:                 remarks.trim(),
        photo_url:               photoUrl,
        status:                  'pending',
      });
      if (insErr) throw insErr;

      onClose();
    } catch (err) {
      console.error('Progress update submit error:', err);
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // Backdrop
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Submit Progress Update</h2>
            <p className="text-sm text-slate-500 mt-0.5 line-clamp-1">{projectName}</p>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Locked project info */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Project Info (read-only)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500">Project Name</p>
                <p className="text-sm font-semibold text-slate-900">{projectName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Municipality</p>
                <p className="text-sm font-semibold text-slate-900">{municipality || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Current Accomplishment</p>
                <p className="text-sm font-bold text-teal-700 font-mono">{currentAccomplishment}%</p>
              </div>
            </div>
          </div>

          {/* New accomplishment */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              New Accomplishment % <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min={currentAccomplishment}
              max={100}
              step={0.1}
              value={newAccomplishment}
              onChange={(e) => setNewAccomplishment(Number(e.target.value))}
              className={inputCls}
              required
            />
            <p className="text-xs text-slate-400 mt-1">
              Must be ≥ {currentAccomplishment}% (current value)
            </p>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Remarks / Notes <span className="text-red-500">*</span>
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Describe the work done, materials used, conditions, etc."
              rows={4}
              className={inputCls + ' resize-none'}
              required
            />
          </div>

          {/* Photo upload */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              Site Photo <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Preview"
                  className="w-full h-48 object-cover rounded-xl border border-slate-200"
                />
                <button
                  type="button"
                  onClick={clearPhoto}
                  className="absolute top-2 right-2 bg-white/90 hover:bg-white rounded-lg p-1.5 shadow-sm border border-slate-200 text-slate-500 hover:text-red-500 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-colors">
                <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <span className="text-sm text-slate-500">Click to upload a photo</span>
                <span className="text-xs text-slate-400 mt-0.5">JPG, PNG, WEBP up to 10MB</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => !submitting && onClose()}
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-lg shadow-teal-500/25 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Submitting…
                </>
              ) : 'Submit Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
