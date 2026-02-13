import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function UserReports() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-2xl font-bold text-gray-800">My Reports</h1>
      <p className="text-gray-600 mt-2">Your reports will appear here.</p>
    </div>
  );
}

export default UserReports;
