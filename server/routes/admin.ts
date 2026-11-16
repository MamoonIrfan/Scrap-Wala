import { Router } from 'express';
import { getDb, withTransaction } from '../db/database';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth';
import { recordAuditLog, recordNotification } from '../services/audit';
import { getAiSystemStatus } from '../services/ai';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/analytics', (_req, res) => {
  const db = getDb();

  const totalUsers = (
    db.prepare('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL').get() as { c: number }
  ).c;
  const demoSeedUsers = (
    db.prepare('SELECT COUNT(*) as c FROM users WHERE is_demo_seed = 1 AND deleted_at IS NULL').get() as {
      c: number;
    }
  ).c;
  const verifiedBuyers = (
    db
      .prepare("SELECT COUNT(*) as c FROM buyer_profiles WHERE verification_status = 'VERIFIED'")
      .get() as { c: number }
  ).c;
  const pendingVerifications = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM buyer_profiles WHERE verification_status IN ('PENDING','UNDER_REVIEW')"
      )
      .get() as { c: number }
  ).c;
  const activeListings = (
    db.prepare("SELECT COUNT(*) as c FROM listings WHERE status = 'PUBLISHED'").get() as {
      c: number;
    }
  ).c;
  const offersSubmitted = (db.prepare('SELECT COUNT(*) as c FROM offers').get() as { c: number }).c;
  const totalBookings = (db.prepare('SELECT COUNT(*) as c FROM bookings').get() as { c: number }).c;
  const completedTransactions = (
    db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'COMPLETED'").get() as {
      c: number;
    }
  ).c;
  const cancelledTransactions = (
    db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'CANCELLED'").get() as {
      c: number;
    }
  ).c;
  const openDisputes = (
    db.prepare("SELECT COUNT(*) as c FROM complaints WHERE status IN ('OPEN','IN_REVIEW')").get() as {
      c: number;
    }
  ).c;

  const volumeAndValue = db
    .prepare(
      `SELECT COALESCE(SUM(final_settlement_amount), 0) as totalValue
       FROM bookings WHERE status = 'COMPLETED'`
    )
    .get() as { totalValue: number };

  const totalMass = db
    .prepare(
      `SELECT COALESCE(SUM(ci.actual_quantity * mu.base_factor), 0) as totalKg
       FROM collection_items ci
       JOIN collection_records cr ON cr.id = ci.collection_record_id
       JOIN bookings b ON b.id = cr.booking_id
       JOIN material_units mu ON mu.id = ci.unit_id
       WHERE b.status = 'COMPLETED' AND mu.dimension = 'MASS'`
    )
    .get() as { totalKg: number };

  const feeRevenue = db
    .prepare(
      `SELECT COALESCE(SUM(fee_amount), 0) as totalFees
       FROM platform_fee_ledger WHERE status != 'REVERSED'`
    )
    .get() as { totalFees: number };

  res.json({
    analytics: {
      totalUsers,
      demoSeedUsers,
      liveUsers: totalUsers - demoSeedUsers,
      verifiedBuyers,
      pendingVerifications,
      activeListings,
      offersSubmitted,
      totalBookings,
      completedTransactions,
      cancelledTransactions,
      openDisputes,
      materialVolumeKg: totalMass.totalKg,
      transactionValue: volumeAndValue.totalValue,
      platformFeeRevenue: feeRevenue.totalFees,
    },
    seedDisclosure:
      'Analytics reflect live database records. Demo/seed accounts are explicitly counted and labeled.',
  });
});

