import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { supabase } from '../../lib/supabase';
import { getBarangays, getMunicipalities } from '../../data/iloiloLocations';
import { getMunicipalityCentroid } from '../../lib/mapRouteUtils';
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

const MARKET_TYPES = ['Public Market', 'Trading Post', 'Collection Center', 'Warehouse', 'Others'];
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
      alert("Please pin the market location on the map to set coordinates.");
      return;
    }

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
      contact_number: form.contactNumber.trim() || null,
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
        alert('Market location updated successfully.');
        setEditingId(null);
      } else {
        const { error } = await supabase
          .from('market_locations')
          .insert(payload);

        if (error) throw error;
        alert('Market location added successfully.');
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
      setActiveSubTab('list');
    } catch (err) {
      alert(`Error saving market: ${err.message}`);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Are you sure you want to delete the market "${name}"?`)) return;
    try {
      const { error } = await supabase
        .from('market_locations')
        .delete()
        .eq('id', id);

      if (error) throw error;
      alert('Market location deleted.');
      fetchMarkets();
    } catch (err) {
      alert(`Error deleting market: ${err.message}`);
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
      <div className="flex border-b border-slate-200">
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Market Type *</label>
                  <select 
                    required 
                    value={form.marketType}
                    onChange={e => setForm(c => ({ ...c, marketType: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    {MARKET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Barangay *</label>
                  <select 
                    required 
                    value={form.barangay}
                    onChange={e => setForm(c => ({ ...c, barangay: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  >
                    <option value="">Select Barangay</option>
                    {getBarangays(municipalityScope || form.municipality).map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Operating Days</label>
                  <input 
                    type="text" 
                    value={form.operatingDays}
                    onChange={e => setForm(c => ({ ...c, operatingDays: e.target.value }))}
                    placeholder="e.g. Mon-Sat" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Operating Hours</label>
                  <input 
                    type="text" 
                    value={form.operatingHours}
                    onChange={e => setForm(c => ({ ...c, operatingHours: e.target.value }))}
                    placeholder="e.g. 5:00 AM - 6:00 PM" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Contact Number</label>
                  <input 
                    type="text" 
                    value={form.contactNumber}
                    onChange={e => setForm(c => ({ ...c, contactNumber: e.target.value }))}
                    placeholder="e.g. 09123456789" 
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-1 focus:ring-emerald-500 outline-none"
                  />
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
                            alert('Location not found. Try adding the municipality name.');
                          }
                        } catch (err) {
                          console.error(err);
                          alert('Error searching location.');
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
                        📍 {m.latitude.toFixed(5)}, {m.longitude.toFixed(5)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {m.operating_days && <p><span className="font-medium text-slate-400">Days:</span> {m.operating_days}</p>}
                      {m.operating_hours && <p><span className="font-medium text-slate-400">Hours:</span> {m.operating_hours}</p>}
                      {(m.contact_person || m.contact_number) && (
                        <p className="mt-1">
                          👤 {m.contact_person || ''} {m.contact_number ? `(${m.contact_number})` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(m.id);
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
                              contactNumber: m.contact_number || '',
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
    </div>
  );
}
