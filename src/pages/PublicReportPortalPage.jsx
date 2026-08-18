import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import PublicReportForm from '../components/PublicReportForm';
import { supabase } from '../lib/supabase';
import Logo from '../components/Logo';

export default function PublicReportPortalPage() {
  const observerRef = useRef(null);

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
    <div className="min-h-screen bg-slate-50" style={{ overflowX: 'hidden' }}>
      {/* Animation Styles */}
      <style>{`
        .fade-up {
          opacity: 0;
          transform: translateY(20px);
          transition: opacity 0.5s ease-out, transform 0.5s ease-out;
        }
        .fade-up.animate-in {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      {/* Navigation */}
      <nav className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <Link to="/" className="flex items-center hover:opacity-80 transition">
              <Logo className="h-8" />
            </Link>

            <div className="flex items-center gap-3">
              <Link
                to="/"
                className="bg-emerald-700 text-white px-4 py-2 rounded-lg hover:bg-emerald-800 transition font-bold text-xs sm:text-sm shadow-sm flex items-center gap-1.5"
              >
                <span>Back to Home</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="relative bg-gradient-to-b from-emerald-950 via-slate-900 to-slate-800" style={{ overflow: 'hidden' }}>
        {/* Background Elements */}
        <div className="absolute inset-0" style={{ overflow: 'hidden' }}>
          <div className="absolute inset-0 opacity-[0.04]" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)',
            backgroundSize: '60px 60px'
          }}></div>
          <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-emerald-500/8 rounded-full" style={{ filter: 'blur(100px)' }}></div>
          <div className="absolute bottom-1/4 right-1/4 w-56 h-56 bg-teal-500/8 rounded-full" style={{ filter: 'blur(100px)' }}></div>
        </div>

        <div className="relative max-w-4xl mx-auto px-6 sm:px-8 lg:px-10 py-16 sm:py-24">
          <div className="text-center">
            <div className="text-white">
              <p className="text-xs sm:text-sm font-semibold text-emerald-400 uppercase tracking-widest mb-4">
                Report Infrastructure Issues
              </p>

              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold mb-6 leading-tight tracking-tight">
                Share Your Concerns<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
                  No Login Required
                </span>
              </h1>

              <p className="text-base sm:text-lg text-slate-300 mb-8 leading-relaxed max-w-2xl mx-auto">
                Help us improve rural infrastructure by reporting issues directly. Use your location to pinpoint problems on ongoing projects. Your feedback drives real change.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 justify-center text-sm">
                <div className="flex items-center justify-center gap-2 text-emerald-200">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 10 10.293 5.707a1 1 0 010-1.414z" />
                  </svg>
                  <span>Anonymous & Secure</span>
                </div>
                <div className="flex items-center justify-center gap-2 text-teal-200">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" />
                  </svg>
                  <span>Location-Based</span>
                </div>
                <div className="flex items-center justify-center gap-2 text-emerald-200">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                  </svg>
                  <span>Real-Time Tracking</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Quick Start Guide */}
      <section className="py-16 sm:py-20 px-6 sm:px-8 lg:px-10 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col items-center mb-14">
            <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider mb-4">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4 text-center">
              Three simple steps to report
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Step 1 */}
            <div className="fade-up relative">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center mb-5 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Enable Location</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Allow access to your GPS location to pinpoint the exact issue on the map.
                </p>
              </div>
              {/* Connector Line */}
              <div className="hidden md:block absolute left-full top-1/4 w-8 h-0.5 bg-gradient-to-r from-slate-300 to-transparent"></div>
            </div>

            {/* Step 2 */}
            <div className="fade-up relative">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center mb-5 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Describe the Issue</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Select a category, provide details, and optionally capture photos for context.
                </p>
              </div>
              {/* Connector Line */}
              <div className="hidden md:block absolute left-full top-1/4 w-8 h-0.5 bg-gradient-to-r from-slate-300 to-transparent"></div>
            </div>

            {/* Step 3 */}
            <div className="fade-up">
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl flex items-center justify-center mb-5 shadow-lg">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Submit & Track</h3>
                <p className="text-slate-600 text-sm leading-relaxed">
                  Your report is received instantly. Track its status and follow resolution updates.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Report Form Section */}
      <section className="py-12 sm:py-16 px-6 sm:px-8 lg:px-10 bg-slate-50">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-lg p-8 sm:p-12">
            <PublicReportForm />
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="py-16 sm:py-20 px-6 sm:px-8 lg:px-10 bg-white border-t border-slate-200">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col items-center mb-14">
            <p className="text-sm font-medium text-teal-600 uppercase tracking-wider mb-4">Why Report?</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4 text-center">
              Your voice matters
            </h2>
            <p className="text-lg text-slate-600 max-w-lg text-center">
              Community feedback drives accountability and accelerates problem resolution
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
            {/* Benefit 1 */}
            <div className="fade-up flex gap-4 bg-slate-50 rounded-xl p-6 border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-emerald-600">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Immediate Impact</h3>
                <p className="text-slate-600 text-sm">
                  Reports are reviewed immediately by authorities and field engineers for quick action.
                </p>
              </div>
            </div>

            {/* Benefit 2 */}
            <div className="fade-up flex gap-4 bg-slate-50 rounded-xl p-6 border border-slate-100 hover:border-teal-200 hover:bg-teal-50/30 transition-colors">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-teal-600">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Transparency</h3>
                <p className="text-slate-600 text-sm">
                  Track every stage of issue resolution with real-time status updates and public timeline.
                </p>
              </div>
            </div>

            {/* Benefit 3 */}
            <div className="fade-up flex gap-4 bg-slate-50 rounded-xl p-6 border border-slate-100 hover:border-sky-200 hover:bg-sky-50/30 transition-colors">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-sky-600">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Privacy Protected</h3>
                <p className="text-slate-600 text-sm">
                  Report anonymously without providing personal information. Your privacy is guaranteed.
                </p>
              </div>
            </div>

            {/* Benefit 4 */}
            <div className="fade-up flex gap-4 bg-slate-50 rounded-xl p-6 border border-slate-100 hover:border-violet-200 hover:bg-violet-50/30 transition-colors">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-violet-600">
                  <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Data-Driven Decisions</h3>
                <p className="text-slate-600 text-sm">
                  Community insights inform policy and infrastructure improvement prioritization.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 sm:py-20 px-6 sm:px-8 lg:px-10 bg-gradient-to-r from-emerald-50 to-teal-50 border-t border-slate-200">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Want more features?
          </h2>

          <p className="text-lg text-slate-600 mb-8">
            Create a free account to access project tracking, interactive maps, and personalized dashboards.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/signup"
              className="inline-flex items-center justify-center bg-emerald-600 text-white px-8 py-3.5 rounded-lg font-semibold hover:bg-emerald-700 transition group"
            >
              Create Free Account
              <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              to="/signin"
              className="inline-flex items-center justify-center border border-slate-300 text-slate-700 px-8 py-3.5 rounded-lg font-semibold hover:bg-white transition"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-400 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 lg:px-10 py-14">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center mb-4">
                <Logo tone="light" className="h-9" />
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                Transparent farm-to-market road infrastructure tracking.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Platform</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/#features" className="hover:text-white transition">
                    Features
                  </Link>
                </li>
                <li>
                  <Link to="/#how-it-works" className="hover:text-white transition">
                    How It Works
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link to="/signin" className="hover:text-white transition">
                    Sign In
                  </Link>
                </li>
                <li>
                  <Link to="/signup" className="hover:text-white transition">
                    Get Started
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="hover:text-white transition">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition">
                    Terms of Service
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8">
            <p className="text-sm text-slate-500 text-center">
              © 2026 KalsaTrack. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
