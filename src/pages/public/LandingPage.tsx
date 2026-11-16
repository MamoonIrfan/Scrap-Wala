import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Recycle, Scale, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { MetaRow } from '../../components/ui/Primitives';

interface SnapshotData {
  counts: {
    verifiedBuyers: number;
    activeServiceAreas: number;
    activeMaterials: number;
    publishedListings: number;
    completedPickups: number;
  };
  includesDemoSeedData: boolean;
  note: string;
}

export function LandingPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { materials, user, activeRole } = useAuth();
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);

  useEffect(() => {
    apiFetch<SnapshotData>('/api/v1/public/platform-snapshot', { skipAuth: true })
      .then(setSnapshot)
      .catch(() => {});
  }, []);

  const primaryCtaPath = user
    ? activeRole === 'BUYER'
      ? '/buyer'
      : activeRole === 'COLLECTOR'
      ? '/collector'
      : activeRole === 'ADMIN'
      ? '/admin'
      : '/seller'
    : '/register';

  const steps = [
    {
      num: '01.',
      title: 'Describe Materials & Upload Photos',
      desc: 'Add material photographs and estimated quantities—or mark weight unknown. Optional AI classification suggests a category that you review and edit.',
    },
    {
      num: '02.',
      title: 'Compare Itemized Buyer Offers',
      desc: 'Verified local scrap dealers in your service area submit per-unit rates, pickup slots, and basket coverage. Exact addresses stay private until confirmation.',
    },
    {
      num: '03.',
      title: 'Verify Doorstep Weighing & Revisions',
      desc: 'Assigned collectors weigh every material separately. Any proposed rate or grade change requires your explicit approval before settlement becomes final.',
    },
    {
      num: '04.',
      title: 'Acknowledge Payment & Digital Receipt',
      desc: 'Confirm direct payment and material handover separately to generate an immutable itemized receipt for your records.',
    },
  ];

  return (
    <div className="bg-[#F8FAF9]">
      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 pt-12 pb-16 lg:pt-16 lg:pb-20">
        <div className="grid lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <MetaRow items={['AI-Assisted Marketplace', 'Doorstep Pickup Coordination', 'Transparent Settlements']} />
            <h1
              className="mt-4 font-display font-bold tracking-tight text-slate-900 leading-[1.1]"
              style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', textWrap: 'balance' }}
            >
              Compare Buyers. Arrange Pickup. Record Settlement.
            </h1>
            <p className="mt-5 text-base lg:text-lg text-slate-600 leading-relaxed max-w-xl">
              Scrap Wala connects households and small businesses with verified independent scrap buyers—making itemized rate comparison, scheduled collection, and weight-verified settlements clear from request to digital receipt.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onNavigate(primaryCtaPath)}
                className="inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
              >
                <span>{user ? 'Open My Workspace' : 'List Scrap for Pickup'}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('/how-it-works')}
                className="px-5 py-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-900 rounded-lg transition-colors whitespace-nowrap"
              >
                See 12-Step Lifecycle
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="h-full min-h-[280px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
              <img
                src="/src/assets/images/hero_scrap_collection_1794826582150.jpg"
                alt="Organized recyclable cardboard, paper stacks, plastic crates, and electric pickup vehicle at a neighborhood collection point"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        </div>

        {/* Full-Width Live Database KPI Strip */}
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Verified Dealers in DB</div>
            <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {snapshot ? snapshot.counts.verifiedBuyers : '—'}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Active Service Areas</div>
            <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {snapshot ? snapshot.counts.activeServiceAreas : '—'}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Published Requests</div>
            <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {snapshot ? snapshot.counts.publishedListings : '—'}
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs font-medium text-slate-500">Completed Settlements</div>
            <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {snapshot ? snapshot.counts.completedPickups : '—'}
            </div>
          </div>
        </div>
        {snapshot && (
          <p className="mt-2.5 text-xs text-slate-500">
            {snapshot.note}
          </p>
        )}
      </section>

      {/* Core Workflow Section */}
      <section className="bg-white border-y border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl">
            <h2 className="text-2xl lg:text-3xl font-display font-bold text-slate-900">
              Structured from Photo Upload to Digital Receipt
            </h2>
            <p className="mt-2.5 text-sm lg:text-base text-slate-600">
              Independent buyers and collectors handle physical collection; Scrap Wala coordinates eligibility, transparent offer comparison, and auditable settlement records.
            </p>
          </div>

          <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((s) => (
              <div key={s.num} className="p-6 rounded-xl bg-[#F8FAF9] border border-slate-200">
                <div className="font-mono text-sm font-semibold text-teal-700">{s.num}</div>
                <h3 className="mt-3 text-base font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Supported Material Categories */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl lg:text-3xl font-display font-bold text-slate-900">
              Supported Material Taxonomy
            </h2>
            <p className="mt-2 text-sm lg:text-base text-slate-600">
              Administrator-governed categories with compatible units of measurement and preparation guidance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/materials')}
            className="text-sm font-semibold text-teal-700 hover:text-teal-800 whitespace-nowrap"
          >
            View all units & service areas
          </button>
        </div>

        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {materials.map((mat) => (
            <div
              key={mat.id}
              className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
            >
              <div className="aspect-[4/3] bg-slate-100 relative overflow-hidden">
                {mat.image_url ? (
                  <img
                    src={mat.image_url}
                    alt={`${mat.name} recyclable scrap category`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 text-teal-700">
                    <Recycle className="w-10 h-10" aria-hidden="true" />
                  </div>
                )}
              </div>
              <div className="p-5 flex-1 flex flex-col">
                <MetaRow items={[`Default unit: ${mat.default_unit_code}`, 'Active category']} />
                <h3 className="mt-2 text-lg font-semibold text-slate-900">{mat.name}</h3>
                <p className="mt-1.5 text-sm text-slate-600 flex-1">{mat.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Marketplace Governance & Transparency */}
      <section className="bg-white border-t border-slate-200 py-16">
        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-3 gap-8">
          <div className="space-y-3">
            <ShieldCheck className="w-6 h-6 text-teal-700" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-slate-900">Address Privacy Before Booking</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Before a seller accepts an offer, buyers only see the approximate service area and postal zone. Exact street details are disclosed strictly after booking confirmation.
            </p>
          </div>
          <div className="space-y-3">
            <Scale className="w-6 h-6 text-teal-700" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-slate-900">Explicit Settlement Consent</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Collectors record actual item weights on site. If grade or unit rates need adjustment, sellers review itemized differences and explicitly approve or reject the revision.
            </p>
          </div>
          <div className="space-y-3">
            <CheckCircle2 className="w-6 h-6 text-teal-700" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-slate-900">No Hidden Price Commitments</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Scrap Wala does not invent market prices or own scrap fleets. Verified independent buyers submit itemized rates, and a disclosed buyer-side service fee applies only upon completion.
            </p>
          </div>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer className="border-t border-slate-200 bg-[#F8FAF9] py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span className="font-semibold text-slate-900">Scrap Wala</span>
            <span className="mx-2">·</span>
            <span>AI-Assisted Scrap Trading & Pickup Management Platform</span>
          </div>
          <div className="flex flex-wrap gap-5">
            <a href="/about" onClick={(e) => { e.preventDefault(); onNavigate('/about'); }} className="hover:text-slate-900">About</a>
            <a href="/how-it-works" onClick={(e) => { e.preventDefault(); onNavigate('/how-it-works'); }} className="hover:text-slate-900">How It Works</a>
            <a href="/materials" onClick={(e) => { e.preventDefault(); onNavigate('/materials'); }} className="hover:text-slate-900">Materials</a>
            <a href="/contact" onClick={(e) => { e.preventDefault(); onNavigate('/contact'); }} className="hover:text-slate-900">Contact</a>
            <a href="/login" onClick={(e) => { e.preventDefault(); onNavigate('/login'); }} className="hover:text-slate-900">Sign In</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
