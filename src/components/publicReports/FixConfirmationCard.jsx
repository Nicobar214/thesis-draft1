import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { buttonClass } from '../ui/Button';

const TABLE = 'public_report_citizen_confirmations';
const MAX_COMMENT = 500;

// Choice buttons are toggles, so they are styled here rather than through buttonClass
// (whose fixed background/text colours would fight the selected state).
const CHOICE_BASE =
  'inline-flex h-10 w-full items-center justify-center rounded-lg border px-3 text-sm font-semibold transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400';
const CHOICE_IDLE = 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50';

/**
 * "Is it actually fixed?" - asked of the citizen who filed a resolved report.
 *
 * Engineers verify repairs on site, but the reporter is the best witness that the
 * problem is really gone. The answer is stored per citizen per report (they can
 * change it) and is readable by admins. See supabase_citizen_fix_confirmation.sql.
 *
 * Until that migration has been run the table does not exist; the card then renders
 * nothing instead of showing a question that cannot be saved.
 *
 * Render with key={reportId} so switching reports starts from a clean state.
 */
export default function FixConfirmationCard({ reportId }) {
  const [available, setAvailable] = useState(false);
  const [saved, setSaved] = useState(null); // { is_fixed, comment }
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState(null); // true | false | null
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!reportId) return undefined;

    (async () => {
      // Row-level security returns only this citizen's own answer.
      const { data, error } = await supabase
        .from(TABLE)
        .select('is_fixed, comment')
        .eq('report_id', reportId)
        .maybeSingle();
      if (!alive || error) return;
      setAvailable(true);
      setSaved(data || null);
    })();

    return () => {
      alive = false;
    };
  }, [reportId]);

  if (!available) return null;

  const startEditing = () => {
    setChoice(saved ? saved.is_fixed : null);
    setComment(saved?.comment || '');
    setEditing(true);
  };

  const submit = async () => {
    if (choice === null || saving) return;
    setSaving(true);
    const row = {
      report_id: reportId,
      is_fixed: choice,
      comment: comment.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'report_id,user_id' });
    setSaving(false);
    if (error) {
      notify('Could not save your answer. Please try again.', 'error');
      return;
    }
    setSaved({ is_fixed: row.is_fixed, comment: row.comment });
    setEditing(false);
    notify('Thank you. Your answer helps the DA check the repair.', 'success');
  };

  const showQuestion = !saved || editing;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">Is it actually fixed?</h3>
        <p className="mt-0.5 text-xs text-slate-500">
          You reported this problem, so you know best. Your answer helps the DA catch repairs that did not hold.
        </p>
      </div>

      {showQuestion ? (
        <>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Is the problem fixed?">
            <button
              type="button"
              onClick={() => setChoice(true)}
              aria-pressed={choice === true}
              className={`${CHOICE_BASE} ${choice === true ? 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-600' : CHOICE_IDLE}`}
            >
              Yes, it&rsquo;s fixed
            </button>
            <button
              type="button"
              onClick={() => setChoice(false)}
              aria-pressed={choice === false}
              className={`${CHOICE_BASE} ${choice === false ? 'border-rose-600 bg-rose-50 text-rose-800 ring-2 ring-rose-600' : CHOICE_IDLE}`}
            >
              No, still a problem
            </button>
          </div>

          {choice !== null && (
            <div className="space-y-1">
              <label htmlFor={`fix-note-${reportId}`} className="text-xs font-medium text-slate-600">
                {choice ? 'Anything to add? (optional)' : 'What is still wrong? (optional)'}
              </label>
              <textarea
                id={`fix-note-${reportId}`}
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT))}
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                placeholder={choice ? 'e.g. The road is smooth now.' : 'e.g. The pothole near the bridge is still there.'}
              />
              <p className="text-right text-[11px] text-slate-500">{comment.length}/{MAX_COMMENT}</p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className={buttonClass('secondary')}>
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={choice === null || saving}
              className={buttonClass('primary')}
            >
              {saving ? 'Sending...' : 'Send answer'}
            </button>
          </div>
        </>
      ) : (
        <div
          className={`rounded-lg border p-3 text-sm ${saved.is_fixed ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}
        >
          <p className="font-medium">
            {saved.is_fixed ? 'You told us this is fixed.' : 'You told us this is still a problem.'}
          </p>
          {saved.comment && <p className="mt-1 text-sm opacity-90">&ldquo;{saved.comment}&rdquo;</p>}
          <button
            type="button"
            onClick={startEditing}
            className="mt-2 text-xs font-semibold underline underline-offset-2 hover:opacity-80"
          >
            Change my answer
          </button>
        </div>
      )}
    </section>
  );
}
