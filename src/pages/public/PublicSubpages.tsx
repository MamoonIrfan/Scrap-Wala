import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { MetaRow, Panel } from '../../components/ui/Primitives';

export function AboutPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
      <div>
        <MetaRow items={['Marketplace Vision', 'Independent Buyer Network', 'Digital Record-Keeping']} />
        <h1 className="mt-3 text-3xl lg:text-4xl font-display font-bold text-slate-900">
          About Scrap Wala
        </h1>
        <p className="mt-4 text-base text-slate-600 leading-relaxed max-w-3xl">
          Scrap Wala is an AI-assisted scrap trading and pickup management marketplace designed to help households and small businesses connect with verified independent scrap buyers, compare itemized offers, and confirm doorstep weighing and payment settlements.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Panel>
          <h2 className="text-lg font-semibold text-slate-900">Marketplace Boundary</h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Scrap Wala operates strictly as a coordination and record-keeping platform. It does not own scrap warehouses, delivery fleets, physical inventory, or recycling plants. Independent verified dealers and their collectors execute physical pickup and settlement.
          </p>
        </Panel>
        <Panel>
          <h2 className="text-lg font-semibold text-slate-900">Problem Hypotheses Under Validation</h2>
          <ul className="mt-2 space-y-2 text-sm text-slate-600">
            <li>01. Finding active, verified local buyers within a neighborhood service area.</li>
            <li>02. Comparing itemized material rates and basket coverage fairly before booking.</li>
            <li>03. Documenting estimated vs. actual doorstep weights and direct payment handoffs transparently.</li>
          </ul>
        </Panel>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => onNavigate('/register')}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
        >
          Create an Account
        </button>
        <button
          type="button"
          onClick={() => onNavigate('/how-it-works')}
          className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
        >
          Explore Transaction Lifecycle
        </button>
      </div>
    </div>
  );
}

export function HowItWorksPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const phases = [
    { step: '01', title: 'Seller Creates & Validates Request', detail: 'Select material categories, upload photos, enter estimated quantities (or mark weight unknown), choose pickup address and window.' },
    { step: '02', title: 'Deterministic Buyer Eligibility', detail: 'Backend rules match verified buyers by active account status, service area, material capabilities, and available pickup capacity.' },
    { step: '03', title: 'Itemized Offers & Fair Comparison', detail: 'Buyers submit per-unit rates with expiry and conditions. Partial baskets are flagged separately from full-basket offers.' },
    { step: '04', title: 'Atomic Booking Confirmation', detail: 'Accepting one offer locks the pickup slot, snapshots accepted rates immutably, reveals exact pickup address to the buyer, and assigns a collector.' },
    { step: '05', title: 'Doorstep Weighing & Revision Consent', detail: 'Collectors record actual weight and grade per item. Any rate or category change requires explicit seller approval.' },
    { step: '06', title: 'Dual Payment & Handover Acknowledgements', detail: 'Payment acknowledgement and material handover confirmation are recorded separately before issuing the digital receipt and assessing the buyer-side fee.' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-10">
      <div>
        <MetaRow items={['12-Step Lifecycle', 'Role-Enforced Backend', 'Audit-Logged Settlements']} />
        <h1 className="mt-3 text-3xl lg:text-4xl font-display font-bold text-slate-900">
          How Scrap Wala Works
        </h1>
        <p className="mt-3 text-base text-slate-600 max-w-2xl">
          Every stage separates AI assistance from financial authority: AI helps classify materials and draft descriptions, while humans and deterministic rules govern rates, approvals, and settlements.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {phases.map((p) => (
          <Panel key={p.step}>
            <div className="font-mono text-xs font-semibold text-teal-700">STEP {p.step}</div>
            <h2 className="mt-2 text-lg font-semibold text-slate-900">{p.title}</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.detail}</p>
          </Panel>
        ))}
      </div>

      <div>
        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg"
        >
          Try with Demo Seed Accounts
        </button>
      </div>
    </div>
  );
}

