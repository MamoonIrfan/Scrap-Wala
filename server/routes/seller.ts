import { Router } from 'express';
import { getDb, withTransaction } from '../db/database';
import { evaluateBuyerEligibility, rankOffers } from '../domain/rules';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth';
import { generateRefCode, recordAuditLog, recordNotification } from '../services/audit';
import { finalizeBookingIfReady } from '../services/transactions';

const router = Router();
router.use(requireAuth, requireRole('SELLER'));

router.get('/dashboard', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const sellerId = req.authUser!.id;

  const activeListings = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM listings WHERE seller_user_id = ? AND status IN ('DRAFT','PUBLISHED') AND deleted_at IS NULL`
      )
      .get(sellerId) as { c: number }
  ).c;

  const receivedOffers = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM offers o
         JOIN listings l ON l.id = o.listing_id
         WHERE l.seller_user_id = ? AND o.status = 'ACTIVE'`
      )
      .get(sellerId) as { c: number }
  ).c;

  const upcomingPickups = (
    db
      .prepare(
        `SELECT COUNT(*) as c FROM bookings
         WHERE seller_user_id = ? AND status IN ('CONFIRMED','COLLECTOR_ASSIGNED','ARRIVED','COLLECTING','WEIGHED_PENDING_APPROVAL','SETTLEMENT_APPROVED')`
      )
      .get(sellerId) as { c: number }
  ).c;

  const completedStats = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(final_settlement_amount), 0) as totalReceived
       FROM bookings WHERE seller_user_id = ? AND status = 'COMPLETED'`
    )
    .get(sellerId) as { count: number; totalReceived: number };

  const recentBookings = db
    .prepare(
      `SELECT b.id, b.booking_reference, b.status, b.pickup_date, b.pickup_window,
              b.estimated_total_amount, b.final_settlement_amount, b.is_demo_seed,
              bp.business_name as buyer_business_name
       FROM bookings b
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       WHERE b.seller_user_id = ?
       ORDER BY b.created_at DESC LIMIT 5`
    )
    .all(sellerId);

  const profile = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.phone_verified, u.is_demo_seed,
              sp.seller_type, sp.organization_name, sp.preferred_payment_method
       FROM users u
       LEFT JOIN seller_profiles sp ON sp.user_id = u.id
       WHERE u.id = ?`
    )
    .get(sellerId);

  res.json({
    metrics: {
      activeListings,
      receivedOffers,
      upcomingPickups,
      completedTransactions: completedStats.count,
      totalReceivedAmount: completedStats.totalReceived,
    },
    recentBookings,
    profile,
  });
});

router.put('/profile', (req: AuthenticatedRequest, res) => {
  const { fullName, sellerType, organizationName, preferredPaymentMethod } = req.body || {};
  const db = getDb();
  const sellerId = req.authUser!.id;
  if (fullName && String(fullName).trim().length >= 2) {
    db.prepare(`UPDATE users SET full_name = ?, updated_at = datetime('now') WHERE id = ?`).run(
      String(fullName).trim(),
      sellerId
    );
  }
  db.prepare(
    `UPDATE seller_profiles
     SET seller_type = COALESCE(?, seller_type),
         organization_name = ?,
         preferred_payment_method = COALESCE(?, preferred_payment_method),
         updated_at = datetime('now')
     WHERE user_id = ?`
  ).run(
    sellerType === 'SMALL_BUSINESS' ? 'SMALL_BUSINESS' : sellerType === 'HOUSEHOLD' ? 'HOUSEHOLD' : null,
    organizationName !== undefined ? (organizationName ? String(organizationName).trim() : null) : null,
    preferredPaymentMethod || null,
    sellerId
  );
  res.json({ ok: true });
});

router.get('/addresses', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const addresses = db
    .prepare(
      `SELECT a.*, sa.name as service_area_name, sa.city
       FROM addresses a
       JOIN service_areas sa ON sa.id = a.service_area_id
       WHERE a.user_id = ? AND a.deleted_at IS NULL
       ORDER BY a.is_default DESC, a.id DESC`
    )
    .all(req.authUser!.id);
  res.json({ addresses });
});

