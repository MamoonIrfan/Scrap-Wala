import React, { useCallback, useEffect, useState } from 'react';
import { CheckSquare, History, Home, Scale, Truck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { DashboardShell, type NavItem } from '../../components/layout/DashboardShell';
import {
  EmptyState,
  MetaRow,
  MetricBlock,
  Panel,
  StatusIndicator,
} from '../../components/ui/Primitives';

type CollectorTab = 'overview' | 'jobs' | 'history';

export function CollectorWorkspace({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { materials } = useAuth();
  const [tab, setTab] = useState<CollectorTab>('jobs');
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [metrics, setMetrics] = useState({ todaysJobs: 0, pendingJobs: 0, completedJobs: 0 });
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);

  // Weighing modal state
  const [weighingJob, setWeighingJob] = useState<Record<string, unknown> | null>(null);
  const [inspectionNotes, setInspectionNotes] = useState('');
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [revisionReason, setRevisionReason] = useState('');
  const [weightInputs, setWeightInputs] = useState<
    Record<number, { qty: string; grade: string; proposedRate: string; proposedMatId: number }>
  >({});

  // Payment recording state
  const [payMethodByJob, setPayMethodByJob] = useState<Record<number, string>>({});
  const [payRefByJob, setPayRefByJob] = useState<Record<number, string>>({});

  const loadAll = useCallback(async () => {
    try {
      const [dash, jobRes] = await Promise.all([
        apiFetch<{ metrics: typeof metrics; profile: Record<string, unknown> }>(
          '/api/v1/collector/dashboard'
        ),
        apiFetch<{ jobs: Array<Record<string, unknown>> }>('/api/v1/collector/jobs'),
      ]);
      setMetrics(dash.metrics);
      setProfile(dash.profile);
      setJobs(jobRes.jobs || []);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load collector jobs.',
      });
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const openWeighing = (job: Record<string, unknown>) => {
    setWeighingJob(job);
    setInspectionNotes('Materials inspected at doorstep.');
    setDiscrepancyNotes('');
    setRevisionReason('');
    const init: Record<
      number,
      { qty: string; grade: string; proposedRate: string; proposedMatId: number }
    > = {};
    for (const li of (job.listingItems as Array<Record<string, unknown>>) || []) {
      if (Number(li.is_covered) === 1) {
        init[Number(li.id)] = {
          qty: li.estimated_quantity ? String(li.estimated_quantity) : '0',
          grade: 'STANDARD',
          proposedRate: String(li.accepted_rate),
          proposedMatId: Number(li.material_id),
        };
      }
    }
    setWeightInputs(init);
  };

  const handleStatusUpdate = async (bookingId: number, action: 'ARRIVED' | 'START_COLLECTION') => {
    setBanner(null);
    try {
      await apiFetch(`/api/v1/collector/jobs/${bookingId}/status`, {
        method: 'POST',
        body: { action },
      });
      setBanner({ type: 'success', text: `Job status updated (${action}).` });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update status.',
      });
    }
  };

  const handleSubmitWeights = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weighingJob) return;
    setBanner(null);
    try {
      const items = Object.entries(weightInputs).map(([listingItemId, v]) => ({
        listingItemId: Number(listingItemId),
        actualQuantity: Number(v.qty),
        materialGrade: v.grade,
        proposedRate: Number(v.proposedRate),
        proposedMaterialId: v.proposedMatId,
      }));
      const res = await apiFetch<{
        needsSellerApproval: boolean;
        originalTotal: number;
        revisedTotal: number;
      }>(`/api/v1/collector/jobs/${weighingJob.id}/record-weights`, {
        method: 'POST',
        body: {
          items,
          inspectionNotes,
          discrepancyNotes,
          revisionReason,
        },
      });
      setWeighingJob(null);
      setBanner({
        type: 'success',
        text: res.needsSellerApproval
          ? `Weights recorded and settlement revision proposed (₹${res.originalTotal} → ₹${res.revisedTotal}). Awaiting explicit seller approval.`
          : `Actual weights recorded (Total ₹${res.originalTotal}). Ready for payment & handover acknowledgements.`,
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save weight entries.',
      });
    }
  };

  const handleRecordPayment = async (bookingId: number) => {
    setBanner(null);
    try {
      const method = payMethodByJob[bookingId] || 'CASH';
      const ref = payRefByJob[bookingId] || '';
      const res = await apiFetch<{ amount: number }>(
        `/api/v1/collector/jobs/${bookingId}/acknowledge-payment`,
        {
          method: 'POST',
          body: { paymentMethod: method, buyerReference: ref },
        }
      );
      setBanner({
        type: 'success',
        text: `Recorded ${method} payment acknowledgement of ₹${res.amount.toFixed(2)}.`,
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not record payment.',
      });
    }
  };

  const handleConfirmHandover = async (bookingId: number) => {
    setBanner(null);
    try {
      const res = await apiFetch<{ completed?: boolean; receiptNumber?: string }>(
        `/api/v1/collector/jobs/${bookingId}/acknowledge-handover`,
        { method: 'POST', body: { notes: 'Collected and loaded.' } }
      );
      setBanner({
        type: 'success',
        text: res.completed
          ? `Handover confirmed and transaction completed! Receipt ${res.receiptNumber} issued.`
          : 'Collector handover confirmed. Awaiting seller confirmation.',
      });
      await loadAll();
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Handover confirmation failed.',
      });
    }
  };

  const activeJobs = jobs.filter((j) => j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
  const completedJobs = jobs.filter((j) => j.status === 'COMPLETED');

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: <Home className="w-4 h-4" /> },
    { id: 'jobs', label: `Assigned Jobs (${activeJobs.length})`, icon: <Truck className="w-4 h-4" /> },
    { id: 'history', label: `Job History (${completedJobs.length})`, icon: <History className="w-4 h-4" /> },
  ];

  return (
    <DashboardShell
      roleTitle="Collector"
      breadcrumb={navItems.find((n) => n.id === tab)?.label || 'Assigned Jobs'}
      navItems={navItems}
      activeTab={tab}
      onSelectTab={(id) => setTab(id as CollectorTab)}
      guidanceTopic="pickup"
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
          <div>
            <h1 className="text-2xl font-display font-bold text-slate-900">
              {String(profile?.full_name || 'Collector Workspace')}
            </h1>
            <p className="text-sm text-slate-600">
              Dealer: {String(profile?.dealer_name || '')} · Vehicle:{' '}
              <span className="font-mono">{String(profile?.vehicle_number || '')}</span>
            </p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <MetricBlock label="Today's Jobs" value={metrics.todaysJobs} />
            <MetricBlock label="Pending Pickups" value={metrics.pendingJobs} />
            <MetricBlock label="Completed Jobs" value={metrics.completedJobs} />
          </div>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">Assigned Pickup Jobs</h1>
          {activeJobs.length === 0 ? (
            <EmptyState
              title="No pending assigned pickups"
              description="New pickups assigned by your dealer will appear here with seller address and accepted rates."
            />
          ) : (
            <div className="space-y-4">
              {activeJobs.map((j) => {
                const bid = Number(j.id);
                const revs = (j.settlementRevisions as Array<Record<string, unknown>>) || [];
                const pendingRev = revs.find((r) => r.status === 'PENDING_SELLER');
                const colItems = (j.collectionItems as Array<Record<string, unknown>>) || [];

                return (
                  <Panel key={bid} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <MetaRow
                          items={[
                            String(j.booking_reference),
                            `${j.pickup_date} · ${j.pickup_window}`,
                            String(j.service_area_name),
                          ]}
                        />
                        <h2 className="mt-1 text-lg font-semibold text-slate-900">
                          {String(j.listing_title)}
                        </h2>
                        <p className="text-xs text-slate-600">
                          Seller: {String(j.seller_name)} ({String(j.seller_phone || 'No phone')}) ·{' '}
                          {String(j.street_line)}, {String(j.postal_code)}
                        </p>
                      </div>
                      <StatusIndicator status={String(j.status)} />
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-slate-500">
                            <th className="pb-1.5">Material</th>
                            <th className="pb-1.5">Est. Qty</th>
                            <th className="pb-1.5 text-right">Accepted Rate</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {((j.listingItems as Array<Record<string, unknown>>) || []).map((li) => (
                            <tr key={String(li.id)} className="h-8">
                              <td className="font-medium text-slate-900">{String(li.material_name)}</td>
                              <td className="font-mono">
                                {Number(li.quantity_unknown) === 1
                                  ? 'Unknown'
                                  : `${li.estimated_quantity} ${String(li.unit_code)}`}
                              </td>
                              <td className="text-right font-mono">
                                {Number(li.is_covered) === 1
                                  ? `₹${Number(li.accepted_rate).toFixed(2)}/${String(li.unit_code)}`
                                  : 'Not covered'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                      {j.status === 'COLLECTOR_ASSIGNED' && (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(bid, 'ARRIVED')}
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                        >
                          Mark Arrival
                        </button>
                      )}
                      {j.status === 'ARRIVED' && (
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(bid, 'START_COLLECTION')}
                          className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                        >
                          Start Collection
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openWeighing(j)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg"
                      >
                        <Scale className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{colItems.length > 0 ? 'Re-record Weights' : 'Enter Actual Weights'}</span>
                      </button>
                    </div>

                    {pendingRev && (
                      <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                        Settlement revision is pending Seller approval before payment can be recorded.
                      </div>
                    )}

                    {colItems.length > 0 && !pendingRev && (
                      <div className="pt-3 border-t border-slate-100 grid sm:grid-cols-2 gap-4 text-xs">
                        <div className="p-3 rounded-lg border border-slate-200 space-y-2">
                          <div className="font-semibold text-slate-900">Record Payment Acknowledgement</div>
                          <div className="flex gap-2">
                            <select
                              value={payMethodByJob[bid] || 'CASH'}
                              onChange={(e) =>
                                setPayMethodByJob((p) => ({ ...p, [bid]: e.target.value }))
                              }
                              className="px-2 py-1.5 border border-slate-200 rounded bg-white"
                            >
                              <option value="CASH">Cash</option>
                              <option value="UPI_DIRECT">UPI Direct</option>
                              <option value="BANK_TRANSFER">Bank Transfer</option>
                            </select>
                            <input
                              type="text"
                              placeholder="Ref / Note (optional)"
                              value={payRefByJob[bid] || ''}
                              onChange={(e) =>
                                setPayRefByJob((p) => ({ ...p, [bid]: e.target.value }))
                              }
                              className="flex-1 px-2 py-1.5 border border-slate-200 rounded"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRecordPayment(bid)}
                            className="px-3 py-1.5 font-semibold text-white bg-teal-700 rounded-lg"
                          >
                            Record Payment Paid
                          </button>
                          {Boolean(j.payment_state) && (
                            <div className="text-slate-600">
                              Current state: <StatusIndicator status={String(j.payment_state)} />
                            </div>
                          )}
                        </div>

                        <div className="p-3 rounded-lg border border-slate-200 space-y-2">
                          <div className="font-semibold text-slate-900">Handover Confirmation</div>
                          <div>
                            Your status: {j.collector_confirmed_at ? 'Confirmed' : 'Pending'} · Seller:{' '}
                            {j.seller_confirmed_at ? 'Confirmed' : 'Pending'}
                          </div>
                          {!j.collector_confirmed_at && (
                            <button
                              type="button"
                              onClick={() => handleConfirmHandover(bid)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-teal-700 rounded-lg"
                            >
                              <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Confirm Material Handover</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </Panel>
                );
              })}
            </div>
          )}

          {weighingJob && (
            <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" role="dialog" aria-label="Enter Actual Material Weights">
              <div className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">
                    Record Doorstep Weights — {String(weighingJob.booking_reference)}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setWeighingJob(null)}
                    className="text-xs text-slate-500"
                  >
                    Cancel
                  </button>
                </div>

                <form onSubmit={handleSubmitWeights} className="space-y-4 text-xs">
                  {((weighingJob.listingItems as Array<Record<string, unknown>>) || [])
                    .filter((li) => Number(li.is_covered) === 1)
                    .map((li) => {
                      const iid = Number(li.id);
                      const cur = weightInputs[iid];
                      if (!cur) return null;
                      return (
                        <div key={iid} className="p-3 border border-slate-200 rounded-lg space-y-2">
                          <div className="font-semibold text-slate-900">
                            {String(li.material_name)} (Accepted rate: ₹
                            {Number(li.accepted_rate).toFixed(2)}/{String(li.unit_code)})
                          </div>
                          <div className="grid sm:grid-cols-4 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-0.5">
                                Actual Qty ({String(li.unit_code)})
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                required
                                value={cur.qty}
                                onChange={(e) =>
                                  setWeightInputs((p) => ({
                                    ...p,
                                    [iid]: { ...cur, qty: e.target.value },
                                  }))
                                }
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-0.5">
                                Grade
                              </label>
                              <input
                                type="text"
                                value={cur.grade}
                                onChange={(e) =>
                                  setWeightInputs((p) => ({
                                    ...p,
                                    [iid]: { ...cur, grade: e.target.value },
                                  }))
                                }
                                className="w-full px-2 py-1.5 border border-slate-200 rounded"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-0.5">
                                Category (Revision)
                              </label>
                              <select
                                value={cur.proposedMatId}
                                onChange={(e) =>
                                  setWeightInputs((p) => ({
                                    ...p,
                                    [iid]: { ...cur, proposedMatId: Number(e.target.value) },
                                  }))
                                }
                                className="w-full px-2 py-1.5 border border-slate-200 rounded bg-white"
                              >
                                {materials.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-0.5">
                                Proposed Rate (INR)
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={cur.proposedRate}
                                onChange={(e) =>
                                  setWeightInputs((p) => ({
                                    ...p,
                                    [iid]: { ...cur, proposedRate: e.target.value },
                                  }))
                                }
                                className="w-full px-2 py-1.5 font-mono border border-slate-200 rounded"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Inspection Notes
                    </label>
                    <input
                      type="text"
                      value={inspectionNotes}
                      onChange={(e) => setInspectionNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Reason for Rate / Category Revision (Required if changing accepted rate or material)
                    </label>
                    <input
                      type="text"
                      value={revisionReason}
                      onChange={(e) => setRevisionReason(e.target.value)}
                      placeholder="e.g., High moisture content or mixed grade observed"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setWeighingJob(null)}
                      className="px-4 py-2 font-medium text-slate-700 bg-slate-100 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
                    >
                      Save Weights
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">Completed Job History</h1>
          {completedJobs.length === 0 ? (
            <EmptyState
              title="No completed pickups yet"
              description="Completed pickups with issued digital receipts will appear here."
            />
          ) : (
            <Panel>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2">Booking</th>
                    <th className="pb-2">Pickup Date</th>
                    <th className="pb-2">Seller</th>
                    <th className="pb-2">Receipt</th>
                    <th className="pb-2 text-right">Final Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completedJobs.map((j) => (
                    <tr key={String(j.id)} className="h-11">
                      <td className="font-mono text-xs">{String(j.booking_reference)}</td>
                      <td className="font-mono text-xs">{String(j.pickup_date)}</td>
                      <td className="text-slate-800">{String(j.seller_name)}</td>
                      <td className="font-mono text-xs">{String(j.receipt_number || '—')}</td>
                      <td className="text-right font-mono tabular-nums font-medium">
                        ₹{Number(j.final_settlement_amount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      )}
    </DashboardShell>
  );
}
