import React, { useCallback, useEffect, useState } from 'react';
import {
  Briefcase,
  ClipboardCheck,
  DollarSign,
  Home,
  Search,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { apiFetch, getPrivateMediaUrl } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { DashboardShell, type NavItem } from '../../components/layout/DashboardShell';
import {
  EmptyState,
  MetaRow,
  MetricBlock,
  Panel,
  StatusIndicator,
} from '../../components/ui/Primitives';

type BuyerTab =
  | 'overview'
  | 'marketplace'
  | 'offers'
  | 'bookings'
  | 'collectors'
  | 'ledger'
  | 'onboarding';

export function BuyerWorkspace({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { materials, units, serviceAreas } = useAuth();
  const [tab, setTab] = useState<BuyerTab>('overview');
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [metrics, setMetrics] = useState({
    submittedOffers: 0,
    acceptedBookings: 0,
    completedCollections: 0,
    totalPurchasedMassKg: 0,
    totalSpend: 0,
    totalServiceFees: 0,
  });
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [selectedAreas, setSelectedAreas] = useState<number[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<number[]>([]);
  const [docs, setDocs] = useState<Array<Record<string, unknown>>>([]);
  const [marketplace, setMarketplace] = useState<Array<Record<string, unknown>>>([]);
  const [ineligibilityNotes, setIneligibilityNotes] = useState<string[]>([]);
  const [offers, setOffers] = useState<Array<Record<string, unknown>>>([]);
  const [bookings, setBookings] = useState<Array<Record<string, unknown>>>([]);
  const [collectors, setCollectors] = useState<Array<Record<string, unknown>>>([]);
  const [ledger, setLedger] = useState<Array<Record<string, unknown>>>([]);

  // Marketplace filter & Offer modal
  const [filterAreaId, setFilterAreaId] = useState<string>('');
  const [filterMaterialId, setFilterMaterialId] = useState<string>('');
  const [biddingListing, setBiddingListing] = useState<Record<string, unknown> | null>(null);
  const [bidPickupDate, setBidPickupDate] = useState('2026-11-22');
  const [bidPickupWindow, setBidPickupWindow] = useState('09:00-12:00');
  const [bidConditions, setBidConditions] = useState('');
  const [bidRates, setBidRates] = useState<Record<number, { covered: boolean; rate: string; unitId: number }>>({});

  // Onboarding edit state
  const [maxWeightKg, setMaxWeightKg] = useState('1000');
  const [maxDailyPickups, setMaxDailyPickups] = useState('10');
  const [isAvailable, setIsAvailable] = useState(true);
  const [docType, setDocType] = useState('Trade License');
  const [docRef, setDocRef] = useState('');

  // Collector creation form
  const [colName, setColName] = useState('');
  const [colEmail, setColEmail] = useState('');
  const [colPhone, setColPhone] = useState('');
  const [colPass, setColPass] = useState('');
  const [colVehicle, setColVehicle] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const mktQuery = new URLSearchParams();
      if (filterAreaId) mktQuery.set('serviceAreaId', filterAreaId);
      if (filterMaterialId) mktQuery.set('materialId', filterMaterialId);

      const [dash, mkt, ofr, bkg, col, ldg] = await Promise.all([
        apiFetch<{
          metrics: typeof metrics;
          profile: Record<string, unknown>;
          serviceAreaIds: number[];
          materialIds: number[];
          verificationDocuments: Array<Record<string, unknown>>;
        }>('/api/v1/buyer/dashboard'),
        apiFetch<{
          listings: Array<Record<string, unknown>>;
          ineligibilityNotes: string[];
        }>(`/api/v1/buyer/marketplace?${mktQuery.toString()}`),
        apiFetch<{ offers: Array<Record<string, unknown>> }>('/api/v1/buyer/offers'),
        apiFetch<{ bookings: Array<Record<string, unknown>> }>('/api/v1/buyer/bookings'),
        apiFetch<{ collectors: Array<Record<string, unknown>> }>('/api/v1/buyer/collectors'),
        apiFetch<{ ledger: Array<Record<string, unknown>> }>('/api/v1/buyer/ledger'),
      ]);

      setMetrics(dash.metrics);
      setProfile(dash.profile);
      setSelectedAreas(dash.serviceAreaIds || []);
      setSelectedMaterials(dash.materialIds || []);
      setDocs(dash.verificationDocuments || []);
      if (dash.profile) {
        setMaxWeightKg(String(dash.profile.max_weight_kg ?? 1000));
        setMaxDailyPickups(String(dash.profile.max_daily_pickups ?? 10));
        setIsAvailable(Number(dash.profile.is_available) === 1);
      }

      setMarketplace(mkt.listings || []);
      setIneligibilityNotes(mkt.ineligibilityNotes || []);
      setOffers(ofr.offers || []);
      setBookings(bkg.bookings || []);
      setCollectors(col.collectors || []);
      setLedger(ldg.ledger || []);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load buyer workspace.',
      });
    }
  }, [filterAreaId, filterMaterialId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openBidForm = (listing: Record<string, unknown>) => {
    setBiddingListing(listing);
    setBidPickupDate(String(listing.preferred_pickup_date || '2026-11-22'));
    setBidPickupWindow(String(listing.preferred_pickup_window || '09:00-12:00'));
    setBidConditions('Digital weighing on site; rates apply to sorted dry material.');
    const initial: Record<number, { covered: boolean; rate: string; unitId: number }> = {};
    for (const item of (listing.items as Array<Record<string, unknown>>) || []) {
      initial[Number(item.id)] = {
        covered: true,
        rate: '12',
        unitId: Number(item.unit_id),
      };
    }
    setBidRates(initial);
  };

  const handleSubmitOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!biddingListing) return;
    setBanner(null);
    try {
      const items = Object.entries(bidRates).map(([listingItemId, val]) => ({
        listingItemId: Number(listingItemId),
        isCovered: val.covered,
        unitRate: Number(val.rate || 0),
        unitId: val.unitId,
      }));
      const res = await apiFetch<{ referenceCode: string; estimatedTotalValue: number }>(
        '/api/v1/buyer/offers',
        {
          method: 'POST',
          body: {
            listingId: Number(biddingListing.id),
            proposedPickupDate: bidPickupDate,
            proposedPickupWindow: bidPickupWindow,
            conditionsText: bidConditions,
            items,
          },
        }
      );
      setBiddingListing(null);
      setBanner({
        type: 'success',
        text: `Offer ${res.referenceCode} submitted (Est. ₹${res.estimatedTotalValue.toFixed(2)}).`,
      });
      await loadAll();
      setTab('offers');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to submit offer.',
      });
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiFetch('/api/v1/buyer/profile', {
        method: 'PUT',
        body: {
          isAvailable,
          maxWeightKg: Number(maxWeightKg),
          maxDailyPickups: Number(maxDailyPickups),
          serviceAreaIds: selectedAreas,
          materialIds: selectedMaterials,
        },
      });
      setBanner({ type: 'success', text: 'Dealer capabilities and service areas updated.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save profile.',
      });
    }
  };

  const handleSubmitDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiFetch('/api/v1/buyer/verification-documents', {
        method: 'POST',
        body: { docType, docReference: docRef },
      });
      setDocRef('');
      setBanner({ type: 'success', text: 'Verification document submitted for admin review.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Document submission failed.',
      });
    }
  };

  const handleCreateCollector = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiFetch('/api/v1/buyer/collectors', {
        method: 'POST',
        body: {
          fullName: colName,
          email: colEmail,
          phone: colPhone,
          password: colPass,
          vehicleNumber: colVehicle,
        },
      });
      setColName('');
      setColEmail('');
      setColPhone('');
      setColPass('');
      setColVehicle('');
      setBanner({ type: 'success', text: 'Collector account created and linked to your dealer profile.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not create collector.',
      });
    }
  };

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <Home className="w-4 h-4" /> },
    { id: 'marketplace', label: 'Eligible Requests', icon: <Search className="w-4 h-4" /> },
    { id: 'offers', label: 'Manage Offers', icon: <ClipboardCheck className="w-4 h-4" /> },
    { id: 'bookings', label: 'Accepted Bookings', icon: <Truck className="w-4 h-4" /> },
    { id: 'collectors', label: 'Collectors', icon: <Users className="w-4 h-4" /> },
    { id: 'ledger', label: 'Service-Fee Ledger', icon: <DollarSign className="w-4 h-4" /> },
    { id: 'onboarding', label: 'Onboarding & Profile', icon: <ShieldCheck className="w-4 h-4" /> },
  ];

  return (
    <DashboardShell
      roleTitle="Buyer / Dealer"
      breadcrumb={navItems.find((n) => n.id === tab)?.label || 'Overview'}
      navItems={navItems}
      activeTab={tab}
      onSelectTab={(id) => setTab(id as BuyerTab)}
      guidanceTopic="offers"
      onNavigate={onNavigate}
    >
      {banner && (
        <div
          className={`mb-6 p-3.5 rounded-lg border text-xs font-medium ${
            banner.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800'
          }`}
        >
          {banner.text}
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900">
                {String(profile?.business_name || 'Buyer Workspace')}
              </h1>
              <div className="mt-1 flex items-center gap-3 text-xs text-slate-600">
                <span>Verification:</span>
                <StatusIndicator status={String(profile?.verification_status || 'PENDING')} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setTab('marketplace')}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Browse Eligible Requests ({marketplace.length})
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
            <MetricBlock label="Open Eligible" value={marketplace.length} />
            <MetricBlock label="Active Offers" value={metrics.submittedOffers} />
            <MetricBlock label="Active Bookings" value={metrics.acceptedBookings} />
            <MetricBlock label="Completed" value={metrics.completedCollections} />
            <MetricBlock label="Purchased Mass" value={`${metrics.totalPurchasedMassKg} kg`} />
            <MetricBlock label="Fee Ledger" value={`₹${metrics.totalServiceFees.toFixed(2)}`} />
          </div>

          {ineligibilityNotes.length > 0 && (
            <Panel className="bg-amber-50 border-amber-200">
              <h2 className="text-sm font-semibold text-amber-900">Eligibility Notice</h2>
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {ineligibilityNotes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {tab === 'marketplace' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900">
                Eligible Scrap Requests
              </h1>
              <p className="text-sm text-slate-600">
                Seller street addresses remain private until a seller confirms your offer.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Filter by service area"
                value={filterAreaId}
                onChange={(e) => setFilterAreaId(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="">All My Service Areas</option>
                {serviceAreas.map((sa) => (
                  <option key={sa.id} value={sa.id}>
                    {sa.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by material"
                value={filterMaterialId}
                onChange={(e) => setFilterMaterialId(e.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
              >
                <option value="">All Materials</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {marketplace.length === 0 ? (
            <EmptyState
              title="No matching eligible listings"
              description={
                ineligibilityNotes[0] ||
                'There are currently no published listings matching your verified areas and supported materials.'
              }
              actionLabel="Review Onboarding & Areas"
              onAction={() => setTab('onboarding')}
            />
          ) : (
            <div className="space-y-4">
              {marketplace.map((l) => {
                const items = (l.items as Array<Record<string, unknown>>) || [];
                const imgUrls = (l.imageUrls as string[]) || [];
                const myOffer = l.myActiveOffer as { reference_code: string; estimated_total_value: number } | null;

                return (
                  <Panel key={String(l.id)} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <MetaRow
                          items={[
                            String(l.reference_code),
                            `${String(l.service_area_name)} (${String(l.approximate_postal_zone)})`,
                            `${l.preferred_pickup_date} · ${l.preferred_pickup_window}`,
                          ]}
                        />
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">{String(l.title)}</h2>
                        <p className="text-sm text-slate-600">{String(l.description)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        {myOffer && (
                          <span className="text-xs font-mono text-emerald-700">
                            Active offer: {myOffer.reference_code} (₹{myOffer.estimated_total_value})
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => openBidForm(l)}
                          className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
                        >
                          {myOffer ? 'Update Offer' : 'Submit Itemized Offer'}
                        </button>
                      </div>
                    </div>

                    {imgUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {imgUrls.map((u, idx) => (
                          <img
                            key={idx}
                            src={getPrivateMediaUrl(u)}
                            alt="Scrap material"
                            className="w-20 h-16 object-cover rounded-lg border border-slate-200"
                          />
                        ))}
                      </div>
                    )}

                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-slate-500">
                          <th className="pb-1.5">Material</th>
                          <th className="pb-1.5">Estimated Qty</th>
                          <th className="pb-1.5">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((it) => (
                          <tr key={String(it.id)} className="h-8">
                            <td className="font-medium text-slate-900">{String(it.material_name)}</td>
                            <td className="font-mono tabular-nums">
                              {Number(it.quantity_unknown) === 1
                                ? `Unknown (${String(it.unit_code)})`
                                : `${it.estimated_quantity} ${String(it.unit_code)}`}
                            </td>
                            <td className="text-slate-500">{String(it.item_notes || '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Panel>
                );
              })}
            </div>
          )}

          {biddingListing && (
            <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-label="Submit Itemized Offer">
              <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Submit Offer for {String(biddingListing.reference_code)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setBiddingListing(null)}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Cancel
                  </button>
                </div>
                <form onSubmit={handleSubmitOffer} className="space-y-4">
                  <div className="space-y-2">
                    {((biddingListing.items as Array<Record<string, unknown>>) || []).map((it) => {
                      const iid = Number(it.id);
                      const state = bidRates[iid] || {
                        covered: true,
                        rate: '10',
                        unitId: Number(it.unit_id),
                      };
                      return (
                        <div
                          key={iid}
                          className="p-3 border border-slate-200 rounded-lg grid sm:grid-cols-12 gap-3 items-center text-xs"
                        >
                          <div className="sm:col-span-4">
                            <div className="font-semibold text-slate-900">
                              {String(it.material_name)}
                            </div>
                            <div className="text-slate-500 font-mono">
                              {Number(it.quantity_unknown) === 1
                                ? 'Weight unknown'
                                : `${it.estimated_quantity} ${String(it.unit_code)}`}
                            </div>
                          </div>
                          <label className="sm:col-span-3 flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={state.covered}
                              onChange={(e) =>
                                setBidRates((p) => ({
                                  ...p,
                                  [iid]: { ...state, covered: e.target.checked },
                                }))
                              }
                            />
                            <span>Cover item</span>
                          </label>
                          <div className="sm:col-span-3">
                            <input
                              type="number"
                              min="0.1"
                              step="0.1"
                              disabled={!state.covered}
                              value={state.rate}
                              onChange={(e) =>
                                setBidRates((p) => ({
                                  ...p,
                                  [iid]: { ...state, rate: e.target.value },
                                }))
                              }
                              placeholder="Rate (INR)"
                              className="w-full px-2.5 py-1.5 font-mono border border-slate-200 rounded"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <select
                              disabled={!state.covered}
                              value={state.unitId}
                              onChange={(e) =>
                                setBidRates((p) => ({
                                  ...p,
                                  [iid]: { ...state, unitId: Number(e.target.value) },
                                }))
                              }
                              className="w-full px-2 py-1.5 border border-slate-200 rounded bg-white"
                            >
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  /{u.code}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Pickup Date
                      </label>
                      <input
                        type="date"
                        required
                        value={bidPickupDate}
                        onChange={(e) => setBidPickupDate(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Pickup Window
                      </label>
                      <select
                        value={bidPickupWindow}
                        onChange={(e) => setBidPickupWindow(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                      >
                        <option value="09:00-12:00">09:00-12:00</option>
                        <option value="14:00-17:00">14:00-17:00</option>
                        <option value="17:00-19:30">17:00-19:30</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Offer Conditions
                    </label>
                    <input
                      type="text"
                      value={bidConditions}
                      onChange={(e) => setBidConditions(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setBiddingListing(null)}
                      className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                    >
                      Submit Itemized Offer
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'offers' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">Submitted Offers</h1>
          {offers.length === 0 ? (
            <EmptyState
              title="No submitted offers"
              description="Browse eligible open requests to submit itemized offers."
              actionLabel="Open Marketplace"
              onAction={() => setTab('marketplace')}
            />
          ) : (
            <Panel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2.5">Offer</th>
                    <th className="pb-2.5">Listing</th>
                    <th className="pb-2.5">Area</th>
                    <th className="pb-2.5">Coverage</th>
                    <th className="pb-2.5 text-right">Est. Value</th>
                    <th className="pb-2.5">Status</th>
                    <th className="pb-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {offers.map((o) => (
                    <tr key={String(o.id)} className="h-11">
                      <td className="font-mono text-xs">{String(o.reference_code)}</td>
                      <td className="text-slate-900">{String(o.listing_title)}</td>
                      <td className="text-xs text-slate-600">{String(o.service_area_name)}</td>
                      <td className="font-mono text-xs">
                        {String(o.covered_items_count)}/{String(o.total_items_count)}
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        ₹{Number(o.estimated_total_value).toFixed(2)}
                      </td>
                      <td>
                        <StatusIndicator status={String(o.status)} />
                      </td>
                      <td className="text-right">
                        {o.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/v1/buyer/offers/${o.id}/withdraw`, {
                                method: 'POST',
                              });
                              await loadAll();
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Withdraw
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}

      {tab === 'bookings' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Accepted Bookings & Collector Assignment
          </h1>
          {bookings.length === 0 ? (
            <EmptyState
              title="No confirmed bookings yet"
              description="When a seller accepts one of your offers, the confirmed pickup and exact address appear here."
            />
          ) : (
            <div className="space-y-4">
              {bookings.map((b) => (
                <Panel key={String(b.id)} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <MetaRow
                        items={[
                          String(b.booking_reference),
                          `${b.pickup_date} · ${b.pickup_window}`,
                          String(b.service_area_name),
                        ]}
                      />
                      <h2 className="mt-1 text-lg font-semibold text-slate-900">
                        {String(b.listing_title)}
                      </h2>
                      <p className="text-xs text-slate-600">
                        Seller: {String(b.seller_name)} ({String(b.seller_phone || 'No phone')}) · Exact Address:{' '}
                        {String(b.street_line)}, {String(b.postal_code)}
                      </p>
                    </div>
                    <StatusIndicator status={String(b.status)} />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 text-xs">
                    <div>
                      <strong>Assigned Collector:</strong>{' '}
                      {b.collector_name
                        ? `${String(b.collector_name)} (${String(b.vehicle_number)})`
                        : 'Unassigned'}
                    </div>
                    {collectors.length > 0 && b.status !== 'COMPLETED' && (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label="Assign collector"
                          defaultValue={String(b.collector_user_id || '')}
                          onChange={async (e) => {
                            if (!e.target.value) return;
                            await apiFetch(`/api/v1/buyer/bookings/${b.id}/assign-collector`, {
                              method: 'POST',
                              body: { collectorUserId: Number(e.target.value) },
                            });
                            setBanner({ type: 'success', text: 'Collector assignment updated.' });
                            await loadAll();
                          }}
                          className="px-2.5 py-1.5 border border-slate-200 rounded-lg bg-white"
                        >
                          <option value="">Assign collector...</option>
                          {collectors.map((c) => (
                            <option key={String(c.id)} value={String(c.id)}>
                              {String(c.full_name)} ({String(c.vehicle_number)})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'collectors' && (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <Panel>
              <h2 className="text-base font-semibold text-slate-900 mb-4">
                Create Collector Account
              </h2>
              <form onSubmit={handleCreateCollector} className="space-y-3">
                <input
                  type="text"
                  required
                  placeholder="Collector Full Name"
                  value={colName}
                  onChange={(e) => setColName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="email"
                  required
                  placeholder="Collector Email"
                  value={colEmail}
                  onChange={(e) => setColEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="tel"
                  placeholder="Phone Number"
                  value={colPhone}
                  onChange={(e) => setColPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Vehicle Number (e.g., DL-1L-AB-4412)"
                  value={colVehicle}
                  onChange={(e) => setColVehicle(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="Password (min 8 chars)"
                  value={colPass}
                  onChange={(e) => setColPass(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <button
                  type="submit"
                  className="w-full py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  Register Collector
                </button>
              </form>
            </Panel>
          </div>
          <div className="lg:col-span-7">
            <Panel>
              <h2 className="text-base font-semibold text-slate-900 mb-4">My Field Collectors</h2>
              {collectors.length === 0 ? (
                <div className="text-xs text-slate-500">No collectors registered yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {collectors.map((c) => (
                    <div key={String(c.id)} className="py-3 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-semibold text-slate-900">{String(c.full_name)}</div>
                        <div className="text-slate-500">
                          {String(c.email)} · {String(c.vehicle_number)} ({String(c.vehicle_type)})
                        </div>
                      </div>
                      <StatusIndicator status={String(c.account_status)} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Disclosed Platform Service-Fee Ledger
          </h1>
          {ledger.length === 0 ? (
            <EmptyState
              title="No fee entries yet"
              description="Coordination fees are assessed only upon successfully completed pickups."
            />
          ) : (
            <Panel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2">Booking Ref</th>
                    <th className="pb-2">Rule Applied</th>
                    <th className="pb-2 text-right">Gross Settlement</th>
                    <th className="pb-2 text-right">Fee Amount</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ledger.map((row) => (
                    <tr key={String(row.id)} className="h-11">
                      <td className="font-mono text-xs">{String(row.transaction_reference)}</td>
                      <td className="text-xs text-slate-700">{String(row.rule_name)}</td>
                      <td className="text-right font-mono tabular-nums">
                        ₹{Number(row.gross_transaction_amount).toFixed(2)}
                      </td>
                      <td className="text-right font-mono tabular-nums font-semibold">
                        ₹{Number(row.fee_amount).toFixed(2)}
                      </td>
                      <td>
                        <StatusIndicator status={String(row.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}

      {tab === 'onboarding' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel>
            <h2 className="text-base font-semibold text-slate-900 mb-4">
              Service Areas, Materials & Capacity
            </h2>
            <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
              <div>
                <div className="font-medium text-slate-700 mb-2">Service Areas</div>
                <div className="grid grid-cols-2 gap-2">
                  {serviceAreas.map((sa) => (
                    <label key={sa.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAreas.includes(sa.id)}
                        onChange={(e) =>
                          setSelectedAreas((p) =>
                            e.target.checked ? [...p, sa.id] : p.filter((x) => x !== sa.id)
                          )
                        }
                      />
                      <span>{sa.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="font-medium text-slate-700 mb-2">Supported Material Categories</div>
                <div className="grid grid-cols-2 gap-2">
                  {materials.map((m) => (
                    <label key={m.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedMaterials.includes(m.id)}
                        onChange={(e) =>
                          setSelectedMaterials((p) =>
                            e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)
                          )
                        }
                      />
                      <span>{m.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max Weight Capacity (kg)
                  </label>
                  <input
                    type="number"
                    value={maxWeightKg}
                    onChange={(e) => setMaxWeightKg(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max Daily Pickups
                  </label>
                  <input
                    type="number"
                    value={maxDailyPickups}
                    onChange={(e) => setMaxDailyPickups(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAvailable}
                  onChange={(e) => setIsAvailable(e.target.checked)}
                />
                <span>Available to receive new eligible requests</span>
              </label>

              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
              >
                Save Capabilities
              </button>
            </form>
          </Panel>

          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Dealer Verification Status</h2>
              <StatusIndicator status={String(profile?.verification_status || 'PENDING')} />
            </div>
            <form onSubmit={handleSubmitDoc} className="space-y-3 text-xs">
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-white"
              >
                <option value="Trade License">Trade License</option>
                <option value="GST Registration">GST Registration</option>
                <option value="Municipal Scrap Permit">Municipal Scrap Permit</option>
              </select>
              <input
                type="text"
                required
                placeholder="Document Reference Number"
                value={docRef}
                onChange={(e) => setDocRef(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"
              >
                Submit Verification Document
              </button>
            </form>
            <div className="pt-2 border-t border-slate-100 space-y-2">
              {docs.map((d) => (
                <div key={String(d.id)} className="flex items-center justify-between text-xs">
                  <span>
                    {String(d.doc_type)} · <span className="font-mono">{String(d.doc_reference)}</span>
                  </span>
                  <StatusIndicator status={String(d.review_status)} />
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}
