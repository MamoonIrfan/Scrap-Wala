import { Router } from 'express';
import { getDb, withTransaction } from '../db/database';
import {
  computeItemAmount,
  evaluateBuyerEligibility,
  roundCurrency,
  validateUnitCompatibility,
} from '../domain/rules';
import { requireAuth, requireRole, type AuthenticatedRequest } from '../middleware/auth';
import { generateRefCode, recordAuditLog, recordNotification } from '../services/audit';
import { hashPassword } from '../services/auth';

const router = Router();
router.use(requireAuth, requireRole('BUYER'));

router.get('/dashboard', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const buyerId = req.authUser!.id;

  const profile = db
    .prepare(
      `SELECT bp.*, bc.max_weight_kg, bc.max_daily_pickups, bc.active_bookings_count, bc.preferred_slots_json
       FROM buyer_profiles bp
       JOIN buyer_capacity bc ON bc.buyer_user_id = bp.user_id
       WHERE bp.user_id = ?`
    )
    .get(buyerId);

  const submittedOffers = (
    db
      .prepare("SELECT COUNT(*) as c FROM offers WHERE buyer_user_id = ? AND status = 'ACTIVE'")
      .get(buyerId) as { c: number }
  ).c;

  const acceptedBookings = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM bookings WHERE buyer_user_id = ? AND status NOT IN ('COMPLETED','CANCELLED')"
      )
      .get(buyerId) as { c: number }
  ).c;

  const completedStats = db
    .prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(final_settlement_amount), 0) as totalSpend
       FROM bookings WHERE buyer_user_id = ? AND status = 'COMPLETED'`
    )
    .get(buyerId) as { count: number; totalSpend: number };

  const totalMass = db
    .prepare(
      `SELECT COALESCE(SUM(ci.actual_quantity * mu.base_factor), 0) as totalKg
       FROM collection_items ci
       JOIN collection_records cr ON cr.id = ci.collection_record_id
       JOIN bookings b ON b.id = cr.booking_id
       JOIN material_units mu ON mu.id = ci.unit_id
       WHERE b.buyer_user_id = ? AND b.status = 'COMPLETED' AND mu.dimension = 'MASS'`
    )
    .get(buyerId) as { totalKg: number };

  const feeSummary = db
    .prepare(
      `SELECT COALESCE(SUM(fee_amount), 0) as totalAssessed
       FROM platform_fee_ledger WHERE buyer_user_id = ? AND status != 'REVERSED'`
    )
    .get(buyerId) as { totalAssessed: number };

  const serviceAreaIds = (
    db
      .prepare('SELECT service_area_id FROM buyer_service_areas WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ service_area_id: number }>
  ).map((r) => r.service_area_id);

  const materialIds = (
    db
      .prepare('SELECT material_id FROM buyer_material_capabilities WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ material_id: number }>
  ).map((r) => r.material_id);

  const docs = db
    .prepare(
      `SELECT vd.*, mf.original_name FROM verification_documents vd
       LEFT JOIN media_files mf ON mf.id = vd.media_file_id
       WHERE vd.buyer_user_id = ? ORDER BY vd.created_at DESC`
    )
    .all(buyerId);

  res.json({
    metrics: {
      submittedOffers,
      acceptedBookings,
      completedCollections: completedStats.count,
      totalPurchasedMassKg: roundCurrency(totalMass.totalKg),
      totalSpend: roundCurrency(completedStats.totalSpend),
      totalServiceFees: roundCurrency(feeSummary.totalAssessed),
    },
    profile,
    serviceAreaIds,
    materialIds,
    verificationDocuments: docs,
  });
});

router.put('/profile', (req: AuthenticatedRequest, res) => {
  const {
    businessName,
    registrationNumber,
    gstOrTaxId,
    contactPerson,
    businessPhone,
    warehouseArea,
    isAvailable,
    maxWeightKg,
    maxDailyPickups,
    preferredSlots,
    serviceAreaIds,
    materialIds,
  } = req.body || {};

  const db = getDb();
  const buyerId = req.authUser!.id;

  withTransaction(db, () => {
    db.prepare(
      `UPDATE buyer_profiles
       SET business_name = COALESCE(?, business_name),
           registration_number = COALESCE(?, registration_number),
           gst_or_tax_id = COALESCE(?, gst_or_tax_id),
           contact_person = COALESCE(?, contact_person),
           business_phone = COALESCE(?, business_phone),
           warehouse_area = COALESCE(?, warehouse_area),
           is_available = COALESCE(?, is_available),
           updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      businessName ? String(businessName).trim() : null,
      registrationNumber !== undefined ? String(registrationNumber || '') : null,
      gstOrTaxId !== undefined ? String(gstOrTaxId || '') : null,
      contactPerson ? String(contactPerson).trim() : null,
      businessPhone ? String(businessPhone).trim() : null,
      warehouseArea ? String(warehouseArea).trim() : null,
      typeof isAvailable === 'boolean' ? (isAvailable ? 1 : 0) : null,
      buyerId
    );

    db.prepare(
      `UPDATE buyer_capacity
       SET max_weight_kg = COALESCE(?, max_weight_kg),
           max_daily_pickups = COALESCE(?, max_daily_pickups),
           preferred_slots_json = COALESCE(?, preferred_slots_json),
           updated_at = datetime('now')
       WHERE buyer_user_id = ?`
    ).run(
      maxWeightKg !== undefined ? Math.max(0, Number(maxWeightKg)) : null,
      maxDailyPickups !== undefined ? Math.max(1, Number(maxDailyPickups)) : null,
      Array.isArray(preferredSlots) ? JSON.stringify(preferredSlots) : null,
      buyerId
    );

    if (Array.isArray(serviceAreaIds)) {
      db.prepare('DELETE FROM buyer_service_areas WHERE buyer_user_id = ?').run(buyerId);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO buyer_service_areas (buyer_user_id, service_area_id) VALUES (?, ?)'
      );
      for (const id of serviceAreaIds) ins.run(buyerId, Number(id));
    }

    if (Array.isArray(materialIds)) {
      db.prepare('DELETE FROM buyer_material_capabilities WHERE buyer_user_id = ?').run(buyerId);
      const ins = db.prepare(
        'INSERT OR IGNORE INTO buyer_material_capabilities (buyer_user_id, material_id) VALUES (?, ?)'
      );
      for (const id of materialIds) ins.run(buyerId, Number(id));
    }
  });

  res.json({ ok: true });
});

