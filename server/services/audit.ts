import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

export function generateRefCode(prefix: string): string {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const year = new Date().getUTCFullYear();
  return `${prefix}-${year}-${rand}`;
}

export function recordAuditLog(
  db: DatabaseSync,
  params: {
    actorUserId?: number | null;
    actorRole?: string;
    action: string;
    entityType: string;
    entityId: string | number;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
  }
): void {
  db.prepare(
    `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.actorUserId ?? null,
    params.actorRole || 'SYSTEM',
    params.action,
    params.entityType,
    String(params.entityId),
    JSON.stringify(params.metadata || {}),
    params.ipAddress || ''
  );
}

export function recordNotification(
  db: DatabaseSync,
  params: {
    userId: number;
    eventType: string;
    title: string;
    body: string;
    linkPath?: string;
  }
): { id: number; externalDeliveryStatus: string } {
  const res = db
    .prepare(
      `INSERT INTO notifications (user_id, event_type, title, body, link_path, delivery_channel, is_read)
       VALUES (?, ?, ?, ?, ?, 'IN_APP', 0)`
    )
    .run(
      params.userId,
      params.eventType,
      params.title,
      params.body,
      params.linkPath || ''
    );

  // External email/SMS adapter status is explicitly documented and never fabricated as delivered
  const externalDeliveryStatus =
    config.emailProvider === 'development_adapter'
      ? 'IN_APP_ONLY_EXTERNAL_ADAPTER_UNCONFIGURED'
      : 'QUEUED';

  return {
    id: Number(res.lastInsertRowid),
    externalDeliveryStatus,
  };
}
