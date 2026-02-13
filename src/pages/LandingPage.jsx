/* LandingPage.jsx - Professional Redesign */
import { Link } from 'react-router-dom';
import { useEffect, useRef } from 'react';

export default function LandingPage() {
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
    <div className="min-h-screen bg-slate-50">
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
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 w-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
                <span className="text-white text-lg font-bold">K</span>
              </div>
              <span className="text-lg font-bold text-slate-900">KalsaTrack</span>
            </div>
            
            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-600 hover:text-slate-900 transition text-sm">Features</a>
              <a href="#how-it-works" className="text-slate-600 hover:text-slate-900 transition text-sm">How It Works</a>
              <a href="#impact" className="text-slate-600 hover:text-slate-900 transition text-sm">Impact</a>
            </div>

            <div className="flex items-center gap-3">
              <Link 
                to="/signin" 
                className="text-slate-600 hover:text-slate-900 transition font-medium px-4 py-2 text-sm"
              >
                Sign In
              </Link>
              <Link 
                to="/signup" 
                className="bg-emerald-600 text-white px-5 py-2 rounded-lg hover:bg-emerald-700 transition font-medium text-sm"
              >
                Get Started
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section - Clean & Centered */}
      <header className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 min-h-[85vh] flex items-center w-full">
        {/* Background Elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '80px 80px'
          }}></div>
          <div className="absolute top-1/4 left-[10%] w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/4 right-[10%] w-64 h-64 bg-teal-500/10 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40 w-full">
          <div className="text-center">
            <div className="text-white">
              <p className="text-sm font-medium text-emerald-400 uppercase tracking-wider mb-6">Farm-to-Market Road Transparency Portal</p>
              
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-8 leading-tight">
                Track Rural Road Infrastructure
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-400 mt-2">
                  With Full Transparency
                </span>
              </h1>
              
              <p className="text-lg sm:text-xl text-slate-300 mb-10 leading-relaxed max-w-2xl mx-auto">
                Monitor farm-to-market road projects in real-time. Access progress updates, budget data, and community reports all in one platform.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  to="/signup"
                  className="inline-flex items-center justify-center bg-white text-slate-900 px-8 py-4 rounded-xl font-semibold hover:bg-slate-100 transition shadow-lg hover:shadow-xl group"
                >
                  Start Tracking Projects
                  <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
              </div>

            </div>
          </div>
        </div>
      </header>

      {/* Key Features */}
      <section id="features" className="py-24 px-4 sm:px-6 lg:px-8 bg-white w-full">
        <div className="max-w-5xl mx-auto w-full">
          <div className="flex flex-col items-center mb-20">
            <p className="text-sm font-medium text-emerald-600 uppercase tracking-wider mb-4">Features</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4 text-center">
              Tools for transparency and accountability
            </h2>
            <p className="text-lg text-slate-600 max-w-lg text-center">
              Everything you need to track, monitor, and engage with rural infrastructure projects
            </p>
          </div>
          
          <div className="flex flex-col md:flex-row justify-center gap-8">
            {/* Feature 1 */}
            <div className="flex-1 max-w-sm flex flex-col items-center bg-slate-50 rounded-2xl p-10 hover:bg-slate-100 transition-colors">
              <div className="w-14 h-14 bg-emerald-600 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 text-xl mb-3 text-center">Progress Tracking</h3>
              <p className="text-slate-600 leading-relaxed text-center">
                Monitor construction milestones, budget utilization, and completion status with real-time dashboard updates.
              </p>
            </div>
            
            {/* Feature 2 */}
            <div className="flex-1 max-w-sm flex flex-col items-center bg-slate-50 rounded-2xl p-10 hover:bg-slate-100 transition-colors">
              <div className="w-14 h-14 bg-teal-600 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 text-xl mb-3 text-center">Interactive Maps</h3>
              <p className="text-slate-600 leading-relaxed text-center">
                Visualize road networks with geospatial data and see project locations across all regions.
              </p>
            </div>
            
            {/* Feature 3 */}
            <div className="flex-1 max-w-sm flex flex-col items-center bg-slate-50 rounded-2xl p-10 hover:bg-slate-100 transition-colors">
              <div className="w-14 h-14 bg-slate-700 rounded-xl flex items-center justify-center mb-6">
                <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-slate-900 text-xl mb-3 text-center">Community Reports</h3>
              <p className="text-slate-600 leading-relaxed text-center">
                Submit feedback, report issues, and track resolution status through transparent citizen engagement.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 px-4 sm:px-6 lg:px-8 bg-slate-50 w-full">
        <div className="max-w-4xl mx-auto w-full">
          <div className="flex flex-col items-center mb-16">
            <p className="text-sm font-medium text-teal-600 uppercase tracking-wider mb-4">How It Works</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4 text-center">
              Get started in minutes
            </h2>
            <p className="text-lg text-slate-600 max-w-lg text-center">
              Three simple steps to start tracking farm-to-market road projects
            </p>
          </div>
          
          <div className="flex flex-col md:flex-row justify-center gap-16">
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-emerald-600 rounded-lg flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-white">1</span>
              </div>
              <h3 className="font-semibold text-slate-900 text-lg mb-2 text-center">Create Account</h3>
              <p className="text-slate-600 text-sm text-center max-w-[200px]">
                Sign up with your email and select your role as citizen, official, or stakeholder.
              </p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-teal-600 rounded-lg flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-white">2</span>
              </div>
              <h3 className="font-semibold text-slate-900 text-lg mb-2 text-center">Browse Projects</h3>
              <p className="text-slate-600 text-sm text-center max-w-[200px]">
                Explore active road projects in your region using the interactive map and filters.
              </p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center mb-4">
                <span className="text-lg font-bold text-white">3</span>
              </div>
              <h3 className="font-semibold text-slate-900 text-lg mb-2 text-center">Track & Report</h3>
              <p className="text-slate-600 text-sm text-center max-w-[200px]">
                Monitor progress, submit feedback, and receive updates on project milestones.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section id="impact" className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-slate-900 w-full">
        <div className="max-w-5xl mx-auto w-full">
          <div className="text-center mb-14">
            <p className="text-sm font-medium text-emerald-400 uppercase tracking-wider mb-4">Platform Impact</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Driving transparency nationwide
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-5xl sm:text-6xl font-bold text-emerald-400 mb-2">
                500+
              </div>
              <p className="text-slate-300">Active Projects</p>
            </div>
            <div>
              <div className="text-5xl sm:text-6xl font-bold text-teal-400 mb-2">
                10K+
              </div>
              <p className="text-slate-300">Community Members</p>
            </div>
            <div>
              <div className="text-5xl sm:text-6xl font-bold text-cyan-400 mb-2">
                95%
              </div>
              <p className="text-slate-300">Data Accuracy</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8 bg-white w-full">
        <div className="max-w-3xl mx-auto text-center w-full">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
            Ready to get started?
          </h2>
          
          <p className="text-lg text-slate-600 mb-8 max-w-xl mx-auto">
            Join communities across the Philippines in building transparent infrastructure.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/signup"
              className="inline-flex items-center justify-center bg-emerald-600 text-white px-8 py-3.5 rounded-lg font-semibold hover:bg-emerald-700 transition"
            >
              Create Free Account
            </Link>
            <Link
              to="/signin"
              className="inline-flex items-center justify-center border border-slate-300 text-slate-700 px-8 py-3.5 rounded-lg font-semibold hover:bg-slate-50 transition"
            >
              Sign In
            </Link>
          </div>

          <p className="mt-6 text-sm text-slate-500">
            Get Started Now!
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-300 w-full">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-9 h-9 bg-emerald-600 rounded-lg flex items-center justify-center">
                  <span className="text-white text-lg font-bold">K</span>
                </div>
                <span className="text-lg font-bold text-white">KalsaTrack</span>
              </div>
              <p className="text-slate-400 text-sm leading-relaxed">
                Transparent farm-to-market road infrastructure tracking.
              </p>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Platform</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-white transition">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-white transition">How It Works</a></li>
                <li><a href="#impact" className="hover:text-white transition">Impact</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Resources</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition">User Guide</a></li>
                <li><a href="#" className="hover:text-white transition">FAQ</a></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold text-white mb-4">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#" className="hover:text-white transition">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition">Terms of Service</a></li>
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