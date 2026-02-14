/* Dashboard.jsx - Complete Functional Rewrite with Supabase Integration */
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export default function Dashboard() {
  const navigate = useNavigate();
  
  // State management
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showSidebar, setShowSidebar] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [notification, setNotification] = useState(null);
  const projectsPerPage = 5;
  
  // Feedback state (admin view)
  const [feedbacks, setFeedbacks] = useState([]);
  const [feedbacksLoading, setFeedbacksLoading] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState('all');
  const [feedbackTypeFilter, setFeedbackTypeFilter] = useState('all');
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState(null);

  // Form state
  const emptyForm = {
    projectName: '',
    projectCode: '',
    region: '',
    barangay: '',
    municipality: '',
    province: '',
    latitude: '',
    longitude: '',
    roadLength: '',
    roadWidth: '',
    totalBudget: '',
    disbursedAmount: '',
    budgetSource: '',
    contractor: '',
    startDate: '',
    expectedEndDate: '',
    roadType: '',
    status: 'Planning',
    progress: 0,
    description: ''
  };
  const [formData, setFormData] = useState(emptyForm);

  // Show notification helper
  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Fetch projects from Supabase
  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (fetchErr) throw fetchErr;
      
      setProjects(data || []);
    } catch (err) {
      console.error('Error fetching projects:', err.message);
      setError(`Failed to load projects: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch feedbacks from Supabase
  const fetchFeedbacks = useCallback(async () => {
    setFeedbacksLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('feedbacks')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchErr) throw fetchErr;
      setFeedbacks(data || []);
    } catch (err) {
      console.error('Error fetching feedbacks:', err.message);
    } finally {
      setFeedbacksLoading(false);
    }
  }, []);

  // Update feedback status (admin action)
  const updateFeedbackStatus = async (feedbackId, newStatus) => {
    try {
      const { error } = await supabase
        .from('feedbacks')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', feedbackId);
      if (error) throw error;
      await fetchFeedbacks();
      showNotification(`Feedback marked as ${newStatus}`);
    } catch (err) {
      console.error('Failed to update feedback:', err.message);
      showNotification(`Failed to update: ${err.message}`, 'error');
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchFeedbacks();

    // Real-time subscription for projects
    const projectChannel = supabase
      .channel('admin-projects-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => fetchProjects())
      .subscribe();

    // Real-time subscription for feedbacks
    const feedbackChannel = supabase
      .channel('admin-feedbacks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => fetchFeedbacks())
      .subscribe();

    return () => {
      supabase.removeChannel(projectChannel);
      supabase.removeChannel(feedbackChannel);
    };
  }, [fetchProjects, fetchFeedbacks]);

  // Filter and search projects
  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      const matchesSearch = project.projectName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.projectCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.municipality?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        project.contractor?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      
      return matchesSearch && matchesStatus;
    });
  }, [projects, searchQuery, statusFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredProjects.length / projectsPerPage);
  const paginatedProjects = filteredProjects.slice(
    (currentPage - 1) * projectsPerPage,
    currentPage * projectsPerPage
  );

  // Calculate metrics
  const metrics = useMemo(() => {
    const totalProjects = projects.length;
    const inProgress = projects.filter(p => p.status === 'In Progress').length;
    const completed = projects.filter(p => p.status === 'Completed').length;
    const totalBudget = projects.reduce((sum, p) => sum + (p.totalBudget || 0), 0);
    const disbursed = projects.reduce((sum, p) => sum + (p.disbursedAmount || 0), 0);
    const avgProgress = projects.length > 0 
      ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / projects.length)
      : 0;
    
    return { totalProjects, inProgress, completed, totalBudget, disbursed, avgProgress };
  }, [projects]);

  // Form handlers
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const generateProjectCode = () => {
    const year = new Date().getFullYear();
    const num = String(projects.length + 1).padStart(3, '0');
    return `FMR-${year}-${num}`;
  };

  const handleAddProject = async (e) => {
    e.preventDefault();
    
    // Build insert payload — do NOT include `id` or `created_at`
    // Supabase auto-generates both via IDENTITY and DEFAULT now()
    const newProject = {
      projectName: formData.projectName,
      projectCode: formData.projectCode || generateProjectCode(),
      region: formData.region,
      province: formData.province,
      municipality: formData.municipality,
      barangay: formData.barangay,
      latitude: parseFloat(formData.latitude) || 0,
      longitude: parseFloat(formData.longitude) || 0,
      roadLength: parseFloat(formData.roadLength) || 0,
      roadWidth: parseFloat(formData.roadWidth) || 0,
      roadType: formData.roadType,
      totalBudget: parseFloat(formData.totalBudget) || 0,
      budgetSource: formData.budgetSource,
      disbursedAmount: parseFloat(formData.disbursedAmount) || 0,
      contractor: formData.contractor,
      startDate: formData.startDate,
      expectedEndDate: formData.expectedEndDate,
      status: formData.status || 'Planning',
      progress: parseInt(formData.progress) || 0,
      description: formData.description
    };

    try {
      const { error } = await supabase.from('projects').insert([newProject]);
      if (error) throw error;
      await fetchProjects();
      setShowAddModal(false);
      setFormData(emptyForm);
      showNotification('Project created successfully!');
    } catch (err) {
      console.error('Failed to create project:', err.message);
      showNotification(`Failed to save project: ${err.message}`, 'error');
    }
  };

  const handleEditProject = async (e) => {
    e.preventDefault();
    
    // Build update payload — exclude `id` and `created_at` (identity/system columns)
    const updatedProject = {
      projectName: formData.projectName,
      projectCode: formData.projectCode,
      region: formData.region,
      province: formData.province,
      municipality: formData.municipality,
      barangay: formData.barangay,
      latitude: parseFloat(formData.latitude) || 0,
      longitude: parseFloat(formData.longitude) || 0,
      roadLength: parseFloat(formData.roadLength) || 0,
      roadWidth: parseFloat(formData.roadWidth) || 0,
      roadType: formData.roadType,
      totalBudget: parseFloat(formData.totalBudget) || 0,
      budgetSource: formData.budgetSource,
      disbursedAmount: parseFloat(formData.disbursedAmount) || 0,
      contractor: formData.contractor,
      startDate: formData.startDate,
      expectedEndDate: formData.expectedEndDate,
      status: formData.status,
      progress: parseInt(formData.progress) || 0,
      description: formData.description,
      updated_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase
        .from('projects')
        .update(updatedProject)
        .eq('id', selectedProject.id);
      if (error) throw error;
      await fetchProjects();
      setShowEditModal(false);
      setSelectedProject(null);
      setFormData(emptyForm);
      showNotification('Project updated successfully!');
    } catch (err) {
      console.error('Failed to update project:', err.message);
      showNotification(`Failed to update project: ${err.message}`, 'error');
    }
  };

  const handleDeleteProject = async () => {
    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', selectedProject.id);
      if (error) throw error;
      await fetchProjects();
      setShowDeleteModal(false);
      setSelectedProject(null);
      showNotification('Project deleted successfully!', 'error');
    } catch (err) {
      console.error('Failed to delete project:', err.message);
      showNotification(`Failed to delete project: ${err.message}`, 'error');
    }
  };

  const openEditModal = (project) => {
    setSelectedProject(project);
    setFormData({
      ...project,
      totalBudget: project.totalBudget?.toString() || '',
      disbursedAmount: project.disbursedAmount?.toString() || '',
      roadLength: project.roadLength?.toString() || '',
      roadWidth: project.roadWidth?.toString() || '',
      latitude: project.latitude?.toString() || '',
      longitude: project.longitude?.toString() || '',
      progress: project.progress?.toString() || '0'
    });
    setShowEditModal(true);
  };

  const openDeleteModal = (project) => {
    setSelectedProject(project);
    setShowDeleteModal(true);
  };

  // Format currency
  const formatCurrency = (amount) => {
    if (!amount) return '₱0';
    if (amount >= 1000000) {
      return `₱${(amount / 1000000).toFixed(1)}M`;
    }
    return `₱${amount.toLocaleString()}`;
  };

  // Get status badge styles
  const getStatusBadge = (status) => {
    const styles = {
      'Planning': 'bg-slate-100 text-slate-700 border-slate-200',
      'Bidding': 'bg-purple-50 text-purple-700 border-purple-200',
      'In Progress': 'bg-blue-50 text-blue-700 border-blue-200',
      'On Hold': 'bg-amber-50 text-amber-700 border-amber-200',
      'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'Cancelled': 'bg-red-50 text-red-700 border-red-200'
    };
    return styles[status] || styles['Planning'];
  };

  // Handle sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/admin');
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[100] px-6 py-3 rounded-lg shadow-lg text-white font-medium transition-all ${
          notification.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'
        }`}>
          {notification.message}
        </div>
      )}

      {/* Sidebar Toggle Button (Mobile) */}
      <button
        className="fixed top-4 left-4 z-50 bg-teal-600 text-white rounded-lg p-2.5 shadow-lg lg:hidden"
        onClick={() => setShowSidebar(s => !s)}
      >
        {showSidebar ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Sidebar Overlay (Mobile) */}
      {showSidebar && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-40 ${sidebarCollapsed ? 'w-24' : 'w-80'} bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col transition-all duration-300 ${
        showSidebar ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        {/* Logo */}
        <div className={`${sidebarCollapsed ? 'px-4 py-6' : 'px-6 py-8'} border-b border-slate-700/50`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
            <div className={`flex items-center ${sidebarCollapsed ? '' : 'gap-4'}`}>
              <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center font-bold text-xl shadow-lg shadow-teal-500/20 flex-shrink-0">
                K
              </div>
              {!sidebarCollapsed && (
                <div>
                  <h1 className="text-xl font-bold tracking-tight">KalsaTrack</h1>
                  <p className="text-xs text-slate-400 mt-0.5">FMR Portal v1.0</p>
                </div>
              )}
            </div>
            {/* Collapse Toggle Button */}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className={`hidden lg:flex w-8 h-8 bg-slate-700/60 hover:bg-teal-600 rounded-lg items-center justify-center text-slate-400 hover:text-white transition-all duration-200 ${sidebarCollapsed ? 'mt-4' : ''}`}
            >
              <svg className={`w-4 h-4 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="hidden lg:flex w-full mt-4 h-8 bg-slate-700/60 hover:bg-teal-600 rounded-lg items-center justify-center text-slate-400 hover:text-white transition-all duration-200"
            >
              <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-8 overflow-y-auto">
          {!sidebarCollapsed && <p className="px-4 mb-6 text-xs font-bold text-slate-500 uppercase tracking-widest">Main Menu</p>}
          <div className="space-y-3">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
              { id: 'projects', label: 'All Projects', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
              { id: 'map', label: 'Map View', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' },
              { id: 'analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
              { id: 'reports', label: 'Reports', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
              { id: 'feedback', label: 'Feedback', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-3' : 'gap-5 px-6'} py-5 rounded-2xl text-left transition-all duration-200 group ${
                  activeTab === item.id
                    ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                    : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
                }`}
              >
                <svg className={`${sidebarCollapsed ? 'w-7 h-7' : 'w-7 h-7'} flex-shrink-0`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
                {!sidebarCollapsed && <span className="text-lg font-semibold">{item.label}</span>}
              </button>
            ))}

            <div className={`${sidebarCollapsed ? 'pt-8' : 'pt-10 pb-4'}`}>
              {!sidebarCollapsed && <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-widest">System</p>}
              {sidebarCollapsed && <div className="border-t border-slate-700/50 mx-2"></div>}
            </div>

            <button
              onClick={() => setActiveTab('settings')}
              title={sidebarCollapsed ? 'Settings' : undefined}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center px-3 mt-4' : 'gap-5 px-6'} py-5 rounded-2xl text-left transition-all duration-200 ${
                activeTab === 'settings'
                  ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                  : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              <svg className="w-7 h-7 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {!sidebarCollapsed && <span className="text-lg font-semibold">Settings</span>}
            </button>
          </div>
        </nav>

        {/* User Profile */}
        <div className={`${sidebarCollapsed ? 'p-3' : 'p-6'} border-t border-slate-700/50 bg-slate-800/50`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-4 px-2'} py-3`}>
            <div className="w-12 h-12 bg-gradient-to-br from-teal-400 to-teal-600 rounded-xl flex items-center justify-center font-bold text-sm shadow-lg shadow-teal-500/20 flex-shrink-0">
              AD
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base truncate">Admin User</p>
                <p className="text-sm text-slate-400 mt-0.5">System Administrator</p>
              </div>
            )}
          </div>
          <button 
            onClick={handleSignOut}
            title={sidebarCollapsed ? 'Sign Out' : undefined}
            className={`w-full mt-4 bg-slate-700/50 hover:bg-slate-600/50 ${sidebarCollapsed ? 'px-3' : 'px-4'} py-3.5 rounded-xl transition-all duration-200 text-sm font-semibold border border-slate-600/30 hover:border-slate-500/50 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-center gap-2'}`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            {!sidebarCollapsed && 'Sign Out'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:ml-0 min-h-screen">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200/50 sticky top-0 z-20">
          <div className="px-6 sm:px-10 py-6 sm:py-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div className="pl-12 lg:pl-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                {activeTab === 'dashboard' && 'Dashboard Overview'}
                {activeTab === 'projects' && 'All Projects'}
                {activeTab === 'map' && 'Map View'}
                {activeTab === 'analytics' && 'Analytics'}
                {activeTab === 'reports' && 'Reports'}
                {activeTab === 'feedback' && 'Community Feedback'}
                {activeTab === 'settings' && 'Settings'}
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {activeTab === 'dashboard' && 'Real-time monitoring of farm-to-market road projects'}
                {activeTab === 'projects' && 'Manage all infrastructure projects'}
                {activeTab === 'map' && 'Geographic visualization of projects'}
                {activeTab === 'analytics' && 'Project performance metrics and trends'}
                {activeTab === 'reports' && 'Generate and view project reports'}
                {activeTab === 'feedback' && 'View and manage citizen feedback on projects'}
                {activeTab === 'settings' && 'Configure system preferences'}
              </p>
            </div>
            {(activeTab === 'dashboard' || activeTab === 'projects') && (
              <button
                onClick={() => {
                  setFormData({ ...emptyForm, projectCode: generateProjectCode() });
                  setShowAddModal(true);
                }}
                className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white px-6 py-3 rounded-xl font-semibold text-sm flex items-center gap-2.5 transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </button>
            )}
          </div>
        </header>

        {/* Content Area */}
        <div className="p-6 sm:p-10">
          {/* Error Banner */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800">{error}</p>
                <p className="text-xs text-red-600 mt-1">Make sure the projects table exists in Supabase. Run the SQL migration file if needed.</p>
              </div>
              <button onClick={() => { setError(null); fetchProjects(); }} className="text-xs font-medium text-red-700 hover:text-red-900 underline">
                Retry
              </button>
            </div>
          )}

          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <>
              {/* Metrics Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 sm:gap-8 mb-10">
                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-teal-50 to-teal-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-1.5 rounded-lg tracking-wider">TOTAL</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.totalProjects}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Total Projects</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-lg tracking-wider">ONGOING</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.inProgress}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">In Progress</p>
                  <p className="text-xs text-slate-400 mt-1">{metrics.avgProgress}% avg. completion</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg tracking-wider">DONE</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{metrics.completed}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Completed</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-7 shadow-sm hover:shadow-md transition-shadow duration-300">
                  <div className="flex items-start justify-between mb-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg tracking-wider">BUDGET</span>
                  </div>
                  <p className="text-4xl font-bold text-slate-900 tracking-tight">{formatCurrency(metrics.totalBudget)}</p>
                  <p className="text-sm text-slate-500 mt-2 font-medium">Total Allocated</p>
                  <p className="text-xs text-slate-400 mt-1">{formatCurrency(metrics.disbursed)} disbursed</p>
                </div>
              </div>

              {/* Projects Table */}
              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 sm:px-8 py-6 sm:py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900 tracking-tight">Active Projects</h2>
                      <p className="text-sm text-slate-500 mt-1.5">Monitor current infrastructure development</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto">
                      <input
                        type="text"
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="px-5 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 w-full sm:w-72 bg-white shadow-sm"
                      />
                      <select
                        value={statusFilter}
                        onChange={(e) => {
                          setStatusFilter(e.target.value);
                          setCurrentPage(1);
                        }}
                        className="px-5 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white shadow-sm cursor-pointer"
                      >
                        <option value="all">All Status</option>
                        <option value="Planning">Planning</option>
                        <option value="Bidding">Bidding</option>
                        <option value="In Progress">In Progress</option>
                        <option value="On Hold">On Hold</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                    </div>
                  </div>
                </div>

                {loading ? (
                  <div className="p-12 text-center">
                    <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <p className="text-slate-600 mt-4">Loading projects...</p>
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div className="p-12 text-center">
                    <svg className="w-12 h-12 text-slate-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-slate-600 font-medium">No projects found</p>
                    <p className="text-slate-500 text-sm mt-1">Try adjusting your search or filter</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[800px]">
                        <thead>
                          <tr className="bg-slate-50/50">
                            <th className="px-8 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Project</th>
                            <th className="px-6 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Location</th>
                            <th className="px-6 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Contractor</th>
                            <th className="px-6 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Budget</th>
                            <th className="px-6 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-5 text-left text-[11px] font-bold text-slate-500 uppercase tracking-wider">Progress</th>
                            <th className="px-8 py-5 text-right text-[11px] font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {paginatedProjects.map((project) => (
                            <tr key={project.id} className="hover:bg-slate-50/50 transition-colors duration-150">
                              <td className="px-8 py-5">
                                <p className="font-semibold text-sm text-slate-900">{project.projectName}</p>
                                <p className="text-xs text-slate-400 font-mono mt-1">{project.projectCode} • {project.roadLength} km</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm text-slate-700">{project.municipality}, {project.province}</p>
                                <p className="text-xs text-slate-400 font-mono mt-1">{project.latitude?.toFixed(4)}°N, {project.longitude?.toFixed(4)}°E</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm text-slate-700">{project.contractor}</p>
                              </td>
                              <td className="px-6 py-5">
                                <p className="text-sm font-bold text-slate-900">{formatCurrency(project.totalBudget)}</p>
                              </td>
                              <td className="px-6 py-5">
                                <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${getStatusBadge(project.status)}`}>
                                  <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                  {project.status}
                                </span>
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-700">{project.progress}%</span>
                                  </div>
                                  <div className="w-28 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                                    <div 
                                      className={`h-2.5 rounded-full transition-all duration-500 ${
                                        project.progress === 100 ? 'bg-emerald-500' : 'bg-teal-500'
                                      }`} 
                                      style={{ width: `${project.progress}%` }}
                                    />
                                  </div>
                                </div>
                              </td>
                              <td className="px-8 py-5">
                                <div className="flex items-center justify-end gap-2">
                                  <button 
                                    onClick={() => openEditModal(project)}
                                    className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-150" 
                                    title="Edit"
                                  >
                                    <svg className="w-4.5 h-4.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                  <button 
                                    onClick={() => openDeleteModal(project)}
                                    className="p-2.5 hover:bg-red-50 rounded-xl transition-colors duration-150" 
                                    title="Delete"
                                  >
                                    <svg className="w-4.5 h-4.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    <div className="px-8 py-5 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white flex flex-col sm:flex-row items-center justify-between gap-5">
                      <p className="text-sm text-slate-500">
                        Showing <span className="font-bold text-slate-700">{(currentPage - 1) * projectsPerPage + 1}</span> to{' '}
                        <span className="font-bold text-slate-700">{Math.min(currentPage * projectsPerPage, filteredProjects.length)}</span> of{' '}
                        <span className="font-bold text-slate-700">{filteredProjects.length}</span> projects
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          Previous
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                              currentPage === page
                                ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white shadow-lg shadow-teal-500/25'
                                : 'border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm'
                            }`}
                          >
                            {page}
                          </button>
                        ))}
                        <button
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                          className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-white hover:border-slate-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          {/* Projects Tab */}
          {activeTab === 'projects' && (
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-8 py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Project Management</h2>
                <p className="text-sm text-slate-500 mt-1.5">View, edit, and manage all road projects</p>
              </div>
              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {projects.map(project => (
                    <div key={project.id} className="bg-white border border-slate-200/60 rounded-2xl p-6 hover:shadow-lg hover:border-slate-300/60 transition-all duration-300">
                      <div className="flex items-start justify-between mb-4">
                        <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold ${getStatusBadge(project.status)}`}>
                          {project.status}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">{project.projectCode}</span>
                      </div>
                      <h3 className="font-bold text-lg text-slate-900 mb-2">{project.projectName}</h3>
                      <p className="text-sm text-slate-500 mb-5">{project.municipality}, {project.province}</p>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm text-slate-500">Progress</span>
                        <span className="text-sm font-bold text-slate-900">{project.progress}%</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 mb-5">
                        <div 
                          className={`h-2.5 rounded-full transition-all duration-500 ${project.progress === 100 ? 'bg-emerald-500' : 'bg-teal-500'}`}
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-sm mb-5">
                        <span className="text-slate-500">Budget</span>
                        <span className="font-bold text-slate-900">{formatCurrency(project.totalBudget)}</span>
                      </div>
                      <div className="flex gap-3 pt-5 border-t border-slate-100">
                        <button 
                          onClick={() => openEditModal(project)}
                          className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold transition-colors duration-200"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => openDeleteModal(project)}
                          className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-semibold transition-colors duration-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Map Tab */}
          {activeTab === 'map' && (
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-8 py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Project Locations</h2>
                <p className="text-sm text-slate-500 mt-1.5">Geographic view of all road projects</p>
              </div>
              <div className="p-8">
                <div className="bg-gradient-to-br from-slate-100 to-slate-50 rounded-2xl h-[450px] flex items-center justify-center border border-slate-200/50">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-sm">
                      <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <p className="text-slate-700 font-semibold text-lg">Map Integration Coming Soon</p>
                    <p className="text-slate-400 text-sm mt-2">Leaflet or Google Maps integration will be added here</p>
                  </div>
                </div>
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {projects.map(project => (
                    <div key={project.id} className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200/50 rounded-xl hover:bg-white hover:shadow-sm transition-all duration-200">
                      <div className={`w-4 h-4 rounded-full shadow-sm ${
                        project.status === 'Completed' ? 'bg-emerald-500' : 
                        project.status === 'In Progress' ? 'bg-blue-500' : 'bg-slate-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{project.projectName}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">{project.latitude?.toFixed(4)}°N, {project.longitude?.toFixed(4)}°E</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-8">
                  <h3 className="font-bold text-lg text-slate-900 mb-6">Project Status Distribution</h3>
                  <div className="space-y-5">
                    {['Planning', 'Bidding', 'In Progress', 'On Hold', 'Completed', 'Cancelled'].map(status => {
                      const count = projects.filter(p => p.status === status).length;
                      const percentage = projects.length > 0 ? (count / projects.length) * 100 : 0;
                      return (
                        <div key={status}>
                          <div className="flex justify-between text-sm mb-2">
                            <span className="text-slate-500 font-medium">{status}</span>
                            <span className="font-bold text-slate-900">{count} ({percentage.toFixed(0)}%)</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2.5">
                            <div 
                              className={`h-2.5 rounded-full transition-all duration-500 ${
                                status === 'Completed' ? 'bg-emerald-500' :
                                status === 'In Progress' ? 'bg-blue-500' :
                                status === 'Planning' ? 'bg-slate-500' :
                                status === 'Bidding' ? 'bg-purple-500' :
                                status === 'On Hold' ? 'bg-amber-500' :
                                'bg-red-500'
                              }`}
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-8">
                  <h3 className="font-bold text-lg text-slate-900 mb-6">Budget Overview</h3>
                  <div className="space-y-8">
                    <div>
                      <p className="text-sm text-slate-500 mb-2 font-medium">Total Allocated</p>
                      <p className="text-4xl font-bold text-slate-900 tracking-tight">{formatCurrency(metrics.totalBudget)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-2 font-medium">Total Disbursed</p>
                      <p className="text-4xl font-bold text-emerald-600 tracking-tight">{formatCurrency(metrics.disbursed)}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500 mb-3 font-medium">Disbursement Rate</p>
                      <div className="w-full bg-slate-100 rounded-full h-5 overflow-hidden">
                        <div 
                          className="bg-emerald-500 h-5 rounded-full transition-all duration-500"
                          style={{ width: `${metrics.totalBudget > 0 ? (metrics.disbursed / metrics.totalBudget) * 100 : 0}%` }}
                        />
                      </div>
                      <p className="text-sm font-bold text-slate-700 mt-2">
                        {metrics.totalBudget > 0 ? ((metrics.disbursed / metrics.totalBudget) * 100).toFixed(1) : 0}%
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-8">
                <h3 className="font-bold text-lg text-slate-900 mb-6">Top Projects by Budget</h3>
                <div className="space-y-5">
                  {[...projects].sort((a, b) => b.totalBudget - a.totalBudget).slice(0, 5).map((project, index) => (
                    <div key={project.id} className="flex items-center gap-5 p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors duration-200">
                      <span className="text-2xl font-bold text-slate-300 w-8">{index + 1}</span>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{project.projectName}</p>
                        <p className="text-sm text-slate-500 mt-0.5">{project.municipality}, {project.province}</p>
                      </div>
                      <p className="font-bold text-lg text-slate-900">{formatCurrency(project.totalBudget)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reports Tab */}
          {activeTab === 'reports' && (
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-8 py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Project Reports</h2>
                <p className="text-sm text-slate-500 mt-1.5">Generate and download project reports</p>
              </div>
              <div className="p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {[
                    { title: 'Project Summary Report', desc: 'Overview of all active projects', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
                    { title: 'Budget Utilization Report', desc: 'Financial allocation and spending', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
                    { title: 'Progress Report', desc: 'Completion status of all projects', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
                  ].map((report, index) => (
                    <div key={index} className="bg-white border border-slate-200/60 rounded-2xl p-7 hover:shadow-lg hover:border-slate-300/60 transition-all duration-300">
                      <div className="w-14 h-14 bg-gradient-to-br from-teal-50 to-teal-100 rounded-2xl flex items-center justify-center mb-5">
                        <svg className="w-7 h-7 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={report.icon} />
                        </svg>
                      </div>
                      <h3 className="font-bold text-lg text-slate-900 mb-2">{report.title}</h3>
                      <p className="text-sm text-slate-500 mb-6">{report.desc}</p>
                      <button className="w-full px-5 py-3 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-semibold transition-colors duration-200">
                        Generate Report
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Feedback Tab */}
          {activeTab === 'feedback' && (() => {
            const filteredFeedbacks = feedbacks.filter(fb => {
              const matchesStatus = feedbackFilter === 'all' || fb.status === feedbackFilter;
              const matchesType = feedbackTypeFilter === 'all' || fb.type === feedbackTypeFilter;
              const q = feedbackSearch.toLowerCase();
              const matchesSearch = !q ||
                (fb.project_name || '').toLowerCase().includes(q) ||
                (fb.user_email || '').toLowerCase().includes(q) ||
                (fb.message || '').toLowerCase().includes(q);
              return matchesStatus && matchesType && matchesSearch;
            });
            const pendingCount = feedbacks.filter(f => f.status === 'pending').length;
            const reviewedCount = feedbacks.filter(f => f.status === 'reviewed').length;
            const resolvedCount = feedbacks.filter(f => f.status === 'resolved').length;

            return (
              <div className="space-y-6">
                {/* Feedback Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                    <p className="text-3xl font-bold text-slate-900">{feedbacks.length}</p>
                    <p className="text-sm text-slate-500 mt-1">Total Feedback</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-amber-700">{pendingCount}</p>
                    <p className="text-sm text-amber-600 mt-1">Pending Review</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-blue-700">{reviewedCount}</p>
                    <p className="text-sm text-blue-600 mt-1">Reviewed</p>
                  </div>
                  <div className="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-5">
                    <p className="text-3xl font-bold text-emerald-700">{resolvedCount}</p>
                    <p className="text-sm text-emerald-600 mt-1">Resolved</p>
                  </div>
                </div>

                {/* Filters */}
                <div className="bg-white border border-slate-200/60 rounded-2xl p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="relative flex-1">
                      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
                      <input type="text" value={feedbackSearch} onChange={e => setFeedbackSearch(e.target.value)} placeholder="Search by project, user, or message..."
                        className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none" />
                    </div>
                    <select value={feedbackFilter} onChange={e => setFeedbackFilter(e.target.value)}
                      className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                      <option value="all">All Status</option>
                      <option value="pending">Pending</option>
                      <option value="reviewed">Reviewed</option>
                      <option value="resolved">Resolved</option>
                    </select>
                    <select value={feedbackTypeFilter} onChange={e => setFeedbackTypeFilter(e.target.value)}
                      className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none">
                      <option value="all">All Types</option>
                      <option value="issue">Issues</option>
                      <option value="suggestion">Suggestions</option>
                      <option value="compliment">Compliments</option>
                      <option value="concern">Safety Concerns</option>
                    </select>
                  </div>
                </div>

                {/* Feedback Detail Modal */}
                {selectedFeedback && (
                  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setSelectedFeedback(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                      <div className="px-6 py-5 border-b border-slate-200/60 flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">Feedback Detail</h3>
                          <p className="text-sm text-slate-500 mt-0.5">{selectedFeedback.project_name || 'General Feedback'}</p>
                        </div>
                        <button onClick={() => setSelectedFeedback(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                          <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                      <div className="p-6 space-y-5">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className={`px-3 py-1 rounded-lg text-xs font-semibold border ${
                            { issue: 'text-red-700 bg-red-50 border-red-200', suggestion: 'text-amber-700 bg-amber-50 border-amber-200', compliment: 'text-emerald-700 bg-emerald-50 border-emerald-200', concern: 'text-violet-700 bg-violet-50 border-violet-200' }[selectedFeedback.type] || 'text-slate-600 bg-slate-50 border-slate-200'
                          }`}>
                            {selectedFeedback.type === 'issue' ? 'Issue' : selectedFeedback.type === 'suggestion' ? 'Suggestion' : selectedFeedback.type === 'compliment' ? 'Compliment' : selectedFeedback.type === 'concern' ? 'Safety Concern' : selectedFeedback.type}
                          </span>
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            { pending: 'bg-amber-100 text-amber-700', reviewed: 'bg-blue-100 text-blue-700', resolved: 'bg-emerald-100 text-emerald-700' }[selectedFeedback.status] || 'bg-slate-100 text-slate-600'
                          }`}>
                            {selectedFeedback.status?.charAt(0).toUpperCase() + selectedFeedback.status?.slice(1)}
                          </span>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-1">From</p>
                          <p className="text-sm text-slate-700">{selectedFeedback.user_email || 'Anonymous'}</p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Date</p>
                          <p className="text-sm text-slate-700">{new Date(selectedFeedback.created_at).toLocaleString()}</p>
                        </div>

                        <div>
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Message</p>
                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-xl">{selectedFeedback.message}</p>
                        </div>

                        {selectedFeedback.latitude && selectedFeedback.longitude && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase font-semibold mb-1">Geo-Tagged Location</p>
                            <div className="flex items-center gap-2 p-3 bg-teal-50 border border-teal-200 rounded-xl">
                              <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                              <span className="text-sm font-medium text-teal-800">{Number(selectedFeedback.latitude).toFixed(6)}, {Number(selectedFeedback.longitude).toFixed(6)}</span>
                              {selectedFeedback.geo_accuracy && <span className="text-xs text-teal-600">(±{Math.round(selectedFeedback.geo_accuracy)}m)</span>}
                            </div>
                          </div>
                        )}

                        {selectedFeedback.photo_urls?.length > 0 && (
                          <div>
                            <p className="text-xs text-slate-400 uppercase font-semibold mb-2">Photos ({selectedFeedback.photo_urls.length})</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                              {selectedFeedback.photo_urls.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt={`Photo ${i + 1}`} className="w-full h-32 object-cover rounded-xl border border-slate-200 hover:opacity-80 transition-opacity" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Admin Actions */}
                        <div className="pt-4 border-t border-slate-100">
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-3">Update Status</p>
                          <div className="flex gap-3 flex-wrap">
                            <button onClick={() => { updateFeedbackStatus(selectedFeedback.id, 'pending'); setSelectedFeedback(null); }}
                              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${selectedFeedback.status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-300 ring-2 ring-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50'}`}>
                              Pending
                            </button>
                            <button onClick={() => { updateFeedbackStatus(selectedFeedback.id, 'reviewed'); setSelectedFeedback(null); }}
                              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${selectedFeedback.status === 'reviewed' ? 'bg-blue-100 text-blue-700 border-blue-300 ring-2 ring-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50'}`}>
                              Reviewed
                            </button>
                            <button onClick={() => { updateFeedbackStatus(selectedFeedback.id, 'resolved'); setSelectedFeedback(null); }}
                              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all ${selectedFeedback.status === 'resolved' ? 'bg-emerald-100 text-emerald-700 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-emerald-50'}`}>
                              Resolved
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Feedback List */}
                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                    <p className="text-sm font-semibold text-slate-700">{filteredFeedbacks.length} feedback{filteredFeedbacks.length !== 1 ? 's' : ''}</p>
                  </div>
                  {feedbacksLoading ? (
                    <div className="p-8 text-center text-slate-400">
                      <div className="animate-spin mx-auto w-8 h-8 border-2 border-slate-300 border-t-teal-600 rounded-full mb-3" />
                      <p className="text-sm">Loading feedbacks...</p>
                    </div>
                  ) : filteredFeedbacks.length === 0 ? (
                    <div className="p-12 text-center">
                      <svg className="w-12 h-12 mx-auto text-slate-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" /></svg>
                      <p className="font-medium text-slate-900">No feedback found</p>
                      <p className="text-sm text-slate-500 mt-1">Citizen feedback will appear here once submitted</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {filteredFeedbacks.map(fb => {
                        const typeStyles = { issue: 'text-red-700 bg-red-50 border-red-200', suggestion: 'text-amber-700 bg-amber-50 border-amber-200', compliment: 'text-emerald-700 bg-emerald-50 border-emerald-200', concern: 'text-violet-700 bg-violet-50 border-violet-200' };
                        const statusStyles = { pending: 'bg-amber-100 text-amber-700', reviewed: 'bg-blue-100 text-blue-700', resolved: 'bg-emerald-100 text-emerald-700' };
                        const typeLabel = { issue: 'Issue', suggestion: 'Suggestion', compliment: 'Compliment', concern: 'Concern' };
                        return (
                          <button key={fb.id} onClick={() => setSelectedFeedback(fb)}
                            className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors group">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium border ${typeStyles[fb.type] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                    {typeLabel[fb.type] || fb.type}
                                  </span>
                                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyles[fb.status] || 'bg-slate-100 text-slate-600'}`}>
                                    {fb.status?.charAt(0).toUpperCase() + fb.status?.slice(1)}
                                  </span>
                                  {fb.photo_urls?.length > 0 && (
                                    <span className="flex items-center gap-1 text-xs text-slate-400">
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" /></svg>
                                      {fb.photo_urls.length}
                                    </span>
                                  )}
                                  {fb.latitude && fb.longitude && (
                                    <span className="flex items-center gap-1 text-xs text-slate-400">
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" /></svg>
                                      GPS
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-slate-900 group-hover:text-teal-700 transition-colors">{fb.project_name || 'General Feedback'}</p>
                                <p className="text-sm text-slate-500 line-clamp-2 mt-0.5">{fb.message}</p>
                                <p className="text-xs text-slate-400 mt-1.5">{fb.user_email || 'Anonymous'} &middot; {new Date(fb.created_at).toLocaleDateString()}</p>
                              </div>
                              <svg className="w-5 h-5 text-slate-300 group-hover:text-teal-500 mt-1 shrink-0 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-8 py-7 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">System Settings</h2>
                <p className="text-sm text-slate-500 mt-1.5">Configure your dashboard preferences</p>
              </div>
              <div className="p-8 space-y-8">
                <div>
                  <h3 className="font-bold text-lg text-slate-900 mb-5">Account Settings</h3>
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Display Name</label>
                      <input type="text" defaultValue="Admin User" className="w-full max-w-md px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
                      <input type="email" defaultValue="admin@kalsatrack.gov.ph" className="w-full max-w-md px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                    </div>
                  </div>
                </div>
                <div className="pt-8 border-t border-slate-100">
                  <h3 className="font-bold text-lg text-slate-900 mb-5">Notification Preferences</h3>
                  <div className="space-y-4">
                    {['Email notifications for project updates', 'SMS alerts for critical issues', 'Weekly summary reports'].map((item, index) => (
                      <label key={index} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors duration-200 cursor-pointer">
                        <input type="checkbox" defaultChecked className="w-5 h-5 text-teal-600 rounded-md border-slate-300 focus:ring-teal-500" />
                        <span className="text-sm font-medium text-slate-700">{item}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="pt-8 border-t border-slate-100">
                  <button className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white px-8 py-3 rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25 hover:shadow-xl hover:shadow-teal-500/30">
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Project Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">New Road Project</h2>
                <p className="text-sm text-slate-500 mt-1">Create a new farm-to-market road project</p>
              </div>
              <button onClick={() => setShowAddModal(false)} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleAddProject} className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name *</label>
                  <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., Barangay Access Road" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Code</label>
                  <input type="text" name="projectCode" value={formData.projectCode} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl bg-slate-50" readOnly />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Status *</label>
                  <select name="status" value={formData.status} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="Planning">Planning</option>
                    <option value="Bidding">Bidding</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Region *</label>
                  <input type="text" name="region" value={formData.region} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., Region VII" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Province *</label>
                  <input type="text" name="province" value={formData.province} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., Cebu" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Municipality *</label>
                  <input type="text" name="municipality" value={formData.municipality} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., Cebu City" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Barangay *</label>
                  <input type="text" name="barangay" value={formData.barangay} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., Lahug" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Latitude</label>
                  <input type="number" step="any" name="latitude" value={formData.latitude} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="10.3157" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Longitude</label>
                  <input type="number" step="any" name="longitude" value={formData.longitude} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 font-mono" placeholder="123.8854" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Length (km) *</label>
                  <input type="number" step="0.01" name="roadLength" value={formData.roadLength} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="3.5" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Width (m) *</label>
                  <input type="number" step="0.1" name="roadWidth" value={formData.roadWidth} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="6.0" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Type *</label>
                  <select name="roadType" value={formData.roadType} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="">Select type</option>
                    <option value="Concrete">Concrete</option>
                    <option value="Asphalt">Asphalt</option>
                    <option value="Gravel">Gravel</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Total Budget (₱) *</label>
                  <input type="number" name="totalBudget" value={formData.totalBudget} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="12500000" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Funding Source *</label>
                  <select name="budgetSource" value={formData.budgetSource} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="">Select source</option>
                    <option value="National">National Government</option>
                    <option value="Provincial">Provincial</option>
                    <option value="Municipal">Municipal</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Contractor *</label>
                  <input type="text" name="contractor" value={formData.contractor} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="e.g., ABC Construction Inc." />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date *</label>
                  <input type="date" name="startDate" value={formData.startDate} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Expected End Date *</label>
                  <input type="date" name="expectedEndDate" value={formData.expectedEndDate} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Progress (%)</label>
                  <input type="number" min="0" max="100" name="progress" value={formData.progress} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" placeholder="0" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange} rows="3" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 resize-none" placeholder="Project description..." />
                </div>
              </div>
            </form>
            <div className="px-8 py-5 border-t border-slate-200/60 bg-slate-50/50 flex justify-end gap-4">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200">Cancel</button>
              <button type="submit" onClick={handleAddProject} className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25">Create Project</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-8 py-6 border-b border-slate-200/60 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">Edit Project</h2>
                <p className="text-sm text-slate-500 mt-1">{selectedProject?.projectCode}</p>
              </div>
              <button onClick={() => { setShowEditModal(false); setSelectedProject(null); }} className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors duration-200">
                <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleEditProject} className="flex-1 overflow-y-auto p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Project Name *</label>
                  <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Status *</label>
                  <select name="status" value={formData.status} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200">
                    <option value="Planning">Planning</option>
                    <option value="Bidding">Bidding</option>
                    <option value="In Progress">In Progress</option>
                    <option value="On Hold">On Hold</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Progress (%) *</label>
                  <input type="number" min="0" max="100" name="progress" value={formData.progress} onChange={handleInputChange} required className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Region</label>
                  <input type="text" name="region" value={formData.region} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Province</label>
                  <input type="text" name="province" value={formData.province} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Municipality</label>
                  <input type="text" name="municipality" value={formData.municipality} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Barangay</label>
                  <input type="text" name="barangay" value={formData.barangay} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Length (km)</label>
                  <input type="number" step="0.01" name="roadLength" value={formData.roadLength} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Road Width (m)</label>
                  <input type="number" step="0.1" name="roadWidth" value={formData.roadWidth} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Total Budget (₱)</label>
                  <input type="number" name="totalBudget" value={formData.totalBudget} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Disbursed Amount (₱)</label>
                  <input type="number" name="disbursedAmount" value={formData.disbursedAmount} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Contractor</label>
                  <input type="text" name="contractor" value={formData.contractor} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Start Date</label>
                  <input type="date" name="startDate" value={formData.startDate} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Expected End Date</label>
                  <input type="date" name="expectedEndDate" value={formData.expectedEndDate} onChange={handleInputChange} className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-2">Description</label>
                  <textarea name="description" value={formData.description} onChange={handleInputChange} rows="3" className="w-full px-5 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 resize-none" />
                </div>
              </div>
            </form>
            <div className="px-8 py-5 border-t border-slate-200/60 bg-slate-50/50 flex justify-end gap-4">
              <button type="button" onClick={() => { setShowEditModal(false); setSelectedProject(null); }} className="px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200">Cancel</button>
              <button type="submit" onClick={handleEditProject} className="px-6 py-3 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-teal-500/25">Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8">
            <div className="text-center">
              <div className="w-18 h-18 bg-gradient-to-br from-red-50 to-red-100 rounded-2xl flex items-center justify-center mx-auto mb-5" style={{width: '72px', height: '72px'}}>
                <svg className="w-9 h-9 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3 tracking-tight">Delete Project?</h3>
              <p className="text-slate-500 mb-8">
                Are you sure you want to delete <span className="font-semibold text-slate-700">{selectedProject?.projectName}</span>? This action cannot be undone.
              </p>
              <div className="flex gap-4">
                <button 
                  onClick={() => { setShowDeleteModal(false); setSelectedProject(null); }}
                  className="flex-1 px-6 py-3 border border-slate-200 rounded-xl font-semibold text-sm hover:bg-slate-100 transition-all duration-200"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleDeleteProject}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg shadow-red-500/25"
                >
                  Delete Project
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
