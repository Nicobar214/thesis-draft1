import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

function UserProjects() {
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-2xl font-bold text-gray-800">My Projects</h1>
      <p className="text-gray-600 mt-2">Your assigned projects will appear here.</p>
    </div>
  );
}

export default UserProjects;
