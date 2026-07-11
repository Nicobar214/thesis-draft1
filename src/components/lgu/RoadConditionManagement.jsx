import { useEffect, useMemo, useState } from 'react';

const CONDITION_OPTIONS = ['Good', 'Fair', 'Poor', 'Critical'];

export const ROAD_CONDITION_DB_FIELDS = {
  tableName: 'road_condition_records',
  fields: [
    { name: 'id', type: 'uuid', required: true, note: 'Primary key' },
    { name: 'road_name', type: 'text', required: true, note: 'Road dropdown source label' },
    { name: 'condition', type: 'text', required: true, note: 'Good, Fair, Poor, or Critical' },
    { name: 'inspection_date', type: 'date', required: true },
    { name: 'remarks', type: 'text', required: true },
    { name: 'photo_urls', type: 'text[]', required: false, note: 'Multiple uploaded image URLs' },
    { name: 'inspector_name', type: 'text', required: false },
    { name: 'inspector_id', type: 'uuid', required: false },
    { name: 'created_at', type: 'timestamptz', required: true },
    { name: 'updated_at', type: 'timestamptz', required: true },
  ],
  historyTable: 'road_condition_history',
  historyFields: [
    { name: 'id', type: 'uuid', required: true },
    { name: 'road_condition_id', type: 'uuid', required: true },
    { name: 'condition', type: 'text', required: true },
    { name: 'inspection_date', type: 'date', required: true },
    { name: 'remarks', type: 'text', required: true },
    { name: 'photo_urls', type: 'text[]', required: false },
    { name: 'inspector_name', type: 'text', required: false },
    { name: 'created_at', type: 'timestamptz', required: true },
  ],
};

