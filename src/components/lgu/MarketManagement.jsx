import { CalendarDaysIcon, CheckIcon, CircleAlertIcon, CircleHelpIcon, ClockIcon, HandCoinsIcon, Loader2Icon, MapPinCheckIcon, MapPinIcon, PencilIcon, StoreIcon, TruckIcon, UserIcon, WarehouseIcon, WheatIcon } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useEffect, useRef, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabaseLgu as supabase } from '../../lib/supabase';
import { notify } from '../../lib/toast';
import { confirm } from '../../lib/confirm';
import { getBarangays, getMunicipalities } from '../../data/iloiloLocations';
import { getMunicipalityCentroid } from '../../lib/mapRouteUtils';
import { barangayNames, locateBarangay, sameBarangay, useBarangayBoundaries } from '../../lib/barangayLocator';
import { DAY_PRESETS, DAYS, HOUR_PRESETS, formatDays, formatHours, parseDays, parseHours } from '../../lib/marketHours';
import { groupMobile, mobileHint, mobileLocalPart, toE164Mobile } from '../../lib/phMobile';
import { BENEFICIARY_CROPS } from '../../utils/farmerBeneficiaryData';

// Leaflet map helper subcomponents
function MapClickPicker({ onPick }) {
  useMapEvents({
    click(event) {
      onPick(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

function MapCenterController({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

/* What kind of place the market is, in everyday words (the local name in
 * brackets). `value` is what is saved in market_locations.market_type and shown
 * on the maps; it is unchanged so old and new markets read the same. "Others"
 * saves what the LGU writes instead (e.g. "Fish landing"). */
const MARKET_TYPES = [
  { value: 'Public Market', label: 'Public market', local: 'Palengke', hint: 'The town market where people buy and sell every day.', icon: <StoreIcon className="size-[18px]" aria-hidden="true" /> },
  { value: 'Trading Post', label: 'Trading post', local: 'Bagsakan', hint: 'Farmers bring their harvest in bulk and sell it to traders.', icon: <TruckIcon className="size-[18px]" aria-hidden="true" /> },
  { value: 'Collection Center', label: 'Buying station', local: 'Co-op or buyer', hint: 'A buyer or cooperative buys palay, corn and other harvest here.', icon: <HandCoinsIcon className="size-[18px]" aria-hidden="true" /> },
  { value: 'Warehouse', label: 'Warehouse or rice mill', local: 'Bodega', hint: 'Harvest is stored or milled here before it is sold.', icon: <WarehouseIcon className="size-[18px]" aria-hidden="true" /> },
  { value: 'Others', label: 'Something else', local: '', hint: 'Write what kind of place it is.', icon: <CircleHelpIcon className="size-[18px]" aria-hidden="true" /> },
];
const KNOWN_TYPE = (v) => MARKET_TYPES.some((t) => t.value === v && v !== 'Others');
const COMMODITY_OPTIONS = [
  ...BENEFICIARY_CROPS,
  'Livestock',
  'Others'
];

export default function MarketManagement({ user, profile, municipalityScope }) {
  const [marketsList, setMarketsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('list');
  const [reviewOpen, setReviewOpen] = useState(false); // the "check before saving" card
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    marketName: '',
    marketType: 'Public Market',
    latitude: '',
    longitude: '',
    municipality: municipalityScope || '',
    barangay: '',
    province: 'Iloilo',
    operatingDays: '',
    operatingHours: '',
    commoditiesAccepted: [],
    contactPerson: '',
    contactNumber: '',
    remarks: ''
  });

  // The barangay follows the pin: wherever the market is pinned (map click,
  // search or typed coordinates), the barangay is read from the official
  // boundaries (lib/barangayLocator.js). A barangay the LGU then picks by hand
  // is kept, with a note when it differs from the pin.
  const town = municipalityScope || form.municipality;
  const boundariesReady = useBarangayBoundaries(town);
  const pinKey = form.latitude && form.longitude ? `${Number(form.latitude).toFixed(6)},${Number(form.longitude).toFixed(6)}` : '';
  const pinPlace = useMemo(
    () => (pinKey ? locateBarangay(form.latitude, form.longitude, town) : null),
    // boundariesReady: re-read once the boundary file has loaded
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pinKey, town, boundariesReady],
  );
  const autoSetFor = useRef(''); // the pin the barangay was last set from (or loaded with)
  const [barangaySetByPin, setBarangaySetByPin] = useState(false);
  useEffect(() => {
    if (!pinKey || !pinPlace?.name || autoSetFor.current === pinKey) return;
    autoSetFor.current = pinKey;
    setForm((c) => ({ ...c, barangay: pinPlace.name }));
    setBarangaySetByPin(true);
  }, [pinKey, pinPlace]);
  // Official names when the boundaries are loaded (complete and spelled like the
  // pin's answer); the town list otherwise. A saved name not in the list stays.
  const barangayOptions = useMemo(() => {
    const list = boundariesReady ? barangayNames(town) : getBarangays(town);
    return form.barangay && !list.some((b) => sameBarangay(b, form.barangay)) ? [form.barangay, ...list] : list;
  }, [boundariesReady, town, form.barangay]);
  const pinDisagrees = Boolean(pinPlace?.name && form.barangay && !sameBarangay(pinPlace.name, form.barangay));

  // Days and hours are picked, not typed; the text columns keep the readable form.
  const parsedDays = parseDays(form.operatingDays);
  const unreadDays = parsedDays === null; // typed by hand earlier in another form: kept until replaced
  const pickedDays = parsedDays || [];
  const setDays = (days) => setForm((c) => ({ ...c, operatingDays: formatDays(days) }));
  const parsedHours = parseHours(form.operatingHours);
  const unreadHours = parsedHours === null;
  const pickedHours = parsedHours || { open: '', close: '', allDay: false };
  const setHours = (h) => setForm((c) => ({ ...c, operatingHours: formatHours(h) }));
  const hoursIncomplete = !pickedHours.allDay && Boolean(pickedHours.open) !== Boolean(pickedHours.close);

  // "Something else": the typed kind is saved in place of 'Others'.
  const typeIsOther = !KNOWN_TYPE(form.marketType);

  // form.contactNumber holds the 10 digits after +63; saved as +639XXXXXXXXX.
  const phoneHint = mobileHint(form.contactNumber);

  const eligibleMunicipalities = useMemo(() => {
    if (municipalityScope) return [municipalityScope];
    return getMunicipalities();
  }, [municipalityScope]);

  useEffect(() => {
    fetchMarkets();
  }, [municipalityScope]);

  const fetchMarkets = async () => {
    setLoading(true);
    try {
      let query = supabase.from('market_locations').select('*').order('market_name', { ascending: true });
      if (municipalityScope) {
        query = query.eq('municipality', municipalityScope);
      }
      const { data, error } = await query;
      if (error) throw error;
      setMarketsList(data || []);
    } catch (err) {
      console.error('Error fetching market locations:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCommodityToggle = (commodity) => {
    setForm(curr => {
      const exists = curr.commoditiesAccepted.includes(commodity);
      const updated = exists 
        ? curr.commoditiesAccepted.filter(c => c !== commodity)
        : [...curr.commoditiesAccepted, commodity];
      return { ...curr, commoditiesAccepted: updated };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    const lat = Number(form.latitude);
    const lng = Number(form.longitude);

    if (!lat || !lng) {
      notify("Please pin the market location on the map to set coordinates.");
      return;
    }
    if (hoursIncomplete) {
      notify('Set both the opening and the closing time, or leave both empty.');
      return;
    }
    if (form.contactNumber && !toE164Mobile(form.contactNumber)) {
      notify(`Please check the contact number: ${phoneHint?.text || 'it needs 10 digits after +63.'} You can also leave it empty.`);
      document.getElementById('market-contact-number')?.focus();
      return;
    }
    // Nothing is saved yet: the review card shows what will be (and any location doubts).
    setReviewOpen(true);
  };

  const saveMarket = async () => {
    if (!user || saving) return;
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    setSaving(true);

    const payload = {
      market_name: form.marketName.trim(),
      market_type: form.marketType,
      latitude: lat,
      longitude: lng,
      municipality: municipalityScope || form.municipality,
      barangay: form.barangay,
      province: form.province,
      operating_days: form.operatingDays.trim() || null,
      operating_hours: form.operatingHours.trim() || null,
      commodities_accepted: form.commoditiesAccepted,
      contact_person: form.contactPerson.trim() || null,
      contact_number: toE164Mobile(form.contactNumber) || null,
      remarks: form.remarks.trim() || null,
      created_by_user_id: user.id,
      created_by_role: 'lgu'
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from('market_locations')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        notify('Market location updated successfully.');
        setEditingId(null);
      } else {
        const { error } = await supabase
          .from('market_locations')
          .insert(payload);

        if (error) throw error;
        notify('Market location added successfully.');
      }

      setForm({
        marketName: '',
        marketType: 'Public Market',
        latitude: '',
        longitude: '',
        municipality: municipalityScope || '',
        barangay: '',
        province: 'Iloilo',
        operatingDays: '',
        operatingHours: '',
        commoditiesAccepted: [],
        contactPerson: '',
        contactNumber: '',
        remarks: ''
      });
      fetchMarkets();
      setReviewOpen(false);
      setActiveSubTab('list');
    } catch (err) {
      notify(`Error saving market: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    const confirmed = await confirm({
      title: 'Delete market location?',
      message: `"${name}" will be permanently removed from the market directory. This cannot be undone.`,
      confirmLabel: 'Delete market',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      const { error } = await supabase
        .from('market_locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      notify('Market location deleted.');
      fetchMarkets();
    } catch (err) {
      notify(`Error deleting market: ${err.message}`);
    }
  };

  const filteredMarkets = marketsList.filter(m => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return m.market_name.toLowerCase().includes(q) || 
           (m.barangay || '').toLowerCase().includes(q) ||
           m.market_type.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Clickable Sub-Nav Bar */}
      <div className="flex border-b border-slate-200" data-tour="lgu-market-tabs">
        <button
          type="button"
          onClick={() => setActiveSubTab('list')}
          className={`border-b-2 px-6 py-3 text-sm font-bold transition-all flex items-center gap-2 ${
            activeSubTab === 'list'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Market Locations</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
            activeSubTab === 'list' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
          }`}>
            {filteredMarkets.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('form')}
          className={`border-b-2 px-6 py-3 text-sm font-bold transition-all ${
            activeSubTab === 'form'
              ? 'border-emerald-600 text-emerald-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {editingId ? 'Edit Market' : 'Register New Market'}
        </button>
      </div>

      {activeSubTab === 'form' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="border-b border-slate-100 pb-3 mb-4">
            <h3 className="text-lg font-semibold text-slate-900">
              {editingId ? 'Edit Market Location' : 'Register Market Location'}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Add market endpoints or trading posts where local farmers deliver goods.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Column of form */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Market Name *</label>
                <input 
                  required 
                  type="text" 
                  value={form.marketName}
                  onChange={e => setForm(c => ({ ...c, marketName: e.target.value }))}
                  placeholder="e.g. Leon Public Market" 
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                />
              </div>

              {/* What kind of place: big, plain cards instead of a dropdown (MARKET_TYPES). */}
              <fieldset>
                <legend className="block text-xs font-semibold text-slate-700 mb-1.5">What kind of place is it? *</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Kind of market">
                  {MARKET_TYPES.map(({ value, label, local, hint, icon }) => {
                    const on = value === 'Others' ? typeIsOther : form.marketType === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setForm((c) => ({ ...c, marketType: value === 'Others' ? (KNOWN_TYPE(c.marketType) ? 'Others' : c.marketType) : value }))}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition ${on ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500' : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'} ${value === 'Others' ? 'sm:col-span-2' : ''}`}
                      >
                        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${on ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">
                            {label}{local && <span className="font-normal text-slate-500"> ({local})</span>}
                          </span>
                          <span className="block text-xs leading-snug text-slate-500">{hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {typeIsOther && (
                  <input
                    type="text"
                    required
                    autoFocus
                    value={form.marketType === 'Others' ? '' : form.marketType}
                    onChange={(e) => setForm((c) => ({ ...c, marketType: e.target.value || 'Others' }))}
                    placeholder="e.g. Fish landing, Cooperative store"
                    aria-label="What kind of place it is"
                    className="mt-2 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                )}
              </fieldset>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Barangay *</label>
                  <select 
                    required 
                    value={form.barangay}
                    onChange={e => { setForm(c => ({ ...c, barangay: e.target.value })); setBarangaySetByPin(false); }}
                    aria-describedby="market-barangay-note"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">{pinKey ? 'Select Barangay' : 'Pin the market to fill this in'}</option>
                    {barangayOptions.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              {pinKey && (
                <div id="market-barangay-note" className="-mt-1" aria-live="polite">
                  {pinPlace?.outside ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                      <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      The pin is outside {town}. Move it onto the market, or choose the barangay yourself.
                    </p>
                  ) : pinDisagrees ? (
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                      <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span>The pin is in Brgy. <span className="font-semibold">{pinPlace.name}</span>{pinPlace.exact ? '' : ' (approximate)'}.</span>
                      <button
                        type="button"
                        onClick={() => { setForm(c => ({ ...c, barangay: pinPlace.name })); setBarangaySetByPin(true); }}
                        className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-700"
                      >
                        Use {pinPlace.name}
                      </button>
                    </p>
                  ) : pinPlace?.name && barangaySetByPin ? (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                      <MapPinCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      Barangay set from the pin{pinPlace.exact ? ' (official boundary)' : ' (approximate: nearest barangay center)'}.
                    </p>
                  ) : !pinPlace && !boundariesReady ? (
                    <p className="text-xs text-slate-500">Loading barangay boundaries…</p>
                  ) : null}
                </div>
              )}

              {/* Operating days: tap the days (or a shortcut); saved as "Mon-Sat" etc. (lib/marketHours.js) */}
              <fieldset>
                <legend className="block text-xs font-semibold text-slate-700 mb-1.5">Operating Days</legend>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days the market is open">
                  {DAYS.map((d) => {
                    const on = pickedDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setDays(on ? pickedDays.filter((x) => x !== d) : [...pickedDays, d])}
                        className={`h-9 w-11 rounded-lg border text-xs font-semibold transition ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700'}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {DAY_PRESETS.map((p) => (
                    <button key={p.label} type="button" onClick={() => setDays(p.days)} className="font-semibold text-emerald-700 hover:text-emerald-900 hover:underline underline-offset-2">
                      {p.label}
                    </button>
                  ))}
                  {pickedDays.length > 0 && (
                    <button type="button" onClick={() => setDays([])} className="text-slate-400 hover:text-slate-600">Clear</button>
                  )}
                  <span className="ml-auto text-slate-500">{form.operatingDays || 'Not set'}</span>
                </div>
                {unreadDays && (
                  <p className="mt-1 text-xs text-amber-700">Saved earlier as &ldquo;{form.operatingDays}&rdquo;. Tap the days to replace it.</p>
                )}
              </fieldset>

              {/* Operating hours: two time pickers (or a shortcut); saved as "5:00 AM - 6:00 PM". */}
              <fieldset>
                <legend className="block text-xs font-semibold text-slate-700 mb-1.5">Operating Hours</legend>
                <div className="flex flex-wrap gap-1.5">
                  {HOUR_PRESETS.map((p) => {
                    const on = p.allDay ? pickedHours.allDay : !pickedHours.allDay && pickedHours.open === p.open && pickedHours.close === p.close;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setHours(p.allDay ? { open: '', close: '', allDay: true } : { open: p.open, close: p.close, allDay: false })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                {!pickedHours.allDay && (
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="block text-[11px] font-medium text-slate-500 mb-1">Opens</span>
                      <input
                        type="time"
                        value={pickedHours.open}
                        onChange={(e) => setHours({ ...pickedHours, open: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="block text-[11px] font-medium text-slate-500 mb-1">Closes</span>
                      <input
                        type="time"
                        value={pickedHours.close}
                        onChange={(e) => setHours({ ...pickedHours, close: e.target.value })}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                    </label>
                  </div>
                )}
                <p className="mt-1.5 text-xs text-slate-500">
                  {unreadHours
                    ? <span className="text-amber-700">Saved earlier as &ldquo;{form.operatingHours}&rdquo;. Pick the times to replace it.</span>
                    : hoursIncomplete
                      ? <span className="text-amber-700">Set both the opening and the closing time.</span>
                      : form.operatingHours || 'Not set'}
                </p>
              </fieldset>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Commodities Handled</label>
                <div className="flex flex-wrap gap-1.5">
                  {COMMODITY_OPTIONS.map(c => {
                    const isChecked = form.commoditiesAccepted.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleCommodityToggle(c)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                          isChecked 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Person</label>
                  <input 
                    type="text" 
                    value={form.contactPerson}
                    onChange={e => setForm(c => ({ ...c, contactPerson: e.target.value }))}
                    placeholder="e.g. Jose Cruz" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="market-contact-number" className="block text-xs font-semibold text-slate-700 mb-1">Contact Number</label>
                  {/* +63 is fixed; the 10 digits after it are typed (12 in all). lib/phMobile.js */}
                  <div className={`flex items-center rounded-lg border bg-white text-sm focus-within:ring-1 ${phoneHint?.tone === 'error' ? 'border-red-300 focus-within:ring-red-400' : 'border-slate-200 focus-within:ring-emerald-500'}`}>
                    <span className="select-none border-r border-slate-200 px-2.5 py-2 font-medium text-slate-500">+63</span>
                    <input
                      id="market-contact-number"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel-national"
                      value={groupMobile(form.contactNumber)}
                      onChange={e => setForm(c => ({ ...c, contactNumber: mobileLocalPart(e.target.value) }))}
                      placeholder="912 345 6789"
                      aria-invalid={phoneHint?.tone === 'error'}
                      aria-describedby="market-contact-number-hint"
                      className="min-w-0 flex-1 rounded-r-lg px-2.5 py-2 outline-none tracking-wide"
                    />
                  </div>
                  <p id="market-contact-number-hint" aria-live="polite" className={`mt-1 text-xs ${!phoneHint ? 'text-slate-400' : phoneHint.tone === 'ok' ? 'text-emerald-700' : phoneHint.tone === 'error' ? 'text-red-600' : 'text-amber-700'}`}>
                    {phoneHint ? phoneHint.text : 'Mobile number, 10 digits after +63. You can also type 09…'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Remarks</label>
                <textarea 
                  value={form.remarks}
                  onChange={e => setForm(c => ({ ...c, remarks: e.target.value }))}
                  placeholder="Market details, landmark, or cooperative links..." 
                  rows={3}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none resize-none"
                />
              </div>
            </div>

            {/* Right Column of form */}
            <div className="space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Latitude *</label>
                    <input 
                      required 
                      type="number" 
                      step="any"
                      value={form.latitude}
                      onChange={e => setForm(c => ({ ...c, latitude: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Longitude *</label>
                    <input 
                      required 
                      type="number" 
                      step="any"
                      value={form.longitude}
                      onChange={e => setForm(c => ({ ...c, longitude: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                    />
                  </div>
                </div>

                {/* GIS Coordinates Picker Map */}
                <div className="border border-slate-200 rounded-xl overflow-hidden mt-2">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Pin Market GPS Location *</span>
                    <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                      {form.latitude && form.longitude
                        ? `${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}`
                        : 'Click on the map or search'}
                    </span>
                  </div>
                  
                  {/* Search Bar inside Map */}
                  <div className="p-2.5 bg-white border-b border-slate-100 flex gap-2">
                    <input
                      type="text"
                      placeholder="Search market address..."
                      id="marketMapSearchInput"
                      className="flex-1 px-3 py-1 border border-slate-200 rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        const queryVal = document.getElementById('marketMapSearchInput')?.value?.trim();
                        if (!queryVal) return;
                        try {
                          const query = `${queryVal}, Iloilo, Philippines`;
                          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
                          const res = await fetch(url, {
                            headers: {
                              'Accept-Language': 'en',
                              'User-Agent': 'KalsaTrack-Route-Builder-Search'
                            }
                          });
                          if (!res.ok) throw new Error();
                          const data = await res.json();
                          if (data && data.length > 0) {
                            const { lat, lon } = data[0];
                            setForm(curr => ({
                              ...curr,
                              latitude: lat,
                              longitude: lon
                            }));
                          } else {
                            notify('Location not found. Try adding the municipality name.');
                          }
                        } catch (err) {
                          console.error(err);
                          notify('Error searching location.');
                        }
                      }}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors"
                    >
                      Search
                    </button>
                  </div>

                  <div style={{ height: '340px', width: '100%', position: 'relative' }}>
                    <MapContainer
                      center={
                        form.latitude && form.longitude
                          ? [Number(form.latitude), Number(form.longitude)]
                          : getMunicipalityCentroid(municipalityScope || form.municipality)
                      }
                      zoom={13}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={true}
                    >
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; OpenStreetMap contributors'
                      />
                      <MapClickPicker
                        onPick={(lat, lng) => {
                          setForm(curr => ({
                            ...curr,
                            latitude: lat,
                            longitude: lng
                          }));
                        }}
                      />
                      <MapCenterController
                        center={
                          form.latitude && form.longitude
                            ? [Number(form.latitude), Number(form.longitude)]
                            : getMunicipalityCentroid(municipalityScope || form.municipality)
                        }
                      />
                      {form.latitude && form.longitude && (
                        <Marker
                          position={[Number(form.latitude), Number(form.longitude)]}
                          icon={new L.Icon({
                            iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
                            shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
                            iconSize: [25, 41],
                            iconAnchor: [12, 41],
                          })}
                        />
                      )}
                    </MapContainer>
                  </div>
                </div>
              </div>

              <div className="flex gap-2.5 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setForm({
                      marketName: '',
                      marketType: 'Public Market',
                      latitude: '',
                      longitude: '',
                      municipality: municipalityScope || '',
                      barangay: '',
                      province: 'Iloilo',
                      operatingDays: '',
                      operatingHours: '',
                      commoditiesAccepted: [],
                      contactPerson: '',
                      contactNumber: '',
                      remarks: ''
                    });
                    setActiveSubTab('list');
                  }}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 text-sm font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition shadow-sm"
                >
                  {editingId ? 'Update Market' : 'Register Market'}
                </button>
              </div>
            </div>
          </form>
        </div>
      ) : (
        /* Markets List */
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-3 mb-4 gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Market Locations</h3>
              <p className="text-xs text-slate-500 mt-1">List of registered distribution hubs and trading posts.</p>
            </div>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm w-full sm:w-56 outline-none"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Market Details</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Operations</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td className="px-4 py-5 text-center text-slate-500" colSpan={4}>Loading markets data...</td></tr>
                ) : filteredMarkets.length === 0 ? (
                  <tr><td className="px-4 py-5 text-center text-slate-500" colSpan={4}>No markets registered yet.</td></tr>
                ) : filteredMarkets.map(m => (
                  <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{m.market_name}</p>
                      <p className="text-xs text-slate-500 font-medium">{m.market_type}</p>
                      {m.commodities_accepted?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {m.commodities_accepted.map(c => (
                            <span key={c} className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <p className="font-semibold">{m.barangay || 'N/A'}, {m.municipality}</p>
                      <p className="text-xs font-mono text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 w-fit mt-1">
                        <MapPinIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {m.operating_days && <p><span className="font-medium text-slate-400">Days:</span> {m.operating_days}</p>}
                      {m.operating_hours && <p><span className="font-medium text-slate-400">Hours:</span> {m.operating_hours}</p>}
                      {(m.contact_person || m.contact_number) && (
                        <p className="mt-1">
                          <UserIcon className="inline size-3.5 -mt-0.5 mr-1" aria-hidden="true" />{m.contact_person || ''} {m.contact_number ? `(${m.contact_number})` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(m.id);
                            // Opening a saved market keeps its barangay; a different pin answer is only flagged.
                            autoSetFor.current = m.latitude && m.longitude ? `${Number(m.latitude).toFixed(6)},${Number(m.longitude).toFixed(6)}` : '';
                            setBarangaySetByPin(false);
                            setForm({
                              marketName: m.market_name || '',
                              marketType: m.market_type || 'Public Market',
                              latitude: m.latitude || '',
                              longitude: m.longitude || '',
                              municipality: m.municipality || '',
                              barangay: m.barangay || '',
                              province: m.province || 'Iloilo',
                              operatingDays: m.operating_days || '',
                              operatingHours: m.operating_hours || '',
                              commoditiesAccepted: m.commodities_accepted || [],
                              contactPerson: m.contact_person || '',
                              contactNumber: mobileLocalPart(m.contact_number),
                              remarks: m.remarks || ''
                            });
                            setActiveSubTab('form');
                          }}
                          className="text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(m.id, m.market_name)}
                          className="text-xs font-semibold text-red-600 hover:text-red-800 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reviewOpen && (
        <Modal
          onClose={() => !saving && setReviewOpen(false)}
          title={editingId ? 'Save these changes?' : 'Ready to register this market?'}
          description="Take a quick look. Farmers will see these details when they choose where to sell."
          size="md"
          footer={(
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                disabled={saving}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <PencilIcon className="size-4" aria-hidden="true" /> Go back and edit
              </button>
              <button
                type="button"
                onClick={saveMarket}
                disabled={saving}
                data-autofocus
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-70"
              >
                {saving
                  ? <><Loader2Icon className="size-4 animate-spin" aria-hidden="true" /> Saving…</>
                  : <><CheckIcon className="size-4" aria-hidden="true" /> {editingId ? 'Yes, save changes' : 'Yes, register market'}</>}
              </button>
            </div>
          )}
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white shadow-sm">
                <StoreIcon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-slate-900">{form.marketName.trim() || 'Unnamed market'}</p>
                <p className="text-sm text-slate-600">{form.marketType}</p>
                <p className="mt-1 flex items-center gap-1 text-sm text-slate-700">
                  <MapPinIcon className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  {form.barangay ? `Brgy. ${form.barangay}, ` : ''}{town}
                </p>
              </div>
            </div>

            {(pinPlace?.outside || pinDisagrees) && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {pinPlace?.outside
                    ? <>The pin is <span className="font-semibold">outside {town}</span>. If that is where the market really is, you can still save it.</>
                    : <>The pin is in <span className="font-semibold">Brgy. {pinPlace.name}</span>, but the barangay is set to {form.barangay}. Go back to fix it, or save if you are sure.</>}
                </span>
              </p>
            )}

            <dl className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 text-sm">
              {[
                { icon: <CalendarDaysIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />, label: 'Open on', value: form.operatingDays },
                { icon: <ClockIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />, label: 'Hours', value: form.operatingHours },
                { icon: <WheatIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />, label: 'Buys', value: form.commoditiesAccepted.join(', ') },
                { icon: <UserIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />, label: 'Contact', value: [form.contactPerson.trim(), form.contactNumber ? `+63 ${groupMobile(form.contactNumber)}` : ''].filter(Boolean).join(' · ') },
                { icon: <MapPinIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />, label: 'Pin', value: `${Number(form.latitude).toFixed(5)}, ${Number(form.longitude).toFixed(5)}` },
              ].map(({ icon, label, value }) => (
                <div key={label} className="grid grid-cols-[7.5rem_1fr] items-start gap-3 px-4 py-2.5">
                  <dt className="flex items-center gap-1.5 text-slate-500">
                    {icon} {label}
                  </dt>
                  <dd className={`min-w-0 break-words ${value ? 'text-slate-800' : 'italic text-slate-400'}`}>{value || 'Not set'}</dd>
                </div>
              ))}
            </dl>

            {form.remarks.trim() && (
              <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
                <span className="font-medium text-slate-700">Remarks: </span>{form.remarks.trim()}
              </p>
            )}
            <p className="text-xs text-slate-500">You can edit or remove this market later from Market Locations.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
