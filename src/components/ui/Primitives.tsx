import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, HelpCircle, X, XCircle } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { GuidanceTopic } from '../../types/domain';

export function MetaRow({ items }: { items: Array<string | number | null | undefined> }) {
  const clean = items.filter((i) => i !== null && i !== undefined && String(i).trim() !== '');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      {clean.map((item, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <span aria-hidden="true">·</span>}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

export function StatusIndicator({ status }: { status: string }) {
  const norm = String(status || '').toUpperCase();
  let Icon = Clock;
  let textClass = 'text-amber-700';

  if (
    [
      'ACTIVE',
      'VERIFIED',
      'PUBLISHED',
      'COMPLETED',
      'APPROVED',
      'ACCEPTED',
      'ACKNOWLEDGED_BY_SELLER',
      'PROVIDER_VERIFIED',
      'RESOLVED',
      'SETTLEMENT_APPROVED',
    ].includes(norm)
  ) {
    Icon = CheckCircle2;
    textClass = 'text-emerald-700';
  } else if (
    ['SUSPENDED', 'REJECTED', 'CANCELLED', 'PAYMENT_DISPUTED', 'DISPUTED', 'EXPIRED', 'REVERSED'].includes(norm)
  ) {
    Icon = XCircle;
    textClass = 'text-red-700';
  } else if (['OPEN', 'WEIGHED_PENDING_APPROVAL', 'PENDING_SELLER'].includes(norm)) {
    Icon = AlertCircle;
    textClass = 'text-amber-700';
  }

  const label = norm.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${textClass}`}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl p-6 ${className}`}>
      {children}
    </div>
  );
}

export function MetricBlock({
  label,
  value,
  subtext,
}: {
  label: string;
  value: string | number;
  subtext?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 font-mono tabular-nums">
        {value}
      </div>
      {subtext && <div className="mt-1 text-xs text-slate-500">{subtext}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto">{description}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function GuidanceDrawer({
  open,
  topic,
  onClose,
}: {
  open: boolean;
  topic?: string;
  onClose: () => void;
}) {
  const [topics, setTopics] = useState<GuidanceTopic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>(topic || 'listing');

  useEffect(() => {
    if (topic) setSelectedTopic(topic);
  }, [topic]);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ guidance: GuidanceTopic[] }>('/api/v1/ai/guidance', { skipAuth: true })
      .then((res) => setTopics(res.guidance || []))
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const current = topics.find((t) => t.topic === selectedTopic) || topics[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-label="Platform Guidance">
      <div className="w-full max-w-md bg-white h-full border-l border-slate-200 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-teal-700" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Scrap Wala Guidance</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guidance drawer"
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-slate-100 flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <button
              key={t.topic}
              type="button"
              onClick={() => setSelectedTopic(t.topic)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                current?.topic === t.topic
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {t.topic.charAt(0).toUpperCase() + t.topic.slice(1)}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {current ? (
            <>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{current.title}</h3>
                <p className="mt-1.5 text-sm text-slate-600">{current.summary}</p>
              </div>
              <ol className="space-y-3">
                {current.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-slate-700">
                    <span className="font-mono text-xs font-semibold text-teal-700 mt-0.5">
                      0{i + 1}.
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                <strong className="font-semibold text-slate-900">Important Rule: </strong>
                {current.importantNote}
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-500">Loading platform instructions...</div>
          )}
        </div>
      </div>
    </div>
  );
}