const SAMPLE_RECORDS = [
  {
    id: 'road-bucari-cumpan-sibucao',
    roadName: 'Bucari-Cumpan-Sibucao',
    condition: 'Critical',
    inspectionDate: '2025-07-01',
    inspector: 'LGU Inspector',
    remarks: 'Heavy erosion during rainy season.',
    photoUrls: [],
    createdAt: '2025-07-01T00:00:00.000Z',
    updatedAt: '2025-07-01T00:00:00.000Z',
    history: [
      {
        id: 'history-1',
        condition: 'Critical',
        inspectionDate: '2025-07-01',
        remarks: 'Heavy erosion during rainy season.',
        inspector: 'LGU Inspector',
        photoUrls: [],
        createdAt: '2025-07-01T00:00:00.000Z',
      },
    ],
  },
  {
    id: 'road-lanag-tuog',
    roadName: 'Lanag-Tu-og Road',
    condition: 'Poor',
    inspectionDate: '2025-06-18',
    inspector: 'LGU Inspector',
    remarks: 'Partial shoulder failure and edge cracking observed.',
    photoUrls: [],
    createdAt: '2025-06-18T00:00:00.000Z',
    updatedAt: '2025-06-20T00:00:00.000Z',
    history: [
      {
        id: 'history-2',
        condition: 'Fair',
        inspectionDate: '2025-05-10',
        remarks: 'Initial inspection before rains.',
        inspector: 'LGU Inspector',
        photoUrls: [],
        createdAt: '2025-05-10T00:00:00.000Z',
      },
      {
        id: 'history-3',
        condition: 'Poor',
        inspectionDate: '2025-06-18',
        remarks: 'Partial shoulder failure and edge cracking observed.',
        inspector: 'LGU Inspector',
        photoUrls: [],
        createdAt: '2025-06-18T00:00:00.000Z',
      },
    ],
  },
];

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function toTitle(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function makeId(prefix = 'road-condition') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initialFormState(record = null) {
  return {
    roadName: record?.roadName || '',
    condition: record?.condition || 'Good',
    inspectionDate: record?.inspectionDate || todayIsoDate(),
    remarks: record?.remarks || '',
    photoFiles: [],
    photoPreviews: record?.photoUrls || [],
  };
}

function getConditionTone(condition) {
  if (condition === 'Good') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (condition === 'Fair') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (condition === 'Poor') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (condition === 'Critical') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function validateRecord(form) {
  const errors = {};
  if (!form.roadName.trim()) errors.roadName = 'Road Name is required.';
  if (!CONDITION_OPTIONS.includes(form.condition)) errors.condition = 'Choose a valid condition.';
  if (!form.inspectionDate) errors.inspectionDate = 'Inspection Date is required.';
  if (form.inspectionDate && form.inspectionDate > todayIsoDate()) {
    errors.inspectionDate = 'Inspection Date cannot be in the future.';
  }
  if (!form.remarks.trim()) errors.remarks = 'Remarks are required.';
  if (form.photoFiles.length > 0) {
    const invalid = form.photoFiles.find((file) => !file.type.startsWith('image/'));
    if (invalid) errors.photoFiles = 'Only image files are allowed.';
  }
  return errors;
}

export default function RoadConditionManagement({
  roadOptions = [],
  initialRecords = SAMPLE_RECORDS,
  inspectorName = 'LGU Inspector',
  onCreateRecord,
  onUpdateRecord,
  onDeleteRecord,
  onViewHistory,
}) {
  const baseRoadOptions = useMemo(() => {
    const source = roadOptions.length > 0 ? roadOptions : initialRecords.map((row) => row.roadName);
    return Array.from(new Set(source.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
  }, [roadOptions, initialRecords]);

  const [records, setRecords] = useState(initialRecords);
  const [mode, setMode] = useState('create');
  const [selectedRecordId, setSelectedRecordId] = useState(null);
  const [historyRecordId, setHistoryRecordId] = useState(null);
  const [form, setForm] = useState(initialFormState());
  const [errors, setErrors] = useState({});
  const [photoPreviewUrls, setPhotoPreviewUrls] = useState([]);

  const selectedRecord = useMemo(
    () => records.find((row) => row.id === selectedRecordId) || null,
    [records, selectedRecordId]
  );
  const historyRecord = useMemo(
    () => records.find((row) => row.id === historyRecordId) || null,
    [records, historyRecordId]
  );

  useEffect(() => {
    return () => {
      photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoPreviewUrls]);

  useEffect(() => {
    if (!selectedRecord) {
      setForm(initialFormState());
      setMode('create');
      return;
    }

    setForm(initialFormState(selectedRecord));
    setMode('edit');
  }, [selectedRecord]);

  const clearForm = () => {
    setSelectedRecordId(null);
    setErrors({});
    setForm(initialFormState());
    setPhotoPreviewUrls([]);
    setMode('create');
  };

  const handlePhotoChange = (event) => {
    const files = Array.from(event.target.files || []);

    photoPreviewUrls.forEach((url) => URL.revokeObjectURL(url));

    const previews = files.map((file) => URL.createObjectURL(file));
    setForm((prev) => ({
      ...prev,
      photoFiles: files,
      photoPreviews: previews,
    }));
    setPhotoPreviewUrls(previews);
  };

  const handleEdit = (record) => {
    setSelectedRecordId(record.id);
    setHistoryRecordId(null);
    setErrors({});
  };

  const handleDelete = async (record) => {
    const confirmed = window.confirm(`Delete road condition record for ${record.roadName}?`);
    if (!confirmed) return;

    if (typeof onDeleteRecord === 'function') {
      await onDeleteRecord(record);
    }

    setRecords((prev) => prev.filter((row) => row.id !== record.id));
    if (selectedRecordId === record.id) clearForm();
    if (historyRecordId === record.id) setHistoryRecordId(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validateRecord(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const now = new Date().toISOString();
    const photoUrls = form.photoFiles.length > 0
      ? form.photoFiles.map((file) => `${file.name}-${makeId('photo')}`)
      : (selectedRecord?.photoUrls || []);

    const payload = {
      id: selectedRecord?.id || makeId(),
      roadName: form.roadName.trim(),
      condition: form.condition,
      inspectionDate: form.inspectionDate,
      remarks: form.remarks.trim(),
      photoUrls,
      inspector: inspectorName,
      createdAt: selectedRecord?.createdAt || now,
      updatedAt: now,
      history: selectedRecord?.history ? [...selectedRecord.history] : [],
    };

    const historyEntry = {
      id: makeId('history'),
      condition: payload.condition,
      inspectionDate: payload.inspectionDate,
      remarks: payload.remarks,
      inspector: inspectorName,
      photoUrls: payload.photoUrls,
      createdAt: now,
    };

    payload.history = [...payload.history, historyEntry];

    if (selectedRecord) {
      if (typeof onUpdateRecord === 'function') {
        await onUpdateRecord(payload, selectedRecord);
      }
      setRecords((prev) => prev.map((row) => (row.id === selectedRecord.id ? payload : row)));
    } else {
      if (typeof onCreateRecord === 'function') {
        await onCreateRecord(payload);
      }
      setRecords((prev) => [payload, ...prev]);
    }

    clearForm();
  };

  const currentHistory = historyRecord?.history || [];

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500 font-semibold">Road Condition Management</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Condition monitoring and inspection log</h2>
            <p className="mt-1 text-sm text-slate-600">Create, edit, delete, and review road condition records with inspection history.</p>
          </div>
          <button
            type="button"
            onClick={clearForm}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            New Record
          </button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_1.35fr]">
        <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 lg:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">{mode === 'edit' ? 'Edit Record' : 'Create Record'}</p>
              <p className="text-xs text-slate-500">Example record supported: Bucari-Cumpan-Sibucao.</p>
            </div>
            {selectedRecord && (
              <button
                type="button"
                onClick={clearForm}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Road Name <span className="text-red-500">*</span></label>
            <select
              value={form.roadName}
              onChange={(e) => setForm((prev) => ({ ...prev, roadName: e.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
            >
              <option value="">Select road name</option>
              {baseRoadOptions.map((road) => (
                <option key={road} value={road}>{road}</option>
              ))}
            </select>
            {errors.roadName && <p className="mt-1 text-xs text-red-600">{errors.roadName}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Condition <span className="text-red-500">*</span></label>
              <select
                value={form.condition}
                onChange={(e) => setForm((prev) => ({ ...prev, condition: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              >
                {CONDITION_OPTIONS.map((condition) => (
                  <option key={condition} value={condition}>{condition}</option>
                ))}
              </select>
              {errors.condition && <p className="mt-1 text-xs text-red-600">{errors.condition}</p>}
            </div>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Inspection Date <span className="text-red-500">*</span></label>
              <input
                type="date"
                value={form.inspectionDate}
                onChange={(e) => setForm((prev) => ({ ...prev, inspectionDate: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              />
              {errors.inspectionDate && <p className="mt-1 text-xs text-red-600">{errors.inspectionDate}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Remarks <span className="text-red-500">*</span></label>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
              rows={4}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none resize-none"
              placeholder="Heavy erosion during rainy season."
            />
            {errors.remarks && <p className="mt-1 text-xs text-red-600">{errors.remarks}</p>}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Photo Upload <span className="text-slate-400 font-normal">(multiple images)</span></label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center hover:border-teal-400 hover:bg-teal-50/30">
              <span className="text-sm font-semibold text-slate-700">Click to upload inspection photos</span>
              <span className="mt-1 text-xs text-slate-500">JPG, PNG, WEBP supported</span>
              <input type="file" accept="image/*" multiple onChange={handlePhotoChange} className="hidden" />
            </label>
            {errors.photoFiles && <p className="mt-1 text-xs text-red-600">{errors.photoFiles}</p>}
          </div>

          {(form.photoPreviews || []).length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {form.photoPreviews.map((src, index) => (
                <img key={`${src}-${index}`} src={src} alt={`Preview ${index + 1}`} className="h-24 w-full rounded-xl border border-slate-200 object-cover" />
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              {mode === 'edit' ? 'Update Record' : 'Create Record'}
            </button>
            {selectedRecord && (
              <button
                type="button"
                onClick={() => handleDelete(selectedRecord)}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-100"
              >
                Delete Record
              </button>
            )}
          </div>
        </form>

        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:p-5 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Condition Records</p>
                <p className="text-xs text-slate-500">Road Name, Current Condition, Inspection Date, Inspector, Last Updated</p>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {records.length} records
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-slate-500">
                    <th className="px-4 py-3">Road Name</th>
                    <th className="px-4 py-3">Current Condition</th>
                    <th className="px-4 py-3">Inspection Date</th>
                    <th className="px-4 py-3">Inspector</th>
                    <th className="px-4 py-3">Last Updated</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-medium text-slate-900">{record.roadName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${getConditionTone(record.condition)}`}>
                          {record.condition}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatDate(record.inspectionDate)}</td>
                      <td className="px-4 py-3 text-slate-700">{record.inspector || inspectorName}</td>
                      <td className="px-4 py-3 text-slate-700">{formatDate(record.updatedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => handleEdit(record)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Edit</button>
                          <button type="button" onClick={() => setHistoryRecordId(record.id)} className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100">View History</button>
                          <button type="button" onClick={() => handleDelete(record)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td className="px-4 py-6 text-slate-500" colSpan={6}>No road condition records yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">Condition History</p>
                <p className="text-xs text-slate-500">Timeline of changes for the selected road.</p>
              </div>
              {historyRecord && (
                <span className="text-xs text-slate-500">{historyRecord.roadName}</span>
              )}
            </div>

            {!historyRecord ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Select <span className="font-semibold text-slate-700">View History</span> for any road record.
              </div>
            ) : (
              <div className="space-y-3">
                {typeof onViewHistory === 'function' ? null : null}
                {currentHistory.length > 0 ? currentHistory.map((entry) => (
                  <article key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{entry.condition}</p>
                      <p className="text-xs text-slate-500">{formatDate(entry.inspectionDate)}</p>
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{entry.remarks}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      <span>Inspector: {entry.inspector || inspectorName}</span>
                      <span>Recorded: {formatDate(entry.createdAt)}</span>
                    </div>
                    {(entry.photoUrls || []).length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {entry.photoUrls.map((url, index) => (
                          <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt={`History ${index + 1}`} className="h-20 w-full rounded-lg border border-slate-200 object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </article>
                )) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">No history entries for this road.</div>
                )}
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Database Fields</p>
            <p className="text-xs text-slate-500">Suggested fields for the road condition management tables.</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{ROAD_CONDITION_DB_FIELDS.tableName}</p>
            <div className="space-y-2 text-sm">
              {ROAD_CONDITION_DB_FIELDS.fields.map((field) => (
                <div key={field.name} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0">
                  <span className="font-medium text-slate-800">{field.name}</span>
                  <span className="text-slate-500">{field.type}{field.required ? ' · required' : ''}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">{ROAD_CONDITION_DB_FIELDS.historyTable}</p>
            <div className="space-y-2 text-sm">
              {ROAD_CONDITION_DB_FIELDS.historyFields.map((field) => (
                <div key={field.name} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-2 last:border-b-0 last:pb-0">
                  <span className="font-medium text-slate-800">{field.name}</span>
                  <span className="text-slate-500">{field.type}{field.required ? ' · required' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}