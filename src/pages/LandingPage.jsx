import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import UserFMRProjects from './UserFMRProjects';
import UserMapView from './UserMapView';
import Icons from '../components/Icons';

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
          transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .fade-up.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      {/* Navigation */}
      <nav className="bg-white/90 backdrop-blur-xl border-b border-slate-200/80 sticky top-0 z-50 transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex justify-between items-center">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 group">
              <div className="w-10 h-10 bg-gradient-to-tr from-emerald-700 to-teal-500 rounded-xl flex items-center justify-center shadow-md shadow-emerald-500/20 group-hover:scale-105 transition-transform">
                <span className="text-white text-xl font-black">K</span>
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight group-hover:text-emerald-700 transition-colors">KalsaTrack</span>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest leading-none">DA Region VI</span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            <div className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-600">
              <a href="#map-view" className="hover:text-emerald-700 transition-colors">Geospatial Map</a>
              <a href="#projects" className="hover:text-emerald-700 transition-colors">FMR Projects</a>
              <a href="#features" className="hover:text-emerald-700 transition-colors">Platform Features</a>
              <a href="#how-it-works" className="hover:text-emerald-700 transition-colors">How It Works</a>
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
                className="bg-emerald-700 text-white px-5 py-2.5 rounded-lg hover:bg-emerald-800 transition font-bold text-sm shadow-xs"
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
        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center">
          {/* Tag Pill */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-900/60 border border-emerald-700/60 text-emerald-300 text-xs font-semibold mb-6">
            <Icons.Sprout />
            <span>Farm-to-Market Road Oversight & Supply Chain Intelligence</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-5 tracking-tight leading-snug">
            Empowering Rural Roads With <br className="hidden sm:inline" />
            <span className="text-emerald-400">Complete Transparency</span>
          </h1>

          <p className="text-sm sm:text-base text-slate-300 mb-8 leading-relaxed max-w-2xl mx-auto font-normal">
            Monitor DA Region VI farm-to-market road developments, visualize rural supply chains, inspect real-time physical accomplishments, and submit community reports.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              to="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center bg-emerald-700 text-white px-7 py-3 rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors shadow-xs group"
            >
              Start Tracking Projects
              <Icons.ArrowRight />
            </Link>
            <Link
              to="/report-portal"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-slate-700 text-slate-200 px-7 py-3 rounded-xl font-semibold text-sm hover:bg-slate-800 transition-colors"
            >
              <Icons.Warning />
              <span className="ml-2">Report Road Issue</span>
            </Link>
          </div>

          {/* Key Quick Stats Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12 pt-8 border-t border-slate-800 text-left max-w-4xl mx-auto">
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <p className="text-xl sm:text-2xl font-bold text-emerald-400">100%</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">DA-RAED Transparency</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <p className="text-xl sm:text-2xl font-bold text-emerald-400">Region VI</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Iloilo FMR Coverage</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <p className="text-xl sm:text-2xl font-bold text-sky-400">Live GPS</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Geospatial Routing</p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-800/60 border border-slate-700/50">
              <p className="text-xl sm:text-2xl font-bold text-amber-400">24/7</p>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Citizen Road Reporting</p>
            </div>
          </div>
        </div>
      </header>

      {/* 1. MAP VIEW SECTION (Moved above FMR Projects as requested) */}
      <section id="map-view" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900 border-b border-slate-800">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider">
              Geospatial Intelligence
            </span>
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
              Interactive Rural Road Network Map
            </h2>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Explore Farm-to-Market Road alignments across Region VI. View live accomplishment statuses, verified coordinates, and supply path routes.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/60 overflow-hidden shadow-2xl backdrop-blur-md">
            <UserMapView embedded />
          </div>
        </div>
      </section>

      {/* 2. FMR PROJECTS SECTION (Moved BELOW the Map View) */}
      <section id="projects" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="text-center max-w-3xl mx-auto space-y-3">
            <span className="px-3.5 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-700 text-xs font-bold uppercase tracking-wider">
              Public Infrastructure Directory
            </span>
            <h2 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight">
              Farm-to-Market Road Projects
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Browse complete records of proposed, ongoing, and completed FMR projects funded by DA-RAED Region VI and local LGUs.
            </p>
          </div>

          <UserFMRProjects embedded />
        </div>
      </section>

      {/* 3. KEY FEATURES / PLATFORM CAPABILITIES */}
      <section id="features" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-slate-50">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col items-center mb-16 text-center max-w-2xl mx-auto">
            <span className="px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 text-xs font-bold uppercase tracking-wider mb-3">
              Platform Features
            </span>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
              Tools Built for Transparency & Accountability
            </h2>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
              Comprehensive tools designed for citizens, farmers, LGU officers, and DA regional engineers.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {/* Feature 1 */}
            <div className="flex flex-col bg-white rounded-2xl p-6 shadow-xs border border-slate-200 group">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-800 rounded-xl flex items-center justify-center mb-5 shrink-0">
                <Icons.Chart />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Real-Time Progress Tracking</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Monitor physical accomplishment percentages, budget allocations, target completion dates, and official engineer inspection reports.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="flex flex-col bg-white rounded-2xl p-6 shadow-xs border border-slate-200 group">
              <div className="w-12 h-12 bg-sky-100 text-sky-800 rounded-xl flex items-center justify-center mb-5 shrink-0">
                <Icons.Road />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Supply Chain Mapping</h3>
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Route farm coordinates to linked FMR roads and agricultural trading posts, calculating logistics distances to nearest markets.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="flex flex-col bg-white rounded-2xl p-6 shadow-xs border border-slate-200 group">
              <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-xl flex items-center justify-center mb-5 shrink-0">
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
      <section id="how-it-works" className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col items-center mb-12 text-center max-w-2xl mx-auto">
            <span className="px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold uppercase tracking-wider mb-2">
              Simple Workflow
            </span>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
              Start Tracking in Three Easy Steps
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Getting started on KalsaTrack takes less than a minute.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div className="text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
              <div className="w-12 h-12 bg-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg">
                1
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1.5">Access Platform</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Log in as a citizen, farmer, LGU officer, or DA engineer to access custom dashboards.
              </p>
            </div>

            <div className="text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
              <div className="w-12 h-12 bg-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg">
                2
              </div>
              <h3 className="font-bold text-slate-900 text-base mb-1.5">Explore Road Networks</h3>
              <p className="text-slate-600 text-xs leading-relaxed">
                Locate FMR projects by municipality, surface type, fiscal year, or accomplishment state.
              </p>
            </div>

            <div className="text-center p-6 rounded-2xl bg-slate-50 border border-slate-200/80">
              <div className="w-12 h-12 bg-emerald-700 text-white rounded-xl flex items-center justify-center mx-auto mb-4 font-bold text-lg">
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

      {/* CTA Section */}
      <section className="py-16 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900 text-white border-t border-slate-800">
        <div className="max-w-3xl mx-auto text-center space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Ready to Drive Infrastructure Transparency?
          </h2>

          <p className="text-xs sm:text-sm text-slate-300 max-w-xl mx-auto leading-relaxed font-normal">
            Join agricultural communities across Region VI in monitoring farm-to-market road progress.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center pt-2">
            <Link
              to="/signup"
              className="w-full sm:w-auto inline-flex items-center justify-center bg-emerald-700 text-white px-7 py-3 rounded-xl font-bold text-sm hover:bg-emerald-600 transition-colors shadow-xs"
            >
              Create Account
              <Icons.ArrowRight />
            </Link>
            <Link
              to="/report-portal"
              className="w-full sm:w-auto inline-flex items-center justify-center border border-slate-700 text-slate-200 px-7 py-3 rounded-xl font-semibold text-sm hover:bg-slate-800 transition-colors"
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
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-emerald-600 rounded-xl flex items-center justify-center shadow-md">
                  <span className="text-white text-lg font-black">K</span>
                </div>
                <span className="text-lg font-extrabold text-white tracking-tight">KalsaTrack</span>
              </div>
              <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                Department of Agriculture RAED Region VI — Farm-to-Market Road Infrastructure Transparency Portal.
              </p>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Platform</h4>
              <ul className="space-y-2.5 text-xs sm:text-sm">
                <li><a href="#map-view" className="hover:text-emerald-400 transition">Geospatial Map</a></li>
                <li><a href="#projects" className="hover:text-emerald-400 transition">FMR Projects</a></li>
                <li><a href="#features" className="hover:text-emerald-400 transition">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-emerald-400 transition">How It Works</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Portals Sign In</h4>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li><Link to="/farmer/login" className="text-emerald-400 hover:text-emerald-300 font-bold transition">🌾 Farmer Sign In</Link></li>
                <li><Link to="/lgu/login" className="hover:text-white transition">LGU Officer Sign In</Link></li>
                <li><Link to="/field-engineer/login" className="hover:text-white transition">Field Engineer Sign In</Link></li>
                <li><Link to="/contractor/login" className="hover:text-white transition">Contractor Sign In</Link></li>
                <li><Link to="/admin" className="hover:text-white transition">DA Admin Sign In</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-bold text-white text-sm uppercase tracking-wider mb-4">Legal & Support</h4>
              <ul className="space-y-2.5 text-xs sm:text-sm">
                <li><Link to="/report-portal" className="hover:text-white transition">Public Issue Report</Link></li>
                <li><a href="#" className="hover:text-white transition">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition">Terms of Service</a></li>
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