router.post('/verification-documents', (req: AuthenticatedRequest, res) => {
  const { docType, docReference, mediaFileId } = req.body || {};
  if (!docType || !docReference) {
    res.status(400).json({ error: 'Document type and reference number are required.' });
    return;
  }
  const db = getDb();
  const buyerId = req.authUser!.id;
  const info = db
    .prepare(
      `INSERT INTO verification_documents (buyer_user_id, media_file_id, doc_type, doc_reference, review_status)
       VALUES (?, ?, ?, ?, 'PENDING')`
    )
    .run(buyerId, mediaFileId ? Number(mediaFileId) : null, String(docType).trim(), String(docReference).trim());

  db.prepare(
    `UPDATE buyer_profiles SET verification_status = CASE WHEN verification_status = 'VERIFIED' THEN 'VERIFIED' ELSE 'UNDER_REVIEW' END, updated_at = datetime('now') WHERE user_id = ?`
  ).run(buyerId);

  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

router.get('/marketplace', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const buyerId = req.authUser!.id;
  const filterAreaId = req.query.serviceAreaId ? Number(req.query.serviceAreaId) : null;
  const filterMaterialId = req.query.materialId ? Number(req.query.materialId) : null;

  const buyer = db
    .prepare(
      `SELECT u.account_status, bp.verification_status, bp.is_available,
              bc.max_weight_kg, bc.max_daily_pickups, bc.active_bookings_count
       FROM buyer_profiles bp
       JOIN users u ON u.id = bp.user_id
       JOIN buyer_capacity bc ON bc.buyer_user_id = bp.user_id
       WHERE bp.user_id = ?`
    )
    .get(buyerId) as
    | {
        account_status: string;
        verification_status: string;
        is_available: number;
        max_weight_kg: number;
        max_daily_pickups: number;
        active_bookings_count: number;
      }
    | undefined;

  if (!buyer) {
    res.status(404).json({ error: 'Buyer profile not found.' });
    return;
  }

  const areaIds = (
    db
      .prepare('SELECT service_area_id FROM buyer_service_areas WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ service_area_id: number }>
  ).map((r) => r.service_area_id);

  const matIds = (
    db
      .prepare('SELECT material_id FROM buyer_material_capabilities WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ material_id: number }>
  ).map((r) => r.material_id);

  // IMPORTANT PRIVACY RULE: Select ONLY approximate service area & postal prefix, NEVER street_line or seller phone/email!
  const published = db
    .prepare(
      `SELECT l.id, l.reference_code, l.service_area_id, l.title, l.description,
              l.preferred_pickup_date, l.preferred_pickup_window, l.status, l.ai_tags_json,
              l.is_demo_seed, l.created_at,
              sa.name as service_area_name, sa.city,
              substr(a.postal_code, 1, 3) || 'xxx' as approximate_postal_zone
       FROM listings l
       JOIN service_areas sa ON sa.id = l.service_area_id
       JOIN addresses a ON a.id = l.address_id
       WHERE l.status = 'PUBLISHED' AND l.deleted_at IS NULL
       ORDER BY l.created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const getItems = db.prepare(
    `SELECT li.id, li.material_id, m.name as material_name, li.unit_id, mu.code as unit_code, mu.dimension, mu.base_factor,
            li.estimated_quantity, li.quantity_unknown, li.item_notes
     FROM listing_items li
     JOIN materials m ON m.id = li.material_id
     JOIN material_units mu ON mu.id = li.unit_id
     WHERE li.listing_id = ?`
  );
  const getImages = db.prepare(
    `SELECT li.media_file_id FROM listing_images li WHERE li.listing_id = ?`
  );
  const getMyOffer = db.prepare(
    `SELECT id, reference_code, estimated_total_value, status FROM offers WHERE listing_id = ? AND buyer_user_id = ? AND status = 'ACTIVE'`
  );

  const eligibleListings: Array<Record<string, unknown>> = [];
  const ineligibilitySummary: string[] = [];

  if (buyer.verification_status !== 'VERIFIED') {
    ineligibilitySummary.push(`Verification status is ${buyer.verification_status}; complete verification to view and bid on live requests.`);
  }
  if (areaIds.length === 0 || matIds.length === 0) {
    ineligibilitySummary.push('Configure at least one service area and supported material category in your dealer profile.');
  }

  for (const l of published) {
    const lid = Number(l.id);
    const items = getItems.all(lid) as Array<{
      id: number;
      material_id: number;
      material_name: string;
      unit_id: number;
      unit_code: string;
      dimension: string;
      base_factor: number;
      estimated_quantity: number | null;
      quantity_unknown: number;
      item_notes: string;
    }>;

    const totalKnownMassKg = items.reduce((acc, it) => {
      if (it.dimension === 'MASS' && it.quantity_unknown === 0 && it.estimated_quantity) {
        return acc + it.estimated_quantity * it.base_factor;
      }
      return acc;
    }, 0);

    const elig = evaluateBuyerEligibility(
      {
        accountStatus: buyer.account_status,
        verificationStatus: buyer.verification_status,
        isAvailable: buyer.is_available === 1,
        serviceAreaIds: areaIds,
        supportedMaterialIds: matIds,
        maxWeightKg: buyer.max_weight_kg,
        maxDailyPickups: buyer.max_daily_pickups,
        activeBookingsCount: buyer.active_bookings_count,
      },
      {
        serviceAreaId: Number(l.service_area_id),
        materialIds: items.map((i) => i.material_id),
        totalKnownMassKg,
      }
    );

    if (!elig.eligible) continue;
    if (filterAreaId && Number(l.service_area_id) !== filterAreaId) continue;
    if (filterMaterialId && !items.some((i) => i.material_id === filterMaterialId)) continue;

    const imgs = (getImages.all(lid) as Array<{ media_file_id: number }>).map(
      (x) => `/api/v1/media/${x.media_file_id}`
    );

    eligibleListings.push({
      ...l,
      items,
      imageUrls: imgs,
      myActiveOffer: getMyOffer.get(lid, buyerId) || null,
    });
  }

  res.json({
    listings: eligibleListings,
    verificationStatus: buyer.verification_status,
    ineligibilityNotes: ineligibilitySummary,
  });
});

router.post('/offers', (req: AuthenticatedRequest, res) => {
  const {
    listingId,
    proposedPickupDate,
    proposedPickupWindow,
    conditionsText,
    expiresInHours,
    items,
  } = req.body || {};

  if (!listingId || !proposedPickupDate || !proposedPickupWindow || !Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'Listing, pickup slot, and itemized rates are required.' });
    return;
  }

  const db = getDb();
  const buyerId = req.authUser!.id;

  const buyer = db
    .prepare(
      `SELECT u.account_status, bp.verification_status, bp.is_available,
              bc.max_weight_kg, bc.max_daily_pickups, bc.active_bookings_count
       FROM buyer_profiles bp
       JOIN users u ON u.id = bp.user_id
       JOIN buyer_capacity bc ON bc.buyer_user_id = bp.user_id
       WHERE bp.user_id = ?`
    )
    .get(buyerId) as
    | {
        account_status: string;
        verification_status: string;
        is_available: number;
        max_weight_kg: number;
        max_daily_pickups: number;
        active_bookings_count: number;
      }
    | undefined;

  const listing = db
    .prepare("SELECT * FROM listings WHERE id = ? AND status = 'PUBLISHED' AND deleted_at IS NULL")
    .get(Number(listingId)) as
    | { id: number; seller_user_id: number; service_area_id: number; reference_code: string }
    | undefined;

  if (!buyer || !listing) {
    res.status(404).json({ error: 'Published listing or buyer profile not found.' });
    return;
  }

  const listingItems = db
    .prepare(
      `SELECT li.*, mu.code as unit_code, mu.dimension, mu.base_factor
       FROM listing_items li
       JOIN material_units mu ON mu.id = li.unit_id
       WHERE li.listing_id = ?`
    )
    .all(listing.id) as Array<{
    id: number;
    material_id: number;
    unit_id: number;
    unit_code: string;
    dimension: 'MASS' | 'COUNT' | 'BUNDLE';
    base_factor: number;
    estimated_quantity: number | null;
    quantity_unknown: number;
  }>;

  const areaIds = (
    db
      .prepare('SELECT service_area_id FROM buyer_service_areas WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ service_area_id: number }>
  ).map((r) => r.service_area_id);
  const matIds = (
    db
      .prepare('SELECT material_id FROM buyer_material_capabilities WHERE buyer_user_id = ?')
      .all(buyerId) as Array<{ material_id: number }>
  ).map((r) => r.material_id);

  const totalMassKg = listingItems.reduce((acc, it) => {
    if (it.dimension === 'MASS' && it.quantity_unknown === 0 && it.estimated_quantity) {
      return acc + it.estimated_quantity * it.base_factor;
    }
    return acc;
  }, 0);

  const elig = evaluateBuyerEligibility(
    {
      accountStatus: buyer.account_status,
      verificationStatus: buyer.verification_status,
      isAvailable: buyer.is_available === 1,
      serviceAreaIds: areaIds,
      supportedMaterialIds: matIds,
      maxWeightKg: buyer.max_weight_kg,
      maxDailyPickups: buyer.max_daily_pickups,
      activeBookingsCount: buyer.active_bookings_count,
    },
    {
      serviceAreaId: listing.service_area_id,
      materialIds: listingItems.map((i) => i.material_id),
      totalKnownMassKg: totalMassKg,
    }
  );

  if (!elig.eligible) {
    res.status(403).json({ error: `Buyer is not eligible for this listing: ${elig.reasons.join(' ')}` });
    return;
  }

  // Validate unit compatibility and compute totals deterministically
  const itemMap = new Map(listingItems.map((li) => [li.id, li]));
  let estimatedTotal = 0;
  let coveredCount = 0;
  const computedItems: Array<{
    listingItemId: number;
    isCovered: boolean;
    unitRate: number;
    unitId: number;
    estimatedAmount: number;
  }> = [];

  for (const li of listingItems) {
    const submitted = items.find((x: { listingItemId: number }) => Number(x.listingItemId) === li.id);
    if (!submitted || !submitted.isCovered) {
      computedItems.push({
        listingItemId: li.id,
        isCovered: false,
        unitRate: 0,
        unitId: li.unit_id,
        estimatedAmount: 0,
      });
      continue;
    }

    const offerUnitRow = db
      .prepare('SELECT id, code, dimension, base_factor FROM material_units WHERE id = ?')
      .get(Number(submitted.unitId || li.unit_id)) as
      | { id: number; code: string; dimension: 'MASS' | 'COUNT' | 'BUNDLE'; base_factor: number }
      | undefined;
    if (!offerUnitRow) {
      res.status(400).json({ error: 'Invalid unit selected in offer item.' });
      return;
    }

    const compat = validateUnitCompatibility(
      { id: li.unit_id, code: li.unit_code, dimension: li.dimension, baseFactor: li.base_factor },
      {
        id: offerUnitRow.id,
        code: offerUnitRow.code,
        dimension: offerUnitRow.dimension,
        baseFactor: offerUnitRow.base_factor,
      }
    );
    if (!compat.compatible) {
      res.status(400).json({ error: compat.reason });
      return;
    }

    const rate = Number(submitted.unitRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      res.status(400).json({ error: 'Covered items must have a positive unit rate.' });
      return;
    }

    const amt = computeItemAmount(
      li.estimated_quantity,
      li.quantity_unknown === 1,
      rate,
      compat.conversionFactor
    );
    estimatedTotal = roundCurrency(estimatedTotal + amt);
    coveredCount += 1;

    computedItems.push({
      listingItemId: li.id,
      isCovered: true,
      unitRate: rate,
      unitId: offerUnitRow.id,
      estimatedAmount: amt,
    });
  }

  if (coveredCount === 0) {
    res.status(400).json({ error: 'An offer must cover at least one listed material item.' });
    return;
  }

  // Ensure any stray listingItemId wasn't forged
  for (const sub of items) {
    if (!itemMap.has(Number(sub.listingItemId))) {
      res.status(400).json({ error: 'Offer references an item not belonging to this listing.' });
      return;
    }
  }

  const hours = Math.min(168, Math.max(1, Number(expiresInHours || 48)));
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

  const offerCreated = withTransaction(db, () => {
    // Supersede/withdraw any prior active offer by same buyer on same listing
    db.prepare(
      `UPDATE offers SET status = 'WITHDRAWN', updated_at = datetime('now')
       WHERE listing_id = ? AND buyer_user_id = ? AND status = 'ACTIVE'`
    ).run(listing.id, buyerId);

    const refCode = generateRefCode('OFR');
    const offerRes = db
      .prepare(
        `INSERT INTO offers (reference_code, listing_id, buyer_user_id, proposed_pickup_date, proposed_pickup_window, conditions_text, expires_at, estimated_total_value, covered_items_count, total_items_count, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`
      )
      .run(
        refCode,
        listing.id,
        buyerId,
        String(proposedPickupDate),
        String(proposedPickupWindow),
        conditionsText ? String(conditionsText).trim() : '',
        expiresAt,
        estimatedTotal,
        coveredCount,
        listingItems.length
      );
    const offerId = Number(offerRes.lastInsertRowid);

    const insItem = db.prepare(
      `INSERT INTO offer_items (offer_id, listing_item_id, is_covered, unit_rate, unit_id, estimated_amount)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const ci of computedItems) {
      insItem.run(
        offerId,
        ci.listingItemId,
        ci.isCovered ? 1 : 0,
        ci.unitRate,
        ci.unitId,
        ci.estimatedAmount
      );
    }

    recordNotification(db, {
      userId: listing.seller_user_id,
      eventType: 'OFFER_RECEIVED',
      title: `New offer ${refCode} received`,
      body: `A verified buyer submitted an offer (${coveredCount}/${listingItems.length} items) on ${listing.reference_code}.`,
      linkPath: '/seller/offers',
    });

    recordAuditLog(db, {
      actorUserId: buyerId,
      actorRole: 'BUYER',
      action: 'OFFER_SUBMITTED',
      entityType: 'OFFER',
      entityId: offerId,
      metadata: { refCode, listingId: listing.id, estimatedTotal },
    });

    return { id: offerId, referenceCode: refCode, estimatedTotalValue: estimatedTotal };
  });

  res.status(201).json(offerCreated);
});

router.get('/offers', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const offers = db
    .prepare(
      `SELECT o.*, l.title as listing_title, l.reference_code as listing_ref, sa.name as service_area_name
       FROM offers o
       JOIN listings l ON l.id = o.listing_id
       JOIN service_areas sa ON sa.id = l.service_area_id
       WHERE o.buyer_user_id = ?
       ORDER BY o.created_at DESC`
    )
    .all(req.authUser!.id);
  res.json({ offers });
});

router.post('/offers/:offerId/withdraw', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const offer = db
    .prepare('SELECT id, status FROM offers WHERE id = ? AND buyer_user_id = ?')
    .get(Number(req.params.offerId), req.authUser!.id) as { id: number; status: string } | undefined;
  if (!offer) {
    res.status(404).json({ error: 'Offer not found.' });
    return;
  }
  if (offer.status !== 'ACTIVE') {
    res.status(400).json({ error: `Cannot withdraw offer in ${offer.status} state.` });
    return;
  }
  db.prepare(`UPDATE offers SET status = 'WITHDRAWN', updated_at = datetime('now') WHERE id = ?`).run(
    offer.id
  );
  res.json({ ok: true });
});

