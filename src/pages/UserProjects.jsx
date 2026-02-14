import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserLayout from '../components/UserLayout';

function UserProjects() {
  return (
    <UserLayout>
      <div className="space-y-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Projects</h1>
          <p className="mt-1 text-zinc-500">Browse FMR projects in your area</p>
        </section>
        <div className="bg-white rounded-2xl border border-zinc-200/60 py-16 text-center">
          <div className="mx-auto size-14 bg-zinc-100 rounded-xl grid place-items-center text-zinc-400 mb-3">
            <svg className="size-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" /></svg>
          </div>
          <p className="font-medium text-zinc-900">Your assigned projects will appear here</p>
          <p className="text-sm text-zinc-500 mt-1">Projects from your community will be listed below</p>
        </div>
      </div>
    </UserLayout>
  );
}

export default UserProjects;
