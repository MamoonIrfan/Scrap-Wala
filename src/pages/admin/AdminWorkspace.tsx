import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Cpu,
  DollarSign,
  FileSearch,
  Layers,
  MessageSquareWarning,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { DashboardShell, type NavItem } from '../../components/layout/DashboardShell';
import {
  MetaRow,
  MetricBlock,
  Panel,
  StatusIndicator,
} from '../../components/ui/Primitives';

type AdminTab =
  | 'analytics'
  | 'users'
  | 'verification'
  | 'taxonomy'
  | 'operations'
  | 'complaints'
  | 'fees'
  | 'audit'
  | 'ai'
  | 'settings';

export function AdminWorkspace({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { refreshTaxonomy } = useAuth();
  const [tab, setTab] = useState<AdminTab>('analytics');
  const [banner, setBanner] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [analytics, setAnalytics] = useState<Record<string, number>>({});
  const [seedDisclosure, setSeedDisclosure] = useState('');
  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [buyers, setBuyers] = useState<Array<Record<string, unknown>>>([]);
  const [taxonomy, setTaxonomy] = useState<{
    materials: Array<Record<string, unknown>>;
    units: Array<Record<string, unknown>>;
    serviceAreas: Array<Record<string, unknown>>;
  }>({ materials: [], units: [], serviceAreas: [] });
  const [operations, setOperations] = useState<{
    listings: Array<Record<string, unknown>>;
    offers: Array<Record<string, unknown>>;
    bookings: Array<Record<string, unknown>>;
    settlements: Array<Record<string, unknown>>;
  }>({ listings: [], offers: [], bookings: [], settlements: [] });
  const [complaints, setComplaints] = useState<Array<Record<string, unknown>>>([]);
  const [fees, setFees] = useState<{
    rules: Array<Record<string, unknown>>;
    ledger: Array<Record<string, unknown>>;
  }>({ rules: [], ledger: [] });
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [aiStatus, setAiStatus] = useState<{
    status: Record<string, unknown>;
    logs: Array<Record<string, unknown>>;
  }>({ status: {}, logs: [] });
  const [settingsData, setSettingsData] = useState<{
    settings: Array<Record<string, unknown>>;
    templates: Array<Record<string, unknown>>;
    inquiries: Array<Record<string, unknown>>;
  }>({ settings: [], templates: [], inquiries: [] });

  // Forms
  const [matName, setMatName] = useState('');
  const [matSlug, setMatSlug] = useState('');
  const [matDesc, setMatDesc] = useState('');
  const [areaName, setAreaName] = useState('');
  const [areaCity, setAreaCity] = useState('');
  const [areaPrefixes, setAreaPrefixes] = useState('');
  const [feeRuleName, setFeeRuleName] = useState('');
  const [feeRate, setFeeRate] = useState('2.5');
  const [feeType, setFeeType] = useState<'PERCENTAGE' | 'FLAT'>('PERCENTAGE');

  const loadAll = useCallback(async () => {
    try {
      const [anRes, uRes, vRes, tRes, opRes, cRes, fRes, aRes, aiRes, sRes] = await Promise.all([
        apiFetch<{ analytics: Record<string, number>; seedDisclosure: string }>('/api/v1/admin/analytics'),
        apiFetch<{ users: Array<Record<string, unknown>> }>('/api/v1/admin/users'),
        apiFetch<{ buyers: Array<Record<string, unknown>> }>('/api/v1/admin/buyers-verification'),
        apiFetch<typeof taxonomy>('/api/v1/admin/taxonomy'),
        apiFetch<typeof operations>('/api/v1/admin/operations'),
        apiFetch<{ complaints: Array<Record<string, unknown>> }>('/api/v1/admin/complaints'),
        apiFetch<typeof fees>('/api/v1/admin/fees'),
        apiFetch<{ logs: Array<Record<string, unknown>> }>('/api/v1/admin/audit-logs'),
        apiFetch<typeof aiStatus>('/api/v1/admin/ai-status'),
        apiFetch<typeof settingsData>('/api/v1/admin/settings'),
      ]);
      setAnalytics(anRes.analytics || {});
      setSeedDisclosure(anRes.seedDisclosure || '');
      setUsers(uRes.users || []);
      setBuyers(vRes.buyers || []);
      setTaxonomy(tRes);
      setOperations(opRes);
      setComplaints(cRes.complaints || []);
      setFees(fRes);
      setAuditLogs(aRes.logs || []);
      setAiStatus(aiRes);
      setSettingsData(sRes);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load admin console.',
      });
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleExportCsv = async () => {
    try {
      const csv = await apiFetch<string>('/api/v1/admin/reports/export');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scrapwala-transactions-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'CSV export failed.',
      });
    }
  };

  const navItems: NavItem[] = [
    { id: 'analytics', label: 'Analytics & Reports', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'users', label: 'User Management', icon: <Users className="w-4 h-4" /> },
    { id: 'verification', label: 'Buyer Verification', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'taxonomy', label: 'Materials & Areas', icon: <Layers className="w-4 h-4" /> },
    { id: 'operations', label: 'Transactions Monitor', icon: <Activity className="w-4 h-4" /> },
    { id: 'complaints', label: 'Disputes & Complaints', icon: <MessageSquareWarning className="w-4 h-4" /> },
    { id: 'fees', label: 'Service Fees & Ledger', icon: <DollarSign className="w-4 h-4" /> },
    { id: 'audit', label: 'Audit Logs', icon: <FileSearch className="w-4 h-4" /> },
    { id: 'ai', label: 'AI Model & Logs', icon: <Cpu className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings & Templates', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <DashboardShell
      roleTitle="Admin"
      breadcrumb={navItems.find((n) => n.id === tab)?.label || 'Analytics'}
      navItems={navItems}
      activeTab={tab}
      onSelectTab={(id) => setTab(id as AdminTab)}
      guidanceTopic="receipts"
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

      {tab === 'analytics' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-display font-bold text-slate-900">
                Platform Analytics & Reports
              </h1>
              <p className="text-xs text-slate-500 mt-1">{seedDisclosure}</p>
            </div>
            <button
              type="button"
              onClick={handleExportCsv}
              className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
            >
              Download CSV Report
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricBlock
              label="Total Users"
              value={analytics.totalUsers ?? 0}
              subtext={`${analytics.demoSeedUsers ?? 0} demo seed · ${analytics.liveUsers ?? 0} live`}
            />
            <MetricBlock
              label="Verified Buyers"
              value={analytics.verifiedBuyers ?? 0}
              subtext={`${analytics.pendingVerifications ?? 0} pending review`}
            />
            <MetricBlock label="Active Listings" value={analytics.activeListings ?? 0} />
            <MetricBlock label="Offers Submitted" value={analytics.offersSubmitted ?? 0} />
            <MetricBlock label="Total Bookings" value={analytics.totalBookings ?? 0} />
            <MetricBlock
              label="Completed / Cancelled"
              value={`${analytics.completedTransactions ?? 0} / ${analytics.cancelledTransactions ?? 0}`}
            />
            <MetricBlock
              label="Completed Volume"
              value={`${Number(analytics.materialVolumeKg ?? 0).toFixed(1)} kg`}
              subtext={`₹${Number(analytics.transactionValue ?? 0).toFixed(2)} value`}
            />
            <MetricBlock
              label="Assessed Fee Revenue"
              value={`₹${Number(analytics.platformFeeRevenue ?? 0).toFixed(2)}`}
              subtext={`${analytics.openDisputes ?? 0} open disputes`}
            />
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-display font-bold text-slate-900">User Management</h1>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <th className="pb-2">User</th>
                    <th className="pb-2">Roles</th>
                    <th className="pb-2">Origin</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={String(u.id)} className="h-11">
                      <td>
                        <div className="font-medium text-slate-900">{String(u.full_name)}</div>
                        <div className="text-xs text-slate-500">{String(u.email)}</div>
                      </td>
                      <td className="font-mono text-xs">{String(u.roles)}</td>
                      <td className="text-xs text-slate-600">
                        {Number(u.is_demo_seed) === 1 ? 'Demo Seed' : 'Live'}
                      </td>
                      <td>
                        <StatusIndicator status={String(u.account_status)} />
                      </td>
                      <td className="text-right">
                        {u.account_status === 'ACTIVE' ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await apiFetch(`/api/v1/admin/users/${u.id}/status`, {
                                  method: 'POST',
                                  body: { status: 'SUSPENDED', reason: 'Admin console action' },
                                });
                                await loadAll();
                              } catch (err) {
                                setBanner({
                                  type: 'error',
                                  text: err instanceof Error ? err.message : 'Action failed.',
                                });
                              }
                            }}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/v1/admin/users/${u.id}/status`, {
                                method: 'POST',
                                body: { status: 'ACTIVE', reason: 'Reactivated by admin' },
                              });
                              await loadAll();
                            }}
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Reactivate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'verification' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Buyer / Dealer Verification Queue
          </h1>
          <div className="space-y-4">
            {buyers.map((b) => (
              <Panel key={String(b.user_id)} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <MetaRow
                      items={[
                        String(b.email),
                        String(b.warehouse_area),
                        b.gst_or_tax_id ? `Tax ID: ${String(b.gst_or_tax_id)}` : 'No Tax ID',
                      ]}
                    />
                    <h2 className="mt-1 text-lg font-semibold text-slate-900">
                      {String(b.business_name)}
                    </h2>
                  </div>
                  <StatusIndicator status={String(b.verification_status)} />
                </div>

                <div className="text-xs text-slate-600 space-y-1">
                  <strong>Submitted Documents:</strong>
                  {((b.documents as Array<Record<string, unknown>>) || []).length === 0 ? (
                    <span> None uploaded yet.</span>
                  ) : (
                    <div className="flex flex-wrap gap-3 pt-1">
                      {((b.documents as Array<Record<string, unknown>>) || []).map((d) => (
                        <span key={String(d.id)} className="font-mono">
                          {String(d.doc_type)}: {String(d.doc_reference)} ({String(d.review_status)})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/v1/admin/buyers/${b.user_id}/verify`, {
                        method: 'POST',
                        body: { status: 'VERIFIED', notes: 'Verified by Admin' },
                      });
                      setBanner({ type: 'success', text: `${String(b.business_name)} verified.` });
                      await loadAll();
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                  >
                    Approve Verification
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/v1/admin/buyers/${b.user_id}/verify`, {
                        method: 'POST',
                        body: { status: 'REJECTED', notes: 'Rejected by Admin' },
                      });
                      setBanner({ type: 'success', text: `${String(b.business_name)} rejected.` });
                      await loadAll();
                    }}
                    className="px-3.5 py-1.5 text-xs font-semibold text-red-700 border border-red-200 rounded-lg"
                  >
                    Reject
                  </button>
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}

      {tab === 'taxonomy' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Material Categories</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {taxonomy.materials.map((m) => (
                <div key={String(m.id)} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">{String(m.name)}</div>
                    <div className="text-slate-500">Default unit: {String(m.default_unit_code)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/v1/admin/materials/${m.id}/toggle`, { method: 'POST' });
                      await loadAll();
                      await refreshTaxonomy();
                    }}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    {Number(m.is_active) === 1 ? 'Active (Disable)' : 'Disabled (Enable)'}
                  </button>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch('/api/v1/admin/materials', {
                  method: 'POST',
                  body: {
                    name: matName,
                    slug: matSlug,
                    description: matDesc,
                    defaultUnitId: taxonomy.units[0]?.id || 1,
                  },
                });
                setMatName('');
                setMatSlug('');
                setMatDesc('');
                await loadAll();
                await refreshTaxonomy();
              }}
              className="pt-3 border-t border-slate-200 space-y-2 text-xs"
            >
              <div className="font-semibold">Add Material Category</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Name (e.g., E-Waste)"
                  value={matName}
                  onChange={(e) => setMatName(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded"
                />
                <input
                  type="text"
                  required
                  placeholder="Slug (e.g., e-waste)"
                  value={matSlug}
                  onChange={(e) => setMatSlug(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded"
                />
              </div>
              <input
                type="text"
                required
                placeholder="Description"
                value={matDesc}
                onChange={(e) => setMatDesc(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded"
              />
              <button type="submit" className="px-3.5 py-1.5 bg-teal-700 text-white rounded-lg font-semibold">
                Add Material
              </button>
            </form>
          </Panel>

          <Panel className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Service Areas</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {taxonomy.serviceAreas.map((sa) => (
                <div key={String(sa.id)} className="py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">
                      {String(sa.name)} ({String(sa.city)})
                    </div>
                    <div className="font-mono text-slate-500">{String(sa.postal_prefixes)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/v1/admin/service-areas/${sa.id}/toggle`, {
                        method: 'POST',
                      });
                      await loadAll();
                      await refreshTaxonomy();
                    }}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    {Number(sa.is_active) === 1 ? 'Active (Disable)' : 'Disabled (Enable)'}
                  </button>
                </div>
              ))}
            </div>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await apiFetch('/api/v1/admin/service-areas', {
                  method: 'POST',
                  body: { name: areaName, city: areaCity, postalPrefixes: areaPrefixes },
                });
                setAreaName('');
                setAreaCity('');
                setAreaPrefixes('');
                await loadAll();
                await refreshTaxonomy();
              }}
              className="pt-3 border-t border-slate-200 space-y-2 text-xs"
            >
              <div className="font-semibold">Add Service Area</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Area Name"
                  value={areaName}
                  onChange={(e) => setAreaName(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded"
                />
                <input
                  type="text"
                  required
                  placeholder="City"
                  value={areaCity}
                  onChange={(e) => setAreaCity(e.target.value)}
                  className="px-2.5 py-1.5 border border-slate-200 rounded"
                />
              </div>
              <input
                type="text"
                placeholder="Postal prefixes (comma-separated)"
                value={areaPrefixes}
                onChange={(e) => setAreaPrefixes(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded"
              />
              <button type="submit" className="px-3.5 py-1.5 bg-teal-700 text-white rounded-lg font-semibold">
                Add Service Area
              </button>
            </form>
          </Panel>
        </div>
      )}

      {tab === 'operations' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Listings, Bookings & Settlement Monitoring
          </h1>
          <Panel>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Recent Bookings</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-2">Booking</th>
                    <th className="pb-2">Seller</th>
                    <th className="pb-2">Buyer</th>
                    <th className="pb-2">Payment</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {operations.bookings.map((b) => (
                    <tr key={String(b.id)} className="h-10">
                      <td className="font-mono">{String(b.booking_reference)}</td>
                      <td>{String(b.seller_name)}</td>
                      <td>{String(b.buyer_name)}</td>
                      <td>
                        <StatusIndicator status={String(b.payment_state || 'PENDING')} />
                      </td>
                      <td>
                        <StatusIndicator status={String(b.status)} />
                      </td>
                      <td className="text-right font-mono tabular-nums">
                        ₹{Number(b.final_settlement_amount ?? b.estimated_total_amount ?? 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'complaints' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Disputes & Complaint Resolution
          </h1>
          {complaints.length === 0 ? (
            <Panel className="text-sm text-slate-500">No complaints submitted.</Panel>
          ) : (
            complaints.map((c) => (
              <Panel key={String(c.id)} className="space-y-3">
                <div className="flex items-center justify-between">
                  <MetaRow
                    items={[
                      String(c.reference_code),
                      String(c.raised_by_name),
                      String(c.category),
                      String(c.booking_reference || 'General'),
                    ]}
                  />
                  <StatusIndicator status={String(c.status)} />
                </div>
                <p className="text-sm text-slate-700">{String(c.description)}</p>
                {c.status !== 'RESOLVED' && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/v1/admin/complaints/${c.id}/resolve`, {
                          method: 'POST',
                          body: {
                            status: 'RESOLVED',
                            adminResponse: 'Reviewed and resolved by administration.',
                            resolutionNotes: 'Closed via Admin Console',
                          },
                        });
                        await loadAll();
                      }}
                      className="px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-700 rounded-lg"
                    >
                      Mark Resolved
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/v1/admin/complaints/${c.id}/resolve`, {
                          method: 'POST',
                          body: {
                            status: 'IN_REVIEW',
                            adminResponse: 'Assigned for dispute investigation.',
                          },
                        });
                        await loadAll();
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
                    >
                      Move to In Review
                    </button>
                  </div>
                )}
              </Panel>
            ))
          )}
        </div>
      )}

      {tab === 'fees' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            Platform Service-Fee Rules & Ledger
          </h1>
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5">
              <Panel className="space-y-4">
                <h2 className="text-base font-semibold text-slate-900">Configure Active Fee Rule</h2>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await apiFetch('/api/v1/admin/fees/rules', {
                      method: 'POST',
                      body: {
                        name: feeRuleName,
                        feeType,
                        rateValue: Number(feeRate),
                        minFee: 5,
                        maxFee: 500,
                      },
                    });
                    setFeeRuleName('');
                    setBanner({ type: 'success', text: 'Active platform fee rule updated.' });
                    await loadAll();
                  }}
                  className="space-y-3 text-xs"
                >
                  <input
                    type="text"
                    required
                    placeholder="Rule Name"
                    value={feeRuleName}
                    onChange={(e) => setFeeRuleName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={feeType}
                      onChange={(e) => setFeeType(e.target.value as 'PERCENTAGE' | 'FLAT')}
                      className="px-3 py-2 border border-slate-200 rounded-lg bg-white"
                    >
                      <option value="PERCENTAGE">Percentage (%)</option>
                      <option value="FLAT">Flat (INR)</option>
                    </select>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      required
                      value={feeRate}
                      onChange={(e) => setFeeRate(e.target.value)}
                      className="px-3 py-2 font-mono border border-slate-200 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 font-semibold text-white bg-teal-700 rounded-lg"
                  >
                    Activate Fee Rule
                  </button>
                </form>

                <div className="pt-3 border-t border-slate-100 space-y-2 text-xs">
                  {fees.rules.map((r) => (
                    <div key={String(r.id)} className="flex items-center justify-between">
                      <span>{String(r.name)}</span>
                      <StatusIndicator status={Number(r.is_active) === 1 ? 'ACTIVE' : 'INACTIVE'} />
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div className="lg:col-span-7">
              <Panel>
                <h2 className="text-base font-semibold text-slate-900 mb-3">Fee Ledger</h2>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="pb-2">Booking</th>
                      <th className="pb-2">Buyer</th>
                      <th className="pb-2 text-right">Fee</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {fees.ledger.map((l) => (
                      <tr key={String(l.id)} className="h-10">
                        <td className="font-mono">{String(l.transaction_reference)}</td>
                        <td>{String(l.buyer_name)}</td>
                        <td className="text-right font-mono tabular-nums">
                          ₹{Number(l.fee_amount).toFixed(2)}
                        </td>
                        <td>
                          <StatusIndicator status={String(l.status)} />
                        </td>
                        <td className="text-right">
                          {l.status !== 'REVERSED' && (
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/v1/admin/fees/ledger/${l.id}/reverse`, {
                                  method: 'POST',
                                  body: { reason: 'Administrative fee correction' },
                                });
                                await loadAll();
                              }}
                              className="text-red-600 hover:underline"
                            >
                              Reverse
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-display font-bold text-slate-900">Security & Financial Audit Logs</h1>
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500">
                    <th className="pb-2">Timestamp</th>
                    <th className="pb-2">Actor</th>
                    <th className="pb-2">Action</th>
                    <th className="pb-2">Entity</th>
                    <th className="pb-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((l) => (
                    <tr key={String(l.id)} className="h-9">
                      <td className="font-mono text-slate-500">{String(l.created_at)}</td>
                      <td>{String(l.actor_email || l.actor_role)}</td>
                      <td className="font-mono font-medium text-slate-900">{String(l.action)}</td>
                      <td className="font-mono">
                        {String(l.entity_type)} #{String(l.entity_id)}
                      </td>
                      <td className="text-slate-600 max-w-xs truncate">{String(l.metadata_json)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'ai' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-display font-bold text-slate-900">
            AI Service Boundaries & Inference Logs
          </h1>
          <Panel className="space-y-2 text-xs">
            <div>
              <strong>Image Adapter:</strong> {String(aiStatus.status.activeImageAdapter || '')}
            </div>
            <div>
              <strong>Listing Adapter:</strong> {String(aiStatus.status.activeListingAdapter || '')}
            </div>
            <div>
              <strong>PyTorch Model Status:</strong> {String(aiStatus.status.pytorchModelNote || '')}
            </div>
            <div>
              <strong>RAG Architecture:</strong> Strictly excluded (false)
            </div>
          </Panel>
          <Panel>
            <h2 className="text-base font-semibold text-slate-900 mb-3">Recent Inference Logs</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Feature</th>
                  <th className="pb-2">Adapter / Model</th>
                  <th className="pb-2">Prediction</th>
                  <th className="pb-2 text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {aiStatus.logs.map((l) => (
                  <tr key={String(l.id)} className="h-9">
                    <td className="font-mono text-slate-500">{String(l.created_at)}</td>
                    <td>{String(l.feature_type)}</td>
                    <td className="font-mono">
                      {String(l.adapter_mode)} ({String(l.model_name)})
                    </td>
                    <td>
                      {String(l.predicted_category || '—')}
                      {l.confidence_score !== null ? ` (${Math.round(Number(l.confidence_score) * 100)}%)` : ''}
                    </td>
                    <td className="text-right font-mono">{String(l.latency_ms)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      {tab === 'settings' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Panel className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Platform Settings</h2>
            <div className="divide-y divide-slate-100 text-xs">
              {settingsData.settings.map((s) => (
                <div key={String(s.key)} className="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono font-medium text-slate-900">{String(s.key)}</div>
                    <div className="text-slate-500">{String(s.description)}</div>
                  </div>
                  <input
                    type="text"
                    defaultValue={String(s.value)}
                    onBlur={async (e) => {
                      if (e.target.value !== String(s.value)) {
                        await apiFetch('/api/v1/admin/settings', {
                          method: 'PUT',
                          body: { key: s.key, value: e.target.value },
                        });
                        setBanner({ type: 'success', text: `Updated ${String(s.key)}.` });
                      }
                    }}
                    className="w-28 px-2 py-1 font-mono border border-slate-200 rounded"
                  />
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Contact Inquiries</h2>
            {settingsData.inquiries.length === 0 ? (
              <div className="text-xs text-slate-500">No contact inquiries yet.</div>
            ) : (
              <div className="divide-y divide-slate-100 text-xs">
                {settingsData.inquiries.map((inq) => (
                  <div key={String(inq.id)} className="py-2.5 space-y-1">
                    <div className="font-semibold text-slate-900">
                      {String(inq.name)} ({String(inq.email)}) · {String(inq.topic)}
                    </div>
                    <p className="text-slate-600">{String(inq.message)}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </DashboardShell>
  );
}