router.get('/users', (_req, res) => {
  const db = getDb();
  const users = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.phone_verified, u.account_status, u.is_demo_seed, u.created_at,
              GROUP_CONCAT(r.name) as roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.deleted_at IS NULL
       GROUP BY u.id
       ORDER BY u.id DESC`
    )
    .all();
  res.json({ users });
});

router.post('/users/:userId/status', (req: AuthenticatedRequest, res) => {
  const userId = Number(req.params.userId);
  const { status, reason } = req.body || {};
  if (!['ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(String(status))) {
    res.status(400).json({ error: 'Invalid account status.' });
    return;
  }
  if (userId === req.authUser!.id && status !== 'ACTIVE') {
    res.status(400).json({ error: 'Administrators cannot suspend their own active session.' });
    return;
  }

  const db = getDb();
  withTransaction(db, () => {
    db.prepare(`UPDATE users SET account_status = ?, updated_at = datetime('now') WHERE id = ?`).run(
      String(status),
      userId
    );
    if (status !== 'ACTIVE') {
      db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?`).run(
        userId
      );
    }
    recordAuditLog(db, {
      actorUserId: req.authUser!.id,
      actorRole: 'ADMIN',
      action: `USER_STATUS_${status}`,
      entityType: 'USER',
      entityId: userId,
      metadata: { reason: reason || '' },
    });
  });

  res.json({ ok: true });
});

router.get('/buyers-verification', (_req, res) => {
  const db = getDb();
  const buyers = db
    .prepare(
      `SELECT bp.*, u.email, u.full_name, u.account_status, u.is_demo_seed
       FROM buyer_profiles bp
       JOIN users u ON u.id = bp.user_id
       ORDER BY CASE bp.verification_status WHEN 'UNDER_REVIEW' THEN 0 WHEN 'PENDING' THEN 1 WHEN 'VERIFIED' THEN 2 ELSE 3 END, bp.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const getDocs = db.prepare(
    `SELECT vd.*, mf.original_name FROM verification_documents vd
     LEFT JOIN media_files mf ON mf.id = vd.media_file_id
     WHERE vd.buyer_user_id = ? ORDER BY vd.created_at DESC`
  );

  res.json({
    buyers: buyers.map((b) => ({
      ...b,
      documents: getDocs.all(Number(b.user_id)),
    })),
  });
});

router.post('/buyers/:buyerUserId/verify', (req: AuthenticatedRequest, res) => {
  const buyerUserId = Number(req.params.buyerUserId);
  const { status, notes } = req.body || {};
  if (status !== 'VERIFIED' && status !== 'REJECTED') {
    res.status(400).json({ error: 'Verification status must be VERIFIED or REJECTED.' });
    return;
  }

  const db = getDb();
  withTransaction(db, () => {
    db.prepare(
      `UPDATE buyer_profiles
       SET verification_status = ?, verification_notes = ?, verified_by = ?, verified_at = datetime('now'), updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(status, notes ? String(notes).trim() : null, req.authUser!.id, buyerUserId);

    db.prepare(
      `UPDATE verification_documents
       SET review_status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
       WHERE buyer_user_id = ? AND review_status = 'PENDING'`
    ).run(
      status === 'VERIFIED' ? 'APPROVED' : 'REJECTED',
      notes ? String(notes).trim() : null,
      req.authUser!.id,
      buyerUserId
    );

    recordNotification(db, {
      userId: buyerUserId,
      eventType: 'VERIFICATION_UPDATED',
      title: `Dealer verification ${status.toLowerCase()}`,
      body: notes ? String(notes).trim() : `Your verification status is now ${status}.`,
      linkPath: '/buyer/onboarding',
    });

    recordAuditLog(db, {
      actorUserId: req.authUser!.id,
      actorRole: 'ADMIN',
      action: `BUYER_VERIFICATION_${status}`,
      entityType: 'BUYER_PROFILE',
      entityId: buyerUserId,
      metadata: { notes: notes || '' },
    });
  });

  res.json({ ok: true });
});

router.get('/taxonomy', (_req, res) => {
  const db = getDb();
  const materials = db
    .prepare(
      `SELECT m.*, mu.code as default_unit_code
       FROM materials m JOIN material_units mu ON mu.id = m.default_unit_id ORDER BY m.id ASC`
    )
    .all();
  const units = db.prepare('SELECT * FROM material_units ORDER BY id ASC').all();
  const serviceAreas = db.prepare('SELECT * FROM service_areas ORDER BY name ASC').all();
  res.json({ materials, units, serviceAreas });
});

