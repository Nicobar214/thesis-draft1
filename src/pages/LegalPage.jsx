/* LegalPage.jsx — Privacy Policy, Terms of Use, and Help & Support
 * (/privacy, /terms, /support), linked from the landing page footer.
 *
 * Everything stated here describes what KalsaTrack actually does, checked
 * against the code and database (Oct 2026):
 *   - data collected: Supabase Auth account, profiles, public_reports (photo,
 *     GPS, optional name/contact), feedbacks, farmer_beneficiaries (RSBSA data
 *     entered by LGUs), notifications, profile photos (avatars bucket);
 *   - report photos are stored in a PUBLIC storage bucket;
 *   - other citizens see report photo/location/description through
 *     public_reports_citizen_view, which leaves out the reporter's name and
 *     contact; closed (declined) reports are visible only to their reporter;
 *   - delete_my_account removes the account, profile, reports and feedback;
 *   - no analytics or advertising trackers are loaded;
 *   - third parties contacted: Supabase, OpenStreetMap tiles + Nominatim,
 *     Esri (ArcGIS) tiles, OpenTopoMap/CyclOSM tiles, OSRM routing, Google Fonts;
 *     Google Maps only when the user taps "open in Google Maps".
 *
 * Official DA Region VI contact details (DPO email, hotline) are NOT invented
 * here: they are marked "to be provided by DA Region VI" until DA supplies them.
 */
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeftIcon, ShieldCheckIcon, FileTextIcon, LifeBuoyIcon } from 'lucide-react';
import Logo from '../components/Logo';

const EFFECTIVE_DATE = 'October 12, 2026';
const TBD = 'to be provided by DA Region VI';

