/* FieldEngineerDashboard.jsx – Professional Multi-View PWA Dashboard for Field Engineers
 * Features: Collapsible left sidebar navigation, responsive PWA mobile bottom bar & drawer,
 * GIS Map Explorer, Progress Certification, Damage Reports Inspection, and Profile Management.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseFieldEngineer as supabase } from '../lib/supabase';
import { enqueueEngineerUpdate } from '../lib/offlineReports';
import { requestBackgroundSync } from '../lib/offlineSync';
import FieldEngineerWorkflowPanel from '../components/publicReports/FieldEngineerWorkflowPanel';
import Logo from '../components/Logo';
import ProgressCertificationPanel from '../components/progress/ProgressCertificationPanel';
import PublicReportRouteMapPanel from '../components/publicReports/PublicReportRouteMapPanel';

/* ─── Status Helpers & Badges ─── */
const engineerStatusStyles = {
  assigned:    { label: 'Assigned',    cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  inspected:   { label: 'Inspected',   cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  validated:   { label: 'Validated',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:    { label: 'Needs Rework',cls: 'bg-rose-50 text-rose-700 border-rose-200' },
};

const reportStatusStyles = {
  pending:  'bg-amber-100 text-amber-800',
  reviewed: 'bg-blue-100 text-blue-800',
  resolved: 'bg-emerald-100 text-emerald-800',
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
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${s.cls}`}>{s.label}</span>;
}

function ReportStatusBadge({ status }) {
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${reportStatusStyles[status] || 'bg-slate-100 text-slate-600'}`}>
      {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending'}
    </span>
  );
}

function VerifyBadge({ verification }) {
  const map = {
    'Verified On-Site':   { icon: '✓', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    'Needs Review':       { icon: '!', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    'Location Mismatch':  { icon: '✕', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  };
  const s = map[verification] || { icon: '?', cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${s.cls}`}>{s.icon} {verification}</span>;
}

export default function FieldEngineerDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  /* Navigation Views: 'overview' | 'reports' | 'certify' | 'gis-map' | 'profile' */
  const [activeNav, setActiveNav] = useState('overview');
  const [activeReportTab, setActiveReportTab] = useState('assigned');
  const [certifyCount, setCertifyCount] = useState(0);

  /* Left Sidebar Collapsible & Mobile States */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  /* Advanced Filter, Sort & Pagination States (Senior Engineer Architect Grade) */
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMunicipality, setSelectedMunicipality] = useState('all');
  const [selectedVerification, setSelectedVerification] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selectedReport, setSelectedReport] = useState(null);
  const [engineerNotes, setEngineerNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [rejectionReason, setRejectionReason] = useState('');

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
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

      const rawRole = prof?.role || currentUser.user_metadata?.role || '';
      const effectiveRole = String(rawRole).trim().toLowerCase().replace(/[\s-]+/g, '_');

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
      }
      setReports(data || []);
    } catch (err) {
      console.error('Error fetching assigned reports:', err.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchReports();
      const channel = supabase
        .channel('engineer-reports-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'public_reports' }, () => fetchReports())
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [user, fetchReports]);

  // Fetch rejection reason if rejected by admin
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
      await supabase.from('notifications').insert({
        user_id: report.user_id,
        type,
        title: 'Public report update',
        message,
        report_id: report.id,
        is_read: false,
        created_at: new Date().toISOString(),
      });
    } catch { /* silent */ }
  }, []);

  const createAdminNotification = useCallback(async (reportId, message) => {
    if (!reportId) return;
    try {
      const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin').limit(10);
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
    } catch { /* silent */ }
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
    } catch { /* silent */ }
  }, [profile?.full_name, user]);

  // Update engineer status
  const updateReportStatus = async (reportId, newStatus) => {
    setUpdatingStatus(true);
    try {
      const flow = engineerStatusFlow[newStatus];
      const activeReport = reports.find((row) => row.id === reportId) || selectedReport;

      if (!flow || !activeReport) throw new Error('Invalid request or report not found');
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
            description: `Field engineer marked report as ${flow.label}.${engineerNotes?.trim() ? ` Notes: ${engineerNotes.trim()}` : ''}`,
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
        showNotification('Saved offline. Will sync when back online.');
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
      showNotification(`Report status updated: ${newStatus.replace('_', ' ')}`);
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
      showNotification(`Update failed: ${err.message}`, 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/field-engineer/login');
  };

  // Unique list of municipalities in assigned reports for dynamic dropdown
  const availableMunicipalities = useMemo(() => {
    const set = new Set();
    reports.forEach((r) => {
      if (r.municipality?.trim()) set.add(r.municipality.trim());
    });
    return Array.from(set).sort();
  }, [reports]);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => {
    return Boolean(
      searchQuery.trim() ||
      selectedMunicipality !== 'all' ||
      selectedVerification !== 'all' ||
      sortBy !== 'newest'
    );
  }, [searchQuery, selectedMunicipality, selectedVerification, sortBy]);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedMunicipality('all');
    setSelectedVerification('all');
    setSortBy('newest');
  };

  // Senior-grade Filter & Sort Engine
  const filteredAndSortedReports = useMemo(() => {
    let list = [...reports];

    // Filter by active status tab if in Damage Reports view
    if (activeNav === 'reports') {
      if (activeReportTab === 'assigned') list = list.filter(r => r.engineer_status === 'assigned');
      else if (activeReportTab === 'in-progress') list = list.filter(r => r.engineer_status === 'in_progress');
      else if (activeReportTab === 'needs-rework') list = list.filter(r => r.engineer_status === 'rejected');
      else if (activeReportTab === 'completed') list = list.filter(r => ['inspected', 'validated'].includes(r.engineer_status));
    }

    // Text Search Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(r =>
        (r.barangay && r.barangay.toLowerCase().includes(q)) ||
        (r.municipality && r.municipality.toLowerCase().includes(q)) ||
        (r.street && r.street.toLowerCase().includes(q)) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.id && r.id.toLowerCase().includes(q))
      );
    }

    // Municipality Filter
    if (selectedMunicipality !== 'all') {
      list = list.filter(r => (r.municipality || '').toLowerCase() === selectedMunicipality.toLowerCase());
    }

    // Verification Severity Filter
    if (selectedVerification !== 'all') {
      list = list.filter(r => r.verification === selectedVerification);
    }

    // Sorting Engine
    list.sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.assigned_at || a.created_at || 0) - new Date(b.assigned_at || b.created_at || 0);
      }
      if (sortBy === 'location') {
        const locA = `${a.municipality || ''} ${a.barangay || ''}`.toLowerCase();
        const locB = `${b.municipality || ''} ${b.barangay || ''}`.toLowerCase();
        return locA.localeCompare(locB);
      }
      if (sortBy === 'priority') {
        const priorityWeight = (status) => {
          if (status === 'rejected') return 4;   // High priority: Needs Rework
          if (status === 'assigned') return 3;   // New assignment
          if (status === 'in_progress') return 2; // Active on-site
          return 1;                              // Completed / validated
        };
        return priorityWeight(b.engineer_status) - priorityWeight(a.engineer_status);
      }
      // Default: newest first
      return new Date(b.assigned_at || b.created_at || 0) - new Date(a.assigned_at || a.created_at || 0);
    });

    return list;
  }, [reports, activeNav, activeReportTab, searchQuery, selectedMunicipality, selectedVerification, sortBy]);

  // Backward compatibility reference
  const filteredReports = filteredAndSortedReports;

  // Reset pagination to page 1 whenever any filter or tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedMunicipality, selectedVerification, sortBy, activeNav, activeReportTab]);

  // Pagination bounds & slice
  const totalPages = Math.max(1, Math.ceil(filteredAndSortedReports.length / pageSize));
  
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredAndSortedReports.slice(start, start + pageSize);
  }, [filteredAndSortedReports, currentPage, pageSize]);

  // Metrics
  const metrics = useMemo(() => ({
    total: reports.length,
    assigned: reports.filter(r => r.engineer_status === 'assigned').length,
    inProgress: reports.filter(r => r.engineer_status === 'in_progress').length,
    needsRework: reports.filter(r => r.engineer_status === 'rejected').length,
    completed: reports.filter(r => ['inspected', 'validated'].includes(r.engineer_status)).length,
  }), [reports]);

  // Coordinates list for GIS map view
  const mapReportPoints = useMemo(() => {
    return reports.filter(r => r.latitude && r.longitude).map(r => ({
      id: r.id,
      lat: Number(r.latitude),
      lng: Number(r.longitude),
      title: `${r.barangay}, ${r.municipality}`,
      status: r.engineer_status,
      description: r.description,
    }));
  }, [reports]);

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-3 border-teal-600 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-slate-500 text-sm font-semibold">Loading Field Engineer Portal…</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25zM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25z' },
    { id: 'certify', label: 'Certify Progress', count: certifyCount, icon: 'M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'reports', label: 'Damage Reports', count: metrics.total, icon: 'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9z' },
    { id: 'gis-map', label: 'GIS Field Map', icon: 'M9 6.75V15m6-6v8.25m.503-14.33 4.243 1.93a1.125 1.125 0 0 1 .63 1.018v12.923a1.125 1.125 0 0 1-1.567 1.03l-4.512-2.05a1.125 1.125 0 0 0-.918 0l-4.75 2.16a1.125 1.125 0 0 1-.918 0l-4.512-2.05A1.125 1.125 0 0 1 2.25 18.06V5.137c0-.472.296-.893.74-1.054l4.243-1.543a1.125 1.125 0 0 1 .74 0l4.512 1.64c.298.109.623.109.92 0z' },
    { id: 'profile', label: 'Engineer Profile', icon: 'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0zM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632z' },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex font-sans relative pb-16 lg:pb-0 overflow-x-hidden">
      {/* Offline Status Banner */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-500 text-slate-950 px-4 py-2 text-xs font-bold text-center flex items-center justify-center gap-2 shadow-md">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          PWA Offline Mode: Field updates will be saved locally and queued for automatic sync when online.
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed top-4 right-4 left-4 sm:left-auto sm:w-auto z-[100] px-5 py-3 rounded-xl shadow-2xl text-white font-bold text-sm flex items-center gap-2 animate-bounce ${
          notification.type === 'error' ? 'bg-rose-600 border border-rose-500' : 'bg-emerald-600 border border-emerald-500'
        }`}>
          <span>{notification.type === 'error' ? '✕' : '✓'}</span>
          <span>{notification.message}</span>
        </div>
      )}

      {/* ── DESKTOP COLLAPSIBLE LEFT SIDEBAR ── */}
      <aside className={`hidden lg:flex flex-col fixed top-0 bottom-0 left-0 z-40 bg-white/95 backdrop-blur-xl border-r border-slate-200/80 shadow-xs transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? 'w-20' : 'w-64'
      }`}>
        {/* Sidebar Header & Toggle */}
        <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
          {!sidebarCollapsed ? (
            <div className="flex items-center gap-3 overflow-hidden">
              <Logo className="h-7" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                Field
              </span>
            </div>
          ) : (
            <div className="mx-auto w-8 h-8 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 flex items-center justify-center text-white font-black text-xs shadow-sm">
              FE
            </div>
          )}

          {/* Collapse/Expand Toggle Button */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all border border-slate-200 ${sidebarCollapsed ? 'mx-auto mt-1' : ''}`}
            title={sidebarCollapsed ? "Expand Navigation" : "Collapse Navigation"}
          >
            <svg className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 py-4 px-3 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs font-bold transition-all group relative ${
                  active
                    ? 'bg-gradient-to-r from-teal-600 to-emerald-600 text-white shadow-md shadow-teal-500/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                } ${sidebarCollapsed ? 'justify-center' : ''}`}
                title={sidebarCollapsed ? `${item.label}${item.count ? ` (${item.count})` : ''}` : undefined}
              >
                <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>

                {!sidebarCollapsed && (
                  <span className="flex-1 text-left truncate">{item.label}</span>
                )}

                {item.count > 0 && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-teal-50 text-teal-700 border border-teal-200'
                  } ${sidebarCollapsed ? 'absolute top-1 right-1 px-1 py-0 text-[9px] min-w-[16px] text-center' : ''}`}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer User Info */}
        <div className="p-3 border-t border-slate-100 bg-slate-50/60">
          {!sidebarCollapsed ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                  {(profile.full_name || profile.email || 'FE').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-800 truncate">{profile.full_name || profile.email}</p>
                  <p className="text-[10px] text-teal-600 font-bold">Field Inspector</p>
                </div>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                title="Sign Out"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={handleSignOut}
              className="w-full py-2 flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-slate-100 rounded-xl transition-colors"
              title="Sign Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          )}
        </div>
      </aside>

      {/* ── MOBILE SLIDE-OUT DRAWER OVERLAY ── */}
      {mobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileDrawerOpen(false)}>
          <div
            className="w-72 max-w-[80vw] h-full bg-white border-r border-slate-200 flex flex-col p-4 shadow-2xl animate-slideRight"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <Logo className="h-7" />
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-xl bg-slate-100"
              >
                ✕
              </button>
            </div>

            <nav className="flex-1 space-y-2">
              {navItems.map((item) => {
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileDrawerOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-xs font-bold transition-all ${
                      active ? 'bg-teal-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      <span>{item.label}</span>
                    </div>
                    {item.count > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        {item.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-teal-600 text-white font-bold text-xs flex items-center justify-center">
                  {(profile.full_name || profile.email || 'FE').charAt(0).toUpperCase()}
                </div>
                <p className="text-xs font-bold text-slate-800">{profile.full_name || 'Engineer'}</p>
              </div>
              <button onClick={handleSignOut} className="text-xs text-rose-600 font-bold hover:underline">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT AREA ── */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
        sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
      }`}>
        {/* Top Header Bar (Matches Admin Page) */}
        <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile Hamburger Drawer Button */}
              <button
                onClick={() => setMobileDrawerOpen(true)}
                className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 bg-slate-100 border border-slate-200"
                title="Open Menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              </button>

              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                  {navItems.find((n) => n.id === activeNav)?.label || 'Field Command'}
                </h2>
              </div>
            </div>

            {/* Top Right Quick Profile */}
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right">
                <p className="text-xs font-bold text-slate-800 leading-tight">{profile.full_name || profile.email}</p>
                <p className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">DA Region VI Inspector</p>
              </div>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                {(profile.full_name || profile.email || 'FE').charAt(0).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

        {/* Main Section Body */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">

          {/* ── VIEW 1: OVERVIEW DASHBOARD ── */}
          {activeNav === 'overview' && (
            <div className="space-y-6 animate-fadeIn">
              {/* Hero Welcome Banner (Clean Light Theme) */}
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-teal-800 via-emerald-800 to-teal-900 border border-teal-700/60 p-6 sm:p-8 shadow-xl text-white">
                <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-white/10 text-teal-200 border border-white/20 mb-3">
                      DA RAED Field Command
                    </span>
                    <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                      Welcome back, {profile.full_name || 'Engineer'}
                    </h1>
                    <p className="text-sm text-teal-100/90 mt-1 max-w-xl">
                      Department of Agriculture Region VI Field Operations. Measure contractor progress, inspect public damage reports, and verify infrastructure quality.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => setActiveNav('reports')}
                      className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-100 text-teal-900 font-bold text-xs uppercase tracking-wider shadow-md transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-teal-700" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25" />
                      </svg>
                      Inspect Reports ({metrics.assigned})
                    </button>
                    <button
                      onClick={() => setActiveNav('certify')}
                      className="px-4 py-2.5 rounded-xl bg-teal-900/60 hover:bg-teal-900 text-white border border-teal-500/40 font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                      </svg>
                      Certify Queue ({certifyCount})
                    </button>
                  </div>
                </div>
              </div>

              {/* KPI Stat Cards (White Theme Cards matching Admin) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
                <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Total Workload</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6z" />
                    </svg>
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-slate-900">{metrics.total}</p>
                  <p className="text-[11px] text-slate-500 mt-1">Assigned Cases</p>
                </div>

                <div className="bg-blue-50/60 rounded-2xl border border-blue-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-blue-700 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">New</span>
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-blue-900">{metrics.assigned}</p>
                  <p className="text-[11px] text-blue-600 mt-1">Awaiting Inspection</p>
                </div>

                <div className="bg-amber-50/60 rounded-2xl border border-amber-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-amber-700 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">In Progress</span>
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-amber-900">{metrics.inProgress}</p>
                  <p className="text-[11px] text-amber-600 mt-1">On-Site Active</p>
                </div>

                <div className="bg-rose-50/60 rounded-2xl border border-rose-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between text-rose-700 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Needs Rework</span>
                    <svg className="w-4 h-4 text-rose-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-rose-900">{metrics.needsRework}</p>
                  <p className="text-[11px] text-rose-600 mt-1">Returned by Admin</p>
                </div>

                <div className="bg-emerald-50/60 rounded-2xl border border-emerald-200/80 p-4 sm:p-5 shadow-xs hover:shadow-md transition-shadow col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between text-emerald-700 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Completed</span>
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  </div>
                  <p className="text-2xl sm:text-3xl font-black text-emerald-900">{metrics.completed}</p>
                  <p className="text-[11px] text-emerald-600 mt-1">Inspected & Verified</p>
                </div>
              </div>

              {/* Recent Assigned Damage Reports Preview */}
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900">Recent Assigned Damage Reports</h3>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        {filteredAndSortedReports.length} {filteredAndSortedReports.length === 1 ? 'Report' : 'Reports'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">Citizens public reports requiring field inspection</p>
                  </div>
                  <button
                    onClick={() => setActiveNav('reports')}
                    className="text-xs font-bold text-teal-600 hover:text-teal-700 transition flex items-center gap-1 shrink-0"
                  >
                    View All Queue ({reports.length}) →
                  </button>
                </div>

                {/* Senior Engineer Search, Filter & Sort Bar */}
                <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200/80 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-medium">
                    {/* Search Input */}
                    <div className="relative">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search barangay, sitio, ref #..."
                        className="w-full pl-9 pr-8 py-2 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-medium placeholder-slate-400"
                      />
                      <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                      </svg>
                      {searchQuery && (
                        <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600">
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Municipality Filter */}
                    <div>
                      <select
                        value={selectedMunicipality}
                        onChange={(e) => setSelectedMunicipality(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        <option value="all">All Municipalities ({availableMunicipalities.length})</option>
                        {availableMunicipalities.map((mun) => (
                          <option key={mun} value={mun}>{mun}</option>
                        ))}
                      </select>
                    </div>

                    {/* Verification Severity Filter */}
                    <div>
                      <select
                        value={selectedVerification}
                        onChange={(e) => setSelectedVerification(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        <option value="all">All Verifications</option>
                        <option value="Needs Review">Needs Review</option>
                        <option value="Location Mismatch">Location Mismatch</option>
                        <option value="Verified On-Site">Verified On-Site</option>
                      </select>
                    </div>

                    {/* Sort Engine Selector */}
                    <div>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-white border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                      >
                        <option value="newest">Sort: Newest First</option>
                        <option value="oldest">Sort: Oldest First (Backlog)</option>
                        <option value="priority">Sort: Needs Rework First</option>
                        <option value="location">Sort: By Location (A-Z)</option>
                      </select>
                    </div>
                  </div>

                  {/* Active Filters Summary & Clear */}
                  {hasActiveFilters && (
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60">
                      <span className="text-slate-500 font-medium">
                        Showing <strong className="text-slate-800">{filteredAndSortedReports.length}</strong> of <strong className="text-slate-800">{reports.length}</strong> total reports
                      </span>
                      <button
                        onClick={resetFilters}
                        className="text-xs text-rose-600 font-bold hover:underline flex items-center gap-1"
                      >
                        <span>Reset All Filters</span>
                      </button>
                    </div>
                  )}
                </div>

                {filteredAndSortedReports.length === 0 ? (
                  <div className="text-center py-10 bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-500 text-sm space-y-1">
                    <p className="font-bold text-slate-700">No matching reports found</p>
                    <p className="text-xs text-slate-400">Try adjusting search terms or clear active filters</p>
                    {hasActiveFilters && (
                      <button onClick={resetFilters} className="mt-2 text-xs font-bold text-teal-600 underline">
                        Clear Active Filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Tabular Data Table */}
                    <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-xs">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                            <th className="py-3 px-4">Ref ID</th>
                            <th className="py-3 px-4">Location</th>
                            <th className="py-3 px-4">Description</th>
                            <th className="py-3 px-4">Date Assigned</th>
                            <th className="py-3 px-4">Field Status</th>
                            <th className="py-3 px-4">Verification</th>
                            <th className="py-3 px-4 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-xs">
                          {paginatedReports.map((rpt) => (
                            <tr
                              key={rpt.id}
                              className="hover:bg-slate-50/50 transition-colors"
                            >
                              <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                                #{rpt.id.slice(0, 8).toUpperCase()}
                              </td>
                              <td className="py-3 px-4">
                                <p className="font-bold text-slate-800">
                                  {rpt.barangay}, {rpt.municipality}
                                </p>
                                {rpt.street && <p className="text-[11px] text-slate-400 truncate max-w-[180px]">{rpt.street}</p>}
                              </td>
                              <td className="py-3 px-4 max-w-xs truncate text-slate-600">
                                <div className="flex items-center gap-2">
                                  {rpt.photo_url && (
                                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Photo</span>
                                  )}
                                  <span className="truncate">{rpt.description}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                                {rpt.assigned_at ? new Date(rpt.assigned_at).toLocaleDateString() : 'Recent'}
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <EngineerStatusBadge status={rpt.engineer_status} />
                              </td>
                              <td className="py-3 px-4 whitespace-nowrap">
                                <VerifyBadge verification={rpt.verification} />
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedReport(rpt); setEngineerNotes(rpt.engineer_notes || ''); }}
                                  className="px-3.5 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 font-bold text-[11px] hover:bg-teal-600 hover:text-white hover:border-teal-600 hover:shadow-md cursor-pointer transition-all active:scale-95"
                                >
                                  Inspect →
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination Controls Footer */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500">
                      <div className="flex items-center gap-3">
                        <span>
                          Showing <strong className="text-slate-800">{Math.min((currentPage - 1) * pageSize + 1, filteredAndSortedReports.length)}</strong> to{' '}
                          <strong className="text-slate-800">{Math.min(currentPage * pageSize, filteredAndSortedReports.length)}</strong> of{' '}
                          <strong className="text-slate-800">{filteredAndSortedReports.length}</strong> entries
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400">Rows:</span>
                          <select
                            value={pageSize}
                            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                            className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 cursor-pointer"
                          >
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                            <option value={20}>20</option>
                          </select>
                        </div>
                      </div>

                      {/* Pagination Buttons */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          disabled={currentPage === 1}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
                        >
                          ‹ Prev
                        </button>

                        <div className="flex items-center gap-1">
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                            <button
                              key={pg}
                              onClick={() => setCurrentPage(pg)}
                              className={`w-7 h-7 rounded-xl font-bold text-xs transition ${
                                currentPage === pg
                                  ? 'bg-teal-600 text-white shadow-xs'
                                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {pg}
                            </button>
                          ))}
                        </div>

                        <button
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          disabled={currentPage === totalPages}
                          className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
                        >
                          Next ›
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── VIEW 2: DAMAGE REPORTS INSPECTIONS ── */}
          {activeNav === 'reports' && (
            <div className="space-y-6 animate-fadeIn">
              {/* Header & Status Tabs */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Public Damage Inspection Queue</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Assigned public reports awaiting on-site findings & geotagged evidence</p>
                </div>

                {/* Status Filter Tabs */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {[
                    { id: 'assigned', label: 'New', count: metrics.assigned },
                    { id: 'in-progress', label: 'In Progress', count: metrics.inProgress },
                    { id: 'needs-rework', label: 'Needs Rework', count: metrics.needsRework },
                    { id: 'completed', label: 'Completed', count: metrics.completed },
                    { id: 'all', label: 'All', count: metrics.total },
                  ].map((tab) => {
                    const active = activeReportTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => setActiveReportTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                          active
                            ? 'bg-teal-600 text-white shadow-sm'
                            : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`px-1.5 py-0.5 rounded-md text-[10px] ${
                          active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'
                        }`}>{tab.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Senior Engineer Filter, Search & Sort Control Bar */}
              <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-medium">
                  {/* Search Input */}
                  <div className="relative">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search barangay, sitio, ref #..."
                      className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-medium placeholder-slate-400"
                    />
                    <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607z" />
                    </svg>
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600">
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Municipality Filter */}
                  <div>
                    <select
                      value={selectedMunicipality}
                      onChange={(e) => setSelectedMunicipality(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      <option value="all">All Municipalities ({availableMunicipalities.length})</option>
                      {availableMunicipalities.map((mun) => (
                        <option key={mun} value={mun}>{mun}</option>
                      ))}
                    </select>
                  </div>

                  {/* Verification Severity Filter */}
                  <div>
                    <select
                      value={selectedVerification}
                      onChange={(e) => setSelectedVerification(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      <option value="all">All Verifications</option>
                      <option value="Needs Review">Needs Review</option>
                      <option value="Location Mismatch">Location Mismatch</option>
                      <option value="Verified On-Site">Verified On-Site</option>
                    </select>
                  </div>

                  {/* Sort Engine Selector */}
                  <div>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/40 text-slate-800 text-xs font-semibold cursor-pointer"
                    >
                      <option value="newest">Sort: Newest First</option>
                      <option value="oldest">Sort: Oldest First (Backlog)</option>
                      <option value="priority">Sort: Needs Rework First</option>
                      <option value="location">Sort: By Location (A-Z)</option>
                    </select>
                  </div>
                </div>

                {/* Active Filters Summary & Reset */}
                {hasActiveFilters && (
                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
                    <span className="text-slate-500 font-medium">
                      Showing <strong className="text-slate-800">{filteredAndSortedReports.length}</strong> of <strong className="text-slate-800">{reports.length}</strong> total queue items
                    </span>
                    <button
                      onClick={resetFilters}
                      className="text-xs text-rose-600 font-bold hover:underline flex items-center gap-1"
                    >
                      <span>Reset All Filters</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Reports List */}
              {loading ? (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-xs">
                  <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
                  <p className="text-xs text-slate-500 font-bold">Loading assigned inspection reports…</p>
                </div>
              ) : filteredReports.length === 0 ? (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-12 text-center shadow-xs">
                  <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
                  </svg>
                  <p className="font-bold text-slate-800">No reports in this category</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {activeReportTab === 'assigned' ? 'No new reports assigned to your queue' : 'Switch category tabs above to view other reports'}
                  </p>
                </div>
              ) : (
                <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
                  {/* Tabular Data Table */}
                  <div className="overflow-x-auto border border-slate-200/80 rounded-2xl bg-white shadow-xs">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                          <th className="py-3 px-4">Ref ID</th>
                          <th className="py-3 px-4">Location</th>
                          <th className="py-3 px-4">Description</th>
                          <th className="py-3 px-4">Date Assigned</th>
                          <th className="py-3 px-4">Field Status</th>
                          <th className="py-3 px-4">Verification</th>
                          <th className="py-3 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {paginatedReports.map((rpt) => (
                          <tr
                            key={rpt.id}
                            className="hover:bg-slate-50/50 transition-colors"
                          >
                            <td className="py-3.5 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                              #{rpt.id.slice(0, 8).toUpperCase()}
                            </td>
                            <td className="py-3.5 px-4">
                              <p className="font-bold text-slate-800">
                                {rpt.barangay}, {rpt.municipality}
                              </p>
                              {rpt.street && <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{rpt.street}</p>}
                            </td>
                            <td className="py-3.5 px-4 max-w-sm truncate text-slate-600">
                              <div className="flex items-center gap-2">
                                {rpt.photo_url && (
                                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Photo</span>
                                )}
                                <span className="truncate">{rpt.description}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                              {rpt.assigned_at ? new Date(rpt.assigned_at).toLocaleDateString() : 'Recent'}
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <EngineerStatusBadge status={rpt.engineer_status} />
                            </td>
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <VerifyBadge verification={rpt.verification} />
                            </td>
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => { setSelectedReport(rpt); setEngineerNotes(rpt.engineer_notes || ''); }}
                                className="px-3.5 py-1.5 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 font-bold text-[11px] hover:bg-teal-600 hover:text-white hover:border-teal-600 hover:shadow-md cursor-pointer transition-all active:scale-95"
                              >
                                Inspect Case →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Controls Footer */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-slate-500">
                    <div className="flex items-center gap-3">
                      <span>
                        Showing <strong className="text-slate-800">{Math.min((currentPage - 1) * pageSize + 1, filteredAndSortedReports.length)}</strong> to{' '}
                        <strong className="text-slate-800">{Math.min(currentPage * pageSize, filteredAndSortedReports.length)}</strong> of{' '}
                        <strong className="text-slate-800">{filteredAndSortedReports.length}</strong> queue items
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400">Rows:</span>
                        <select
                          value={pageSize}
                          onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                          className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 cursor-pointer"
                        >
                          <option value={5}>5</option>
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                        </select>
                      </div>
                    </div>

                    {/* Pagination Buttons */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
                      >
                        ‹ Prev
                      </button>

                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pg) => (
                          <button
                            key={pg}
                            onClick={() => setCurrentPage(pg)}
                            className={`w-7 h-7 rounded-xl font-bold text-xs transition ${
                              currentPage === pg
                                ? 'bg-teal-600 text-white shadow-xs'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {pg}
                          </button>
                        ))}
                      </div>

                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-100 transition"
                      >
                        Next ›
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── VIEW 3: PROGRESS CERTIFICATION QUEUE ── */}
          {activeNav === 'certify' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm">
                <h2 className="text-xl font-bold text-slate-900">Contractor Progress Certification</h2>
                <p className="text-xs text-slate-500 mt-0.5">DA Region VI Requirement: Verify on-site accomplishment before payment recognition</p>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm text-slate-900">
                <ProgressCertificationPanel
                  onCountChange={setCertifyCount}
                  showNotification={showNotification}
                />
              </div>
            </div>
          )}

          {/* ── VIEW 4: GIS FIELD MAP EXPLORER ── */}
          {activeNav === 'gis-map' && (
            <div className="space-y-6 animate-fadeIn">
              <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Geospatial GIS Field Map</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Interactive map of assigned public damage reports across Region VI</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <span className="w-3 h-3 rounded-full bg-teal-500 inline-block" /> {mapReportPoints.length} Geotagged Sites
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-slate-200/80 p-4 shadow-sm overflow-hidden">
                <PublicReportRouteMapPanel
                  reportLatitude={mapReportPoints[0]?.lat}
                  reportLongitude={mapReportPoints[0]?.lng}
                  heightClass="h-[520px]"
                  title="Field Engineer Inspection Map"
                />
              </div>
            </div>
          )}

          {/* ── VIEW 5: ENGINEER PROFILE ── */}
          {activeNav === 'profile' && (
            <div className="space-y-6 animate-fadeIn max-w-3xl mx-auto">
              <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 shadow-sm space-y-6">
                <div className="flex items-center gap-4 border-b border-slate-100 pb-6">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-600 text-white font-black text-2xl flex items-center justify-center shadow-md">
                    {(profile.full_name || profile.email || 'FE').charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{profile.full_name || 'Field Engineer'}</h2>
                    <p className="text-xs font-bold text-teal-600 uppercase tracking-wider mt-0.5">DA RAED Authorized Inspector</p>
                    <p className="text-xs text-slate-500 mt-1">{profile.email}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
                    <span className="text-slate-500 uppercase font-bold block mb-1">Role Permission</span>
                    <span className="font-bold text-slate-800">Field Supervising Engineer</span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
                    <span className="text-slate-500 uppercase font-bold block mb-1">Region / Jurisdiction</span>
                    <span className="font-bold text-slate-800">DA Region VI (Western Visayas)</span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
                    <span className="text-slate-500 uppercase font-bold block mb-1">PWA Sync Status</span>
                    <span className={`font-bold ${isOffline ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {isOffline ? 'Offline Mode (Local Storage)' : 'Online (Direct Cloud Sync)'}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/60">
                    <span className="text-slate-500 uppercase font-bold block mb-1">Active Assigned Cases</span>
                    <span className="font-bold text-teal-600">{reports.length} Reports</span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSignOut}
                    className="px-5 py-2.5 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-600 hover:text-white font-bold text-xs uppercase tracking-wider transition-all"
                  >
                    Sign Out of Field Portal
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ── REPORT DETAIL MODAL ── */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4" onClick={() => setSelectedReport(null)}>
          <div
            className="bg-white border border-slate-200 w-full max-w-3xl max-h-[92vh] rounded-3xl shadow-2xl overflow-y-auto text-slate-900 flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-slate-900 text-white px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-teal-500/20 text-teal-300 rounded-xl flex items-center justify-center border border-teal-400/30 font-bold text-sm">
                  FE
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">On-Site Field Inspection</h3>
                  <p className="text-xs text-slate-300">Ref #{selectedReport.id.slice(0, 8).toUpperCase()} &middot; {selectedReport.barangay}, {selectedReport.municipality}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedReport(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              <div className="flex items-center gap-2 flex-wrap">
                <EngineerStatusBadge status={selectedReport.engineer_status} />
                <VerifyBadge verification={selectedReport.verification} />
                <ReportStatusBadge status={selectedReport.status} />
              </div>

              {selectedReport.engineer_status === 'rejected' && (
                <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-1">
                  <p className="text-xs font-bold text-rose-800 uppercase tracking-wide">DA Admin Returned For Re-Inspection</p>
                  <p className="text-sm text-slate-800">{rejectionReason || 'No reason specified.'}</p>
                  <p className="text-xs text-rose-600 mt-1">Re-examine site findings below and resubmit once verified.</p>
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

              {/* Photos */}
              {selectedReport.photo_url && (
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Citizen On-Site Photo Evidence</p>
                  <a href={selectedReport.photo_url} target="_blank" rel="noopener noreferrer">
                    <img src={selectedReport.photo_url} alt="Site" className="w-full max-h-60 object-cover rounded-xl border border-slate-200 hover:opacity-90 transition" />
                  </a>
                </div>
              )}

              {/* Status Actions */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-700 uppercase">Update Field Inspection Workflow Status</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => updateReportStatus(selectedReport.id, 'in_progress')}
                    disabled={updatingStatus || selectedReport.engineer_status === 'in_progress'}
                    className={`px-4 py-3 rounded-xl text-xs font-bold border transition-all disabled:opacity-40 ${
                      selectedReport.engineer_status === 'in_progress'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                    }`}
                  >
                    Start On-Site Inspection
                  </button>
                </div>
              </div>

              {/* Cancel / Close Footer */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedReport(null)}
                  className="px-6 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-wider transition-all"
                >
                  Cancel & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE PWA BOTTOM NAVIGATION BAR (Light Theme) ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-lg border-t border-slate-200 px-2 py-2 flex items-center justify-around shadow-xl">
        {navItems.map((item) => {
          const active = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all relative ${
                active ? 'text-teal-600 font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="text-[10px] leading-none font-bold">{item.label.split(' ')[0]}</span>
              {item.count > 0 && (
                <span className="absolute -top-1 right-2 w-4 h-4 rounded-full bg-teal-600 text-white font-black text-[9px] flex items-center justify-center shadow-xs">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}