router.post('/materials', (req: AuthenticatedRequest, res) => {
  const { name, slug, description, defaultUnitId, handlingGuidance } = req.body || {};
  if (!name || !slug || !description || !defaultUnitId) {
    res.status(400).json({ error: 'Name, slug, description, and default unit are required.' });
    return;
  }
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO materials (slug, name, description, default_unit_id, handling_guidance, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(
      String(slug).trim().toLowerCase(),
      String(name).trim(),
      String(description).trim(),
      Number(defaultUnitId),
      handlingGuidance ? String(handlingGuidance).trim() : ''
    );
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: 'ADMIN',
    action: 'MATERIAL_CREATED',
    entityType: 'MATERIAL',
    entityId: Number(info.lastInsertRowid),
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.post('/materials/:id/toggle', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  db.prepare(`UPDATE materials SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`).run(
    id
  );
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: 'ADMIN',
    action: 'MATERIAL_TOGGLED',
    entityType: 'MATERIAL',
    entityId: id,
  });
  res.json({ ok: true });
});

router.post('/units', (req: AuthenticatedRequest, res) => {
  const { code, name, dimension, baseFactor } = req.body || {};
  if (!code || !name || !['MASS', 'COUNT', 'BUNDLE'].includes(String(dimension))) {
    res.status(400).json({ error: 'Code, name, and valid dimension (MASS, COUNT, BUNDLE) required.' });
    return;
  }
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO material_units (code, name, dimension, base_factor, is_active) VALUES (?, ?, ?, ?, 1)`
    )
    .run(String(code).trim(), String(name).trim(), String(dimension), Number(baseFactor || 1));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.post('/service-areas', (req: AuthenticatedRequest, res) => {
  const { name, city, postalPrefixes } = req.body || {};
  if (!name || !city) {
    res.status(400).json({ error: 'Area name and city are required.' });
    return;
  }
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO service_areas (name, city, postal_prefixes, is_active) VALUES (?, ?, ?, 1)`
    )
    .run(String(name).trim(), String(city).trim(), postalPrefixes ? String(postalPrefixes).trim() : '');
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: 'ADMIN',
    action: 'SERVICE_AREA_CREATED',
    entityType: 'SERVICE_AREA',
    entityId: Number(info.lastInsertRowid),
  });
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.post('/service-areas/:id/toggle', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  db.prepare(
    `UPDATE service_areas SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`
  ).run(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/operations', (_req, res) => {
  const db = getDb();
  const listings = db
    .prepare(
      `SELECT l.*, u.full_name as seller_name, sa.name as service_area_name
       FROM listings l
       JOIN users u ON u.id = l.seller_user_id
       JOIN service_areas sa ON sa.id = l.service_area_id
       ORDER BY l.created_at DESC LIMIT 50`
    )
    .all();

  const offers = db
    .prepare(
      `SELECT o.*, l.reference_code as listing_ref, bp.business_name as buyer_name
       FROM offers o
       JOIN listings l ON l.id = o.listing_id
       JOIN buyer_profiles bp ON bp.user_id = o.buyer_user_id
       ORDER BY o.created_at DESC LIMIT 50`
    )
    .all();

  const bookings = db
    .prepare(
      `SELECT b.*, su.full_name as seller_name, bp.business_name as buyer_name,
              pa.state as payment_state, tr.receipt_number
       FROM bookings b
       JOIN users su ON su.id = b.seller_user_id
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       LEFT JOIN payment_acknowledgements pa ON pa.booking_id = b.id
       LEFT JOIN transaction_receipts tr ON tr.booking_id = b.id
       ORDER BY b.created_at DESC LIMIT 50`
    )
    .all();

  const settlements = db
    .prepare(
      `SELECT sr.*, b.booking_reference, u.full_name as proposed_by_name
       FROM settlement_revisions sr
       JOIN bookings b ON b.id = sr.booking_id
       JOIN users u ON u.id = sr.proposed_by_user_id
       ORDER BY sr.created_at DESC LIMIT 50`
    )
    .all();

  res.json({ listings, offers, bookings, settlements });
});