export function MaterialsPage() {
  const { materials, units, serviceAreas } = useAuth();
  const [feeRule, setFeeRule] = useState<{ name: string; fee_type: string; rate_value: number; min_fee: number; max_fee: number | null } | null>(null);

  useEffect(() => {
    apiFetch<{ activeFeeRule: typeof feeRule }>('/api/v1/public/taxonomy', { skipAuth: true })
      .then((r) => setFeeRule(r.activeFeeRule || null))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12 space-y-10">
      <div>
        <h1 className="text-3xl font-display font-bold text-slate-900">
          Material Categories, Units & Service Areas
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Live taxonomy configured by platform administrators. Scrap Wala does not publish fixed market scrap prices; verified dealers quote itemized rates per request.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {materials.map((m) => (
          <Panel key={m.id} className="flex flex-col sm:flex-row gap-5">
            {m.image_url && (
              <img
                src={m.image_url}
                alt={m.name}
                referrerPolicy="no-referrer"
                className="w-full sm:w-40 h-32 object-cover rounded-lg border border-slate-200 shrink-0"
              />
            )}
            <div className="space-y-1.5">
              <MetaRow items={[`Default unit: ${m.default_unit_name}`, `Slug: ${m.slug}`]} />
              <h2 className="text-lg font-semibold text-slate-900">{m.name}</h2>
              <p className="text-sm text-slate-600">{m.description}</p>
              {m.handling_guidance && (
                <p className="text-xs text-slate-500 pt-1">
                  <strong>Preparation:</strong> {m.handling_guidance}
                </p>
              )}
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Panel>
          <h2 className="text-base font-semibold text-slate-900">Supported Units of Measurement</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {units.map((u) => (
              <div key={u.id} className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">{u.name}</span>
                <span className="font-mono text-xs text-slate-500">
                  {u.code} · {u.dimension}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold text-slate-900">Active Service Areas & Disclosed Fee</h2>
          <div className="mt-4 divide-y divide-slate-100">
            {serviceAreas.map((a) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">{a.name} ({a.city})</span>
                <span className="font-mono text-xs text-slate-500">{a.postal_prefixes}</span>
              </div>
            ))}
          </div>
          {feeRule && (
            <div className="mt-4 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
              <strong>Disclosed Buyer Coordination Fee:</strong> {feeRule.name} (applies only to completed transactions).
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('General Inquiry');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError('Please complete all required fields.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ message: string; id: number }>('/api/v1/public/contact', {
        method: 'POST',
        body: { name, email, topic, message },
        skipAuth: true,
      });
      setSuccess(`${res.message} (Reference #${res.id})`);
      setName('');
      setEmail('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit inquiry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-display font-bold text-slate-900">Contact Scrap Wala</h1>
      <p className="mt-2 text-sm text-slate-600">
        Questions about dealer onboarding, service-area coverage, or transaction disputes? Inquiries are stored directly for administrative review.
      </p>

      <Panel className="mt-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {success}
            </div>
          )}
          <div>
            <label htmlFor="contact-name" className="block text-xs font-medium text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="contact-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-xs font-medium text-slate-700 mb-1">
              Email Address
            </label>
            <input
              id="contact-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <div>
            <label htmlFor="contact-topic" className="block text-xs font-medium text-slate-700 mb-1">
              Topic
            </label>
            <select
              id="contact-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            >
              <option value="General Inquiry">General Inquiry</option>
              <option value="Buyer Verification">Buyer / Dealer Verification</option>
              <option value="Service Area Request">Service Area Request</option>
              <option value="Dispute Escalation">Dispute Escalation</option>
            </select>
          </div>
          <div>
            <label htmlFor="contact-msg" className="block text-xs font-medium text-slate-700 mb-1">
              Message
            </label>
            <textarea
              id="contact-msg"
              rows={4}
              required
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg"
          >
            {submitting ? 'Submitting...' : 'Send Inquiry'}
          </button>
        </form>
      </Panel>
    </div>
  );
}