const TABS = [
  { path: '/privacy', label: 'Privacy Policy', icon: ShieldCheckIcon },
  { path: '/terms', label: 'Terms of Use', icon: FileTextIcon },
  { path: '/support', label: 'Help & Support', icon: LifeBuoyIcon },
];

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="space-y-3 text-[15px] leading-7 text-slate-300 [&_li]:ml-5 [&_li]:list-disc [&_li]:marker:text-emerald-400 [&_strong]:font-semibold [&_strong]:text-white">
        {children}
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <>
      <Section title="Who we are">
        <p>
          KalsaTrack is a monitoring system for Farm-to-Market Road (FMR) projects of the Department of
          Agriculture Regional Field Office VI (Western Visayas), currently piloted in Leon, Iloilo. It lets
          citizens and farmers report road problems, lets LGUs register farmer beneficiaries, and lets DA staff,
          field engineers and contractors track project progress.
        </p>
        <p>
          This policy explains what personal information the system handles, why, and your rights under the
          <strong> Data Privacy Act of 2012 (Republic Act No. 10173)</strong> and its implementing rules.
        </p>
      </Section>

      <Section title="Information we collect">
        <p><strong>When you create a citizen account:</strong> your email address and password (stored by our
          authentication service; passwords are never visible to staff), your name, and optionally your
          municipality, barangay and a profile photo.</p>
        <p><strong>When you submit a road report:</strong> the photo you take, your phone&rsquo;s GPS location and
          its accuracy at the time of submission, the photo&rsquo;s time, the project you selected, the issue
          category and your description. If you are signed in, the report is linked to your account. A name and
          contact number are optional.</p>
        <p><strong>Farmer beneficiaries:</strong> LGU agriculture offices enter registry data from the RSBSA
          (Registry System for Basic Sectors in Agriculture): name, RSBSA number, birthday, sex, contact number,
          barangay, main crop, farm area and an approximate farm location. Farmers who sign in can view their
          own record and update their contact number and photo.</p>
        <p><strong>Staff accounts</strong> (DA administrators, LGU officers, field engineers, contractors): name,
          email, phone number, assigned municipality and work records such as inspections, certifications and
          progress updates.</p>
        <p><strong>On your device:</strong> the app keeps your sign-in session and small preferences (for example,
          list or card view, map style, whether you have seen the guided tour) in your browser&rsquo;s local
          storage. It can also save reports on your device while you are offline and send them when you
          reconnect.</p>
        <p><strong>We do not use</strong> advertising, analytics or tracking cookies.</p>
      </Section>

      <Section title="How we use it">
        <ul>
          <li>To route your report to DA staff and a field engineer, and to tell you how it progresses.</li>
          <li>To verify that a report was made at the project site. Reports submitted more than 1 km from the
            project road cannot be verified and are declined.</li>
          <li>To show nearby projects on your dashboard, based on the location in your profile.</li>
          <li>To monitor FMR projects and the farmers they serve, for planning and reporting by the DA and LGUs.</li>
          <li>To keep an audit trail of decisions on each report, for accountability.</li>
        </ul>
      </Section>

      <Section title="Who can see your information">
        <ul>
          <li><strong>Other citizens</strong> can see a report&rsquo;s photo, location, project, category and
            description in the community view, but <strong>not your name or contact details</strong>. Declined
            reports are visible only to the person who submitted them.</li>
          <li><strong>DA administrators</strong> can see all reports and accounts, to manage the system.</li>
          <li><strong>Field engineers</strong> see the reports assigned to them for inspection.</li>
          <li><strong>LGU officers</strong> see farmer records and reports for their own municipality.</li>
          <li><strong>Contractors</strong> see reports on the projects they are building, without your name or
            contact details.</li>
        </ul>
        <p>Report photos are stored so they can be displayed in the app; anyone with a photo&rsquo;s direct link
          can open it. Please avoid capturing faces, plate numbers or private property where you can.</p>
      </Section>

      <Section title="Service providers">
        <p>KalsaTrack runs on <strong>Supabase</strong> (database, sign-in and file storage). Maps are drawn from
          <strong> OpenStreetMap</strong>, <strong>Esri</strong>, OpenTopoMap and CyclOSM map tiles; place searches
          use OpenStreetMap&rsquo;s Nominatim service and road routes use the OSRM routing service, which receive
          the place name or coordinates being looked up. Fonts are loaded from Google Fonts. Google Maps is opened
          only when you tap a &ldquo;directions&rdquo; link.</p>
      </Section>

      <Section title="How long we keep it">
        <p>Reports and project records are kept as part of the public record of FMR monitoring. You can delete
          your citizen account at any time from <strong>Profile Settings → Delete account</strong>; this
          permanently deletes your account, your profile, and the reports and feedback you submitted.
          Farmer registry records are kept and corrected by your LGU agriculture office.</p>
      </Section>

      <Section title="Your rights">
        <p>Under RA 10173 you have the right to be informed, to access, to correct, to object, to have data
          erased or blocked, to data portability, and to file a complaint. You can correct your name, location
          and photo in Profile Settings. For farmer records, ask your Municipal Agriculture Office. If you believe
          your rights were violated, you may file a complaint with the <strong>National Privacy Commission</strong> (privacy.gov.ph).</p>
      </Section>

      <Section title="Data Protection Officer">
        <p>Requests about your personal data may be sent to the Data Protection Officer of DA Regional Field
          Office VI. Contact details: <em className="text-amber-300/90">{TBD}</em>.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <Section title="Using KalsaTrack">
        <p>KalsaTrack is a public service of DA Regional Field Office VI for monitoring Farm-to-Market Road
          projects. By creating an account or submitting a report, you agree to these terms.</p>
      </Section>

      <Section title="Reporting road problems">
        <ul>
          <li>Submit reports only for real conditions you observed yourself, from the project site. Reports
            submitted more than 1 km from the project road cannot be verified and will be declined.</li>
          <li>Use a current photo of the actual problem. Do not upload photos of people, vehicles&rsquo; plate
            numbers or private property unless they are needed to show the problem.</li>
          <li>Do not submit false, duplicate, offensive or misleading reports. Such reports may be closed and the
            account restricted.</li>
          <li>Submitting a report does not guarantee a repair. Reports are reviewed, inspected by a field
            engineer where they can be verified, and acted on according to DA and LGU priorities and funding.</li>
        </ul>
      </Section>

      <Section title="Accounts">
        <ul>
          <li>Keep your password private; you are responsible for activity under your account.</li>
          <li>Staff, LGU, field engineer and contractor accounts are issued by DA Region VI for official use only.</li>
          <li>Farmer accounts are linked to the farmer&rsquo;s RSBSA record. Registry details can only be changed
            by the LGU or DA.</li>
        </ul>
      </Section>

      <Section title="Information shown in the app">
        <p>Project status, progress figures, map locations and distances are provided for monitoring and may be
          approximate (for example, farm locations are shown at barangay level). Official project documents
          and decisions of the DA prevail over what is displayed here.</p>
      </Section>

      <Section title="Availability">
        <p>We aim to keep the service available but do not guarantee uninterrupted access. Parts of the app work
          offline and will send saved reports when you reconnect.</p>
      </Section>

      <Section title="Changes">
        <p>These terms may be updated. The effective date at the top of this page shows the latest version.</p>
      </Section>
    </>
  );
}

