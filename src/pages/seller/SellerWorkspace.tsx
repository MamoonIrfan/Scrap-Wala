import React, { useCallback, useEffect, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  Home,
  MessageSquareWarning,
  PlusCircle,
  Sparkles,
  Tag,
  Truck,
  UserCheck,
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

type SellerTab =
  | 'overview'
  | 'create'
  | 'listings'
  | 'bookings'
  | 'receipts'
  | 'complaints'
  | 'profile';

interface Address {
  id: number;
  service_area_id: number;
  service_area_name: string;
  city: string;
  label: string;
  street_line: string;
  landmark: string | null;
  postal_code: string;
  is_default: number;
}

interface ListingItemDraft {
  materialId: number;
  unitId: number;
  estimatedQuantity: string;
  quantityUnknown: boolean;
  itemNotes: string;
  aiSuggestedCategory?: string;
  aiConfidence?: number;
}

export function SellerWorkspace({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { user, materials, units, serviceAreas, refreshUser } = useAuth();
  const [tab, setTab] = useState<SellerTab>('overview');
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  // Dashboard & data states
  const [metrics, setMetrics] = useState({
    activeListings: 0,
    receivedOffers: 0,
    upcomingPickups: 0,
    completedTransactions: 0,
    totalReceivedAmount: 0,
  });
  const [recentBookings, setRecentBookings] = useState<Array<Record<string, unknown>>>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [listings, setListings] = useState<Array<Record<string, unknown>>>([]);
  const [bookings, setBookings] = useState<Array<Record<string, unknown>>>([]);
  const [receipts, setReceipts] = useState<Array<Record<string, unknown>>>([]);
  const [complaints, setComplaints] = useState<Array<Record<string, unknown>>>([]);

  // Offer comparison modal/panel state
  const [selectedListingForOffers, setSelectedListingForOffers] = useState<number | null>(null);
  const [offersData, setOffersData] = useState<{
    listing: Record<string, unknown> | null;
    offers: Array<Record<string, unknown>>;
  }>({ listing: null, offers: [] });

  // Create Listing form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [addressId, setAddressId] = useState<number>(0);
  const [pickupDate, setPickupDate] = useState('2026-11-22');
  const [pickupWindow, setPickupWindow] = useState('09:00-12:00');
  const [items, setItems] = useState<ListingItemDraft[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<
    Array<{
      id: number;
      url: string;
      originalName: string;
      prediction?: {
        predictedCategory: string;
        confidence: number;
        lowConfidence: boolean;
        adapterMode: string;
        notes: string;
      };
    }>
  >([]);
  const [aiSuggestion, setAiSuggestion] = useState<{
    suggestedTitle: string;
    suggestedDescription: string;
    suggestedCategory: string;
    clarificationQuestions: string[];
    suggestedTags: string[];
    adapterMode: string;
  } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  // Address form
  const [newAddrArea, setNewAddrArea] = useState<number>(0);
  const [newAddrLabel, setNewAddrLabel] = useState('');
  const [newAddrStreet, setNewAddrStreet] = useState('');
  const [newAddrPostal, setNewAddrPostal] = useState('');

  // OTP verification
  const [otpPhone, setOtpPhone] = useState(user?.phone || '');
  const [otpCode, setOtpCode] = useState('');
  const [otpInfo, setOtpInfo] = useState<string | null>(null);

  // Complaint form
  const [cmpBookingId, setCmpBookingId] = useState('');
  const [cmpCategory, setCmpCategory] = useState('WEIGHT_DISCREPANCY');
  const [cmpDesc, setCmpDesc] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, addrRes, listRes, bkgRes, rcpRes, cmpRes] = await Promise.all([
        apiFetch<{
          metrics: typeof metrics;
          recentBookings: Array<Record<string, unknown>>;
        }>('/api/v1/seller/dashboard'),
        apiFetch<{ addresses: Address[] }>('/api/v1/seller/addresses'),
        apiFetch<{ listings: Array<Record<string, unknown>> }>('/api/v1/seller/listings'),
        apiFetch<{ bookings: Array<Record<string, unknown>> }>('/api/v1/seller/bookings'),
        apiFetch<{ receipts: Array<Record<string, unknown>> }>('/api/v1/seller/receipts'),
        apiFetch<{ complaints: Array<Record<string, unknown>> }>('/api/v1/seller/complaints'),
      ]);
      setMetrics(dash.metrics);
      setRecentBookings(dash.recentBookings || []);
      setAddresses(addrRes.addresses || []);
      if (addrRes.addresses?.length && !addressId) {
        setAddressId(addrRes.addresses[0].id);
      }
      setListings(listRes.listings || []);
      setBookings(bkgRes.bookings || []);
      setReceipts(rcpRes.receipts || []);
      setComplaints(cmpRes.complaints || []);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load seller workspace.',
      });
    } finally {
      setLoading(false);
    }
  }, [addressId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (materials.length > 0 && units.length > 0 && items.length === 0) {
      setItems([
        {
          materialId: materials[0].id,
          unitId: materials[0].default_unit_id || units[0].id,
          estimatedQuantity: '10',
          quantityUnknown: false,
          itemNotes: '',
        },
      ]);
    }
    if (serviceAreas.length > 0 && newAddrArea === 0) {
      setNewAddrArea(serviceAreas[0].id);
    }
  }, [materials, units, serviceAreas, items.length, newAddrArea]);

  const handlePhotoUploadAndClassify = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBanner(null);
    setAiBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope', 'LISTING_IMAGE');
      const uploaded = await apiFetch<{ id: number; url: string; originalName: string }>(
        '/api/v1/media/upload',
        { method: 'POST', formData: fd }
      );

      const classifyFd = new FormData();
      classifyFd.append('image', file);
      classifyFd.append('hint', description);
      const prediction = await apiFetch<{
        predictedCategory: string;
        confidence: number;
        lowConfidence: boolean;
        adapterMode: string;
        notes: string;
      }>('/api/v1/ai/classify-image', { method: 'POST', formData: classifyFd });

      setUploadedMedia((prev) => [...prev, { ...uploaded, prediction }]);

      // Pre-fill first item category if matched (always remains editable by seller)
      const matchedMat = materials.find(
        (m) => m.name.toLowerCase() === prediction.predictedCategory.toLowerCase()
      );
      if (matchedMat && items.length > 0) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === 0
              ? {
                  ...it,
                  materialId: matchedMat.id,
                  aiSuggestedCategory: prediction.predictedCategory,
                  aiConfidence: prediction.confidence,
                }
              : it
          )
        );
      }
      setBanner({
        type: 'success',
        text: `Image uploaded. AI suggested "${prediction.predictedCategory}" (${Math.round(
          prediction.confidence * 100
        )}% confidence via ${prediction.adapterMode}). Review and edit before publishing.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Image upload or classification failed.',
      });
    } finally {
      setAiBusy(false);
    }
  };

  const handleRunListingAssist = async () => {
    setAiBusy(true);
    setBanner(null);
    try {
      const selectedCats = items
        .map((i) => materials.find((m) => m.id === i.materialId)?.name || '')
        .filter(Boolean);
      const imgPreds = uploadedMedia
        .map((m) => m.prediction?.predictedCategory || '')
        .filter(Boolean);
      const res = await apiFetch<NonNullable<typeof aiSuggestion>>('/api/v1/ai/listing-assist', {
        method: 'POST',
        body: {
          description,
          selectedCategories: selectedCats,
          imagePredictions: imgPreds,
        },
      });
      setAiSuggestion(res);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'AI listing assistant failed.',
      });
    } finally {
      setAiBusy(false);
    }
  };

  const handleCreateListing = async (targetStatus: 'DRAFT' | 'PUBLISHED') => {
    setBanner(null);
    try {
      const res = await apiFetch<{ referenceCode: string; status: string }>('/api/v1/seller/listings', {
        method: 'POST',
        body: {
          addressId,
          title,
          description,
          preferredPickupDate: pickupDate,
          preferredPickupWindow: pickupWindow,
          status: targetStatus,
          aiAssisted: Boolean(aiSuggestion || uploadedMedia.some((u) => u.prediction)),
          aiTags: aiSuggestion?.suggestedTags || [],
          mediaFileIds: uploadedMedia.map((u) => u.id),
          items: items.map((i) => ({
            materialId: i.materialId,
            unitId: i.unitId,
            estimatedQuantity: i.quantityUnknown ? null : Number(i.estimatedQuantity),
            quantityUnknown: i.quantityUnknown,
            itemNotes: i.itemNotes,
            aiSuggestedCategory: i.aiSuggestedCategory,
            aiConfidence: i.aiConfidence,
          })),
        },
      });
      setBanner({
        type: 'success',
        text: `Listing ${res.referenceCode} saved as ${res.status}.`,
      });
      setTitle('');
      setDescription('');
      setUploadedMedia([]);
      setAiSuggestion(null);
      await loadAll();
      setTab('listings');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save listing.',
      });
    }
  };

  const openOfferComparison = async (listingId: number) => {
    setSelectedListingForOffers(listingId);
    try {
      const res = await apiFetch<{
        listing: Record<string, unknown>;
        offers: Array<Record<string, unknown>>;
      }>(`/api/v1/seller/listings/${listingId}/offers`);
      setOffersData(res);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load offers.',
      });
    }
  };

  const handleAcceptOffer = async (offerId: number) => {
    setBanner(null);
    try {
      const res = await apiFetch<{ booking: { booking_reference: string } }>(
        `/api/v1/seller/offers/${offerId}/accept`,
        {
          method: 'POST',
          body: { idempotencyKey: `ui-accept-${offerId}-${Date.now()}` },
        }
      );
      setBanner({
        type: 'success',
        text: `Offer accepted! Booking ${res.booking.booking_reference} confirmed and exact pickup details shared with the assigned dealer.`,
      });
      setSelectedListingForOffers(null);
      await loadAll();
      setTab('bookings');
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to accept offer.',
      });
    }
  };

  const handleDecideRevision = async (revisionId: number, decision: 'APPROVED' | 'REJECTED') => {
    setBanner(null);
    try {
      await apiFetch(`/api/v1/seller/settlement-revisions/${revisionId}/decide`, {
        method: 'POST',
        body: { decision, notes: `Seller ${decision.toLowerCase()} in dashboard` },
      });
      setBanner({ type: 'success', text: `Settlement revision ${decision.toLowerCase()}.` });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to record settlement decision.',
      });
    }
  };

  const handleAckPayment = async (bookingId: number, disputed = false) => {
    setBanner(null);
    try {
      const res = await apiFetch<{ completed?: boolean; receiptNumber?: string }>(
        `/api/v1/seller/bookings/${bookingId}/acknowledge-payment`,
        { method: 'POST', body: { disputed } }
      );
      setBanner({
        type: 'success',
        text: res.completed
          ? `Payment acknowledged and transaction completed! Receipt ${res.receiptNumber} issued.`
          : disputed
          ? 'Payment marked as disputed.'
          : 'Payment acknowledged.',
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to acknowledge payment.',
      });
    }
  };

  const handleAckHandover = async (bookingId: number) => {
    setBanner(null);
    try {
      const res = await apiFetch<{ completed?: boolean; receiptNumber?: string }>(
        `/api/v1/seller/bookings/${bookingId}/acknowledge-handover`,
        { method: 'POST', body: {} }
      );
      setBanner({
        type: 'success',
        text: res.completed
          ? `Handover confirmed and transaction completed! Receipt ${res.receiptNumber} generated.`
          : 'Material handover acknowledged.',
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to confirm handover.',
      });
    }
  };

  const handleRateBooking = async (bookingId: number, score: number) => {
    setBanner(null);
    try {
      await apiFetch(`/api/v1/seller/bookings/${bookingId}/rate`, {
        method: 'POST',
        body: { score, comment: 'Rated via Seller Workspace' },
      });
      setBanner({ type: 'success', text: 'Rating saved.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to submit rating.',
      });
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      await apiFetch('/api/v1/seller/addresses', {
        method: 'POST',
        body: {
          serviceAreaId: newAddrArea,
          label: newAddrLabel,
          streetLine: newAddrStreet,
          postalCode: newAddrPostal,
          isDefault: addresses.length === 0,
        },
      });
      setNewAddrLabel('');
      setNewAddrStreet('');
      setNewAddrPostal('');
      setBanner({ type: 'success', text: 'Pickup address added.' });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add address.',
      });
    }
  };

  const handleRequestOtp = async () => {
    setBanner(null);
    try {
      const res = await apiFetch<{ limitationNote: string; devVerificationCode?: string }>(
        '/api/v1/auth/phone-otp/request',
        { method: 'POST', body: { phone: otpPhone } }
      );
      setOtpInfo(
        `${res.limitationNote}${
          res.devVerificationCode ? ` Dev OTP code: ${res.devVerificationCode}` : ''
        }`
      );
      if (res.devVerificationCode) setOtpCode(res.devVerificationCode);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'OTP request failed.',
      });
    }
  };

  const handleVerifyOtp = async () => {
    setBanner(null);
    try {
      await apiFetch('/api/v1/auth/phone-otp/verify', {
        method: 'POST',
        body: { phone: otpPhone, code: otpCode },
      });
      setOtpInfo(null);
      setBanner({ type: 'success', text: 'Phone number verified.' });
      await refreshUser();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'OTP verification failed.',
      });
    }
  };

  const handleRaiseComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    try {
      const res = await apiFetch<{ referenceCode: string }>('/api/v1/seller/complaints', {
        method: 'POST',
        body: {
          bookingId: cmpBookingId ? Number(cmpBookingId) : null,
          category: cmpCategory,
          description: cmpDesc,
        },
      });
      setCmpDesc('');
      setBanner({ type: 'success', text: `Complaint ${res.referenceCode} submitted.` });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not submit complaint.',
      });
    }
  };

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <Home className="w-4 h-4" /> },
    { id: 'create', label: 'Create Listing', icon: <PlusCircle className="w-4 h-4" /> },
    { id: 'listings', label: 'My Listings & Offers', icon: <Tag className="w-4 h-4" /> },
    { id: 'bookings', label: 'Pickups & Settlements', icon: <Truck className="w-4 h-4" /> },
    { id: 'receipts', label: 'Digital Receipts', icon: <FileText className="w-4 h-4" /> },
    { id: 'complaints', label: 'Complaints', icon: <MessageSquareWarning className="w-4 h-4" /> },
    { id: 'profile', label: 'Profile & Addresses', icon: <UserCheck className="w-4 h-4" /> },
  ];

  const guidanceTopicMap: Record<SellerTab, string> = {
    overview: 'listing',
    create: 'listing',
    listings: 'offers',
    bookings: 'settlement',
    receipts: 'receipts',
    complaints: 'receipts',
    profile: 'listing',
  };

  return (
    <DashboardShell
      roleTitle="Seller"
      breadcrumb={navItems.find((n) => n.id === tab)?.label || 'Overview'}
      navItems={navItems}
      activeTab={tab}
      onSelectTab={(id) => setTab(id as SellerTab)}
      guidanceTopic={guidanceTopicMap[tab]}
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
                Seller Workspace
              </h1>
              <p className="text-sm text-slate-600">
                Manage scrap pickup requests, compare buyer offers, and verify settlements.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTab('create')}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
            >
              New Scrap Listing
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricBlock label="Active Listings" value={metrics.activeListings} />
            <MetricBlock label="Active Offers" value={metrics.receivedOffers} />
            <MetricBlock label="Upcoming Pickups" value={metrics.upcomingPickups} />
            <MetricBlock label="Completed" value={metrics.completedTransactions} />
            <MetricBlock
              label="Total Settled"
              value={`₹${metrics.totalReceivedAmount.toFixed(2)}`}
            />
          </div>

          <Panel>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-slate-900">Recent Pickups & Settlements</h2>
              <button
                type="button"
                onClick={() => setTab('bookings')}
                className="text-xs font-medium text-teal-700 hover:underline"
              >
                View all bookings
              </button>
            </div>
            {loading ? (
              <div className="text-sm text-slate-500">Loading activity...</div>
            ) : recentBookings.length === 0 ? (
              <EmptyState
                title="No pickup bookings yet"
                description="Create and publish a listing to receive itemized offers from verified local buyers."
                actionLabel="Create Listing"
                onAction={() => setTab('create')}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="pb-2.5 font-medium">Reference</th>
                      <th className="pb-2.5 font-medium">Buyer</th>
                      <th className="pb-2.5 font-medium">Pickup Slot</th>
                      <th className="pb-2.5 font-medium">Status</th>
                      <th className="pb-2.5 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentBookings.map((b) => (
                      <tr key={String(b.id)} className="h-11">
                        <td className="font-mono text-xs font-medium text-slate-900">
                          {String(b.booking_reference)}
                        </td>
                        <td className="text-slate-700">{String(b.buyer_business_name)}</td>
                        <td className="text-xs text-slate-600 font-mono tabular-nums">
                          {String(b.pickup_date)} · {String(b.pickup_window)}
                        </td>
                        <td>
                          <StatusIndicator status={String(b.status)} />
                        </td>
                        <td className="text-right font-mono tabular-nums text-slate-900">
                          ₹
                          {Number(
                            b.final_settlement_amount ?? b.estimated_total_amount ?? 0
                          ).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === 'create' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">
              Create Scrap Pickup Request
            </h1>
            <p className="text-sm text-slate-600">
              Upload photos for optional AI material classification, review suggestions, and enter material estimates.
            </p>
          </div>

          {addresses.length === 0 ? (
            <EmptyState
              title="Add a Pickup Address First"
              description="You need at least one saved pickup address in an active service area before publishing a scrap request."
              actionLabel="Go to Addresses"
              onAction={() => setTab('profile')}
            />
          ) : (
            <div className="grid lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-6">
                <Panel className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-slate-900">
                      01. Material Photographs & AI Classification
                    </h2>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg cursor-pointer">
                      <Camera className="w-4 h-4" aria-hidden="true" />
                      <span>{aiBusy ? 'Analyzing...' : 'Upload & Classify Photo'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handlePhotoUploadAndClassify}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {uploadedMedia.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-3">
                      {uploadedMedia.map((m) => (
                        <div
                          key={m.id}
                          className="p-3 border border-slate-200 rounded-lg flex gap-3 items-start"
                        >
                          <img
                            src={getPrivateMediaUrl(m.url)}
                            alt={m.originalName}
                            className="w-16 h-16 object-cover rounded border border-slate-200 shrink-0"
                          />
                          <div className="text-xs space-y-1 min-w-0">
                            <div className="font-medium text-slate-900 truncate">
                              {m.originalName}
                            </div>
                            {m.prediction && (
                              <>
                                <div className="text-teal-700 font-medium">
                                  Suggested: {m.prediction.predictedCategory} (
                                  {Math.round(m.prediction.confidence * 100)}%)
                                </div>
                                <div className="text-slate-500">
                                  {m.prediction.adapterMode}
                                  {m.prediction.lowConfidence
                                    ? ' · Low confidence — verify manually'
                                    : ''}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-base font-semibold text-slate-900">
                        02. Request Details
                      </h2>
                      <button
                        type="button"
                        disabled={aiBusy}
                        onClick={handleRunListingAssist}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-teal-700" aria-hidden="true" />
                        <span>Suggest Title & Tags</span>
                      </button>
                    </div>

                    <div>
                      <label htmlFor="lst-title" className="block text-xs font-medium text-slate-700 mb-1">
                        Listing Title
                      </label>
                      <input
                        id="lst-title"
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g., Sorted Home Cardboard & Newspapers"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>

                    <div>
                      <label htmlFor="lst-desc" className="block text-xs font-medium text-slate-700 mb-1">
                        Material Description & Condition
                      </label>
                      <textarea
                        id="lst-desc"
                        rows={3}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe cleanliness, bundling, moisture status, or access instructions..."
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                      />
                    </div>

                    {aiSuggestion && (
                      <div className="p-4 rounded-lg bg-teal-50/60 border border-teal-200 space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-teal-900">
                            AI Listing Suggestion ({aiSuggestion.adapterMode})
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setTitle(aiSuggestion.suggestedTitle);
                              setDescription(aiSuggestion.suggestedDescription);
                            }}
                            className="px-2.5 py-1 bg-teal-700 text-white rounded font-medium"
                          >
                            Apply to Draft (Editable)
                          </button>
                        </div>
                        <div>
                          <strong>Suggested Title:</strong> {aiSuggestion.suggestedTitle}
                        </div>
                        <div>
                          <strong>Suggested Description:</strong> {aiSuggestion.suggestedDescription}
                        </div>
                        <div>
                          <strong>Clarifications to check:</strong>{' '}
                          {aiSuggestion.clarificationQuestions.join(' · ')}
                        </div>
                      </div>
                    )}
                  </div>
                </Panel>

                <Panel className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-900">
                      03. Material Items & Quantities
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        setItems((prev) => [
                          ...prev,
                          {
                            materialId: materials[0]?.id || 1,
                            unitId: units[0]?.id || 1,
                            estimatedQuantity: '5',
                            quantityUnknown: false,
                            itemNotes: '',
                          },
                        ])
                      }
                      className="text-xs font-semibold text-teal-700 hover:underline"
                    >
                      + Add Material Item
                    </button>
                  </div>

                  <div className="space-y-3">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-4 border border-slate-200 rounded-lg grid sm:grid-cols-12 gap-3 items-end"
                      >
                        <div className="sm:col-span-3">
                          <label className="block text-xs text-slate-600 mb-1">Material</label>
                          <select
                            value={item.materialId}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, materialId: Number(e.target.value) } : it
                                )
                              )
                            }
                            className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                          >
                            {materials.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-2">
                          <label className="block text-xs text-slate-600 mb-1">Unit</label>
                          <select
                            value={item.unitId}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, unitId: Number(e.target.value) } : it
                                )
                              )
                            }
                            className="w-full px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                          >
                            {units.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.code}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="sm:col-span-3">
                          <label className="block text-xs text-slate-600 mb-1">Est. Qty</label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            disabled={item.quantityUnknown}
                            value={item.quantityUnknown ? '' : item.estimatedQuantity}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, estimatedQuantity: e.target.value } : it
                                )
                              )
                            }
                            className="w-full px-2.5 py-2 text-xs font-mono border border-slate-200 rounded-lg disabled:bg-slate-100"
                          />
                        </div>

                        <div className="sm:col-span-3 flex items-center gap-2 pb-2">
                          <input
                            id={`unk-${idx}`}
                            type="checkbox"
                            checked={item.quantityUnknown}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((it, i) =>
                                  i === idx ? { ...it, quantityUnknown: e.target.checked } : it
                                )
                              )
                            }
                          />
                          <label htmlFor={`unk-${idx}`} className="text-xs text-slate-700">
                            Weight Unknown
                          </label>
                        </div>

                        <div className="sm:col-span-1 text-right pb-2">
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() =>
                                setItems((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-xs text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>

              <div className="lg:col-span-4 space-y-6">
                <Panel className="space-y-4">
                  <h2 className="text-base font-semibold text-slate-900">04. Pickup Schedule & Privacy</h2>
                  <div>
                    <label htmlFor="lst-addr" className="block text-xs font-medium text-slate-700 mb-1">
                      Pickup Address
                    </label>
                    <select
                      id="lst-addr"
                      value={addressId}
                      onChange={(e) => setAddressId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      {addresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} ({a.service_area_name})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="lst-date" className="block text-xs font-medium text-slate-700 mb-1">
                      Preferred Date
                    </label>
                    <input
                      id="lst-date"
                      type="date"
                      value={pickupDate}
                      onChange={(e) => setPickupDate(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label htmlFor="lst-window" className="block text-xs font-medium text-slate-700 mb-1">
                      Pickup Window
                    </label>
                    <select
                      id="lst-window"
                      value={pickupWindow}
                      onChange={(e) => setPickupWindow(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="09:00-12:00">09:00 – 12:00 (Morning)</option>
                      <option value="12:00-15:00">12:00 – 15:00 (Midday)</option>
                      <option value="14:00-17:00">14:00 – 17:00 (Afternoon)</option>
                      <option value="17:00-19:30">17:00 – 19:30 (Evening)</option>
                    </select>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    Before you accept an offer, buyers see only your service area and approximate postal prefix.
                  </p>

                  <div className="pt-2 space-y-2">
                    <button
                      type="button"
                      onClick={() => handleCreateListing('PUBLISHED')}
                      className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                    >
                      Publish Request
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCreateListing('DRAFT')}
                      className="w-full py-2 px-4 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                    >
                      Save as Draft
                    </button>
                  </div>
                </Panel>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'listings' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-display font-bold text-slate-900">
              My Scrap Listings & Offer Comparison
            </h1>
            <button
              type="button"
              onClick={() => setTab('create')}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Create Request
            </button>
          </div>

          {listings.length === 0 ? (
            <EmptyState
              title="No scrap listings created yet"
              description="Publish a request to receive itemized quotes from verified dealers."
              actionLabel="Create Listing"
              onAction={() => setTab('create')}
            />
          ) : (
            <div className="space-y-4">
              {listings.map((l) => {
                const lid = Number(l.id);
                const lItems = (l.items as Array<Record<string, unknown>>) || [];
                const lImages = (l.images as Array<{ id: number; url: string; original_name: string }>) || [];
                const activeOffersCount = Number(l.active_offers_count || 0);

                return (
                  <Panel key={lid} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1">
                        <MetaRow
                          items={[
                            String(l.reference_code),
                            String(l.service_area_name),
                            `${l.preferred_pickup_date} · ${l.preferred_pickup_window}`,
                          ]}
                        />
                        <h2 className="text-lg font-semibold text-slate-900">{String(l.title)}</h2>
                        <p className="text-sm text-slate-600">{String(l.description)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusIndicator status={String(l.status)} />
                        {l.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/v1/seller/listings/${lid}/publish`, { method: 'POST' });
                              await loadAll();
                            }}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                          >
                            Publish
                          </button>
                        )}
                        {l.status === 'PUBLISHED' && (
                          <button
                            type="button"
                            onClick={() => openOfferComparison(lid)}
                            className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg whitespace-nowrap"
                          >
                            Compare Offers ({activeOffersCount})
                          </button>
                        )}
                      </div>
                    </div>

                    {lImages.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {lImages.map((img) => (
                          <img
                            key={img.id}
                            src={getPrivateMediaUrl(img.url)}
                            alt={img.original_name}
                            className="w-20 h-16 object-cover rounded-lg border border-slate-200"
                          />
                        ))}
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-100 text-left text-slate-500">
                            <th className="pb-2">Material</th>
                            <th className="pb-2">Estimated Quantity</th>
                            <th className="pb-2">Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lItems.map((it) => (
                            <tr key={String(it.id)} className="h-9">
                              <td className="font-medium text-slate-900">{String(it.material_name)}</td>
                              <td className="font-mono tabular-nums text-slate-700">
                                {Number(it.quantity_unknown) === 1
                                  ? `Unknown (${String(it.unit_code)})`
                                  : `${it.estimated_quantity} ${String(it.unit_code)}`}
                              </td>
                              <td className="text-slate-500">{String(it.item_notes || '—')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {selectedListingForOffers === lid && (
                      <div className="pt-4 border-t border-slate-200 space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Itemized Offer Comparison (Deterministic Baseline Ranking)
                          </h3>
                          <button
                            type="button"
                            onClick={() => setSelectedListingForOffers(null)}
                            className="text-xs text-slate-500 hover:text-slate-900"
                          >
                            Close comparison
                          </button>
                        </div>

                        {offersData.offers.length === 0 ? (
                          <div className="text-xs text-slate-500">
                            No active buyer offers received yet for this listing.
                          </div>
                        ) : (
                          <div className="grid md:grid-cols-2 gap-4">
                            {offersData.offers.map((offer) => {
                              const rk = offer.ranking as {
                                rank: number;
                                isFullCoverage: boolean;
                                compositeScore: number;
                                comparisonNote: string;
                                reliabilityBasis: string;
                                breakdown: {
                                  coverageScore: number;
                                  payoutScore: number;
                                  timingScore: number;
                                  reliabilityScore: number;
                                };
                              };
                              const oItems = (offer.items as Array<Record<string, unknown>>) || [];

                              return (
                                <div
                                  key={String(offer.id)}
                                  className="p-4 border border-slate-200 rounded-xl bg-[#F8FAF9] space-y-3"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <MetaRow
                                        items={[
                                          `Rank #${rk.rank}`,
                                          `Score ${rk.compositeScore}/100`,
                                          String(offer.reference_code),
                                        ]}
                                      />
                                      <h4 className="mt-1 text-base font-semibold text-slate-900">
                                        {String(offer.business_name)}
                                      </h4>
                                    </div>
                                    <div className="text-right">
                                      <div className="text-xs text-slate-500">Estimated Total</div>
                                      <div className="text-lg font-bold font-mono tabular-nums text-teal-800">
                                        ₹{Number(offer.estimated_total_value).toFixed(2)}
                                      </div>
                                    </div>
                                  </div>

                                  <div
                                    className={`text-xs font-medium ${
                                      rk.isFullCoverage ? 'text-emerald-700' : 'text-amber-700'
                                    }`}
                                  >
                                    {rk.comparisonNote}
                                  </div>

                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 text-left text-slate-500">
                                        <th className="pb-1">Material</th>
                                        <th className="pb-1 text-right">Rate</th>
                                        <th className="pb-1 text-right">Est.</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200/70">
                                      {oItems.map((oi) => (
                                        <tr key={String(oi.id)} className="h-8">
                                          <td className="text-slate-800">{String(oi.material_name)}</td>
                                          <td className="text-right font-mono tabular-nums">
                                            {Number(oi.is_covered) === 1
                                              ? `₹${Number(oi.unit_rate).toFixed(2)}/${String(oi.offer_unit_code)}`
                                              : 'Not covered'}
                                          </td>
                                          <td className="text-right font-mono tabular-nums">
                                            {Number(oi.is_covered) === 1
                                              ? `₹${Number(oi.estimated_amount).toFixed(2)}`
                                              : '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>

                                  <div className="text-[11px] text-slate-600 space-y-1">
                                    <div>
                                      <strong>Pickup:</strong> {String(offer.proposed_pickup_date)} ({String(offer.proposed_pickup_window)})
                                    </div>
                                    <div>
                                      <strong>Reliability:</strong> {rk.reliabilityBasis}
                                    </div>
                                    <div>
                                      <strong>Ranking breakdown:</strong> Coverage {rk.breakdown.coverageScore} + Payout {rk.breakdown.payoutScore} + Timing {rk.breakdown.timingScore} + Reliability {rk.breakdown.reliabilityScore}
                                    </div>
                                    {Boolean(offer.conditions_text) && (
                                      <div>
                                        <strong>Conditions:</strong> {String(offer.conditions_text)}
                                      </div>
                                    )}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleAcceptOffer(Number(offer.id))}
                                    className="w-full py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                                  >
                                    Accept Offer & Confirm Pickup
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'bookings' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Pickups, Actual Weights & Settlement Approvals
          </h1>

          {bookings.length === 0 ? (
            <EmptyState
              title="No active or past bookings"
              description="Accept a buyer offer on one of your published listings to schedule a doorstep pickup."
              actionLabel="View My Listings"
              onAction={() => setTab('listings')}
            />
          ) : (
            <div className="space-y-5">
              {bookings.map((b) => {
                const bid = Number(b.id);
                const colItems = (b.collectionItems as Array<Record<string, unknown>>) || [];
                const revs = (b.settlementRevisions as Array<Record<string, unknown>>) || [];
                const pendingRev = revs.find((r) => r.status === 'PENDING_SELLER');

                return (
                  <Panel key={bid} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <MetaRow
                          items={[
                            String(b.booking_reference),
                            String(b.buyer_business_name),
                            `${b.pickup_date} · ${b.pickup_window}`,
                          ]}
                        />
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">
                          {String(b.listing_title)}
                        </h2>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Address: {String(b.street_line)} ({String(b.service_area_name)})
                        </p>
                      </div>
                      <StatusIndicator status={String(b.status)} />
                    </div>

                    {Boolean(b.collector_name) && (
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
                        <span>
                          <strong>Assigned Collector:</strong> {String(b.collector_name)}
                        </span>
                        <span>
                          <strong>Vehicle:</strong> {String(b.vehicle_number)} ({String(b.vehicle_type)})
                        </span>
                        {Boolean(b.collector_phone) && (
                          <span>
                            <strong>Phone:</strong> {String(b.collector_phone)}
                          </span>
                        )}
                      </div>
                    )}

                    {colItems.length > 0 && (
                      <div>
                        <h3 className="text-xs font-semibold text-slate-800 mb-2">
                          Recorded Doorstep Weights
                        </h3>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-left text-slate-500">
                              <th className="pb-1.5">Material</th>
                              <th className="pb-1.5">Grade</th>
                              <th className="pb-1.5 text-right">Actual Qty</th>
                              <th className="pb-1.5 text-right">Rate</th>
                              <th className="pb-1.5 text-right">Line Total</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {colItems.map((ci) => (
                              <tr key={String(ci.id)} className="h-8">
                                <td className="font-medium text-slate-900">{String(ci.material_name)}</td>
                                <td className="text-slate-600">{String(ci.material_grade)}</td>
                                <td className="text-right font-mono tabular-nums">
                                  {Number(ci.actual_quantity)} {String(ci.unit_code)}
                                </td>
                                <td className="text-right font-mono tabular-nums">
                                  ₹{Number(ci.accepted_unit_rate).toFixed(2)}
                                </td>
                                <td className="text-right font-mono tabular-nums font-medium">
                                  ₹{Number(ci.line_total).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Pending Settlement Revision Approval */}
                    {pendingRev && (
                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-amber-900">
                            Settlement Revision Requires Your Approval
                          </span>
                          <span className="font-mono text-xs text-amber-900">
                            ₹{Number(pendingRev.original_total).toFixed(2)} → ₹
                            {Number(pendingRev.revised_total).toFixed(2)}
                          </span>
                        </div>
                        <p className="text-xs text-amber-900">
                          <strong>Collector Reason:</strong> {String(pendingRev.reason)}
                        </p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-amber-200 text-left text-amber-900">
                                <th className="pb-1">Item</th>
                                <th className="pb-1 text-right">Orig. Rate</th>
                                <th className="pb-1 text-right">Proposed Rate</th>
                                <th className="pb-1 text-right">Orig. Total</th>
                                <th className="pb-1 text-right">Proposed Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {((pendingRev.items as Array<Record<string, unknown>>) || []).map((ri) => (
                                <tr key={String(ri.id)} className="h-8">
                                  <td>
                                    {String(ri.original_material_name)} →{' '}
                                    {String(ri.revised_material_name)} ({String(ri.revised_grade)})
                                  </td>
                                  <td className="text-right font-mono">
                                    ₹{Number(ri.original_rate).toFixed(2)}
                                  </td>
                                  <td className="text-right font-mono font-semibold">
                                    ₹{Number(ri.revised_rate).toFixed(2)}
                                  </td>
                                  <td className="text-right font-mono">
                                    ₹{Number(ri.original_line_total).toFixed(2)}
                                  </td>
                                  <td className="text-right font-mono font-semibold">
                                    ₹{Number(ri.revised_line_total).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleDecideRevision(Number(pendingRev.id), 'APPROVED')}
                            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                          >
                            Approve Revised Settlement
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDecideRevision(Number(pendingRev.id), 'REJECTED')}
                            className="px-4 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg"
                          >
                            Reject (Keep Accepted Rates)
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Payment & Handover Separate Acknowledgements */}
                    {b.status !== 'CONFIRMED' && b.status !== 'COLLECTOR_ASSIGNED' && (
                      <div className="pt-3 border-t border-slate-100 grid sm:grid-cols-2 gap-4 text-xs">
                        <div className="p-3.5 rounded-lg border border-slate-200 space-y-2">
                          <div className="font-semibold text-slate-900">
                            Payment Acknowledgement (Non-Escrow)
                          </div>
                          <div>
                            State:{' '}
                            <StatusIndicator
                              status={String(b.payment_state || 'PAYMENT_PENDING')}
                            />
                          </div>
                          {b.payment_amount !== null && b.payment_amount !== undefined && (
                            <div className="font-mono">
                              Method: {String(b.payment_method)} · ₹
                              {Number(b.payment_amount).toFixed(2)}
                              {b.buyer_reference ? ` · Ref: ${String(b.buyer_reference)}` : ''}
                            </div>
                          )}
                          {b.payment_state === 'ACKNOWLEDGED_BY_BUYER' && !pendingRev && (
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleAckPayment(bid, false)}
                                className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                              >
                                Acknowledge Payment Received
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAckPayment(bid, true)}
                                className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded-lg"
                              >
                                Dispute Payment
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="p-3.5 rounded-lg border border-slate-200 space-y-2">
                          <div className="font-semibold text-slate-900">
                            Material Handover Confirmation
                          </div>
                          <div>
                            Collector:{' '}
                            {b.collector_confirmed_at ? 'Confirmed' : 'Pending collector'}
                            {' · '}Seller:{' '}
                            {b.seller_confirmed_at ? 'Confirmed' : 'Pending your confirmation'}
                          </div>
                          {!b.seller_confirmed_at && colItems.length > 0 && !pendingRev && (
                            <button
                              type="button"
                              onClick={() => handleAckHandover(bid)}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                            >
                              Confirm Material Handover
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {b.status === 'COMPLETED' && (
                      <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div>
                          <span className="font-semibold text-emerald-800">
                            Completed · Receipt {String(b.receipt_number)}
                          </span>
                        </div>
                        {!b.seller_rating_score ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-600">Rate pickup:</span>
                            {[3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => handleRateBooking(bid, s)}
                                className="px-2.5 py-1 border border-slate-200 rounded hover:bg-slate-50 font-mono"
                              >
                                {s}/5
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="font-mono text-slate-600">
                            Rated {String(b.seller_rating_score)}/5
                          </span>
                        )}
                      </div>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'receipts' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Digital Transaction Receipts
          </h1>
          {receipts.length === 0 ? (
            <EmptyState
              title="No completed receipts yet"
              description="Digital receipts are automatically generated once weighing, payment acknowledgement, and material handover are complete."
            />
          ) : (
            <div className="space-y-4">
              {receipts.map((r) => {
                const payload = JSON.parse(String(r.receipt_payload_json || '{}')) as {
                  receiptNumber: string;
                  bookingReference: string;
                  sellerName: string;
                  buyerBusinessName: string;
                  collectorName: string;
                  items: Array<{
                    material: string;
                    grade: string;
                    actualQty: number;
                    unit: string;
                    rate: number;
                    lineTotal: number;
                  }>;
                  finalAmount: number;
                  paymentMethod: string;
                  paymentState: string;
                  isDemoSeed?: boolean;
                };
                return (
                  <Panel key={String(r.id)} className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <MetaRow
                          items={[
                            payload.receiptNumber,
                            `Booking ${payload.bookingReference}`,
                            new Date(String(r.issued_at)).toLocaleString(),
                            payload.isDemoSeed ? 'Demo Seed Record' : 'Live Transaction',
                          ]}
                        />
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">
                          {payload.buyerBusinessName}
                        </h2>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Final Settlement</div>
                        <div className="text-xl font-bold font-mono tabular-nums text-teal-800">
                          ₹{Number(payload.finalAmount).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-left text-slate-500">
                          <th className="pb-1.5">Material</th>
                          <th className="pb-1.5">Grade</th>
                          <th className="pb-1.5 text-right">Actual Qty</th>
                          <th className="pb-1.5 text-right">Rate</th>
                          <th className="pb-1.5 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(payload.items || []).map((it, idx) => (
                          <tr key={idx} className="h-8">
                            <td className="font-medium text-slate-900">{it.material}</td>
                            <td className="text-slate-600">{it.grade}</td>
                            <td className="text-right font-mono">
                              {it.actualQty} {it.unit}
                            </td>
                            <td className="text-right font-mono">₹{it.rate.toFixed(2)}</td>
                            <td className="text-right font-mono font-medium">
                              ₹{it.lineTotal.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="text-xs text-slate-600 flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100">
                      <div className="flex flex-wrap gap-x-6 gap-y-1">
                        <span>Collector: {payload.collectorName}</span>
                        <span>Payment: {payload.paymentMethod} ({payload.paymentState})</span>
                        <span>Handover: Confirmed</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const lines = [
                            `SCRAP WALA DIGITAL RECEIPT`,
                            `Receipt: ${payload.receiptNumber}`,
                            `Booking: ${payload.bookingReference}`,
                            `Issued: ${new Date(String(r.issued_at)).toISOString()}`,
                            `Seller: ${payload.sellerName}`,
                            `Buyer: ${payload.buyerBusinessName}`,
                            `Collector: ${payload.collectorName}`,
                            ``,
                            `ITEMS:`,
                            ...(payload.items || []).map(
                              (it) =>
                                `- ${it.material} (${it.grade}): ${it.actualQty} ${it.unit} @ INR ${it.rate.toFixed(2)} = INR ${it.lineTotal.toFixed(2)}`
                            ),
                            ``,
                            `Final Settlement: INR ${Number(payload.finalAmount).toFixed(2)}`,
                            `Payment: ${payload.paymentMethod} (${payload.paymentState})`,
                            `Handover: Confirmed`,
                          ];
                          const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `${payload.receiptNumber}.txt`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="px-3 py-1.5 font-medium text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                      >
                        Download Receipt (.txt)
                      </button>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'complaints' && (
        <div className="grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <Panel>
              <h2 className="text-base font-semibold text-slate-900 mb-4">Raise a Complaint or Dispute</h2>
              <form onSubmit={handleRaiseComplaint} className="space-y-3">
                <div>
                  <label htmlFor="cmp-bkg" className="block text-xs font-medium text-slate-700 mb-1">
                    Related Booking (Optional)
                  </label>
                  <select
                    id="cmp-bkg"
                    value={cmpBookingId}
                    onChange={(e) => setCmpBookingId(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="">General platform complaint</option>
                    {bookings.map((b) => (
                      <option key={String(b.id)} value={String(b.id)}>
                        {String(b.booking_reference)} — {String(b.buyer_business_name)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="cmp-cat" className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="cmp-cat"
                    value={cmpCategory}
                    onChange={(e) => setCmpCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="WEIGHT_DISCREPANCY">Weight Discrepancy</option>
                    <option value="PAYMENT_ISSUE">Payment Issue</option>
                    <option value="NO_SHOW">Collector No-Show</option>
                    <option value="CONDUCT">Collector Conduct</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="cmp-desc" className="block text-xs font-medium text-slate-700 mb-1">
                    Description
                  </label>
                  <textarea
                    id="cmp-desc"
                    rows={4}
                    required
                    minLength={10}
                    value={cmpDesc}
                    onChange={(e) => setCmpDesc(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                >
                  Submit Complaint
                </button>
              </form>
            </Panel>
          </div>
          <div className="lg:col-span-7 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">My Complaints</h2>
            {complaints.length === 0 ? (
              <EmptyState title="No complaints logged" description="Any disputes raised against bookings or platform interactions will appear here." />
            ) : (
              complaints.map((c) => (
                <Panel key={String(c.id)} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <MetaRow items={[String(c.reference_code), String(c.category), String(c.booking_reference || 'General')]} />
                    <StatusIndicator status={String(c.status)} />
                  </div>
                  <p className="text-sm text-slate-700">{String(c.description)}</p>
                  {Boolean(c.admin_response) && (
                    <div className="p-3 rounded bg-slate-50 border border-slate-200 text-xs text-slate-700">
                      <strong>Admin Response:</strong> {String(c.admin_response)}
                    </div>
                  )}
                </Panel>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'profile' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Phone OTP Verification</h2>
            <div className="text-xs text-slate-600">
              Current Status:{' '}
              <StatusIndicator status={user?.phoneVerified ? 'VERIFIED' : 'PENDING'} />
            </div>
            <div className="flex gap-2">
              <input
                type="tel"
                value={otpPhone}
                onChange={(e) => setOtpPhone(e.target.value)}
                placeholder="+9198..."
                className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg"
              />
              <button
                type="button"
                onClick={handleRequestOtp}
                className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg whitespace-nowrap"
              >
                Request OTP
              </button>
            </div>
            {otpInfo && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                <p>{otpInfo}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value)}
                    placeholder="6-digit code"
                    className="w-36 px-3 py-1.5 text-xs font-mono border border-slate-200 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={handleVerifyOtp}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg"
                  >
                    Verify Code
                  </button>
                </div>
              </div>
            )}
          </Panel>

          <Panel className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Saved Pickup Addresses</h2>
            <div className="divide-y divide-slate-100">
              {addresses.map((a) => (
                <div key={a.id} className="py-2.5 flex items-start justify-between gap-2 text-xs">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {a.label} · {a.service_area_name}
                    </div>
                    <div className="text-slate-600">
                      {a.street_line}, {a.postal_code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/v1/seller/addresses/${a.id}`, { method: 'DELETE' });
                      await loadAll();
                    }}
                    className="text-red-600 hover:underline shrink-0"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <form onSubmit={handleAddAddress} className="pt-3 border-t border-slate-200 space-y-3">
              <div className="text-xs font-semibold text-slate-900">Add New Address</div>
              <div className="grid sm:grid-cols-2 gap-2">
                <select
                  value={newAddrArea}
                  onChange={(e) => setNewAddrArea(Number(e.target.value))}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg bg-white"
                >
                  {serviceAreas.map((sa) => (
                    <option key={sa.id} value={sa.id}>
                      {sa.name} ({sa.city})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  placeholder="Label (e.g., Home)"
                  value={newAddrLabel}
                  onChange={(e) => setNewAddrLabel(e.target.value)}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <div className="grid sm:grid-cols-3 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Street address"
                  value={newAddrStreet}
                  onChange={(e) => setNewAddrStreet(e.target.value)}
                  className="sm:col-span-2 px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                />
                <input
                  type="text"
                  required
                  placeholder="Postal code"
                  value={newAddrPostal}
                  onChange={(e) => setNewAddrPostal(e.target.value)}
                  className="px-2.5 py-2 text-xs border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"
              >
                Save Address
              </button>
            </form>
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}
