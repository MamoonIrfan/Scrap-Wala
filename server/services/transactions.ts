import type { DatabaseSync } from 'node:sqlite';
import { calculatePlatformFee } from '../domain/rules';
import { generateRefCode, recordAuditLog, recordNotification } from './audit';

export function finalizeBookingIfReady(
  db: DatabaseSync,
  bookingId: number,
  actorUserId: number,
  actorRole: string
): { completed: boolean; receiptNumber?: string; feeAssessed?: number } {
  const booking = db
    .prepare(
      `SELECT b.*, l.reference_code as listing_ref,
              sp.full_name as seller_name, bp.business_name as buyer_business_name
       FROM bookings b
       JOIN listings l ON l.id = b.listing_id
       JOIN users sp ON sp.id = b.seller_user_id
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       WHERE b.id = ?`
    )
    .get(bookingId) as
    | {
        id: number;
        booking_reference: string;
        listing_id: number;
        listing_ref: string;
        seller_user_id: number;
        buyer_user_id: number;
        seller_name: string;
        buyer_business_name: string;
        status: string;
        final_settlement_amount: number | null;
        estimated_total_amount: number;
      }
    | undefined;

  if (!booking) {
    throw new Error('Booking not found.');
  }
  if (booking.status === 'COMPLETED') {
    const existing = db
      .prepare('SELECT receipt_number FROM transaction_receipts WHERE booking_id = ?')
      .get(bookingId) as { receipt_number: string } | undefined;
    return { completed: true, receiptNumber: existing?.receipt_number };
  }

  const pendingRevision = db
    .prepare(
      `SELECT id FROM settlement_revisions WHERE booking_id = ? AND status = 'PENDING_SELLER'`
    )
    .get(bookingId);
  if (pendingRevision) {
    return { completed: false };
  }

  const payment = db
    .prepare('SELECT * FROM payment_acknowledgements WHERE booking_id = ?')
    .get(bookingId) as
    | {
        payment_method: string;
        amount: number;
        state: string;
        buyer_ack_at: string | null;
        seller_ack_at: string | null;
      }
    | undefined;

  const handover = db
    .prepare('SELECT * FROM handover_records WHERE booking_id = ?')
    .get(bookingId) as
    | {
        collector_confirmed_at: string | null;
        seller_confirmed_at: string | null;
      }
    | undefined;

  const collection = db
    .prepare('SELECT * FROM collection_records WHERE booking_id = ?')
    .get(bookingId) as { id: number; calculated_total: number; collector_user_id: number } | undefined;

  if (
    !collection ||
    !payment ||
    (payment.state !== 'ACKNOWLEDGED_BY_SELLER' && payment.state !== 'PROVIDER_VERIFIED') ||
    !handover ||
    !handover.collector_confirmed_at ||
    !handover.seller_confirmed_at
  ) {
    return { completed: false };
  }

  const finalAmount =
    booking.final_settlement_amount !== null
      ? booking.final_settlement_amount
      : collection.calculated_total;

  // Mark booking and listing COMPLETED
  db.prepare(
    `UPDATE bookings SET status = 'COMPLETED', final_settlement_amount = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(finalAmount, bookingId);

  db.prepare(
    `UPDATE listings SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?`
  ).run(booking.listing_id);

  db.prepare(
    `UPDATE collector_assignments SET status = 'COMPLETED', completed_at = COALESCE(completed_at, datetime('now')) WHERE booking_id = ?`
  ).run(bookingId);

  db.prepare(
    `UPDATE pickup_slots SET status = 'COMPLETED' WHERE booking_id = ?`
  ).run(bookingId);

  db.prepare(
    `UPDATE buyer_capacity SET active_bookings_count = MAX(0, active_bookings_count - 1), updated_at = datetime('now') WHERE buyer_user_id = ?`
  ).run(booking.buyer_user_id);

  db.prepare(
    `UPDATE buyer_profiles SET completed_transactions_count = completed_transactions_count + 1, updated_at = datetime('now') WHERE user_id = ?`
  ).run(booking.buyer_user_id);

  const collectorRow = db
    .prepare(
      `SELECT u.full_name FROM collector_assignments ca
       JOIN users u ON u.id = ca.collector_user_id
       WHERE ca.booking_id = ?`
    )
    .get(bookingId) as { full_name: string } | undefined;

  const items = db
    .prepare(
      `SELECT ci.*, m.name as material_name, mu.code as unit_code
       FROM collection_items ci
       JOIN materials m ON m.id = ci.material_id
       JOIN material_units mu ON mu.id = ci.unit_id
       WHERE ci.collection_record_id = ?`
    )
    .all(collection.id) as Array<{
    material_name: string;
    material_grade: string;
    actual_quantity: number;
    unit_code: string;
    accepted_unit_rate: number;
    line_total: number;
  }>;

  const revisions = db
    .prepare(
      `SELECT id, reason, original_total, revised_total, status, decided_at
       FROM settlement_revisions WHERE booking_id = ? ORDER BY id ASC`
    )
    .all(bookingId);

  const receiptNumber = generateRefCode('RCP');
  const receiptPayload = {
    receiptNumber,
    bookingReference: booking.booking_reference,
    listingReference: booking.listing_ref,
    sellerName: booking.seller_name,
    buyerBusinessName: booking.buyer_business_name,
    collectorName: collectorRow?.full_name || 'Assigned Collector',
    items: items.map((i) => ({
      material: i.material_name,
      grade: i.material_grade,
      actualQty: i.actual_quantity,
      unit: i.unit_code,
      rate: i.accepted_unit_rate,
      lineTotal: i.line_total,
    })),
    approvedAdjustments: revisions,
    finalAmount,
    paymentMethod: payment.payment_method,
    paymentState: payment.state,
    handoverConfirmed: true,
    completedAt: new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO transaction_receipts (receipt_number, booking_id, receipt_payload_json, final_amount)
     VALUES (?, ?, ?, ?)`
  ).run(receiptNumber, bookingId, JSON.stringify(receiptPayload), finalAmount);

  // Assess Buyer-side service fee ONLY on COMPLETED transaction
  const activeFeeRule = db
    .prepare(
      `SELECT id, fee_type, rate_value, min_fee, max_fee, applies_to_status
       FROM platform_fee_rules WHERE is_active = 1 ORDER BY id DESC LIMIT 1`
    )
    .get() as
    | {
        id: number;
        fee_type: 'PERCENTAGE' | 'FLAT';
        rate_value: number;
        min_fee: number;
        max_fee: number | null;
        applies_to_status: 'COMPLETED';
      }
    | undefined;

  let feeAssessed = 0;
  if (activeFeeRule) {
    feeAssessed = calculatePlatformFee(finalAmount, 'COMPLETED', {
      id: activeFeeRule.id,
      feeType: activeFeeRule.fee_type,
      rateValue: activeFeeRule.rate_value,
      minFee: activeFeeRule.min_fee,
      maxFee: activeFeeRule.max_fee,
      appliesToStatus: activeFeeRule.applies_to_status,
    });
    if (feeAssessed > 0) {
      db.prepare(
        `INSERT INTO platform_fee_ledger (booking_id, buyer_user_id, fee_rule_id, transaction_reference, gross_transaction_amount, fee_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ASSESSED')`
      ).run(
        bookingId,
        booking.buyer_user_id,
        activeFeeRule.id,
        booking.booking_reference,
        finalAmount,
        feeAssessed
      );
    }
  }

  recordAuditLog(db, {
    actorUserId,
    actorRole,
    action: 'TRANSACTION_COMPLETED',
    entityType: 'BOOKING',
    entityId: bookingId,
    metadata: { receiptNumber, finalAmount, feeAssessed },
  });

  recordNotification(db, {
    userId: booking.seller_user_id,
    eventType: 'TRANSACTION_COMPLETED',
    title: `Receipt ${receiptNumber} issued`,
    body: `Pickup ${booking.booking_reference} is complete. Final settlement: ${finalAmount}.`,
    linkPath: '/seller/receipts',
  });
  recordNotification(db, {
    userId: booking.buyer_user_id,
    eventType: 'TRANSACTION_COMPLETED',
    title: `Transaction ${booking.booking_reference} completed`,
    body: `Receipt ${receiptNumber} issued. Disclosed coordination fee: ${feeAssessed}.`,
    linkPath: '/buyer/ledger',
  });

  return { completed: true, receiptNumber, feeAssessed };
}
