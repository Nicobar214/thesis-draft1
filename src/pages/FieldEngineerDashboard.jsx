/* FieldEngineerDashboard.jsx – Mobile-responsive dashboard for field engineers
 * Shows assigned public reports, allows status updates and field notes.
 * Matches the KalsaTrack teal/slate design system.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { enqueueEngineerUpdate } from '../lib/offlineReports';
import { requestBackgroundSync } from '../lib/offlineSync';
import FieldEngineerWorkflowPanel from '../components/publicReports/FieldEngineerWorkflowPanel';

/* ─── Engineer Status Helpers ─── */
const engineerStatusStyles = {
  assigned:    { label: 'Assigned',    cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  inspected:   { label: 'Inspected',   cls: 'bg-violet-100 text-violet-700 border-violet-200' },
  validated:   { label: 'Validated',   cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected:    { label: 'Rejected',    cls: 'bg-red-100 text-red-700 border-red-200' },
};

const reportStatusStyles = {
  pending:  'bg-amber-100 text-amber-700',
  reviewed: 'bg-blue-100 text-blue-700',
  resolved: 'bg-emerald-100 text-emerald-700',
};

const engineerStatusFlow = {
  in_progress: {
    label: 'In Progress',
    verification: 'Needs Review',
    userMessage: 'Field inspection has started for your report.',
    adminMessage: 'Field inspection is now in progress.',
  },
  inspected: {
    label: 'Inspected',
    verification: 'Needs Review',
    userMessage: 'Field inspection was completed and is now awaiting admin review.',
    adminMessage: 'Field inspection has been completed and is ready for admin review.',
  },
  validated: {
    label: 'Validated',
    verification: 'Verified On-Site',
    userMessage: 'Field findings validated your report. Admin review is in progress.',
    adminMessage: 'Field findings validated this report. Please proceed with admin action.',
  },
  rejected: {
    label: 'Rejected',
    verification: 'Location Mismatch',
    userMessage: 'Field findings flagged this report for additional admin review.',
    adminMessage: 'Field findings rejected this report. Please review and decide next action.',
  },
};

function EngineerStatusBadge({ status }) {
  const s = engineerStatusStyles[status] || { label: status || 'Unknown', cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${s.cls}`}>{s.label}</span>;
}

function ReportStatusBadge({ status }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${reportStatusStyles[status] || 'bg-slate-100 text-slate-600'}`}>
      {status?.charAt(0).toUpperCase() + status?.slice(1)}
    </span>
  );
}

function VerifyBadge({ verification }) {
  const map = {
    'Verified On-Site':   { icon: '✔', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    'Needs Review':       { icon: '⚠', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    'Location Mismatch':  { icon: '✖', cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const s = map[verification] || { icon: '?', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold border ${s.cls}`}>{s.icon} {verification}</span>;
}

// ════════════════════════════════════════════════════════════
export default function FieldEngineerDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('assigned');
  const [selectedReport, setSelectedReport] = useState(null);
  const [engineerNotes, setEngineerNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [notification, setNotification] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [rejectionReason, setRejectionReason] = useState('');

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    const updateStatus = () => setIsOffline(!navigator.onLine);
    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    return () => {
      window.removeEventListener('online', updateStatus);
      window.removeEventListener('offline', updateStatus);
    };
  }, []);

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) { navigate('/field-engineer/login'); return; }

      const { data: prof, error: profErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (profErr) console.warn('Profile query error:', profErr);

      // Use metadata role as fallback when profile row is missing or query fails
      const effectiveRole = prof?.role || currentUser.user_metadata?.role;

      if (effectiveRole !== 'field_engineer') {
        await supabase.auth.signOut();
        navigate('/field-engineer/login');
        return;
      }

      setUser(currentUser);
      setProfile(prof || { id: currentUser.id, email: currentUser.email, role: 'field_engineer', full_name: currentUser.user_metadata?.full_name || '' });
    };
    checkAuth();
  }, [navigate]);

  // Fetch assigned reports
  const fetchReports = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('public_reports')
        .select('*')
        .eq('assigned_engineer_id', user.id)
        .order('assigned_at', { ascending: false });
      if (error) {
        console.error('Error fetching assigned reports:', error);
        if (error.message?.includes('column') || error.code === '42703') {
          console.error('Assignment columns missing. Ask admin to run supabase_complete_fe_setup.sql');
        }
      }
      setReports(data || []);
    } catch (err) {
      console.error('Error fetching assigned reports:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Surface the DA admin's rejection reason so the engineer knows what to fix.
  useEffect(() => {
    if (!selectedReport?.id || selectedReport.engineer_status !== 'rejected') {
      setRejectionReason('');
      return;
    }
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from('public_report_activity_logs')
          .select('description')
          .eq('report_id', selectedReport.id)
          .eq('action_type', 'finding_rejected')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (alive) setRejectionReason(data?.description || '');
      } catch {
        if (alive) setRejectionReason('');
      }
    })();
    return () => { alive = false; };
  }, [selectedReport?.id, selectedReport?.engineer_status]);

  const createReportNotification = useCallback(async (report, type, message) => {
    if (!report?.user_id) return;

    try {
      await supabase
        .from('notifications')
        .insert({
          user_id: report.user_id,
          type,
          title: 'Public report update',
          message,
          report_id: report.id,
          is_read: false,
          created_at: new Date().toISOString(),
        });
    } catch {
      // Keep status updates working if notifications table is unavailable.
    }
  }, []);

  const createAdminNotification = useCallback(async (reportId, message) => {
    if (!reportId) return;

    try {
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .limit(10);

      if (!Array.isArray(admins) || admins.length === 0) return;

      await supabase.from('notifications').insert(
        admins.map((admin) => ({
          user_id: admin.id,
          type: 'public_report_field_update',
          title: 'Field engineer update',
          message,
          report_id: reportId,
          is_read: false,
          created_at: new Date().toISOString(),
        }))
      );
    } catch {
      // Keep status updates working if notifications table is unavailable.
    }
  }, []);

  const addPublicReportActivity = useCallback(async (reportId, statusLabel, note = '') => {
    if (!reportId) return;

    try {
      const actorName = profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Field Engineer';
      const noteText = note?.trim() ? ` Notes: ${note.trim()}` : '';
      await supabase.from('public_report_activity_logs').insert({
        report_id: reportId,
        action_type: 'engineer_status_updated',
        description: `Field engineer marked the report as ${statusLabel}.${noteText}`,
        metadata: { engineer_status: statusLabel.toLowerCase().replace(/\s+/g, '_') },
        actor_name: actorName,
        actor_email: user?.email || null,
        created_at: new Date().toISOString(),
      });
    } catch {
      // Keep status updates working if activity logs table is unavailable.
    }
  }, [profile?.full_name, user]);

  useEffect(() => {
    if (user) {
      fetchReports();
      // Real-time subscription
      const channel = supabase
        .channel('engineer-reports-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, () => fetchReports())
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [user, fetchReports]);

  // Update engineer status + notes
  const updateReportStatus = async (reportId, newStatus) => {
    setUpdatingStatus(true);
    try {
      const flow = engineerStatusFlow[newStatus];
      const activeReport = reports.find((row) => row.id === reportId) || selectedReport;

      if (!flow) {
        throw new Error('Unsupported status transition');
      }
      if (!activeReport) {
        throw new Error('Report not found. Refresh and try again.');
      }
      if (String(activeReport.status || '').toLowerCase() === 'resolved') {
        throw new Error('Resolved reports can no longer be edited by field engineers.');
      }

      const normalizedStatus = String(activeReport.status || '').toLowerCase();
      const nextReportStatus = normalizedStatus === 'pending' ? 'reviewed' : activeReport.status;

      if (isOffline) {
        const actorName = profile?.full_name || user?.user_metadata?.full_name || user?.email || 'Field Engineer';
        await enqueueEngineerUpdate({
          type: 'status',
          reportId,
          engineerId: user.id,
          payload: {
            engineer_status: newStatus,
            verification: flow.verification,
            status: nextReportStatus,
            engineer_notes: engineerNotes,
            updated_at: new Date().toISOString(),
          },
          activity: {
            report_id: reportId,
            action_type: 'engineer_status_updated',
            description: `Field engineer marked the report as ${flow.label}.${engineerNotes?.trim() ? ` Notes: ${engineerNotes.trim()}` : ''}`,
            metadata: { engineer_status: newStatus },
            actor_name: actorName,
            actor_email: user?.email || null,
            created_at: new Date().toISOString(),
          },
          notifications: {
            userId: activeReport.user_id,
            userMessage: flow.userMessage,
            adminMessage: flow.adminMessage,
          }
        });
        await requestBackgroundSync();

        setReports((prev) => prev.map((row) => (
          row.id === reportId
            ? { ...row, engineer_status: newStatus, verification: flow.verification, status: nextReportStatus, engineer_notes: engineerNotes, updated_at: new Date().toISOString() }
            : row
        )));
        if (selectedReport) {
          setSelectedReport(prev => ({
            ...prev,
            engineer_status: newStatus,
            verification: flow.verification,
            status: nextReportStatus,
            engineer_notes: engineerNotes,
            updated_at: new Date().toISOString(),
          }));
        }
        showNotification('Saved offline. Will sync when online.');
        return;
      }

      const { error } = await supabase
        .from('public_reports')
        .update({
          engineer_status: newStatus,
          verification: flow.verification,
          status: nextReportStatus,
          engineer_notes: engineerNotes,
          updated_at: new Date().toISOString()
        })
        .eq('id', reportId)
        .eq('assigned_engineer_id', user.id);
      if (error) throw error;

      await addPublicReportActivity(reportId, flow.label, engineerNotes);
      await createReportNotification(activeReport, 'public_report_field_update', flow.userMessage);
      await createAdminNotification(reportId, flow.adminMessage);

      await fetchReports();
      showNotification(`Report marked as ${newStatus.replace('_', ' ')}`);
      if (selectedReport) {
        setSelectedReport(prev => ({
          ...prev,
          engineer_status: newStatus,
          verification: flow.verification,
          status: nextReportStatus,
          engineer_notes: engineerNotes,
          updated_at: new Date().toISOString(),
        }));
      }
    } catch (err) {
      console.error('Failed to update report:', err.message);
      showNotification(`Failed to update: ${err.message}`, 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Save notes only
  const saveNotes = async (reportId) => {
    try {
      if (isOffline) {
        await enqueueEngineerUpdate({
          type: 'notes',
          reportId,
          engineerId: user.id,
          payload: {
            engineer_notes: engineerNotes,
            updated_at: new Date().toISOString(),
          },
        });
        await requestBackgroundSync();
        showNotification('Notes saved offline. Will sync when online.');
        if (selectedReport) {
          setSelectedReport(prev => ({ ...prev, engineer_notes: engineerNotes }));
        }
        return;
      }
      const { error } = await supabase
        .from('public_reports')
        .update({ engineer_notes: engineerNotes, updated_at: new Date().toISOString() })
        .eq('id', reportId)
        .eq('assigned_engineer_id', user.id);
      if (error) throw error;
      showNotification('Notes saved');
      if (selectedReport) {
        setSelectedReport(prev => ({ ...prev, engineer_notes: engineerNotes }));
      }
    } catch (err) {
      showNotification(`Failed to save notes: ${err.message}`, 'error');
    }
  };

  // Sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/field-engineer/login');
  };

  // Filter reports by tab
  const filteredReports = useMemo(() => {
    if (activeTab === 'all') return reports;
    if (activeTab === 'assigned') return reports.filter(r => r.engineer_status === 'assigned');
    if (activeTab === 'in-progress') return reports.filter(r => r.engineer_status === 'in_progress');
    if (activeTab === 'needs-rework') return reports.filter(r => r.engineer_status === 'rejected');
    if (activeTab === 'completed') return reports.filter(r => ['inspected', 'validated'].includes(r.engineer_status));
    return reports;
  }, [reports, activeTab]);

  // Metrics
  const metrics = useMemo(() => ({
    total: reports.length,
    assigned: reports.filter(r => r.engineer_status === 'assigned').length,
    inProgress: reports.filter(r => r.engineer_status === 'in_progress').length,
    needsRework: reports.filter(r => r.engineer_status === 'rejected').length,
    completed: reports.filter(r => ['inspected', 'validated'].includes(r.engineer_status)).length,
  }), [reports]);

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 left-4 sm:left-auto sm:w-auto z-[100] px-5 py-3 rounded-xl shadow-lg text-white font-medium text-sm ${
          notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {notification.message}
        </div>
      )}

      {/* Header - Sticky */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm">K</span>
            </div>
            <div className="hidden sm:block">
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">KalsaTrack</h1>
              <p className="text-xs text-slate-500">Field Engineer Portal</p>
            </div>
            <span className="sm:hidden text-lg font-bold text-slate-900">KalsaTrack</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-slate-700">{profile.full_name || profile.email}</p>
              <p className="text-xs text-teal-600 font-medium">Field Engineer</p>
            </div>
            <div className="w-9 h-9 bg-teal-100 rounded-xl flex items-center justify-center text-teal-700 font-bold text-sm">
              {(profile.full_name || profile.email || 'FE').charAt(0).toUpperCase()}
            </div>
            <button onClick={handleSignOut} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors" title="Sign out">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {/* Greeting */}
        <div className="mb-6">
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
            Welcome, {profile.full_name || 'Engineer'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">Your assigned field inspection reports</p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-slate-200/60 p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-bold text-slate-900">{metrics.total}</p>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Total Assigned</p>
          </div>
          <div className="bg-blue-50 rounded-2xl border border-blue-200/60 p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-bold text-blue-700">{metrics.assigned}</p>
            <p className="text-xs sm:text-sm text-blue-600 mt-1">New</p>
          </div>
          <div className="bg-amber-50 rounded-2xl border border-amber-200/60 p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-bold text-amber-700">{metrics.inProgress}</p>
            <p className="text-xs sm:text-sm text-amber-600 mt-1">In Progress</p>
          </div>
          <div className="bg-red-50 rounded-2xl border border-red-200/60 p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-bold text-red-700">{metrics.needsRework}</p>
            <p className="text-xs sm:text-sm text-red-600 mt-1">Needs Rework</p>
          </div>
          <div className="bg-emerald-50 rounded-2xl border border-emerald-200/60 p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-bold text-emerald-700">{metrics.completed}</p>
            <p className="text-xs sm:text-sm text-emerald-600 mt-1">Completed</p>
          </div>
        </div>

        {/* Tab Filter */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          {[
            { id: 'assigned', label: 'New', count: metrics.assigned },
            { id: 'in-progress', label: 'In Progress', count: metrics.inProgress },
            { id: 'needs-rework', label: 'Needs Rework', count: metrics.needsRework },
            { id: 'completed', label: 'Completed', count: metrics.completed },
            { id: 'all', label: 'All', count: metrics.total },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-teal-600 text-white shadow-lg shadow-teal-500/25'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {tab.label}
              <span className={`px-1.5 py-0.5 rounded-md text-xs font-bold ${
                activeTab === tab.id ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Reports List */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
            <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
            <p className="text-sm text-slate-400">Loading reports...</p>
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 p-12 text-center">
            <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
            </svg>
            <p className="font-medium text-slate-900">No reports in this category</p>
            <p className="text-sm text-slate-500 mt-1">
              {activeTab === 'assigned' ? 'No new reports assigned to you' : 'Switch tabs to see other reports'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map(rpt => (
              <button
                key={rpt.id}
                onClick={() => { setSelectedReport(rpt); setEngineerNotes(rpt.engineer_notes || ''); }}
                className="w-full text-left bg-white rounded-2xl border border-slate-200/60 hover:border-teal-300 transition-all p-4 sm:p-5 group"
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  {rpt.photo_url ? (
                    <img src={rpt.photo_url} alt="" className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-slate-200 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
                      </svg>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <EngineerStatusBadge status={rpt.engineer_status} />
                      <VerifyBadge verification={rpt.verification} />
                    </div>

                    {/* Location */}
                    <p className="text-sm font-medium text-slate-900 group-hover:text-teal-700 transition-colors truncate">
                      {rpt.barangay}, {rpt.municipality}
                    </p>
                    {rpt.street && <p className="text-xs text-slate-500">{rpt.street}</p>}

                    {/* Description preview */}
                    <p className="text-sm text-slate-500 line-clamp-1 mt-0.5">{rpt.description}</p>

                    {/* Meta */}
                    <p className="text-xs text-slate-400 mt-1">
                      Assigned {rpt.assigned_at ? new Date(rpt.assigned_at).toLocaleDateString() : '—'}
                    </p>
                  </div>

                  <svg className="w-5 h-5 text-slate-300 group-hover:text-teal-500 mt-1 shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* ── Report Detail Modal ── */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={() => setSelectedReport(null)}>
          <div
            className="fixed inset-0 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:max-w-lg sm:w-full sm:max-h-[90vh] bg-white sm:rounded-2xl shadow-2xl overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white px-5 py-4 flex items-center justify-between z-10 border-b border-emerald-900/60">
              <div className="flex items-center gap-3">
                <div className="size-9 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center border border-emerald-500/30 font-bold text-sm">
                  FE
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-white tracking-tight">On-Site Field Inspection</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 font-mono border border-emerald-800 font-bold">
                      REF #{selectedReport.id.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">{selectedReport.barangay}, {selectedReport.municipality} &middot; DA RAED Region VI</p>
                </div>
              </div>
              <button onClick={() => setSelectedReport(null)} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-5 bg-slate-50/50">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <EngineerStatusBadge status={selectedReport.engineer_status} />
                <VerifyBadge verification={selectedReport.verification} />
                <ReportStatusBadge status={selectedReport.status} />
              </div>

              {selectedReport.engineer_status === 'rejected' && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 space-y-1">
                  <p className="text-xs font-bold text-red-800 uppercase tracking-wide">DA Admin sent this back for re-inspection</p>
                  <p className="text-sm text-red-900">{rejectionReason || 'No reason was recorded.'}</p>
                  <p className="text-xs text-red-600">Resubmit findings below once the issue is re-checked to send it back for review.</p>
                </div>
              )}

              <FieldEngineerWorkflowPanel
                report={selectedReport}
                currentUser={user}
                onSaved={(message, type = 'success') => {
                  showNotification(message, type);
                  fetchReports();
                }}
              />

              {/* Photo */}
              {selectedReport.photo_url && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                  <p className="text-xs text-slate-500 uppercase font-bold mb-2">Citizen On-Site Photo Evidence</p>
                  <a href={selectedReport.photo_url} target="_blank" rel="noopener noreferrer">
                    <img src={selectedReport.photo_url} alt="Site" className="w-full max-h-56 object-cover rounded-xl border border-slate-200 hover:opacity-95 transition" />
                  </a>
                </div>
              )}

              {/* Location Info */}
              <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs space-y-2.5">
                <p className="text-xs text-slate-500 uppercase font-bold border-b border-slate-100 pb-2">Location & Case Metadata</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block font-semibold">Municipality</span>
                    <span className="font-bold text-slate-800">{selectedReport.municipality}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block font-semibold">Barangay</span>
                    <span className="font-bold text-slate-800">{selectedReport.barangay}</span>
                  </div>
                  {selectedReport.street && (
                    <div>
                      <span className="text-slate-400 block font-semibold">Sitio / Street</span>
                      <span className="font-bold text-slate-800">{selectedReport.street}</span>
                    </div>
                  )}
                  {selectedReport.project_name && (
                    <div className="col-span-2">
                      <span className="text-slate-400 block font-semibold">FMR Project</span>
                      <span className="font-bold text-teal-800">{selectedReport.project_name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* GPS */}
              {(selectedReport.latitude || selectedReport.longitude) && (
                <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-xl p-4 shadow-xs">
                  <p className="text-xs text-emerald-800 uppercase font-bold mb-2">Geospatial Coordinates</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-950 font-mono">
                    <span><strong>Lat:</strong> {Number(selectedReport.latitude).toFixed(6)}</span>
                    <span><strong>Lng:</strong> {Number(selectedReport.longitude).toFixed(6)}</span>
                    {selectedReport.geo_accuracy && <span><strong>Accuracy:</strong> ±{Math.round(selectedReport.geo_accuracy)}m</span>}
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${selectedReport.latitude},${selectedReport.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-2 bg-emerald-700 text-white rounded-lg text-xs font-bold hover:bg-emerald-800 transition shadow-xs"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0Z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0Z" />
                    </svg>
                    Open Target Location in Google Maps
                  </a>
                </div>
              )}

              {/* Description */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
                <p className="text-xs text-slate-500 uppercase font-bold mb-2">Citizen Complaint Description</p>
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed italic bg-slate-50 p-3 rounded-lg border border-slate-100">
                  &ldquo;{selectedReport.description || 'No description provided.'}&rdquo;
                </p>
              </div>

              {/* Status Update Actions */}
              <div className="bg-white p-4.5 rounded-xl border border-slate-200 shadow-xs space-y-3">
                <p className="text-xs text-slate-700 uppercase font-bold">Update Official Inspection Workflow Status</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { status: 'in_progress', label: 'Start Inspection', cls: 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' },
                  ].map(action => (
                    <button
                      key={action.status}
                      onClick={() => updateReportStatus(selectedReport.id, action.status)}
                      disabled={updatingStatus || selectedReport.engineer_status === action.status}
                      className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${action.cls} ${
                        selectedReport.engineer_status === action.status ? 'ring-2 ring-emerald-500 ring-offset-1' : ''
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">
                  Submitting findings below automatically marks this report as Inspected for DA admin review — inspection results are no longer self-certified here.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
