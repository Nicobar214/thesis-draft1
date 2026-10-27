/* ContractorDelays.jsx — Delay Follow-ups: the contractor's own page for the DA's
 * overdue-project requests (commit a new finish date: supabase_overdue_v2.sql),
 * what is waiting on the DA, and recent decisions. It has its own menu item with a
 * red count so a reply with a deadline is never buried in the dashboard.
 * ?project=<id> (from a notification) scrolls to and highlights that project. */
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabaseContractor as supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import DelayExplanationPanel from '../components/contractor/DelayExplanationPanel';

export default function ContractorDelays() {
  const [searchParams] = useSearchParams();
  const [userId, setUserId] = useState(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => { if (alive) setUserId(data?.user?.id || null); });
    return () => { alive = false; };
  }, []);

  return (
    <ContractorLayout>
      <div className="space-y-5">
        {/* How it works: one slim, foldable strip so the list stays on top. */}
        <details className="group rounded-2xl border border-slate-200 bg-white shadow-xs [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="font-semibold text-slate-800">How delay follow-ups work</span>
            <span className="text-xs font-medium text-teal-700 group-open:hidden">Show the rules</span>
            <span className="hidden text-xs font-medium text-slate-500 group-open:inline">Hide</span>
          </summary>
          <ol className="grid gap-2 px-5 pb-2 text-sm text-slate-600 sm:grid-cols-3">
            {[
              ['1', 'The DA asks', 'You get a notification with a reply-by date. No reply counts as an offense.'],
              ['2', 'You commit', 'Pick the cause and a new finish date inside the allowed days.'],
              ['3', 'The DA approves', 'The date is then locked. Missing it opens the next round with less time.'],
            ].map(([n, title, text]) => (
              <li key={n} className="flex gap-2.5 rounded-xl bg-slate-50 p-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-teal-600 text-xs font-bold text-white">{n}</span>
                <span>
                  <span className="block font-semibold text-slate-800">{title}</span>
                  <span className="block text-xs leading-snug">{text}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mx-5 mb-4 grid gap-2 rounded-xl border border-slate-200 p-3 text-xs text-slate-600 sm:grid-cols-2">
            <p><span className="font-semibold text-sky-800">Act of nature</span> (typhoon, flood, earthquake, landslide, volcanic activity): not counted. Needs proof and a field check; you get the days work stopped, up to 30.</p>
            <p><span className="font-semibold text-amber-800">Manpower</span>: an offense. Offense 1: up to 60 days · 2: up to 45 · 3 (final, field check): up to 30 · a 4th delay ends your contract on the project.</p>
          </div>
        </details>

        <DelayExplanationPanel client={supabase} userId={userId} focusProjectId={searchParams.get('project')} />
      </div>
    </ContractorLayout>
  );
}
