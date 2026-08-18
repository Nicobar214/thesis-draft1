import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import UserFMRProjects from './UserFMRProjects';
import UserMapView from './UserMapView';
import Icons from '../components/Icons';
import Logo from '../components/Logo';

export default function LandingPage() {
  const observerRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' }
    );

    document.querySelectorAll('.fade-up').forEach((el) => {
      observerRef.current.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans" style={{ overflowX: 'hidden' }}>
      {/* Animation Styles */}
      <style>{`
        .fade-up {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fade-up.animate-in {
          opacity: 1;
          transform: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .fade-up { opacity: 1; transform: none; transition: none; }
        }
        @keyframes kt-float {
          0%, 100% { transform: translateY(0) scale(1); opacity: 0.55; }
          50% { transform: translateY(-14px) scale(1.04); opacity: 0.8; }
        }
        .kt-glow { animation: kt-float 9s ease-in-out infinite; }
        .kt-grid {
          background-image:
            linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px);
          background-size: 44px 44px;
          -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%);
          mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%);
        }
      `}</style>

      {/* Navigation */}
      <nav className="bg-white/90 backdrop-blur-xl border-b border-slate-200/80 sticky top-0 z-50 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex justify-between items-center">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-3 group">
              <Logo className="h-8 sm:h-9 transition-transform duration-300 group-hover:scale-105" />
              <span className="hidden sm:block h-8 w-px bg-slate-200" aria-hidden="true" />
              <span className="hidden sm:block text-[10px] font-bold text-emerald-600 uppercase tracking-widest leading-none whitespace-nowrap">DA Region VI</span>
            </Link>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
              <a href="#map-view" className="relative py-1 hover:text-emerald-700 transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:w-0 after:bg-emerald-600 after:transition-all after:duration-300 hover:after:w-full">Geospatial Map</a>
              <a href="#projects" className="relative py-1 hover:text-emerald-700 transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:w-0 after:bg-emerald-600 after:transition-all after:duration-300 hover:after:w-full">FMR Projects</a>
              <a href="#features" className="relative py-1 hover:text-emerald-700 transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:w-0 after:bg-emerald-600 after:transition-all after:duration-300 hover:after:w-full">Platform Features</a>
              <a href="#how-it-works" className="relative py-1 hover:text-emerald-700 transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:w-0 after:bg-emerald-600 after:transition-all after:duration-300 hover:after:w-full">How It Works</a>
              <a href="#farmer-registration" className="relative py-1 hover:text-emerald-700 transition-colors after:absolute after:left-0 after:-bottom-0.5 after:h-0.5 after:w-0 after:bg-emerald-600 after:transition-all after:duration-300 hover:after:w-full">Farmer Registration</a>
            </div>

            {/* Action Buttons */}
            <div className="hidden md:flex items-center gap-3">
              <Link
                to="/signin"
                className="text-slate-700 hover:text-emerald-800 transition font-semibold px-4 py-2 text-sm rounded-lg hover:bg-slate-100"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="bg-gradient-to-r from-emerald-700 to-emerald-600 text-white px-5 py-2.5 rounded-lg hover:from-emerald-600 hover:to-teal-600 transition-[box-shadow,background-color] duration-300 font-bold text-sm shadow-sm shadow-emerald-600/20 hover:shadow-md hover:shadow-emerald-600/30"
              >
                Get Started
              </Link>
            </div>

            {/* Mobile Menu Toggle Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 focus:outline-none"
              aria-label="Toggle Navigation Menu"
            >
              <Icons.Menu />
            </button>
          </div>

          {/* Mobile Collapsible Navigation */}
          {mobileMenuOpen && (
            <div className="md:hidden mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3 font-semibold text-sm text-slate-700">
              <a href="#map-view" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 hover:text-emerald-700">Geospatial Map</a>
              <a href="#projects" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 hover:text-emerald-700">FMR Projects</a>
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 hover:text-emerald-700">Platform Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 hover:text-emerald-700">How It Works</a>
              <a href="#farmer-registration" onClick={() => setMobileMenuOpen(false)} className="px-2 py-1.5 hover:text-emerald-700">Farmer Registration</a>
              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
                <Link to="/signin" className="w-full text-center py-2 rounded-lg border border-slate-200 font-semibold text-slate-800">Sign In</Link>
                <Link to="/signup" className="w-full text-center py-2 rounded-lg bg-emerald-700 text-white font-bold">Get Started</Link>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <header className="relative bg-slate-900 text-white overflow-hidden">
        {/* Decorative ambiance (purely visual, non-interactive) */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="kt-grid absolute inset-0" />
          <div className="kt-glow absolute -top-24 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-emerald-500/20 blur-[110px]" />
          <div className="kt-glow absolute bottom-0 right-0 w-[26rem] h-[26rem] rounded-full bg-teal-500/10 blur-[100px]" style={{ animationDelay: '2.5s' }} />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-900 to-transparent" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 text-center">
          {/* Tag Pill */}
          <div className="fade-up inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-900/50 backdrop-blur-sm ring-1 ring-inset ring-emerald-600/40 text-emerald-300 text-xs font-semibold mb-7 shadow-sm shadow-emerald-950/40">
            <Icons.Sprout />
            <span>Farm-to-Market Road Oversight & Supply Chain Intelligence</span>
          </div>

          <h1 className="fade-up text-4xl sm:text-5xl md:text-6xl font-black mb-6 tracking-tight leading-[1.1]" style={{ transitionDelay: '80ms' }}>
            Empowering Rural Roads With <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-300 bg-clip-text text-transparent">Complete Transparency</span>
          </h1>

          <p className="fade-up text-sm sm:text-base text-slate-300 mb-9 leading-relaxed max-w-2xl mx-auto font-normal" style={{ transitionDelay: '140ms' }}>
            Monitor DA Region VI farm-to-market road developments, visualize rural supply chains, inspect real-time physical accomplishments, and submit community reports.
          </p>

          {/* CTA Buttons */}
          <div className="fade-up flex flex-col sm:flex-row gap-3 justify-center items-center" style={{ transitionDelay: '200ms' }}>
            <Link
              to="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-7 py-3.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity duration-200 shadow-lg shadow-emerald-900/40 group"
            >
              Start Tracking Projects
              <span className="inline-flex transition-transform duration-300 group-hover:translate-x-1">
                <Icons.ArrowRight />
              </span>
            </Link>
            <Link
              to="/report-portal"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-slate-700 text-slate-200 px-7 py-3.5 rounded-xl font-semibold text-sm hover:bg-slate-800 hover:border-slate-600 transition-colors duration-200"
            >
              <Icons.Warning />
              <span className="ml-2">Report Road Issue</span>
            </Link>
          </div>

          {/* Key Quick Stats Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-14 pt-8 border-t border-white/10 text-left max-w-4xl mx-auto">
            {[
              { value: '100%', label: 'DA-RAED Transparency', tone: 'text-emerald-400' },
              { value: 'Region VI', label: 'Iloilo FMR Coverage', tone: 'text-emerald-400' },
              { value: 'Live GPS', label: 'Geospatial Routing', tone: 'text-sky-400' },
              { value: '24/7', label: 'Citizen Road Reporting', tone: 'text-amber-400' },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="fade-up group relative p-3.5 rounded-xl bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 overflow-hidden shadow-sm hover:shadow-lg hover:shadow-emerald-900/20 transition-shadow duration-300 ease-out"
                style={{ transitionDelay: `${260 + i * 70}ms` }}
              >
                <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-emerald-500/0 via-emerald-400/70 to-emerald-500/0" />
                <p className={`text-xl sm:text-2xl font-bold ${stat.tone}`}>{stat.value}</p>
                <p className="text-xs text-slate-400 font-medium mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* 1. MAP VIEW SECTION (Moved above FMR Projects as requested) */}
      <section id="map-view" className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="fade-up text-center max-w-3xl mx-auto space-y-3.5">
            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25 text-emerald-400 text-xs font-bold uppercase tracking-wider">
              Geospatial Intelligence
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
              Interactive Rural Road Network Map
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Explore Farm-to-Market Road alignments across Region VI. View live accomplishment statuses, verified coordinates, and supply path routes.
            </p>
          </div>

          <div className="fade-up rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-2xl backdrop-blur-md" style={{ transitionDelay: '100ms' }}>
            <UserMapView embedded />
          </div>
        </div>

        {/* Soft seam into the next (light) section */}
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-slate-700/70 to-transparent" />
      </section>

      {/* 2. FMR PROJECTS SECTION (Moved BELOW the Map View) */}
      <section id="projects" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto space-y-10">
          <div className="fade-up text-center max-w-3xl mx-auto space-y-3.5">
            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-teal-500/10 ring-1 ring-inset ring-teal-500/25 text-teal-700 text-xs font-bold uppercase tracking-wider">
              Public Infrastructure Directory
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
              Farm-to-Market Road Projects
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Browse complete records of proposed, ongoing, and completed FMR projects funded by DA-RAED Region VI and local LGUs.
            </p>
          </div>

          <div className="fade-up" style={{ transitionDelay: '100ms' }}>
            <UserFMRProjects embedded />
          </div>
        </div>
      </section>

      {/* 3. KEY FEATURES / PLATFORM CAPABILITIES */}
      <section id="features" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <div className="fade-up flex flex-col items-center mb-16 text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-3">
              Platform Features
            </span>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-4">
              Tools Built for Transparency & Accountability
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Comprehensive tools designed for citizens, farmers, LGU officers, and DA regional engineers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {/* Feature 1 */}
            <div className="fade-up flex flex-col bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '0ms' }}>
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-emerald-50 text-emerald-800 rounded-xl flex items-center justify-center mb-5 shrink-0 ring-1 ring-emerald-100">
                <Icons.Chart />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Real-Time Progress Tracking</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Monitor physical accomplishment percentages, budget allocations, target completion dates, and official engineer inspection reports.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="fade-up flex flex-col bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '90ms' }}>
              <div className="w-12 h-12 bg-gradient-to-br from-sky-100 to-sky-50 text-sky-800 rounded-xl flex items-center justify-center mb-5 shrink-0 ring-1 ring-sky-100">
                <Icons.Road />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Supply Chain Mapping</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Route farm coordinates to linked FMR roads and agricultural trading posts, calculating logistics distances to nearest markets.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="fade-up flex flex-col bg-white rounded-2xl p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '180ms' }}>
              <div className="w-12 h-12 bg-gradient-to-br from-amber-100 to-amber-50 text-amber-800 rounded-xl flex items-center justify-center mb-5 shrink-0 ring-1 ring-amber-100">
                <Icons.Warning />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Citizen & Farmer Reporting</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Submit damage reports, pothole alerts, and bridge washouts with auto-detected GPS coordinates and photo evidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW IT WORKS */}
      <section id="how-it-works" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="fade-up flex flex-col items-center mb-14 text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center px-4 py-1.5 rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-200 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-3">
              Simple Workflow
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-2">
              Start Tracking in Three Easy Steps
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Getting started on KalsaTrack takes less than a minute.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            {/* Connector line between steps (desktop only) */}
            <div
              aria-hidden="true"
              className="hidden md:block absolute top-11 left-[16.5%] right-[16.5%] h-0.5 opacity-70"
              style={{ backgroundImage: 'repeating-linear-gradient(to right, #34d399 0 8px, transparent 8px 16px)' }}
            />

            <div className="fade-up relative text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '0ms' }}>
              <div className="relative z-10 w-12 h-12 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg shadow-md shadow-emerald-700/25 ring-4 ring-white">
                1
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1.5">Access Platform</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Log in as a citizen, farmer, LGU officer, or DA engineer to access custom dashboards.
              </p>
            </div>

            <div className="fade-up relative text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '100ms' }}>
              <div className="relative z-10 w-12 h-12 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg shadow-md shadow-emerald-700/25 ring-4 ring-white">
                2
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1.5">Explore Road Networks</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Locate FMR projects by municipality, surface type, fiscal year, or accomplishment state.
              </p>
            </div>

            <div className="fade-up relative text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '200ms' }}>
              <div className="relative z-10 w-12 h-12 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg shadow-md shadow-emerald-700/25 ring-4 ring-white">
                3
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1.5">Report & Monitor</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Submit damage alerts, log actual crop yields, or track resolution milestones in real time.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. FARMER REGISTRATION INSTRUCTIONS */}
      <section id="farmer-registration" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <div className="fade-up flex flex-col items-center mb-14 text-center max-w-2xl mx-auto">
            <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-200 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-3">
              <svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
              For Farmers
            </span>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight mb-2">
              How to Register as a Farmer
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Farmer accounts are set up through your local Municipal Agriculture Office. Here's what you need to do.
            </p>
          </div>

          {/* Vertical timeline steps */}
          <div className="relative space-y-6">
            {/* Vertical connector line */}
            <div
              aria-hidden="true"
              className="hidden sm:block absolute left-[27px] top-8 bottom-8 w-0.5 opacity-60"
              style={{ backgroundImage: 'repeating-linear-gradient(to bottom, #34d399 0 8px, transparent 8px 16px)' }}
            />

            {[
              {
                step: 1,
                title: 'Visit Your Municipal Agriculture Office',
                description: 'Go to the Department of Agriculture office at your municipal or city hall. Ask about registering for the KalsaTrack Farmer Portal.',
                icon: <svg className="size-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205l3 1m-6-4.625l3-1.5M6.75 7.364V3h-3v18m3-13.636l10.5-3.819" /></svg>,
              },
              {
                step: 2,
                title: 'Provide Your Farmer Details',
                description: 'Bring a valid ID and be ready to provide your name, barangay, contact number, farm location, and the crops you produce. The LGU officer will encode your information.',
                icon: <svg className="size-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6.75c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h.01M9 15h.01M12 12h.01M12 15h.01M15 12h.01M15 15h.01" /></svg>,
              },
              {
                step: 3,
                title: 'Receive Your Login Credentials',
                description: 'The LGU officer will create your farmer account and provide you with a username and temporary password. Keep these safe.',
                icon: <svg className="size-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" /></svg>,
              },
              {
                step: 4,
                title: 'Sign In to the Farmer Portal',
                description: 'Go to the Farmer Sign In page, enter your username and password, and start using the portal to view FMR projects near your farm, log harvests, and submit road reports.',
                icon: <svg className="size-4 text-emerald-700" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>,
              },
            ].map((item, i) => (
              <div
                key={item.step}
                className="fade-up flex items-start gap-4 sm:gap-5 relative"
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                {/* Step number badge */}
                <div className="relative z-10 shrink-0 w-14 h-14 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-2xl flex items-center justify-center font-bold text-lg shadow-md shadow-emerald-700/25 ring-4 ring-slate-50">
                  {item.step}
                </div>

                {/* Content card */}
                <div className="flex-1 bg-white rounded-2xl p-5 sm:p-6 border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 ease-out">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="shrink-0" aria-hidden="true">{item.icon}</span>
                    <h3 className="font-bold text-slate-900 text-sm sm:text-base">{item.title}</h3>
                  </div>
                  <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Help callout + CTA */}
          <div className="fade-up mt-10 bg-white rounded-2xl border border-emerald-200/60 p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4 shadow-sm hover:shadow-md transition-shadow duration-300 ease-out" style={{ transitionDelay: '400ms' }}>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-900 mb-1">Already have your credentials?</p>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                If your LGU has already registered you, sign in now to access your Farmer Dashboard.
              </p>
            </div>
            <Link
              to="/farmer/login"
              className="shrink-0 inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity duration-200 shadow-md shadow-emerald-600/20"
            >
              Farmer Sign In
              <Icons.ArrowRight />
            </Link>
          </div>

          {/* Contact info */}
          <p className="fade-up text-center text-xs text-slate-500 mt-6 leading-relaxed" style={{ transitionDelay: '500ms' }}>
            Need help? Contact your <strong className="text-slate-700">Municipal Agriculture Office</strong> or reach out to the DA Region VI RAED office.
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900 text-white overflow-hidden">
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="kt-glow absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[30rem] h-[30rem] rounded-full bg-emerald-500/15 blur-[110px]" />
        </div>

        <div className="fade-up relative max-w-3xl mx-auto text-center space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-sm px-6 py-12 sm:px-12 sm:py-14 shadow-2xl">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight">
            Ready to Drive Infrastructure Transparency?
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto leading-relaxed font-normal">
            Join agricultural communities across Region VI in monitoring farm-to-market road progress.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-3">
            <Link
              to="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-7 py-3.5 rounded-xl font-bold text-sm hover:opacity-90 transition-opacity duration-200 shadow-lg shadow-emerald-900/40"
            >
              Create Account
              <Icons.ArrowRight />
            </Link>
            <Link
              to="/report-portal"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-slate-600 text-slate-200 px-7 py-3.5 rounded-xl font-semibold text-sm hover:bg-slate-800 hover:border-slate-500 transition-colors duration-200"
            >
              Report an Issue
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 border-t border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1 space-y-4">
              <div className="flex items-center">
                <Logo tone="light" className="h-9" />
              </div>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Department of Agriculture RAED Region VI — Farm-to-Market Road Infrastructure Transparency Portal.
              </p>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Platform</h4>
              <ul className="space-y-2.5 text-xs sm:text-sm">
                <li><a href="#map-view" className="group inline-block hover:text-emerald-400 transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Geospatial Map</span></a></li>
                <li><a href="#projects" className="group inline-block hover:text-emerald-400 transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">FMR Projects</span></a></li>
                <li><a href="#features" className="group inline-block hover:text-emerald-400 transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Features</span></a></li>
                <li><a href="#how-it-works" className="group inline-block hover:text-emerald-400 transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">How It Works</span></a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Portals Sign In</h4>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li><Link to="/farmer/login" className="group inline-block text-emerald-400 hover:text-emerald-300 font-bold transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">🌾 Farmer Sign In</span></Link></li>
                <li><Link to="/lgu/login" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">LGU Officer Sign In</span></Link></li>
                <li><Link to="/field-engineer/login" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Field Engineer Sign In</span></Link></li>
                <li><Link to="/contractor/login" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Contractor Sign In</span></Link></li>
                <li><Link to="/admin" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">DA Admin Sign In</span></Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Legal & Support</h4>
              <ul className="space-y-2.5 text-xs sm:text-sm">
                <li><Link to="/report-portal" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Public Issue Report</span></Link></li>
                <li><a href="#" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Privacy Policy</span></a></li>
                <li><a href="#" className="group inline-block hover:text-white transition-colors duration-200"><span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">Terms of Service</span></a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800/80 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-500">
            <p>© 2026 KalsaTrack — DA Region VI. All rights reserved.</p>
            <div className="flex gap-4">
              <span>Department of Agriculture</span>
              <span>•</span>
              <span>RAED Region VI</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}