router.get('/collectors', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const collectors = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.account_status,
              cp.vehicle_number, cp.vehicle_type, cp.license_ref, cp.is_active
       FROM collector_profiles cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.buyer_user_id = ?
       ORDER BY u.id DESC`
    )
    .all(req.authUser!.id);
  res.json({ collectors });
});

router.post('/collectors', (req: AuthenticatedRequest, res) => {
  const { email, password, fullName, phone, vehicleNumber, vehicleType, licenseRef } = req.body || {};
  if (!email || !password || String(password).length < 8 || !fullName || !vehicleNumber) {
    res.status(400).json({
      error: 'Email, password (min 8 chars), full name, and vehicle number are required.',
    });
    return;
  }
  const db = getDb();
  const buyerId = req.authUser!.id;
  const normalizedEmail = String(email).trim().toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) {
    res.status(409).json({ error: 'Email already registered.' });
    return;
  }

  const collectorId = withTransaction(db, () => {
    const uRes = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, phone_verified, email_verified, account_status)
         VALUES (?, ?, ?, ?, 1, 1, 'ACTIVE')`
      )
      .run(normalizedEmail, hashPassword(String(password)), String(fullName).trim(), phone ? String(phone).trim() : null);
    const uid = Number(uRes.lastInsertRowid);
    const roleRow = db.prepare("SELECT id FROM roles WHERE name = 'COLLECTOR'").get() as { id: number };
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(uid, roleRow.id);
    db.prepare(
      `INSERT INTO collector_profiles (user_id, buyer_user_id, vehicle_number, vehicle_type, license_ref, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`
    ).run(uid, buyerId, String(vehicleNumber).trim(), vehicleType ? String(vehicleType).trim() : 'MINI_TRUCK', licenseRef ? String(licenseRef).trim() : null);

    recordAuditLog(db, {
      actorUserId: buyerId,
      actorRole: 'BUYER',
      action: 'COLLECTOR_ACCOUNT_CREATED',
      entityType: 'USER',
      entityId: uid,
    });
    return uid;
  });

  res.status(201).json({ id: collectorId });
});

