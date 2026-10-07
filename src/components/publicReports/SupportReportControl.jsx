import { useState } from 'react';
import { UsersIcon } from 'lucide-react';

import { supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { buttonClass } from '../ui/Button';
import { supportCountLabel } from '../../lib/reportSupport';

/**
 * "I see this too" for someone else's road report, so people back an existing
 * report instead of filing a duplicate. The count is shown to everyone; who backed
 * it never is. See supabase_report_supporters.sql.
 *
 *   count / mine   current total and whether the signed-in citizen is part of it
 *   canSupport     false for the citizen's own report or one that is no longer open
 *   onChange       (count, mine) => void - lets the parent keep its cache in sync
 */
export default function SupportReportControl({ reportId, count = 0, mine = false, canSupport, onChange }) {
  const [busy, setBusy] = useState(false);
  const label = supportCountLabel(count);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const nextMine = !mine;
    const nextCount = Math.max(0, count + (nextMine ? 1 : -1));
    onChange?.(nextCount, nextMine); // optimistic

    const { error } = nextMine
      ? await supabase.from('public_report_supporters').insert({ report_id: reportId })
      : await supabase.from('public_report_supporters').delete().eq('report_id', reportId);

    // A duplicate insert (code 23505) means we were already counted - not an error.
    if (error && error.code !== '23505') {
      onChange?.(count, mine); // roll back
      notify(
        nextMine ? 'Could not add your support. Please try again.' : 'Could not remove your support. Please try again.',
        'error'
      );
    } else if (nextMine) {
      notify('Thanks. Staff can see that more residents are affected.', 'success');
    }
    setBusy(false);
  };

  if (!canSupport && !label) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <div className="flex items-center gap-2 text-sm text-slate-700">
        <UsersIcon className="size-4 text-slate-500" aria-hidden="true" />
        <span aria-live="polite">{label || 'No one else has backed this report yet.'}</span>
      </div>
      {canSupport && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={mine}
          className={mine ? buttonClass('secondary', 'sm') : buttonClass('primary', 'sm')}
        >
          {mine ? 'You see this too (undo)' : 'I see this too'}
        </button>
      )}
    </div>
  );
}
