/* ContractorProjects.jsx – List of fmr_projects assigned to this contractor
 * Shows status badge, accomplishment %, and a Submit Update button per project.
 * If the latest update is 'pending', shows "Pending Review" pill instead.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ContractorLayout from '../components/ContractorLayout';
import ContractorProgressForm from './ContractorProgressForm';

// ── FMR status badge ─────────────────────────────────────────
function FmrStatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-sky-50 text-sky-700 border-sky-200';
  let label = status || 'Proposed';
  if (s.includes('complet')) { cls = 'bg-emerald-50 text-emerald-700 border-emerald-200'; label = 'Completed'; }
  else if (s.includes('going') || s.includes('ongoing')) { cls = 'bg-amber-50 text-amber-700 border-amber-200'; label = 'On-Going'; }
  else if (s.includes('proposed')) { cls = 'bg-sky-50 text-sky-700 border-sky-200'; label = 'Proposed'; }
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

export default function ContractorProjects() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [latestUpdates, setLatestUpdates] = useState({}); // { [fmr_project_id]: update }
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null); // project for the modal

  // ── Auth ─────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) { navigate('/signin'); return; }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', u.id).maybeSingle();
      if (prof?.role !== 'contractor') { navigate('/signin'); return; }
      setUser(u);
    };
    check();
  }, [navigate]);

  // ── Fetch projects + latest update per project ───────────────
  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: projs, error } = await supabase
        .from('fmr_projects')
        .select('id, project_name, municipality, province, status, accomplishment, project_length_km')
        .eq('contractor_id', user.id)
        .order('project_name', { ascending: true });
      if (error) throw error;
      setProjects(projs || []);

      if (projs && projs.length > 0) {
        const ids = projs.map((p) => p.id);
        const { data: updates } = await supabase
          .from('progress_updates')
          .select('id, fmr_project_id, status, reported_accomplishment, submitted_at')
          .eq('contractor_id', user.id)
          .in('fmr_project_id', ids)
          .order('submitted_at', { ascending: false });
        // Keep only the most recent per project
        const map = {};
        for (const upd of updates || []) {
          if (!map[upd.fmr_project_id]) map[upd.fmr_project_id] = upd;
        }
        setLatestUpdates(map);
      }
    } catch (err) {
      console.error('ContractorProjects fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchData();
      const ch = supabase
        .channel('contractor-projects-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'progress_updates' }, fetchData)
        .subscribe();
      return () => supabase.removeChannel(ch);
    }
  }, [user, fetchData]);

  const handleFormClose = () => {
    setSelectedProject(null);
    fetchData();
  };

  if (loading) {
    return (
      <ContractorLayout>
        <div className="flex items-center justify-center py-24">
          <div className="w-10 h-10 border-4 border-teal-200 border-t-teal-600 rounded-full animate-spin" />
        </div>
      </ContractorLayout>
    );
  }

  return (
    <ContractorLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Projects</h1>
          <p className="text-sm text-slate-500 mt-1">{projects.length} project{projects.length !== 1 ? 's' : ''} assigned to you</p>
        </div>

        {projects.length === 0 ? (
          <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm py-16 text-center">
            <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-base font-bold text-slate-900">No projects assigned yet</p>
            <p className="text-sm text-slate-500 mt-1">An administrator will assign projects to you.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {projects.map((project) => {
              const latest = latestUpdates[project.id];
              const hasPendingUpdate = latest?.status === 'pending';
              const accomplishment = Number(project.accomplishment || 0);

              return (
                <div key={project.id} className="bg-white border border-slate-200/60 rounded-2xl shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                  {/* Status accent strip */}
                  <div className={`h-1 ${
                    (project.status || '').toLowerCase().includes('complet') ? 'bg-emerald-500' :
                    (project.status || '').toLowerCase().includes('going') ? 'bg-amber-500' : 'bg-sky-500'
                  }`} />

                  <div className="p-6 flex-1 flex flex-col">
                    {/* Status + year-less badges */}
                    <div className="flex items-center justify-between mb-3">
                      <FmrStatusBadge status={project.status} />
                    </div>

                    {/* Project name */}
                    <h3 className="font-bold text-base text-slate-900 mb-1.5 leading-snug line-clamp-2">
                      {project.project_name || project.project_name || 'Unnamed Project'}
                    </h3>

                    {/* Location */}
                    <p className="text-sm text-slate-500 flex items-center gap-1.5 mb-4">
                      <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                      </svg>
                      {project.municipality}{project.province ? `, ${project.province}` : ', Iloilo'}
                    </p>

                    {/* Accomplishment bar */}
                    <div className="mb-5">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-slate-500 font-medium">Current Accomplishment</span>
                        <span className="text-xs font-bold text-slate-700 font-mono">{accomplishment}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-teal-500 transition-all duration-500"
                          style={{ width: `${Math.min(accomplishment, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Action button */}
                    <div className="mt-auto pt-4 border-t border-slate-100">
                      {hasPendingUpdate ? (
                        <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 w-full justify-center">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Pending Review
                        </span>
                      ) : (
                        <button
                          onClick={() => setSelectedProject(project)}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 shadow-lg shadow-teal-500/25 transition-all"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Submit Update
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Progress Update Modal */}
      {selectedProject && (
        <ContractorProgressForm
          project={selectedProject}
          user={user}
          onClose={handleFormClose}
        />
      )}
    </ContractorLayout>
  );
}