router.get('/complaints', (_req, res) => {
  const db = getDb();
  const complaints = db
    .prepare(
      `SELECT c.*, u.full_name as raised_by_name, u.email as raised_by_email, b.booking_reference
       FROM complaints c
       JOIN users u ON u.id = c.raised_by_user_id
       LEFT JOIN bookings b ON b.id = c.booking_id
       ORDER BY c.created_at DESC`
    )
    .all();
  res.json({ complaints });
});

router.post('/complaints/:id/resolve', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const { status, adminResponse, resolutionNotes } = req.body || {};
  if (!['IN_REVIEW', 'RESOLVED', 'DISMISSED'].includes(String(status))) {
    res.status(400).json({ error: 'Valid complaint status required.' });
    return;
  }

  const db = getDb();
  const comp = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id) as
    | { id: number; raised_by_user_id: number; reference_code: string }
    | undefined;
  if (!comp) {
    res.status(404).json({ error: 'Complaint not found.' });
    return;
  }

  withTransaction(db, () => {
    db.prepare(
      `UPDATE complaints
       SET status = ?, admin_response = ?, resolution_notes = ?, resolved_by = ?,
           resolved_at = CASE WHEN ? IN ('RESOLVED','DISMISSED') THEN datetime('now') ELSE resolved_at END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      String(status),
      adminResponse ? String(adminResponse).trim() : null,
      resolutionNotes ? String(resolutionNotes).trim() : null,
      req.authUser!.id,
      String(status),
      id
    );

    recordNotification(db, {
      userId: comp.raised_by_user_id,
      eventType: 'COMPLAINT_UPDATED',
      title: `Dispute ${comp.reference_code} updated`,
      body: `Status changed to ${status}. ${adminResponse ? String(adminResponse).trim() : ''}`,
      linkPath: '/seller/complaints',
    });

    recordAuditLog(db, {
      actorUserId: req.authUser!.id,
      actorRole: 'ADMIN',
      action: `COMPLAINT_${status}`,
      entityType: 'COMPLAINT',
      entityId: id,
    });
  });

  res.json({ ok: true });
});

router.get('/fees', (_req, res) => {
  const db = getDb();
  const rules = db.prepare('SELECT * FROM platform_fee_rules ORDER BY id DESC').all();
  const ledger = db
    .prepare(
      `SELECT pfl.*, bp.business_name as buyer_name, pfr.name as rule_name
       FROM platform_fee_ledger pfl
       JOIN buyer_profiles bp ON bp.user_id = pfl.buyer_user_id
       JOIN platform_fee_rules pfr ON pfr.id = pfl.fee_rule_id
       ORDER BY pfl.created_at DESC`
    )
    .all();
  res.json({ rules, ledger });
});

router.post('/fees/rules', (req: AuthenticatedRequest, res) => {
  const { name, feeType, rateValue, minFee, maxFee } = req.body || {};
  if (!name || !['PERCENTAGE', 'FLAT'].includes(String(feeType)) || Number(rateValue) < 0) {
    res.status(400).json({ error: 'Valid rule name, fee type, and non-negative rate required.' });
    return;
  }
  const db = getDb();
  const ruleId = withTransaction(db, () => {
    db.prepare('UPDATE platform_fee_rules SET is_active = 0').run();
    const info = db
      .prepare(
        `INSERT INTO platform_fee_rules (name, fee_type, rate_value, min_fee, max_fee, applies_to_status, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, 'COMPLETED', 1, ?)`
      )
      .run(
        String(name).trim(),
        String(feeType),
        Number(rateValue),
        Number(minFee || 0),
        maxFee !== undefined && maxFee !== null && maxFee !== '' ? Number(maxFee) : null,
        req.authUser!.id
      );
    recordAuditLog(db, {
      actorUserId: req.authUser!.id,
      actorRole: 'ADMIN',
      action: 'FEE_RULE_UPDATED',
      entityType: 'PLATFORM_FEE_RULE',
      entityId: Number(info.lastInsertRowid),
    });
    return Number(info.lastInsertRowid);
  });
  res.status(201).json({ id: ruleId });
});

router.post('/fees/ledger/:id/reverse', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  if (!reason || String(reason).trim().length < 5) {
    res.status(400).json({ error: 'Audit reason (min 5 chars) is required to reverse a fee.' });
    return;
  }
  const db = getDb();
  withTransaction(db, () => {
    db.prepare(
      `UPDATE platform_fee_ledger
       SET status = 'REVERSED', reversal_reason = ?, reversed_by = ?, reversed_at = datetime('now')
       WHERE id = ?`
    ).run(String(reason).trim(), req.authUser!.id, id);

    recordAuditLog(db, {
      actorUserId: req.authUser!.id,
      actorRole: 'ADMIN',
      action: 'PLATFORM_FEE_REVERSED',
      entityType: 'PLATFORM_FEE_LEDGER',
      entityId: id,
      metadata: { reason: String(reason).trim() },
    });
  });
  res.json({ ok: true });
});

router.get('/audit-logs', (_req, res) => {
  const db = getDb();
  const logs = db
    .prepare(
      `SELECT al.*, u.email as actor_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ORDER BY al.id DESC LIMIT 120`
    )
    .all();
  res.json({ logs });
});

router.get('/ai-status', (_req, res) => {
  const db = getDb();
  const logs = db
    .prepare(
      `SELECT ail.*, u.email as user_email
       FROM ai_inference_logs ail
       LEFT JOIN users u ON u.id = ail.user_id
       ORDER BY ail.id DESC LIMIT 50`
    )
    .all();
  res.json({ status: getAiSystemStatus(), logs });
});

router.get('/settings', (_req, res) => {
  const db = getDb();
  const settings = db.prepare('SELECT * FROM platform_settings ORDER BY key ASC').all();
  const templates = db.prepare('SELECT * FROM notification_templates ORDER BY id ASC').all();
  const inquiries = db.prepare('SELECT * FROM contact_inquiries ORDER BY id DESC LIMIT 30').all();
  res.json({ settings, templates, inquiries });
});

router.put('/settings', (req: AuthenticatedRequest, res) => {
  const { key, value } = req.body || {};
  if (!key || value === undefined) {
    res.status(400).json({ error: 'Setting key and value are required.' });
    return;
  }
  const db = getDb();
  db.prepare(
    `UPDATE platform_settings SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?`
  ).run(String(value), req.authUser!.id, String(key));
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: 'ADMIN',
    action: 'PLATFORM_SETTING_UPDATED',
    entityType: 'SETTING',
    entityId: String(key),
    metadata: { value: String(value) },
  });
  res.json({ ok: true });
});

router.put('/notification-templates/:id', (req: AuthenticatedRequest, res) => {
  const { titleTemplate, bodyTemplate, isActive } = req.body || {};
  const db = getDb();
  db.prepare(
    `UPDATE notification_templates
     SET title_template = COALESCE(?, title_template),
         body_template = COALESCE(?, body_template),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    titleTemplate || null,
    bodyTemplate || null,
    typeof isActive === 'boolean' ? (isActive ? 1 : 0) : null,
    Number(req.params.id)
  );
  res.json({ ok: true });
});

router.get('/reports/export', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT b.booking_reference, b.status, b.pickup_date, b.estimated_total_amount,
              b.final_settlement_amount, su.full_name as seller_name, bp.business_name as buyer_name,
              COALESCE(pfl.fee_amount, 0) as platform_fee, b.is_demo_seed
       FROM bookings b
       JOIN users su ON su.id = b.seller_user_id
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       LEFT JOIN platform_fee_ledger pfl ON pfl.booking_id = b.id AND pfl.status != 'REVERSED'
       ORDER BY b.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const headers = [
    'booking_reference',
    'status',
    'pickup_date',
    'estimated_total_amount',
    'final_settlement_amount',
    'seller_name',
    'buyer_name',
    'platform_fee',
    'is_demo_seed',
  ];
  const csvLines = [
    headers.join(','),
    ...rows.map((r) =>
      headers
        .map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="scrapwala-transactions-report.csv"');
  res.send(csvLines.join('\n'));
});

export default router;
