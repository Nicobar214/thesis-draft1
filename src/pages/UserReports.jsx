import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

function UserReports() {
  return (
    <UserLayout>
      <div className="space-y-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Reports</h1>
          <p className="mt-1 text-zinc-500">Your submitted reports and updates</p>
        </section>
        <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
          <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
            <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" /></svg>
          </div>
          <p className="font-medium text-zinc-900">No reports yet</p>
          <p className="text-sm text-zinc-500 mt-1">Your reports will appear here once submitted</p>
        </div>
      </div>
    </UserLayout>
  );
}

export default UserReports;