router.post('/addresses', (req: AuthenticatedRequest, res) => {
  const { serviceAreaId, label, streetLine, landmark, postalCode, isDefault } = req.body || {};
  if (!serviceAreaId || !label || !streetLine || !postalCode) {
    res.status(400).json({ error: 'Service area, label, street address, and postal code are required.' });
    return;
  }
  const db = getDb();
  const area = db
    .prepare('SELECT id FROM service_areas WHERE id = ? AND is_active = 1')
    .get(Number(serviceAreaId));
  if (!area) {
    res.status(400).json({ error: 'Selected service area is unavailable or inactive.' });
    return;
  }

  const addressId = withTransaction(db, () => {
    if (isDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.authUser!.id);
    }
    const info = db
      .prepare(
        `INSERT INTO addresses (user_id, service_area_id, label, street_line, landmark, postal_code, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.authUser!.id,
        Number(serviceAreaId),
        String(label).trim(),
        String(streetLine).trim(),
        landmark ? String(landmark).trim() : null,
        String(postalCode).trim(),
        isDefault ? 1 : 0
      );
    return Number(info.lastInsertRowid);
  });
  res.status(201).json({ id: addressId });
});

router.delete('/addresses/:id', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const info = db
    .prepare(`UPDATE addresses SET deleted_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .run(Number(req.params.id), req.authUser!.id);
  if (info.changes === 0) {
    res.status(404).json({ error: 'Address not found.' });
    return;
  }
  res.json({ ok: true });
});

router.get('/listings', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const listings = db
    .prepare(
      `SELECT l.*, sa.name as service_area_name, a.label as address_label, a.street_line, a.postal_code,
              (SELECT COUNT(*) FROM offers o WHERE o.listing_id = l.id AND o.status = 'ACTIVE') as active_offers_count
       FROM listings l
       JOIN service_areas sa ON sa.id = l.service_area_id
       JOIN addresses a ON a.id = l.address_id
       WHERE l.seller_user_id = ? AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC`
    )
    .all(req.authUser!.id) as Array<Record<string, unknown>>;

  const getItems = db.prepare(
    `SELECT li.*, m.name as material_name, m.slug as material_slug, mu.code as unit_code, mu.name as unit_name
     FROM listing_items li
     JOIN materials m ON m.id = li.material_id
     JOIN material_units mu ON mu.id = li.unit_id
     WHERE li.listing_id = ?`
  );
  const getImages = db.prepare(
    `SELECT li.id, li.media_file_id, li.caption, mf.original_name
     FROM listing_images li
     JOIN media_files mf ON mf.id = li.media_file_id
     WHERE li.listing_id = ?`
  );

  const enriched = listings.map((l) => ({
    ...l,
    items: getItems.all(Number(l.id)),
    images: (getImages.all(Number(l.id)) as Array<{ id: number; media_file_id: number; caption: string; original_name: string }>).map((img) => ({
      ...img,
      url: `/api/v1/media/${img.media_file_id}`,
    })),
  }));

  res.json({ listings: enriched });
});

router.post('/listings', (req: AuthenticatedRequest, res) => {
  const {
    addressId,
    title,
    description,
    preferredPickupDate,
    preferredPickupWindow,
    status,
    aiAssisted,
    aiTags,
    items,
    mediaFileIds,
  } = req.body || {};

  const db = getDb();
  const sellerId = req.authUser!.id;
  const targetStatus = status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

  if (!addressId || !title || !description || !preferredPickupDate || !preferredPickupWindow) {
    res.status(400).json({
      error: 'Address, title, description, pickup date, and pickup window are required.',
    });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'At least one material item is required.' });
    return;
  }

  // Check optional phone OTP requirement from platform_settings
  if (targetStatus === 'PUBLISHED') {
    const setting = db
      .prepare("SELECT value FROM platform_settings WHERE key = 'require_seller_phone_otp_for_publish'")
      .get() as { value: string } | undefined;
    if (setting?.value === 'true' && !req.authUser!.phoneVerified) {
      res.status(400).json({
        error: 'Phone OTP verification is required by platform settings before publishing a listing.',
      });
      return;
    }
  }

  const address = db
    .prepare(
      `SELECT a.id, a.service_area_id, sa.is_active as area_active
       FROM addresses a
       JOIN service_areas sa ON sa.id = a.service_area_id
       WHERE a.id = ? AND a.user_id = ? AND a.deleted_at IS NULL`
    )
    .get(Number(addressId), sellerId) as
    | { id: number; service_area_id: number; area_active: number }
    | undefined;

  if (!address || address.area_active !== 1) {
    res.status(400).json({ error: 'Selected pickup address or service area is invalid or inactive.' });
    return;
  }

  // Validate materials & units
  for (const item of items) {
    const mat = db
      .prepare('SELECT id FROM materials WHERE id = ? AND is_active = 1')
      .get(Number(item.materialId));
    const unit = db
      .prepare('SELECT id FROM material_units WHERE id = ? AND is_active = 1')
      .get(Number(item.unitId));
    if (!mat || !unit) {
      res.status(400).json({ error: 'Each listing item must reference an active material and unit.' });
      return;
    }
    if (!item.quantityUnknown && (item.estimatedQuantity === undefined || Number(item.estimatedQuantity) <= 0)) {
      res.status(400).json({
        error: 'Specify a positive estimated quantity or mark "Weight Unknown".',
      });
      return;
    }
  }

  const created = withTransaction(db, () => {
    const referenceCode = generateRefCode('LST');
    const listingRes = db
      .prepare(
        `INSERT INTO listings (reference_code, seller_user_id, address_id, service_area_id, title, description, preferred_pickup_date, preferred_pickup_window, status, ai_assisted, ai_tags_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        referenceCode,
        sellerId,
        address.id,
        address.service_area_id,
        String(title).trim(),
        String(description).trim(),
        String(preferredPickupDate),
        String(preferredPickupWindow),
        targetStatus,
        aiAssisted ? 1 : 0,
        JSON.stringify(Array.isArray(aiTags) ? aiTags : [])
      );
    const listingId = Number(listingRes.lastInsertRowid);

    const insertItem = db.prepare(
      `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes, ai_suggested_category, ai_confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of items) {
      insertItem.run(
        listingId,
        Number(item.materialId),
        Number(item.unitId),
        item.quantityUnknown ? null : Number(item.estimatedQuantity),
        item.quantityUnknown ? 1 : 0,
        item.itemNotes ? String(item.itemNotes).trim() : '',
        item.aiSuggestedCategory ? String(item.aiSuggestedCategory) : null,
        item.aiConfidence !== undefined ? Number(item.aiConfidence) : null
      );
    }

    if (Array.isArray(mediaFileIds)) {
      const insertImg = db.prepare(
        `INSERT INTO listing_images (listing_id, media_file_id, caption) VALUES (?, ?, '')`
      );
      for (const fid of mediaFileIds) {
        const ownsMedia = db
          .prepare('SELECT id FROM media_files WHERE id = ? AND owner_user_id = ?')
          .get(Number(fid), sellerId);
        if (ownsMedia) {
          insertImg.run(listingId, Number(fid));
        }
      }
    }

    // Notify eligible buyers if published
    if (targetStatus === 'PUBLISHED') {
      const listingMaterialIds = items.map((i: { materialId: number }) => Number(i.materialId));
      const allBuyers = db
        .prepare(
          `SELECT u.id as user_id, u.account_status, bp.verification_status, bp.is_available,
                  bc.max_weight_kg, bc.max_daily_pickups, bc.active_bookings_count
           FROM buyer_profiles bp
           JOIN users u ON u.id = bp.user_id
           JOIN buyer_capacity bc ON bc.buyer_user_id = bp.user_id`
        )
        .all() as Array<{
        user_id: number;
        account_status: string;
        verification_status: string;
        is_available: number;
        max_weight_kg: number;
        max_daily_pickups: number;
        active_bookings_count: number;
      }>;

      for (const b of allBuyers) {
        const areaIds = (
          db
            .prepare('SELECT service_area_id FROM buyer_service_areas WHERE buyer_user_id = ?')
            .all(b.user_id) as Array<{ service_area_id: number }>
        ).map((r) => r.service_area_id);
        const matIds = (
          db
            .prepare('SELECT material_id FROM buyer_material_capabilities WHERE buyer_user_id = ?')
            .all(b.user_id) as Array<{ material_id: number }>
        ).map((r) => r.material_id);

        const elig = evaluateBuyerEligibility(
          {
            accountStatus: b.account_status,
            verificationStatus: b.verification_status,
            isAvailable: b.is_available === 1,
            serviceAreaIds: areaIds,
            supportedMaterialIds: matIds,
            maxWeightKg: b.max_weight_kg,
            maxDailyPickups: b.max_daily_pickups,
            activeBookingsCount: b.active_bookings_count,
          },
          {
            serviceAreaId: address.service_area_id,
            materialIds: listingMaterialIds,
            totalKnownMassKg: 0,
          }
        );

        if (elig.eligible) {
          recordNotification(db, {
            userId: b.user_id,
            eventType: 'LISTING_MATCH',
            title: `New open request ${referenceCode}`,
            body: `${String(title).trim()} matches your service area and supported materials.`,
            linkPath: '/buyer/marketplace',
          });
        }
      }
    }

    recordAuditLog(db, {
      actorUserId: sellerId,
      actorRole: 'SELLER',
      action: targetStatus === 'PUBLISHED' ? 'LISTING_PUBLISHED' : 'LISTING_DRAFT_SAVED',
      entityType: 'LISTING',
      entityId: listingId,
      metadata: { referenceCode },
    });

    return { id: listingId, referenceCode, status: targetStatus };
  });

  res.status(201).json(created);
});