router.get('/bookings', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  // Exact address & seller name/phone revealed ONLY here for confirmed bookings!
  const bookings = db
    .prepare(
      `SELECT b.*, l.title as listing_title, l.reference_code as listing_ref,
              su.full_name as seller_name, su.phone as seller_phone,
              a.label as address_label, a.street_line, a.landmark, a.postal_code, sa.name as service_area_name,
              ca.collector_user_id, cu.full_name as collector_name, cp.vehicle_number,
              pa.payment_method, pa.amount as payment_amount, pa.state as payment_state, pa.buyer_reference,
              hr.collector_confirmed_at, hr.seller_confirmed_at,
              tr.receipt_number
       FROM bookings b
       JOIN listings l ON l.id = b.listing_id
       JOIN users su ON su.id = b.seller_user_id
       JOIN addresses a ON a.id = b.address_id
       JOIN service_areas sa ON sa.id = a.service_area_id
       LEFT JOIN collector_assignments ca ON ca.booking_id = b.id
       LEFT JOIN users cu ON cu.id = ca.collector_user_id
       LEFT JOIN collector_profiles cp ON cp.user_id = ca.collector_user_id
       LEFT JOIN payment_acknowledgements pa ON pa.booking_id = b.id
       LEFT JOIN handover_records hr ON hr.booking_id = b.id
       LEFT JOIN transaction_receipts tr ON tr.booking_id = b.id
       WHERE b.buyer_user_id = ?
       ORDER BY b.created_at DESC`
    )
    .all(req.authUser!.id);
  res.json({ bookings });
});