const FAQS = [
  {
    q: 'How do I report a road problem?',
    a: 'Sign in, open My Reports and tap Submit New Report. Choose the project, take a photo of the problem, classify it and add a short description. Submit while you are on or near the project road so your location can be verified.',
  },
  {
    q: 'Why was my report declined?',
    a: 'Reports are checked against the project road using your phone’s location. If it was submitted more than 1 km from the road, it cannot be verified and is declined. Your report page shows the recorded distance. If the problem is real, submit a new report from the project site.',
  },
  {
    q: 'What do the report statuses mean?',
    a: 'Submitted: received. Under Review: DA staff are checking it. Site Inspection Scheduled: a field engineer has been assigned. Under Verification: the inspection findings are being reviewed. Resolved: a decision or repair has been recorded. Closed: the report was closed without an inspection; the reason is shown on your report.',
  },
  {
    q: 'What is the reference number for?',
    a: 'Every report has an 8-character reference (for example 64C1324E) shown on the report. Tap it to copy it, and quote it when following up with your Municipal Agriculture Office or DA Region VI so staff can find your report quickly.',
  },
  {
    q: 'I forgot my password.',
    a: 'On the sign-in page, choose “Forgot password?” and enter your email. A reset link is sent to that address.',
  },
  {
    q: 'I am a farmer. How do I get an account?',
    a: 'Farmer accounts are linked to your RSBSA record. Ask your Municipal Agriculture Office to register you as a beneficiary, then sign in through the Farmer portal.',
  },
  {
    q: 'My farmer details are wrong.',
    a: 'Your name, crop, farm area and location come from your official RSBSA record and can only be corrected by your LGU or DA officer. You can update your own contact number and photo in My Profile.',
  },
  {
    q: 'Does the app work without a signal?',
    a: 'Yes, partly. Reports you submit while offline are saved on your phone and sent automatically when you reconnect. You can also install KalsaTrack on your phone from the browser menu (“Add to Home screen”).',
  },
  {
    q: 'How do I delete my account?',
    a: 'Go to Profile Settings and open Delete account. This permanently deletes your account and the reports and feedback you submitted.',
  },
];

function Support() {
  return (
    <>
      <Section title="Frequently asked questions">
        <div className="divide-y divide-slate-700/60 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900/40">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-white hover:text-emerald-300">
                {f.q}
                <span className="text-lg text-emerald-400 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-2 text-[15px] leading-7 text-slate-300">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Contact">
        <ul>
          <li><strong>Road problems and farmer registration:</strong> your Municipal Agriculture Office (MAO) at the
            municipal hall.</li>
          <li><strong>FMR projects and declined reports:</strong> DA Regional Field Office VI (Western Visayas),
            Iloilo City. Hotline and email: <em className="text-amber-300/90">{TBD}</em>.</li>
          <li><strong>Personal data requests:</strong> see the Data Protection Officer section of the{' '}
            <Link to="/privacy" className="font-medium text-emerald-400 hover:text-emerald-300 hover:underline">Privacy Policy</Link>.</li>
        </ul>
        <p>When you contact us about a report, please include its reference number.</p>
      </Section>
    </>
  );
}

const CONTENT = {
  '/privacy': { title: 'Privacy Policy', intro: 'How KalsaTrack collects, uses and protects personal information.', Body: Privacy },
  '/terms': { title: 'Terms of Use', intro: 'The rules for using KalsaTrack and submitting reports.', Body: Terms },
  '/support': { title: 'Help & Support', intro: 'Answers to common questions, and who to contact.', Body: Support },
};

export default function LegalPage() {
  const { pathname } = useLocation();
  const page = CONTENT[pathname] || CONTENT['/privacy'];
  const { Body } = page;

  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${page.title} · KalsaTrack`;
  }, [page.title]);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-slate-900 text-slate-300">
      {/* Same ambiance as the landing page hero */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0">
        <div className="kt-grid absolute inset-0" />
        <div className="kt-glow absolute -top-24 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[110px]" />
        <div className="kt-glow absolute bottom-0 right-0 h-[26rem] w-[26rem] rounded-full bg-teal-500/10 blur-[100px]" style={{ animationDelay: '2.5s' }} />
      </div>

      <header className="relative border-b border-slate-800/80 bg-slate-900/60 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link to="/" aria-label="KalsaTrack home"><Logo tone="light" className="h-8" /></Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 transition-colors hover:text-white">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            Back to home
          </Link>
        </div>
      </header>

      <main className="relative mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-900/50 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-600/40">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            Legal &amp; Support · DA Region VI
          </span>
          <h1 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-5xl">
            <span className="bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-300 bg-clip-text text-transparent">{page.title}</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">{page.intro}</p>
          {pathname !== '/support' && (
            <p className="mt-1 text-sm text-slate-500">Effective {EFFECTIVE_DATE}</p>
          )}
        </div>

        <nav className="mx-auto mt-8 flex max-w-2xl gap-1 overflow-x-auto rounded-2xl bg-slate-800/50 p-1 ring-1 ring-slate-700/60 backdrop-blur" aria-label="Legal and support">
          {TABS.map((tab) => {
            const { path, label } = tab;
            const active = path === pathname;
            return (
              <Link
                key={path}
                to={path}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-900/40'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <tab.icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-8 space-y-10 rounded-3xl border border-slate-700/60 bg-slate-800/40 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-10">
          <Body />
        </div>

        <p className="mt-8 text-center text-xs text-slate-500">
          © 2026 KalsaTrack · Department of Agriculture Regional Field Office VI
        </p>
      </main>
    </div>
  );
}
