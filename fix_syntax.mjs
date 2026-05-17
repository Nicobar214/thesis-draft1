import { readFileSync, writeFileSync } from 'fs';

const filePath = './src/pages/Dashboard.jsx';
let c = readFileSync(filePath, 'utf8');

const BROKEN = '{/* Admin Actions */} */}';
const RESTORED = `                        {/* Admin Actions */}
                        <div className="pt-4 border-t border-slate-100">
                          <p className="text-xs text-slate-400 uppercase font-semibold mb-3">Update Status</p>
                          <div className="flex gap-3 flex-wrap">
                            <button onClick={() => { updatePublicReportStatus(selectedPublicReport.id, 'pending'); setSelectedPublicReport(null); }}
                              className={\`px-4 py-2 rounded-xl text-sm font-medium border transition-all \${selectedPublicReport.status === 'pending' ? 'bg-amber-100 text-amber-700 border-amber-300 ring-2 ring-amber-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-amber-50'}\`}>
                              Pending
                            </button>
                            <button onClick={() => { updatePublicReportStatus(selectedPublicReport.id, 'reviewed'); setSelectedPublicReport(null); }}
                              className={\`px-4 py-2 rounded-xl text-sm font-medium border transition-all \${selectedPublicReport.status === 'reviewed' ? 'bg-blue-100 text-blue-700 border-blue-300 ring-2 ring-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50'}\`}>
                              Reviewed
                            </button>
                            <button onClick={() => { updatePublicReportStatus(selectedPublicReport.id, 'resolved'); setSelectedPublicReport(null); }}
                              className={\`px-4 py-2 rounded-xl text-sm font-medium border transition-all \${selectedPublicReport.status === 'resolved' ? 'bg-emerald-100 text-emerald-700 border-emerald-300 ring-2 ring-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-emerald-50'}\`}>
                              Resolved
                            </button>
                          </div>
                        </div>`;

const idx = c.indexOf(BROKEN);
if (idx === -1) {
  console.error('Target string not found in file. Current state may differ.');
  process.exit(1);
}

c = c.slice(0, idx) + RESTORED + c.slice(idx + BROKEN.length);
writeFileSync(filePath, c, 'utf8');
console.log('Fixed and restored Update Status section at character index', idx);