router.post('/bookings/:bookingId/assign-collector', (req: AuthenticatedRequest, res) => {
  const bookingId = Number(req.params.bookingId);
  const { collectorUserId } = req.body || {};
  if (!collectorUserId) {
    res.status(400).json({ error: 'Collector user ID is required.' });
    return;
  }

  const db = getDb();
  const buyerId = req.authUser!.id;
  const booking = db
    .prepare('SELECT id, seller_user_id, booking_reference, status FROM bookings WHERE id = ? AND buyer_user_id = ?')
    .get(bookingId, buyerId) as
    | { id: number; seller_user_id: number; booking_reference: string; status: string }
    | undefined;
  if (!booking) {
    res.status(404).json({ error: 'Booking not found.' });
    return;
  }

  const collector = db
    .prepare(
      `SELECT cp.user_id, u.full_name FROM collector_profiles cp
       JOIN users u ON u.id = cp.user_id
       WHERE cp.user_id = ? AND cp.buyer_user_id = ? AND cp.is_active = 1 AND u.account_status = 'ACTIVE'`
    )
    .get(Number(collectorUserId), buyerId) as { user_id: number; full_name: string } | undefined;

  if (!collector) {
    res.status(400).json({ error: 'Selected collector does not belong to your dealer roster or is inactive.' });
    return;
  }

  withTransaction(db, () => {
    const existing = db
      .prepare('SELECT id FROM collector_assignments WHERE booking_id = ?')
      .get(bookingId);
    if (existing) {
      db.prepare(
        `UPDATE collector_assignments SET collector_user_id = ?, assigned_by = ?, status = 'ASSIGNED' WHERE booking_id = ?`
      ).run(collector.user_id, buyerId, bookingId);
    } else {
      db.prepare(
        `INSERT INTO collector_assignments (booking_id, collector_user_id, assigned_by, status) VALUES (?, ?, ?, 'ASSIGNED')`
      ).run(bookingId, collector.user_id, buyerId);
    }
    if (booking.status === 'CONFIRMED') {
      db.prepare(`UPDATE bookings SET status = 'COLLECTOR_ASSIGNED', updated_at = datetime('now') WHERE id = ?`).run(
        bookingId
      );
    }
    recordNotification(db, {
      userId: collector.user_id,
      eventType: 'COLLECTOR_ASSIGNED',
      title: `Assigned pickup ${booking.booking_reference}`,
      body: 'Check your assigned jobs schedule for pickup details.',
      linkPath: '/collector/jobs',
    });
    recordNotification(db, {
      userId: booking.seller_user_id,
      eventType: 'COLLECTOR_ASSIGNED',
      title: `Collector assigned for ${booking.booking_reference}`,
      body: `${collector.full_name} has been assigned to your pickup.`,
      linkPath: '/seller/bookings',
    });
  });

  res.json({ ok: true });
});

router.get('/ledger', (req: AuthenticatedRequest, res) => {
  const db = getDb();
  const ledger = db
    .prepare(
      `SELECT pfl.*, pfr.name as rule_name, pfr.fee_type, pfr.rate_value
       FROM platform_fee_ledger pfl
       JOIN platform_fee_rules pfr ON pfr.id = pfl.fee_rule_id
       WHERE pfl.buyer_user_id = ?
       ORDER BY pfl.created_at DESC`
    )
    .all(req.authUser!.id);
  res.json({ ledger });
});

export default router;