router.post('/listings/:id/publish', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const listing = db
    .prepare('SELECT id, status FROM listings WHERE id = ? AND seller_user_id = ? AND deleted_at IS NULL')
    .get(Number(req.params.id), req.authUser!.id) as { id: number; status: string } | undefined;

  if (!listing) {
    res.status(404).json({ error: 'Listing not found.' });
    return;
  }
  if (listing.status !== 'DRAFT') {
    res.status(400).json({ error: `Cannot publish listing in ${listing.status} state.` });
    return;
  }

  db.prepare(`UPDATE listings SET status = 'PUBLISHED', updated_at = datetime('now') WHERE id = ?`).run(
    listing.id
  );
  res.json({ ok: true, status: 'PUBLISHED' });
});

router.post('/listings/:id/cancel', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const listing = db
    .prepare('SELECT id, status FROM listings WHERE id = ? AND seller_user_id = ? AND deleted_at IS NULL')
    .get(Number(req.params.id), req.authUser!.id) as { id: number; status: string } | undefined;

  if (!listing) {
    res.status(404).json({ error: 'Listing not found.' });
    return;
  }
  if (listing.status !== 'DRAFT' && listing.status !== 'PUBLISHED') {
    res.status(400).json({ error: 'Only draft or published listings without an active booking can be cancelled.' });
    return;
  }
  withTransaction(db, () => {
    db.prepare(`UPDATE listings SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(
      listing.id
    );
    db.prepare(`UPDATE offers SET status = 'DECLINED', updated_at = datetime('now') WHERE listing_id = ? AND status = 'ACTIVE'`).run(
      listing.id
    );
  });
  res.json({ ok: true, status: 'CANCELLED' });
});

router.get('/listings/:id/offers', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const listing = db
    .prepare('SELECT * FROM listings WHERE id = ? AND seller_user_id = ? AND deleted_at IS NULL')
    .get(Number(req.params.id), req.authUser!.id);
  if (!listing) {
    res.status(404).json({ error: 'Listing not found.' });
    return;
  }

  const offers = db
    .prepare(
      `SELECT o.*, bp.business_name, bp.warehouse_area, bp.verification_status,
              bp.completed_transactions_count, bp.average_rating
       FROM offers o
       JOIN buyer_profiles bp ON bp.user_id = o.buyer_user_id
       WHERE o.listing_id = ? AND o.status IN ('ACTIVE','ACCEPTED')
       ORDER BY o.created_at DESC`
    )
    .all(Number(req.params.id)) as Array<Record<string, unknown>>;

  const getOfferItems = db.prepare(
    `SELECT oi.*, li.material_id, m.name as material_name, li.estimated_quantity, li.quantity_unknown,
            lu.code as listing_unit_code, ou.code as offer_unit_code
     FROM offer_items oi
     JOIN listing_items li ON li.id = oi.listing_item_id
     JOIN materials m ON m.id = li.material_id
     JOIN material_units lu ON lu.id = li.unit_id
     JOIN material_units ou ON ou.id = oi.unit_id
     WHERE oi.offer_id = ?`
  );

  const ranked = rankOffers(
    offers.map((o) => ({
      id: Number(o.id),
      referenceCode: String(o.reference_code),
      buyerUserId: Number(o.buyer_user_id),
      buyerBusinessName: String(o.business_name),
      estimatedTotalValue: Number(o.estimated_total_value),
      coveredItemsCount: Number(o.covered_items_count),
      totalItemsCount: Number(o.total_items_count),
      proposedPickupDate: String(o.proposed_pickup_date),
      proposedPickupWindow: String(o.proposed_pickup_window),
      completedTransactionsCount: Number(o.completed_transactions_count),
      averageRating: Number(o.average_rating),
    }))
  );

  const offerMap = new Map(offers.map((o) => [Number(o.id), o]));
  const enriched = ranked.map((r) => ({
    ...offerMap.get(r.id),
    ranking: r,
    items: getOfferItems.all(r.id),
  }));

  res.json({ listing, offers: enriched });
});

router.post('/offers/:offerId/accept', (req: AuthenticatedRequest, res) => {
  const offerId = Number(req.params.offerId);
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim()
      : null;

  const db = getDb();
  const sellerId = req.authUser!.id;

  if (idempotencyKey) {
    const existing = db
      .prepare('SELECT * FROM bookings WHERE idempotency_key = ? AND seller_user_id = ?')
      .get(idempotencyKey, sellerId);
    if (existing) {
      res.json({ booking: existing, deduplicated: true });
      return;
    }
  }

  try {
    const booking = withTransaction(db, () => {
      const offer = db
        .prepare(
          `SELECT o.*, l.seller_user_id, l.address_id, l.service_area_id, l.status as listing_status, l.reference_code as listing_ref
           FROM offers o
           JOIN listings l ON l.id = o.listing_id
           WHERE o.id = ?`
        )
        .get(offerId) as
        | {
            id: number;
            reference_code: string;
            listing_id: number;
            listing_ref: string;
            buyer_user_id: number;
            seller_user_id: number;
            address_id: number;
            service_area_id: number;
            listing_status: string;
            proposed_pickup_date: string;
            proposed_pickup_window: string;
            conditions_text: string;
            expires_at: string;
            estimated_total_value: number;
            status: string;
          }
        | undefined;

      if (!offer || offer.seller_user_id !== sellerId) {
        throw Object.assign(new Error('Offer not found.'), { statusCode: 404 });
      }
      if (offer.listing_status !== 'PUBLISHED') {
        throw Object.assign(
          new Error(`Listing is already ${offer.listing_status}; cannot create another booking.`),
          { statusCode: 409 }
        );
      }
      if (offer.status !== 'ACTIVE') {
        throw Object.assign(new Error(`Offer is ${offer.status} and cannot be accepted.`), {
          statusCode: 409,
        });
      }
      if (Date.parse(offer.expires_at) < Date.now()) {
        db.prepare(`UPDATE offers SET status = 'EXPIRED', updated_at = datetime('now') WHERE id = ?`).run(
          offer.id
        );
        throw Object.assign(new Error('Offer has expired.'), { statusCode: 409 });
      }

      // Recheck buyer availability & capacity atomically
      const buyerCheck = db
        .prepare(
          `SELECT u.account_status, bp.verification_status, bp.is_available,
                  bc.max_daily_pickups, bc.active_bookings_count
           FROM buyer_profiles bp
           JOIN users u ON u.id = bp.user_id
           JOIN buyer_capacity bc ON bc.buyer_user_id = bp.user_id
           WHERE bp.user_id = ?`
        )
        .get(offer.buyer_user_id) as
        | {
            account_status: string;
            verification_status: string;
            is_available: number;
            max_daily_pickups: number;
            active_bookings_count: number;
          }
        | undefined;

      if (
        !buyerCheck ||
        buyerCheck.account_status !== 'ACTIVE' ||
        buyerCheck.verification_status !== 'VERIFIED' ||
        buyerCheck.is_available !== 1 ||
        buyerCheck.active_bookings_count >= buyerCheck.max_daily_pickups
      ) {
        throw Object.assign(
          new Error('Buyer no longer meets availability or pickup capacity requirements.'),
          { statusCode: 409 }
        );
      }

      const offerItems = db
        .prepare(
          `SELECT oi.*, m.name as material_name, mu.code as unit_code
           FROM offer_items oi
           JOIN listing_items li ON li.id = oi.listing_item_id
           JOIN materials m ON m.id = li.material_id
           JOIN material_units mu ON mu.id = oi.unit_id
           WHERE oi.offer_id = ?`
        )
        .all(offer.id);

      const bookingRef = generateRefCode('BKG');
      const bookingRes = db
        .prepare(
          `INSERT INTO bookings (booking_reference, listing_id, offer_id, seller_user_id, buyer_user_id, address_id, pickup_date, pickup_window, accepted_rates_snapshot_json, accepted_conditions, estimated_total_amount, status, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`
        )
        .run(
          bookingRef,
          offer.listing_id,
          offer.id,
          sellerId,
          offer.buyer_user_id,
          offer.address_id,
          offer.proposed_pickup_date,
          offer.proposed_pickup_window,
          JSON.stringify(offerItems),
          offer.conditions_text,
          offer.estimated_total_value,
          idempotencyKey
        );
      const bookingId = Number(bookingRes.lastInsertRowid);

      db.prepare(
        `UPDATE offers SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?`
      ).run(offer.id);
      db.prepare(
        `UPDATE offers SET status = 'DECLINED', updated_at = datetime('now') WHERE listing_id = ? AND id != ? AND status = 'ACTIVE'`
      ).run(offer.listing_id, offer.id);
      db.prepare(
        `UPDATE listings SET status = 'BOOKED', updated_at = datetime('now') WHERE id = ?`
      ).run(offer.listing_id);

      db.prepare(
        `INSERT INTO pickup_slots (buyer_user_id, slot_date, slot_window, booking_id, status)
         VALUES (?, ?, ?, ?, 'RESERVED')`
      ).run(offer.buyer_user_id, offer.proposed_pickup_date, offer.proposed_pickup_window, bookingId);

      db.prepare(
        `UPDATE buyer_capacity SET active_bookings_count = active_bookings_count + 1, updated_at = datetime('now') WHERE buyer_user_id = ?`
      ).run(offer.buyer_user_id);

      // Assign an active collector belonging to this buyer if available
      const defaultCollector = db
        .prepare(
          `SELECT cp.user_id, u.full_name
           FROM collector_profiles cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.buyer_user_id = ? AND cp.is_active = 1 AND u.account_status = 'ACTIVE'
           ORDER BY cp.user_id ASC LIMIT 1`
        )
        .get(offer.buyer_user_id) as { user_id: number; full_name: string } | undefined;

      if (defaultCollector) {
        db.prepare(
          `INSERT INTO collector_assignments (booking_id, collector_user_id, assigned_by, status)
           VALUES (?, ?, ?, 'ASSIGNED')`
        ).run(bookingId, defaultCollector.user_id, offer.buyer_user_id);
        db.prepare(`UPDATE bookings SET status = 'COLLECTOR_ASSIGNED' WHERE id = ?`).run(bookingId);
        recordNotification(db, {
          userId: defaultCollector.user_id,
          eventType: 'COLLECTOR_ASSIGNED',
          title: `New pickup assigned: ${bookingRef}`,
          body: `Scheduled for ${offer.proposed_pickup_date} (${offer.proposed_pickup_window}).`,
          linkPath: '/collector/jobs',
        });
      }

      recordNotification(db, {
        userId: offer.buyer_user_id,
        eventType: 'OFFER_ACCEPTED',
        title: `Offer ${offer.reference_code} accepted!`,
        body: `Booking ${bookingRef} is confirmed for ${offer.proposed_pickup_date}.`,
        linkPath: '/buyer/bookings',
      });

      recordAuditLog(db, {
        actorUserId: sellerId,
        actorRole: 'SELLER',
        action: 'OFFER_ACCEPTED_BOOKING_CREATED',
        entityType: 'BOOKING',
        entityId: bookingId,
        metadata: { bookingRef, offerId: offer.id, buyerUserId: offer.buyer_user_id },
      });

      return db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
    });

    res.status(201).json({ booking });
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    const message = err instanceof Error ? err.message : 'Unable to accept offer.';
    res.status(status).json({ error: message });
  }
});

router.get('/bookings', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const sellerId = req.authUser!.id;
  const bookings = db
    .prepare(
      `SELECT b.*, l.title as listing_title, l.reference_code as listing_ref,
              bp.business_name as buyer_business_name, bp.business_phone as buyer_phone,
              a.label as address_label, a.street_line, a.postal_code, sa.name as service_area_name,
              ca.collector_user_id, cu.full_name as collector_name, cu.phone as collector_phone,
              cp.vehicle_number, cp.vehicle_type,
              pa.payment_method, pa.amount as payment_amount, pa.state as payment_state, pa.buyer_reference,
              hr.collector_confirmed_at, hr.seller_confirmed_at,
              tr.receipt_number, tr.id as receipt_id,
              rt.score as seller_rating_score
       FROM bookings b
       JOIN listings l ON l.id = b.listing_id
       JOIN buyer_profiles bp ON bp.user_id = b.buyer_user_id
       JOIN addresses a ON a.id = b.address_id
       JOIN service_areas sa ON sa.id = a.service_area_id
       LEFT JOIN collector_assignments ca ON ca.booking_id = b.id
       LEFT JOIN users cu ON cu.id = ca.collector_user_id
       LEFT JOIN collector_profiles cp ON cp.user_id = ca.collector_user_id
       LEFT JOIN payment_acknowledgements pa ON pa.booking_id = b.id
       LEFT JOIN handover_records hr ON hr.booking_id = b.id
       LEFT JOIN transaction_receipts tr ON tr.booking_id = b.id
       LEFT JOIN ratings rt ON rt.booking_id = b.id
       WHERE b.seller_user_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(sellerId) as Array<Record<string, unknown>>;

  const getColItems = db.prepare(
    `SELECT ci.*, m.name as material_name, mu.code as unit_code
     FROM collection_items ci
     JOIN collection_records cr ON cr.id = ci.collection_record_id
     JOIN materials m ON m.id = ci.material_id
     JOIN material_units mu ON mu.id = ci.unit_id
     WHERE cr.booking_id = ?`
  );
  const getColRec = db.prepare('SELECT * FROM collection_records WHERE booking_id = ?');
  const getRevisions = db.prepare('SELECT * FROM settlement_revisions WHERE booking_id = ? ORDER BY id DESC');
  const getRevItems = db.prepare(
    `SELECT sri.*, om.name as original_material_name, rm.name as revised_material_name
     FROM settlement_revision_items sri
     JOIN materials om ON om.id = sri.original_material_id
     JOIN materials rm ON rm.id = sri.revised_material_id
     WHERE sri.settlement_revision_id = ?`
  );

  const enriched = bookings.map((b) => {
    const bid = Number(b.id);
    const revs = (getRevisions.all(bid) as Array<Record<string, unknown>>).map((rv) => ({
      ...rv,
      items: getRevItems.all(Number(rv.id)),
    }));
    return {
      ...b,
      collectionRecord: getColRec.get(bid) || null,
      collectionItems: getColItems.all(bid),
      settlementRevisions: revs,
    };
  });

  res.json({ bookings: enriched });
});

router.post('/settlement-revisions/:revisionId/decide', (req: AuthenticatedRequest, res) => {
  const revisionId = Number(req.params.revisionId);
  const { decision, notes } = req.body || {};
  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    res.status(400).json({ error: 'Decision must be APPROVED or REJECTED.' });
    return;
  }

  const db = getDb();
  const sellerId = req.authUser!.id;

  try {
    const result = withTransaction(db, () => {
      const rev = db
        .prepare(
          `SELECT sr.*, b.seller_user_id, b.buyer_user_id, b.booking_reference
           FROM settlement_revisions sr
           JOIN bookings b ON b.id = sr.booking_id
           WHERE sr.id = ?`
        )
        .get(revisionId) as
        | {
            id: number;
            booking_id: number;
            booking_reference: string;
            seller_user_id: number;
            buyer_user_id: number;
            revised_total: number;
            original_total: number;
            status: string;
          }
        | undefined;

      if (!rev || rev.seller_user_id !== sellerId) {
        throw Object.assign(new Error('Settlement revision not found.'), { statusCode: 404 });
      }
      if (rev.status !== 'PENDING_SELLER') {
        throw Object.assign(new Error('This settlement revision has already been decided.'), {
          statusCode: 409,
        });
      }

      db.prepare(
        `UPDATE settlement_revisions
         SET status = ?, seller_decision_notes = ?, decided_by_user_id = ?, decided_at = datetime('now')
         WHERE id = ?`
      ).run(decision, notes ? String(notes).trim() : null, sellerId, revisionId);

      if (decision === 'APPROVED') {
        const revItems = db
          .prepare('SELECT * FROM settlement_revision_items WHERE settlement_revision_id = ?')
          .all(revisionId) as Array<{
          listing_item_id: number;
          revised_material_id: number;
          revised_rate: number;
          revised_grade: string;
          revised_line_total: number;
        }>;

        const colRec = db
          .prepare('SELECT id FROM collection_records WHERE booking_id = ?')
          .get(rev.booking_id) as { id: number } | undefined;

        if (colRec) {
          for (const ri of revItems) {
            db.prepare(
              `UPDATE collection_items
               SET material_id = ?, material_grade = ?, accepted_unit_rate = ?, line_total = ?
               WHERE collection_record_id = ? AND listing_item_id = ?`
            ).run(
              ri.revised_material_id,
              ri.revised_grade,
              ri.revised_rate,
              ri.revised_line_total,
              colRec.id,
              ri.listing_item_id
            );
          }
          db.prepare(`UPDATE collection_records SET calculated_total = ? WHERE id = ?`).run(
            rev.revised_total,
            colRec.id
          );
        }

        db.prepare(
          `UPDATE bookings SET final_settlement_amount = ?, status = 'SETTLEMENT_APPROVED', updated_at = datetime('now') WHERE id = ?`
        ).run(rev.revised_total, rev.booking_id);

        db.prepare(
          `UPDATE payment_acknowledgements SET amount = ?, updated_at = datetime('now') WHERE booking_id = ?`
        ).run(rev.revised_total, rev.booking_id);
      } else {
        db.prepare(
          `UPDATE bookings SET status = 'SETTLEMENT_APPROVED', final_settlement_amount = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(rev.original_total, rev.booking_id);
      }

      recordNotification(db, {
        userId: rev.buyer_user_id,
        eventType: 'SETTLEMENT_DECISION',
        title: `Settlement revision ${decision.toLowerCase()}`,
        body: `Seller ${decision.toLowerCase()} the revision for ${rev.booking_reference}.`,
        linkPath: '/buyer/bookings',
      });

      recordAuditLog(db, {
        actorUserId: sellerId,
        actorRole: 'SELLER',
        action: `SETTLEMENT_REVISION_${decision}`,
        entityType: 'SETTLEMENT_REVISION',
        entityId: revisionId,
        metadata: { bookingId: rev.booking_id },
      });

      return { ok: true, status: decision };
    });
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { statusCode?: number }).statusCode || 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Decision failed.' });
  }
});

router.post('/bookings/:bookingId/acknowledge-payment', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { disputed, notes } = req.body || {};
  const db = getDb();
  const sellerId = req.authUser!.id;

  const result = withTransaction(db, () => {
    const booking = db
      .prepare('SELECT * FROM bookings WHERE id = ? AND seller_user_id = ?')
      .get(bookingId, sellerId) as
      | { id: number; buyer_user_id: number; booking_reference: string; final_settlement_amount: number | null }
      | undefined;

    if (!booking) {
      return { error: 'Booking not found.', status: 404 };
    }
    const pendingRev = db
      .prepare("SELECT id FROM settlement_revisions WHERE booking_id = ? AND status = 'PENDING_SELLER'")
      .get(bookingId);
    if (pendingRev) {
      return { error: 'Approve or reject the pending settlement revision first.', status: 409 };
    }

    const payment = db
      .prepare('SELECT * FROM payment_acknowledgements WHERE booking_id = ?')
      .get(bookingId) as { id: number; state: string } | undefined;
    if (!payment) {
      return { error: 'Collector/Buyer must weigh materials and record payment first.', status: 400 };
    }

    const nextState = disputed ? 'PAYMENT_DISPUTED' : 'ACKNOWLEDGED_BY_SELLER';
    db.prepare(
      `UPDATE payment_acknowledgements
       SET state = ?, seller_ack_by = ?, seller_ack_at = datetime('now'),
           notes = COALESCE(NULLIF(?, ''), notes), updated_at = datetime('now')
       WHERE booking_id = ?`
    ).run(nextState, sellerId, notes ? String(notes).trim() : '', bookingId);

    recordNotification(db, {
      userId: booking.buyer_user_id,
      eventType: 'PAYMENT_ACKNOWLEDGED',
      title: `Seller ${disputed ? 'disputed' : 'acknowledged'} payment`,
      body: `Payment status for ${booking.booking_reference} is now ${nextState}.`,
      linkPath: '/buyer/bookings',
    });

    recordAuditLog(db, {
      actorUserId: sellerId,
      actorRole: 'SELLER',
      action: disputed ? 'PAYMENT_DISPUTED_BY_SELLER' : 'PAYMENT_ACKNOWLEDGED_BY_SELLER',
      entityType: 'BOOKING',
      entityId: bookingId,
    });

    const completion = finalizeBookingIfReady(db, bookingId, sellerId, 'SELLER');
    return { ok: true, paymentState: nextState, ...completion, status: 200 };
  });

  if ('error' in result) {
    res.status(result.status as number).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post('/bookings/:bookingId/acknowledge-handover', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { notes } = req.body || {};
  const db = getDb();
  const sellerId = req.authUser!.id;

  const result = withTransaction(db, () => {
    const booking = db
      .prepare('SELECT * FROM bookings WHERE id = ? AND seller_user_id = ?')
      .get(bookingId, sellerId) as { id: number; buyer_user_id: number; booking_reference: string } | undefined;
    if (!booking) {
      return { error: 'Booking not found.', status: 404 };
    }

    const existing = db.prepare('SELECT * FROM handover_records WHERE booking_id = ?').get(bookingId);
    if (!existing) {
      db.prepare(
        `INSERT INTO handover_records (booking_id, seller_confirmed_by, seller_confirmed_at, handover_notes)
         VALUES (?, ?, datetime('now'), ?)`
      ).run(bookingId, sellerId, notes ? String(notes).trim() : '');
    } else {
      db.prepare(
        `UPDATE handover_records
         SET seller_confirmed_by = ?, seller_confirmed_at = datetime('now'),
             handover_notes = CASE WHEN ? != '' THEN ? ELSE handover_notes END
         WHERE booking_id = ?`
      ).run(
        sellerId,
        notes ? String(notes).trim() : '',
        notes ? String(notes).trim() : '',
        bookingId
      );
    }

    recordNotification(db, {
      userId: booking.buyer_user_id,
      eventType: 'HANDOVER_CONFIRMED',
      title: `Seller confirmed handover for ${booking.booking_reference}`,
      body: 'Seller confirmed physical handover of weighed scrap materials.',
      linkPath: '/buyer/bookings',
    });

    const completion = finalizeBookingIfReady(db, bookingId, sellerId, 'SELLER');
    return { ok: true, ...completion, status: 200 };
  });

  if ('error' in result) {
    res.status(result.status as number).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.get('/receipts', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const receipts = db
    .prepare(
      `SELECT tr.*, b.booking_reference, b.pickup_date, b.is_demo_seed
       FROM transaction_receipts tr
       JOIN bookings b ON b.id = tr.booking_id
       WHERE b.seller_user_id = ?
       ORDER BY tr.issued_at DESC`
    )
    .all(req.authUser!.id);
  res.json({ receipts });
});

router.post('/bookings/:bookingId/rate', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { score, comment } = req.body || {};
  const numScore = Number(score);
  if (!Number.isInteger(numScore) || numScore < 1 || numScore > 5) {
    res.status(400).json({ error: 'Rating score must be an integer between 1 and 5.' });
    return;
  }

  const db = getDb();
  const booking = db
    .prepare("SELECT * FROM bookings WHERE id = ? AND seller_user_id = ? AND status = 'COMPLETED'")
    .get(bookingId, req.authUser!.id) as { id: number; buyer_user_id: number } | undefined;
  if (!booking) {
    res.status(400).json({ error: 'Only completed bookings can be rated.' });
    return;
  }
  const existing = db.prepare('SELECT id FROM ratings WHERE booking_id = ?').get(bookingId);
  if (existing) {
    res.status(409).json({ error: 'You have already rated this transaction.' });
    return;
  }

  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO ratings (booking_id, seller_user_id, buyer_user_id, score, comment)
       VALUES (?, ?, ?, ?, ?)`
    ).run(bookingId, req.authUser!.id, booking.buyer_user_id, numScore, comment ? String(comment).trim() : '');

    const avg = db
      .prepare('SELECT AVG(score) as avg_score FROM ratings WHERE buyer_user_id = ?')
      .get(booking.buyer_user_id) as { avg_score: number };
    db.prepare('UPDATE buyer_profiles SET average_rating = ? WHERE user_id = ?').run(
      Math.round((avg.avg_score || numScore) * 100) / 100,
      booking.buyer_user_id
    );
  });

  res.status(201).json({ ok: true });
});

router.get('/complaints', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const complaints = db
    .prepare(
      `SELECT c.*, b.booking_reference
       FROM complaints c
       LEFT JOIN bookings b ON b.id = c.booking_id
       WHERE c.raised_by_user_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(req.authUser!.id);
  res.json({ complaints });
});

router.post('/complaints', (req: AuthenticatedRequest, res) => {
  const { bookingId, category, description, evidenceMediaId } = req.body || {};
  const validCategories = ['WEIGHT_DISCREPANCY', 'PAYMENT_ISSUE', 'NO_SHOW', 'CONDUCT', 'PLATFORM_ISSUE', 'OTHER'];
  if (!validCategories.includes(String(category)) || !description || String(description).trim().length < 10) {
    res.status(400).json({ error: 'Valid complaint category and description (min 10 chars) are required.' });
    return;
  }

  const db = getDb();
  if (bookingId) {
    const ownsBooking = db
      .prepare('SELECT id FROM bookings WHERE id = ? AND seller_user_id = ?')
      .get(Number(bookingId), req.authUser!.id);
    if (!ownsBooking) {
      res.status(403).json({ error: 'Booking does not belong to your account.' });
      return;
    }
  }

  const refCode = generateRefCode('CMP');
  const info = db
    .prepare(
      `INSERT INTO complaints (reference_code, booking_id, raised_by_user_id, category, description, evidence_media_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      refCode,
      bookingId ? Number(bookingId) : null,
      req.authUser!.id,
      String(category),
      String(description).trim(),
      evidenceMediaId ? Number(evidenceMediaId) : null
    );

  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: 'SELLER',
    action: 'COMPLAINT_CREATED',
    entityType: 'COMPLAINT',
    entityId: Number(info.lastInsertRowid),
    metadata: { refCode, category },
  });

  res.status(201).json({ id: Number(info.lastInsertRowid), referenceCode: refCode });
});

export default router;
