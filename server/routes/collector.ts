import { Router } from 'express';
import { getDb, withTransaction } from '../db/database';
import { calculateSettlementTotals, roundCurrency } from '../domain/rules';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth';
import { recordAuditLog, recordNotification } from '../services/audit';
import { finalizeBookingIfReady } from '../services/transactions';

const router = Router();
router.use(requireAuth, requireRole('COLLECTOR'));

router.get('/dashboard', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const collectorId = req.authUser!.id;
  const today = new Date().toISOString().slice(0, 10);

  const todaysJobs = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM collector_assignments ca
         JOIN bookings b ON b.id = ca.booking_id
         WHERE ca.collector_user_id = ? AND b.pickup_date = ? AND b.status != 'CANCELLED'`
      )
      .get(collectorId, today) as { c: number }
  ).c;

  const pendingJobs = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM collector_assignments ca
         JOIN bookings b ON b.id = ca.booking_id
         WHERE ca.collector_user_id = ? AND b.status NOT IN ('COMPLETED','CANCELLED')`
      )
      .get(collectorId) as { c: number }
  ).c;

  const completedJobs = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM collector_assignments ca
         JOIN bookings b ON b.id = ca.booking_id
         WHERE ca.collector_user_id = ? AND b.status = 'COMPLETED'`
      )
      .get(collectorId) as { c: number }
  ).c;

  const profile = db
    .prepare(
      `SELECT u.id, u.full_name, u.email, u.phone, cp.vehicle_number, cp.vehicle_type, bp.business_name as dealer_name
       FROM users u
       JOIN collector_profiles cp ON cp.user_id = u.id
       JOIN buyer_profiles bp ON bp.user_id = cp.buyer_user_id
       WHERE u.id = ?`
    )
    .get(collectorId);

  res.json({
    metrics: { todaysJobs, pendingJobs, completedJobs },
    profile,
  });
});

router.get('/jobs', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const collectorId = req.authUser!.id;

  const jobs = db
    .prepare(
      `SELECT b.*, l.title as listing_title, l.reference_code as listing_ref, l.description as listing_description,
              su.full_name as seller_name, su.phone as seller_phone,
              bp.business_name as buyer_business_name,
              a.label as address_label, a.street_line, a.landmark, a.postal_code, sa.name as service_area_name,
              ca.status as assignment_status, ca.arrived_at, ca.started_at, ca.completed_at,
              pa.payment_method, pa.amount as payment_amount, pa.state as payment_state, pa.buyer_reference,
              hr.collector_confirmed_at, hr.seller_confirmed_at,
              tr.receipt_number
       FROM collector_assignments ca
       JOIN bookings b ON b.id = ca.booking_id
       JOIN listings l ON l.id = b.listing_id
       JOIN users su ON su.id = b.seller_user_id
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       JOIN addresses a ON a.id = b.address_id
       JOIN service_areas sa ON sa.id = a.service_area_id
       LEFT JOIN payment_acknowledgements pa ON pa.booking_id = b.id
       LEFT JOIN handover_records hr ON hr.booking_id = b.id
       LEFT JOIN transaction_receipts tr ON tr.booking_id = b.id
       WHERE ca.collector_user_id = ?
       ORDER BY b.pickup_date ASC, b.created_at DESC`
    )
    .all(collectorId) as Array<Record<string, unknown>>;

  const getListingItems = db.prepare(
    `SELECT li.*, m.name as material_name, mu.code as unit_code,
            oi.is_covered, oi.unit_rate as accepted_rate, oi.unit_id as accepted_unit_id
     FROM listing_items li
     JOIN materials m ON m.id = li.material_id
     JOIN material_units mu ON mu.id = li.unit_id
     LEFT JOIN offer_items oi ON oi.listing_item_id = li.id AND oi.offer_id = ?
     WHERE li.listing_id = ?`
  );
  const getCollectionRec = db.prepare('SELECT * FROM collection_records WHERE booking_id = ?');
  const getCollectionItems = db.prepare(
    `SELECT ci.*, m.name as material_name, mu.code as unit_code
     FROM collection_items ci
     JOIN collection_records cr ON cr.id = ci.collection_record_id
     JOIN materials m ON m.id = ci.material_id
     JOIN material_units mu ON mu.id = ci.unit_id
     WHERE cr.booking_id = ?`
  );
  const getRevisions = db.prepare('SELECT * FROM settlement_revisions WHERE booking_id = ? ORDER BY id DESC');

  const enriched = jobs.map((j) => ({
    ...j,
    listingItems: getListingItems.all(Number(j.offer_id), Number(j.listing_id)),
    collectionRecord: getCollectionRec.get(Number(j.id)) || null,
    collectionItems: getCollectionItems.all(Number(j.id)),
    settlementRevisions: getRevisions.all(Number(j.id)),
  }));

  res.json({ jobs: enriched });
});

router.post('/jobs/:bookingId/status', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { action } = req.body || {};
  const db = getDb();
  const collectorId = req.authUser!.id;

  const job = db
    .prepare(
      `SELECT ca.id, b.seller_user_id, b.buyer_user_id, b.booking_reference, b.status
       FROM collector_assignments ca
       JOIN bookings b ON b.id = ca.booking_id
       WHERE ca.booking_id = ? AND ca.collector_user_id = ?`
    )
    .get(bookingId, collectorId) as
    | { id: number; seller_user_id: number; buyer_user_id: number; booking_reference: string; status: string }
    | undefined;

  if (!job) {
    res.status(404).json({ error: 'Assigned pickup job not found.' });
    return;
  }

  if (action === 'ARRIVED') {
    withTransaction(db, () => {
      db.prepare(
        `UPDATE collector_assignments SET status = 'ARRIVED', arrived_at = datetime('now') WHERE id = ?`
      ).run(job.id);
      db.prepare(`UPDATE bookings SET status = 'ARRIVED', updated_at = datetime('now') WHERE id = ?`).run(
        bookingId
      );
      recordNotification(db, {
        userId: job.seller_user_id,
        eventType: 'PICKUP_STATUS_UPDATED',
        title: `Collector arrived for ${job.booking_reference}`,
        body: 'Your assigned collector has arrived at the pickup location.',
        linkPath: '/seller/bookings',
      });
    });
    res.json({ ok: true, status: 'ARRIVED' });
    return;
  }

  if (action === 'START_COLLECTION') {
    withTransaction(db, () => {
      db.prepare(
        `UPDATE collector_assignments SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?`
      ).run(job.id);
      db.prepare(`UPDATE bookings SET status = 'COLLECTING', updated_at = datetime('now') WHERE id = ?`).run(
        bookingId
      );
      recordNotification(db, {
        userId: job.seller_user_id,
        eventType: 'PICKUP_STATUS_UPDATED',
        title: `Collection started for ${job.booking_reference}`,
        body: 'Weighing and inspection are underway.',
        linkPath: '/seller/bookings',
      });
    });
    res.json({ ok: true, status: 'COLLECTING' });
    return;
  }

  res.status(400).json({ error: 'Unsupported status action. Use ARRIVED or START_COLLECTION.' });
});

router.post('/jobs/:bookingId/record-weights', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { items, inspectionNotes, discrepancyNotes, revisionReason } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Actual weight entries for materials are required.' });
    return;
  }

  const db = getDb();
  const collectorId = req.authUser!.id;

  const job = db
    .prepare(
      `SELECT b.*, ca.id as assignment_id
       FROM collector_assignments ca
       JOIN bookings b ON b.id = ca.booking_id
       WHERE ca.booking_id = ? AND ca.collector_user_id = ?`
    )
    .get(bookingId, collectorId) as
    | {
        id: number;
        booking_reference: string;
        listing_id: number;
        offer_id: number;
        seller_user_id: number;
        buyer_user_id: number;
        status: string;
      }
    | undefined;

  if (!job) {
    res.status(404).json({ error: 'Assigned pickup job not found.' });
    return;
  }

  const offerItems = db
    .prepare(
      `SELECT oi.listing_item_id, oi.unit_rate, oi.unit_id, oi.is_covered, li.material_id
       FROM offer_items oi
       JOIN listing_items li ON li.id = oi.listing_item_id
       WHERE oi.offer_id = ? AND oi.is_covered = 1`
    )
    .all(job.offer_id) as Array<{
    listing_item_id: number;
    unit_rate: number;
    unit_id: number;
    material_id: number;
  }>;

  const offerItemMap = new Map(offerItems.map((oi) => [oi.listing_item_id, oi]));
  const calcInputs: Array<{
    listingItemId: number;
    actualQuantity: number;
    acceptedRate: number;
    proposedRate: number;
    originalMaterialId: number;
    proposedMaterialId: number;
    unitId: number;
    grade: string;
    evidenceMediaId: number | null;
    notes: string;
  }> = [];

  for (const raw of items) {
    const lid = Number(raw.listingItemId);
    const base = offerItemMap.get(lid);
    if (!base) {
      res.status(400).json({ error: `Item ${lid} is not a covered item in the accepted offer.` });
      return;
    }
    const actualQty = Number(raw.actualQuantity);
    if (!Number.isFinite(actualQty) || actualQty < 0) {
      res.status(400).json({ error: 'Actual quantity must be a non-negative number.' });
      return;
    }
    const proposedRate =
      raw.proposedRate !== undefined && raw.proposedRate !== null
        ? Number(raw.proposedRate)
        : base.unit_rate;
    const proposedMaterialId =
      raw.proposedMaterialId !== undefined && raw.proposedMaterialId !== null
        ? Number(raw.proposedMaterialId)
        : base.material_id;

    calcInputs.push({
      listingItemId: lid,
      actualQuantity: actualQty,
      acceptedRate: base.unit_rate,
      proposedRate,
      originalMaterialId: base.material_id,
      proposedMaterialId,
      unitId: base.unit_id,
      grade: raw.materialGrade ? String(raw.materialGrade).trim() : 'STANDARD',
      evidenceMediaId: raw.evidenceMediaId ? Number(raw.evidenceMediaId) : null,
      notes: raw.notes ? String(raw.notes).trim() : '',
    });
  }

  const totals = calculateSettlementTotals(calcInputs);
  const needsRevision =
    totals.hasRateChange ||
    calcInputs.some((c) => c.proposedMaterialId !== c.originalMaterialId);

  if (needsRevision && (!revisionReason || String(revisionReason).trim().length < 5)) {
    res.status(400).json({
      error:
        'A clear reason is required whenever proposing a material category or unit rate change from the accepted offer.',
    });
    return;
  }

  const outcome = withTransaction(db, () => {
    // Replace prior unfinalized collection record if re-weighed before approval
    db.prepare('DELETE FROM collection_records WHERE booking_id = ?').run(bookingId);

    const recRes = db
      .prepare(
        `INSERT INTO collection_records (booking_id, collector_user_id, inspection_notes, discrepancy_notes, calculated_total)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        bookingId,
        collectorId,
        inspectionNotes ? String(inspectionNotes).trim() : '',
        discrepancyNotes ? String(discrepancyNotes).trim() : '',
        totals.originalTotal
      );
    const recId = Number(recRes.lastInsertRowid);

    const insColItem = db.prepare(
      `INSERT INTO collection_items (collection_record_id, listing_item_id, material_id, unit_id, actual_quantity, material_grade, accepted_unit_rate, line_total, evidence_media_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of calcInputs) {
      const lineTotal = roundCurrency(c.actualQuantity * c.acceptedRate);
      insColItem.run(
        recId,
        c.listingItemId,
        c.originalMaterialId,
        c.unitId,
        c.actualQuantity,
        c.grade,
        c.acceptedRate,
        lineTotal,
        c.evidenceMediaId,
        c.notes
      );
    }

    let revisionId: number | null = null;
    if (needsRevision) {
      const revRes = db
        .prepare(
          `INSERT INTO settlement_revisions (booking_id, proposed_by_user_id, reason, original_total, revised_total, status)
           VALUES (?, ?, ?, ?, ?, 'PENDING_SELLER')`
        )
        .run(
          bookingId,
          collectorId,
          String(revisionReason).trim(),
          totals.originalTotal,
          totals.revisedTotal
        );
      revisionId = Number(revRes.lastInsertRowid);

      const insRevItem = db.prepare(
        `INSERT INTO settlement_revision_items (settlement_revision_id, listing_item_id, original_material_id, revised_material_id, original_rate, revised_rate, actual_quantity, revised_grade, original_line_total, revised_line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of calcInputs) {
        insRevItem.run(
          revisionId,
          c.listingItemId,
          c.originalMaterialId,
          c.proposedMaterialId,
          c.acceptedRate,
          c.proposedRate,
          c.actualQuantity,
          c.grade,
          roundCurrency(c.actualQuantity * c.acceptedRate),
          roundCurrency(c.actualQuantity * c.proposedRate)
        );
      }

      db.prepare(
        `UPDATE bookings SET status = 'WEIGHED_PENDING_APPROVAL', updated_at = datetime('now') WHERE id = ?`
      ).run(bookingId);

      recordNotification(db, {
        userId: job.seller_user_id,
        eventType: 'SETTLEMENT_REVISION_REQUESTED',
        title: `Settlement revision needs approval (${job.booking_reference})`,
        body: `Original weighted total: ${totals.originalTotal}; Proposed revised total: ${totals.revisedTotal}. Reason: ${String(revisionReason).trim()}`,
        linkPath: '/seller/bookings',
      });
    } else {
      db.prepare(
        `UPDATE bookings SET status = 'SETTLEMENT_APPROVED', final_settlement_amount = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(totals.originalTotal, bookingId);
    }

    recordAuditLog(db, {
      actorUserId: collectorId,
      actorRole: 'COLLECTOR',
      action: needsRevision ? 'WEIGHTS_RECORDED_REVISION_PROPOSED' : 'WEIGHTS_RECORDED',
      entityType: 'BOOKING',
      entityId: bookingId,
      metadata: {
        originalTotal: totals.originalTotal,
        revisedTotal: totals.revisedTotal,
        needsRevision,
        revisionId,
      },
    });

    return {
      collectionRecordId: recId,
      needsSellerApproval: needsRevision,
      revisionId,
      originalTotal: totals.originalTotal,
      revisedTotal: totals.revisedTotal,
    };
  });

  res.status(201).json(outcome);
});

router.post('/jobs/:bookingId/acknowledge-payment', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { paymentMethod, buyerReference, notes } = req.body || {};
  const validMethods = ['CASH', 'BANK_TRANSFER', 'UPI_DIRECT', 'OTHER'];
  if (!validMethods.includes(String(paymentMethod))) {
    res.status(400).json({ error: 'Valid payment method is required.' });
    return;
  }

  const db = getDb();
  const collectorId = req.authUser!.id;
  const job = db
    .prepare(
      `SELECT b.*, cr.calculated_total
       FROM collector_assignments ca
       JOIN bookings b ON b.id = ca.booking_id
       LEFT JOIN collection_records cr ON cr.booking_id = b.id
       WHERE ca.booking_id = ? AND ca.collector_user_id = ?`
    )
    .get(bookingId, collectorId) as
    | {
        id: number;
        seller_user_id: number;
        booking_reference: string;
        final_settlement_amount: number | null;
        calculated_total: number | null;
      }
    | undefined;

  if (!job || job.calculated_total === null) {
    res.status(400).json({ error: 'Weigh materials before recording payment acknowledgement.' });
    return;
  }
  const pendingRev = db
    .prepare("SELECT id FROM settlement_revisions WHERE booking_id = ? AND status = 'PENDING_SELLER'")
    .get(bookingId);
  if (pendingRev) {
    res.status(409).json({
      error: 'Seller must approve or reject the pending settlement revision before payment acknowledgement.',
    });
    return;
  }

  const amount =
    job.final_settlement_amount !== null ? job.final_settlement_amount : job.calculated_total;

  withTransaction(db, () => {
    const existing = db
      .prepare('SELECT id FROM payment_acknowledgements WHERE booking_id = ?')
      .get(bookingId);
    if (!existing) {
      db.prepare(
        `INSERT INTO payment_acknowledgements (booking_id, payment_method, amount, state, buyer_ack_by, buyer_ack_at, buyer_reference, notes)
         VALUES (?, ?, ?, 'ACKNOWLEDGED_BY_BUYER', ?, datetime('now'), ?, ?)`
      ).run(
        bookingId,
        String(paymentMethod),
        amount,
        collectorId,
        buyerReference ? String(buyerReference).trim() : null,
        notes ? String(notes).trim() : ''
      );
    } else {
      db.prepare(
        `UPDATE payment_acknowledgements
         SET payment_method = ?, amount = ?, state = CASE WHEN state = 'ACKNOWLEDGED_BY_SELLER' THEN state ELSE 'ACKNOWLEDGED_BY_BUYER' END,
             buyer_ack_by = ?, buyer_ack_at = datetime('now'), buyer_reference = COALESCE(?, buyer_reference),
             updated_at = datetime('now')
         WHERE booking_id = ?`
      ).run(
        String(paymentMethod),
        amount,
        collectorId,
        buyerReference ? String(buyerReference).trim() : null,
        bookingId
      );
    }

    recordNotification(db, {
      userId: job.seller_user_id,
      eventType: 'PAYMENT_ACKNOWLEDGED',
      title: `Payment recorded for ${job.booking_reference}`,
      body: `Collector recorded ${paymentMethod} payment of ${amount}. Please review and acknowledge receipt.`,
      linkPath: '/seller/bookings',
    });
  });

  res.json({ ok: true, amount, paymentState: 'ACKNOWLEDGED_BY_BUYER' });
});

router.post('/jobs/:bookingId/acknowledge-handover', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { notes } = req.body || {};
  const db = getDb();
  const collectorId = req.authUser!.id;

  const job = db
    .prepare(
      `SELECT b.* FROM collector_assignments ca
       JOIN bookings b ON b.id = ca.booking_id
       WHERE ca.booking_id = ? AND ca.collector_user_id = ?`
    )
    .get(bookingId, collectorId) as
    | { id: number; seller_user_id: number; booking_reference: string }
    | undefined;
  if (!job) {
    res.status(404).json({ error: 'Assigned job not found.' });
    return;
  }

  const outcome = withTransaction(db, () => {
    const existing = db.prepare('SELECT id FROM handover_records WHERE booking_id = ?').get(bookingId);
    if (!existing) {
      db.prepare(
        `INSERT INTO handover_records (booking_id, collector_confirmed_by, collector_confirmed_at, handover_notes)
         VALUES (?, ?, datetime('now'), ?)`
      ).run(bookingId, collectorId, notes ? String(notes).trim() : '');
    } else {
      db.prepare(
        `UPDATE handover_records
         SET collector_confirmed_by = ?, collector_confirmed_at = datetime('now'),
             handover_notes = CASE WHEN ? != '' THEN ? ELSE handover_notes END
         WHERE booking_id = ?`
      ).run(
        collectorId,
        notes ? String(notes).trim() : '',
        notes ? String(notes).trim() : '',
        bookingId
      );
    }

    recordNotification(db, {
      userId: job.seller_user_id,
      eventType: 'HANDOVER_CONFIRMED',
      title: `Collector confirmed handover (${job.booking_reference})`,
      body: 'Confirm material handover in your bookings screen to issue the digital receipt.',
      linkPath: '/seller/bookings',
    });

    return finalizeBookingIfReady(db, bookingId, collectorId, 'COLLECTOR');
  });

  res.json({ ok: true, ...outcome });
});

export default router;
