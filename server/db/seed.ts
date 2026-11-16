import bcrypt from 'bcryptjs';
import type { DatabaseSync } from 'node:sqlite';

export function seedDatabase(db: DatabaseSync): void {
  const existingRoles = db.prepare('SELECT COUNT(*) as cnt FROM roles').get() as { cnt: number };
  if (existingRoles.cnt > 0) {
    return;
  }

  db.exec('BEGIN IMMEDIATE;');
  try {
    // Roles
    const insertRole = db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)');
    insertRole.run('SELLER', 'Households and small businesses selling scrap materials');
    insertRole.run('BUYER', 'Verified independent scrap dealers submitting offers and managing pickups');
    insertRole.run('COLLECTOR', 'Field collection personnel assigned to pickup bookings');
    insertRole.run('ADMIN', 'Platform administrators managing verification, taxonomy, fees, and disputes');

    // Permissions
    const permList = [
      ['listing:create', 'Create and publish scrap listings'],
      ['offer:submit', 'Submit itemized offers on eligible listings'],
      ['booking:accept', 'Accept an offer and create an immutable booking'],
      ['collection:weigh', 'Record actual material weights and propose revisions'],
      ['settlement:approve', 'Approve or reject revised settlements'],
      ['admin:manage', 'Manage users, verification, materials, areas, fees, and disputes'],
    ];
    const insertPerm = db.prepare('INSERT INTO permissions (code, description) VALUES (?, ?)');
    for (const [code, desc] of permList) {
      insertPerm.run(code, desc);
    }

    // Service Areas
    const insertArea = db.prepare(
      'INSERT INTO service_areas (name, city, postal_prefixes, is_active) VALUES (?, ?, ?, 1)'
    );
    insertArea.run('South Delhi', 'New Delhi', '110016,110017,110019,110024,110048');
    insertArea.run('Central Bengaluru', 'Bengaluru', '560001,560002,560008,560025,560038');
    insertArea.run('West Mumbai', 'Mumbai', '400050,400052,400053,400058');
    insertArea.run('East Pune', 'Pune', '411001,411006,411014');

    // Material Units
    const insertUnit = db.prepare(
      'INSERT INTO material_units (code, name, dimension, base_factor, is_active) VALUES (?, ?, ?, ?, 1)'
    );
    insertUnit.run('kg', 'Kilogram (kg)', 'MASS', 1.0);
    insertUnit.run('g', 'Gram (g)', 'MASS', 0.001);
    insertUnit.run('piece', 'Piece (pc)', 'COUNT', 1.0);
    insertUnit.run('bundle', 'Bundle (bdl)', 'BUNDLE', 1.0);

    const kgUnit = db.prepare("SELECT id FROM material_units WHERE code = 'kg'").get() as { id: number };
    const pieceUnit = db.prepare("SELECT id FROM material_units WHERE code = 'piece'").get() as { id: number };

    // Materials
    const insertMat = db.prepare(
      'INSERT INTO materials (slug, name, description, default_unit_id, handling_guidance, image_url, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    );
    insertMat.run(
      'paper',
      'Paper',
      'Clean newspapers, office copy paper, notebooks, books, and printed magazines free from food grease or moisture.',
      kgUnit.id,
      'Keep dry and tie into manageable stacks; separate glossy magazines from plain office sheets where possible.',
      '/src/assets/images/material_paper_1794826582267.jpg'
    );
    insertMat.run(
      'cardboard',
      'Cardboard',
      'Flattened corrugated shipping boxes, retail cartons, and clean kraft paperboard packaging.',
      kgUnit.id,
      'Flatten cartons completely, remove excessive packing tape or foam inserts, and keep dry.',
      '/src/assets/images/material_cardboard_1794826583095.jpg'
    );
    insertMat.run(
      'plastic',
      'Plastic',
      'Rinsed PET beverage bottles, rigid HDPE milk/detergent jugs, clean PP containers, and sorted polymer scrap.',
      kgUnit.id,
      'Empty and rinse containers briefly; keep rigid plastics separate from soft film or contaminated packaging.',
      '/src/assets/images/material_plastic_1794826582957.jpg'
    );
    insertMat.run(
      'metal',
      'Metal',
      'Household aluminum cans, clean copper pipe/wire offcuts, brass fittings, and sorted ferrous steel hardware.',
      kgUnit.id,
      'Separate non-ferrous items (copper, brass, aluminum) from steel/iron so collectors can weigh each grade accurately.',
      '/src/assets/images/material_metal_1794826584397.jpg'
    );

    // Notification Templates
    const insertTpl = db.prepare(
      'INSERT INTO notification_templates (event_type, title_template, body_template) VALUES (?, ?, ?)'
    );
    const templates = [
      ['OFFER_RECEIVED', 'New buyer offer received', 'A verified buyer submitted an itemized offer on your listing {{listingRef}}.'],
      ['OFFER_ACCEPTED', 'Your offer was accepted', 'Seller accepted your offer {{offerRef}}. Booking {{bookingRef}} is confirmed.'],
      ['COLLECTOR_ASSIGNED', 'Collector assigned to pickup', 'Collector {{collectorName}} has been assigned to booking {{bookingRef}}.'],
      ['PICKUP_STATUS_UPDATED', 'Pickup status updated', 'Booking {{bookingRef}} status updated to {{status}}.'],
      ['SETTLEMENT_REVISION_REQUESTED', 'Settlement revision needs approval', 'A revised settlement for {{bookingRef}} requires your explicit review and approval.'],
      ['SETTLEMENT_DECISION', 'Settlement revision {{decision}}', 'Seller {{decision}} the proposed settlement revision for {{bookingRef}}.'],
      ['PAYMENT_ACKNOWLEDGED', 'Payment status updated', 'Payment acknowledgement recorded for booking {{bookingRef}}.'],
      ['HANDOVER_CONFIRMED', 'Material handover confirmed', 'Handover acknowledgement recorded for booking {{bookingRef}}.'],
      ['TRANSACTION_COMPLETED', 'Transaction completed & receipt issued', 'Digital receipt {{receiptNumber}} is ready for booking {{bookingRef}}.'],
      ['COMPLAINT_UPDATED', 'Dispute status updated', 'Complaint {{complaintRef}} has been updated by administration.'],
      ['VERIFICATION_UPDATED', 'Dealer verification updated', 'Your buyer account verification status is now {{status}}.'],
    ];
    for (const [ev, title, body] of templates) {
      insertTpl.run(ev, title, body);
    }

    // Platform Settings
    const insertSetting = db.prepare(
      'INSERT INTO platform_settings (key, value, description) VALUES (?, ?, ?)'
    );
    insertSetting.run('require_seller_phone_otp_for_publish', 'false', 'Whether sellers must verify phone OTP before publishing listings');
    insertSetting.run('default_offer_expiry_hours', '48', 'Default expiry window in hours for submitted buyer offers');
    insertSetting.run('currency_symbol', 'INR', 'Display currency label for dealer-submitted rates');
    insertSetting.run('demo_seed_banner_visible', 'true', 'Clearly label demo/seed records in dashboards');

    // Demo Users (explicitly flagged is_demo_seed = 1)
    const passwordHashAdmin = bcrypt.hashSync('Admin@1234', 10);
    const passwordHashSeller = bcrypt.hashSync('Seller@1234', 10);
    const passwordHashBuyer = bcrypt.hashSync('Buyer@1234', 10);
    const passwordHashCollector = bcrypt.hashSync('Collector@1234', 10);

    const insertUser = db.prepare(
      `INSERT INTO users (email, password_hash, full_name, phone, phone_verified, email_verified, account_status, is_demo_seed)
       VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE', 1)`
    );

    const adminId = Number(insertUser.run('admin@scrapwala.demo', passwordHashAdmin, 'Aarav Mehta (Admin)', '+919810000001', 1).lastInsertRowid);
    const seller1Id = Number(insertUser.run('seller@scrapwala.demo', passwordHashSeller, 'Priya Sharma', '+919810000010', 1).lastInsertRowid);
    const seller2Id = Number(insertUser.run('seller2@scrapwala.demo', passwordHashSeller, 'Rohan Verma', '+919810000011', 1).lastInsertRowid);
    const buyer1Id = Number(insertUser.run('buyer1@scrapwala.demo', passwordHashBuyer, 'Vikram Malhotra', '+919810000020', 1).lastInsertRowid);
    const buyer2Id = Number(insertUser.run('buyer2@scrapwala.demo', passwordHashBuyer, 'Kavita Nair', '+919810000021', 1).lastInsertRowid);
    const buyer3Id = Number(insertUser.run('buyer3@scrapwala.demo', passwordHashBuyer, 'Suresh Patel', '+919810000022', 1).lastInsertRowid);
    const collector1Id = Number(insertUser.run('collector1@scrapwala.demo', passwordHashCollector, 'Deepak Kumar', '+919810000030', 1).lastInsertRowid);
    const collector2Id = Number(insertUser.run('collector2@scrapwala.demo', passwordHashCollector, 'Manoj Yadav', '+919810000031', 1).lastInsertRowid);

    const roleMap = Object.fromEntries(
      (db.prepare('SELECT id, name FROM roles').all() as Array<{ id: number; name: string }>).map((r) => [r.name, r.id])
    );

    const assignRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    assignRole.run(adminId, roleMap.ADMIN);
    assignRole.run(seller1Id, roleMap.SELLER);
    assignRole.run(seller2Id, roleMap.SELLER);
    assignRole.run(buyer1Id, roleMap.BUYER);
    assignRole.run(buyer2Id, roleMap.BUYER);
    assignRole.run(buyer3Id, roleMap.BUYER);
    assignRole.run(collector1Id, roleMap.COLLECTOR);
    assignRole.run(collector2Id, roleMap.COLLECTOR);

    // Seller Profiles & Addresses
    db.prepare('INSERT INTO seller_profiles (user_id, seller_type, organization_name, preferred_payment_method) VALUES (?, ?, ?, ?)')
      .run(seller1Id, 'HOUSEHOLD', null, 'UPI_DIRECT');
    db.prepare('INSERT INTO seller_profiles (user_id, seller_type, organization_name, preferred_payment_method) VALUES (?, ?, ?, ?)')
      .run(seller2Id, 'SMALL_BUSINESS', 'Verma Print & Stationery', 'BANK_TRANSFER');

    const southDelhi = db.prepare("SELECT id FROM service_areas WHERE name = 'South Delhi'").get() as { id: number };
    const centralBlr = db.prepare("SELECT id FROM service_areas WHERE name = 'Central Bengaluru'").get() as { id: number };

    const insertAddr = db.prepare(
      'INSERT INTO addresses (user_id, service_area_id, label, street_line, landmark, postal_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const addr1Id = Number(insertAddr.run(seller1Id, southDelhi.id, 'Home — Hauz Khas', 'B-42, Second Floor, Hauz Khas Enclave', 'Near Deer Park Gate 2', '110016', 1).lastInsertRowid);
    insertAddr.run(seller1Id, southDelhi.id, 'Studio — Saket', '14, Press Enclave Road, Saket', 'Opposite District Park', '110017', 0);
    const addr2Id = Number(insertAddr.run(seller2Id, southDelhi.id, 'Shop — Lajpat Nagar', 'Shop 8, Central Market Lane 3, Lajpat Nagar II', 'Behind Metro Pillar 44', '110024', 1).lastInsertRowid);

    // Buyer Profiles
    const insertBuyer = db.prepare(
      `INSERT INTO buyer_profiles (user_id, business_name, registration_number, gst_or_tax_id, contact_person, business_phone, warehouse_area, verification_status, verification_notes, verified_by, verified_at, is_available, completed_transactions_count, average_rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertBuyer.run(buyer1Id, 'Metro Recycle Traders', 'DL-REC-2024-109', '07AABCM1234F1Z5', 'Vikram Malhotra', '+919810000020', 'Okhla Phase II, South Delhi', 'VERIFIED', 'Demo seed verified dealer', adminId, '2026-10-01T10:00:00Z', 1, 4, 4.75);
    insertBuyer.run(buyer2Id, 'GreenLoop Materials', 'DL-REC-2024-214', '07AABCG5678K1Z2', 'Kavita Nair', '+919810000021', 'Kalkaji Depot, South Delhi', 'VERIFIED', 'Demo seed verified dealer', adminId, '2026-10-05T11:30:00Z', 1, 3, 4.6);
    insertBuyer.run(buyer3Id, 'NewEra Scrap Works', 'BLR-REC-2026-041', '29AABCN9988L1Z9', 'Suresh Patel', '+919810000022', 'Shivajinagar, Central Bengaluru', 'PENDING', 'Awaiting document verification', null, null, 1, 0, 0);

    // Verification Docs
    const insertVerDoc = db.prepare(
      'INSERT INTO verification_documents (buyer_user_id, doc_type, doc_reference, review_status, reviewer_notes, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    insertVerDoc.run(buyer1Id, 'Trade License', 'TL-SOUTH-DL-88412', 'APPROVED', 'Verified against demo seed registry', adminId, '2026-10-01T10:00:00Z');
    insertVerDoc.run(buyer2Id, 'GST Registration', 'GST-07AABCG5678K1Z2', 'APPROVED', 'Verified against demo seed registry', adminId, '2026-10-05T11:30:00Z');
    insertVerDoc.run(buyer3Id, 'Trade License', 'TL-BLR-77102', 'PENDING', 'Submitted during dealer onboarding', null, null);

    // Collector Profiles
    const insertCollector = db.prepare(
      'INSERT INTO collector_profiles (user_id, buyer_user_id, vehicle_number, vehicle_type, license_ref, is_active) VALUES (?, ?, ?, ?, ?, 1)'
    );
    insertCollector.run(collector1Id, buyer1Id, 'DL-1L-AB-4412', 'COMPACT_EV_PICKUP', 'DL-04-2019-88211');
    insertCollector.run(collector2Id, buyer2Id, 'DL-1L-CD-9083', 'THREE_WHEELER_CARGO', 'DL-03-2020-77412');

    // Buyer Capabilities, Areas, Capacities
    const mats = db.prepare('SELECT id, slug FROM materials').all() as Array<{ id: number; slug: string }>;
    const matMap = Object.fromEntries(mats.map((m) => [m.slug, m.id]));

    const insertCapMat = db.prepare('INSERT INTO buyer_material_capabilities (buyer_user_id, material_id) VALUES (?, ?)');
    for (const slug of ['paper', 'cardboard', 'plastic', 'metal']) {
      insertCapMat.run(buyer1Id, matMap[slug]);
    }
    for (const slug of ['paper', 'cardboard', 'plastic']) {
      insertCapMat.run(buyer2Id, matMap[slug]);
    }
    insertCapMat.run(buyer3Id, matMap.metal);
    insertCapMat.run(buyer3Id, matMap.cardboard);

    const insertBuyerArea = db.prepare('INSERT INTO buyer_service_areas (buyer_user_id, service_area_id) VALUES (?, ?)');
    insertBuyerArea.run(buyer1Id, southDelhi.id);
    insertBuyerArea.run(buyer2Id, southDelhi.id);
    insertBuyerArea.run(buyer3Id, centralBlr.id);

    const insertBuyerCap = db.prepare(
      'INSERT INTO buyer_capacity (buyer_user_id, max_weight_kg, max_daily_pickups, active_bookings_count) VALUES (?, ?, ?, ?)'
    );
    insertBuyerCap.run(buyer1Id, 1500, 12, 0);
    insertBuyerCap.run(buyer2Id, 800, 8, 0);
    insertBuyerCap.run(buyer3Id, 600, 5, 0);

    // Platform Fee Rule (disclosed buyer-side service fee)
    const feeRuleId = Number(
      db.prepare(
        `INSERT INTO platform_fee_rules (name, fee_type, rate_value, min_fee, max_fee, applies_to_status, is_active, created_by)
         VALUES (?, 'PERCENTAGE', 2.5, 5, 500, 'COMPLETED', 1, ?)`
      ).run('Standard Buyer Coordination Fee (2.5%)', adminId).lastInsertRowid
    );

    // Seed Listing 1: PUBLISHED with 2 competing offers ready for Seller comparison!
    const listing1Id = Number(
      db.prepare(
        `INSERT INTO listings (reference_code, seller_user_id, address_id, service_area_id, title, description, preferred_pickup_date, preferred_pickup_window, status, ai_assisted, ai_tags_json, is_demo_seed)
         VALUES ('LST-2026-1001', ?, ?, ?, 'Sorted Home Paper, Cardboard & PET Bottles', 'Two bundles of dry newspapers, flattened shipping cartons, and rinsed clear plastic bottles from apartment cleanout.', '2026-11-18', '09:00-12:00', 'PUBLISHED', 1, '["paper","cardboard","plastic"]', 1)`
      ).run(seller1Id, addr1Id, southDelhi.id).lastInsertRowid
    );

    const l1Item1 = Number(
      db.prepare(
        `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
         VALUES (?, ?, ?, 18, 0, 'Dry tied newspaper and office sheets')`
      ).run(listing1Id, matMap.paper, kgUnit.id).lastInsertRowid
    );
    const l1Item2 = Number(
      db.prepare(
        `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
         VALUES (?, ?, ?, 14, 0, 'Flattened delivery cartons')`
      ).run(listing1Id, matMap.cardboard, kgUnit.id).lastInsertRowid
    );
    const l1Item3 = Number(
      db.prepare(
        `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
         VALUES (?, ?, ?, 6, 0, 'Rinsed PET & HDPE bottles')`
      ).run(listing1Id, matMap.plastic, kgUnit.id).lastInsertRowid
    );

    // Offer 1 (Full basket coverage from Metro Recycle Traders)
    const offer1Id = Number(
      db.prepare(
        `INSERT INTO offers (reference_code, listing_id, buyer_user_id, proposed_pickup_date, proposed_pickup_window, conditions_text, expires_at, estimated_total_value, covered_items_count, total_items_count, status, is_demo_seed)
         VALUES ('OFR-2026-2001', ?, ?, '2026-11-18', '09:00-12:00', 'Digital scale weighed at doorstep; dry paper rate applies if moisture-free.', '2026-11-20T23:59:00Z', 494, 3, 3, 'ACTIVE', 1)`
      ).run(listing1Id, buyer1Id).lastInsertRowid
    );
    const insertOfferItem = db.prepare(
      'INSERT INTO offer_items (offer_id, listing_item_id, is_covered, unit_rate, unit_id, estimated_amount) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertOfferItem.run(offer1Id, l1Item1, 1, 14, kgUnit.id, 252);
    insertOfferItem.run(offer1Id, l1Item2, 1, 10, kgUnit.id, 140);
    insertOfferItem.run(offer1Id, l1Item3, 1, 17, kgUnit.id, 102);

    // Offer 2 (Partial basket coverage from GreenLoop Materials - higher paper rate, excludes plastic)
    const offer2Id = Number(
      db.prepare(
        `INSERT INTO offers (reference_code, listing_id, buyer_user_id, proposed_pickup_date, proposed_pickup_window, conditions_text, expires_at, estimated_total_value, covered_items_count, total_items_count, status, is_demo_seed)
         VALUES ('OFR-2026-2002', ?, ?, '2026-11-18', '14:00-17:00', 'Covers paper and cardboard only; plastic excluded from this pickup slot.', '2026-11-20T23:59:00Z', 432, 2, 3, 'ACTIVE', 1)`
      ).run(listing1Id, buyer2Id).lastInsertRowid
    );
    insertOfferItem.run(offer2Id, l1Item1, 1, 16, kgUnit.id, 288);
    insertOfferItem.run(offer2Id, l1Item2, 1, 10.28, kgUnit.id, 144);
    insertOfferItem.run(offer2Id, l1Item3, 0, 0, kgUnit.id, 0);

    // Seed Listing 2: PUBLISHED open request (unknown weight item included!)
    const listing2Id = Number(
      db.prepare(
        `INSERT INTO listings (reference_code, seller_user_id, address_id, service_area_id, title, description, preferred_pickup_date, preferred_pickup_window, status, ai_assisted, ai_tags_json, is_demo_seed)
         VALUES ('LST-2026-1002', ?, ?, ?, 'Print Shop Offcuts & Metal Shelving Brackets', 'Office archive paper bundles plus mixed steel brackets and aluminum trim (exact weight unknown).', '2026-11-19', '14:00-17:00', 'PUBLISHED', 0, '["paper","metal"]', 1)`
      ).run(seller2Id, addr2Id, southDelhi.id).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
       VALUES (?, ?, ?, 45, 0, 'Trimmed white office paper stock')`
    ).run(listing2Id, matMap.paper, kgUnit.id);
    db.prepare(
      `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
       VALUES (?, ?, ?, NULL, 1, 'Assorted steel shelf brackets — weigh on site')`
    ).run(listing2Id, matMap.metal, pieceUnit.id);

    // Seed Listing 3: COMPLETED transaction with full Receipt & Platform Fee Ledger
    const listing3Id = Number(
      db.prepare(
        `INSERT INTO listings (reference_code, seller_user_id, address_id, service_area_id, title, description, preferred_pickup_date, preferred_pickup_window, status, ai_assisted, ai_tags_json, is_demo_seed)
         VALUES ('LST-2026-0990', ?, ?, ?, 'Corrugated Packaging & Copper Offcuts', 'Completed demo seed transaction illustrating receipt and fee ledger records.', '2026-11-10', '09:00-12:00', 'COMPLETED', 1, '["cardboard","metal"]', 1)`
      ).run(seller1Id, addr1Id, southDelhi.id).lastInsertRowid
    );
    const l3Item1 = Number(
      db.prepare(
        `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
         VALUES (?, ?, ?, 20, 0, 'Dry corrugated boxes')`
      ).run(listing3Id, matMap.cardboard, kgUnit.id).lastInsertRowid
    );
    const l3Item2 = Number(
      db.prepare(
        `INSERT INTO listing_items (listing_id, material_id, unit_id, estimated_quantity, quantity_unknown, item_notes)
         VALUES (?, ?, ?, 3, 0, 'Clean copper pipe pieces')`
      ).run(listing3Id, matMap.metal, kgUnit.id).lastInsertRowid
    );

    const offer3Id = Number(
      db.prepare(
        `INSERT INTO offers (reference_code, listing_id, buyer_user_id, proposed_pickup_date, proposed_pickup_window, conditions_text, expires_at, estimated_total_value, covered_items_count, total_items_count, status, is_demo_seed)
         VALUES ('OFR-2026-1990', ?, ?, '2026-11-10', '09:00-12:00', 'Verified scale reading at pickup.', '2026-11-12T23:59:00Z', 2150, 2, 2, 'ACCEPTED', 1)`
      ).run(listing3Id, buyer1Id).lastInsertRowid
    );
    insertOfferItem.run(offer3Id, l3Item1, 1, 10, kgUnit.id, 200);
    insertOfferItem.run(offer3Id, l3Item2, 1, 650, kgUnit.id, 1950);

    const snapshotJson = JSON.stringify([
      { listingItemId: l3Item1, materialName: 'Cardboard', unitCode: 'kg', unitRate: 10 },
      { listingItemId: l3Item2, materialName: 'Metal', unitCode: 'kg', unitRate: 650 },
    ]);

    const booking3Id = Number(
      db.prepare(
        `INSERT INTO bookings (booking_reference, listing_id, offer_id, seller_user_id, buyer_user_id, address_id, pickup_date, pickup_window, accepted_rates_snapshot_json, accepted_conditions, estimated_total_amount, final_settlement_amount, status, idempotency_key, is_demo_seed)
         VALUES ('BKG-2026-0990', ?, ?, ?, ?, ?, '2026-11-10', '09:00-12:00', ?, 'Verified scale reading at pickup.', 2150, 2295, 'COMPLETED', 'seed-bkg-0990', 1)`
      ).run(listing3Id, offer3Id, seller1Id, buyer1Id, addr1Id, snapshotJson).lastInsertRowid
    );

    db.prepare(
      `INSERT INTO collector_assignments (booking_id, collector_user_id, assigned_by, status, arrived_at, started_at, completed_at)
       VALUES (?, ?, ?, 'COMPLETED', '2026-11-10T09:20:00Z', '2026-11-10T09:25:00Z', '2026-11-10T09:50:00Z')`
    ).run(booking3Id, collector1Id, buyer1Id);

    const colRecId = Number(
      db.prepare(
        `INSERT INTO collection_records (booking_id, collector_user_id, inspection_notes, discrepancy_notes, calculated_total)
         VALUES (?, ?, 'Materials dry and clean as described.', 'Copper weighed 3.2 kg instead of estimated 3.0 kg.', 2295)`
      ).run(booking3Id, collector1Id).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO collection_items (collection_record_id, listing_item_id, material_id, unit_id, actual_quantity, material_grade, accepted_unit_rate, line_total, notes)
       VALUES (?, ?, ?, ?, 21.5, 'DRY_CORRUGATED', 10, 215, '21.5 kg verified')`
    ).run(colRecId, l3Item1, matMap.cardboard, kgUnit.id);
    db.prepare(
      `INSERT INTO collection_items (collection_record_id, listing_item_id, material_id, unit_id, actual_quantity, material_grade, accepted_unit_rate, line_total, notes)
       VALUES (?, ?, ?, ?, 3.2, 'CLEAN_COPPER', 650, 2080, '3.2 kg verified')`
    ).run(colRecId, l3Item2, matMap.metal, kgUnit.id);

    db.prepare(
      `INSERT INTO payment_acknowledgements (booking_id, payment_method, amount, state, buyer_ack_by, buyer_ack_at, buyer_reference, seller_ack_by, seller_ack_at, notes)
       VALUES (?, 'UPI_DIRECT', 2295, 'ACKNOWLEDGED_BY_SELLER', ?, '2026-11-10T09:46:00Z', 'DEMO-UPI-9901', ?, '2026-11-10T09:48:00Z', 'Direct transfer acknowledged by both parties (demo seed)')`
    ).run(booking3Id, buyer1Id, seller1Id);

    db.prepare(
      `INSERT INTO handover_records (booking_id, collector_confirmed_by, collector_confirmed_at, seller_confirmed_by, seller_confirmed_at, handover_notes)
       VALUES (?, ?, '2026-11-10T09:49:00Z', ?, '2026-11-10T09:49:30Z', 'All materials loaded cleanly.')`
    ).run(booking3Id, collector1Id, seller1Id);

    const receiptPayload = JSON.stringify({
      receiptNumber: 'RCP-2026-0990',
      bookingReference: 'BKG-2026-0990',
      sellerName: 'Priya Sharma',
      buyerBusinessName: 'Metro Recycle Traders',
      collectorName: 'Deepak Kumar',
      items: [
        { material: 'Cardboard', grade: 'DRY_CORRUGATED', actualQty: 21.5, unit: 'kg', rate: 10, lineTotal: 215 },
        { material: 'Metal', grade: 'CLEAN_COPPER', actualQty: 3.2, unit: 'kg', rate: 650, lineTotal: 2080 },
      ],
      finalAmount: 2295,
      paymentMethod: 'UPI_DIRECT',
      paymentState: 'ACKNOWLEDGED_BY_SELLER',
      handoverConfirmed: true,
      isDemoSeed: true,
    });
    db.prepare(
      `INSERT INTO transaction_receipts (receipt_number, booking_id, receipt_payload_json, final_amount, issued_at)
       VALUES ('RCP-2026-0990', ?, ?, 2295, '2026-11-10T09:50:00Z')`
    ).run(booking3Id, receiptPayload);

    db.prepare(
      `INSERT INTO platform_fee_ledger (booking_id, buyer_user_id, fee_rule_id, transaction_reference, gross_transaction_amount, fee_amount, status)
       VALUES (?, ?, ?, 'BKG-2026-0990', 2295, 57.38, 'ASSESSED')`
    ).run(booking3Id, buyer1Id, feeRuleId);

    db.prepare(
      `INSERT INTO ratings (booking_id, seller_user_id, buyer_user_id, score, comment)
       VALUES (?, ?, ?, 5, 'Punctual collector and transparent weighing.')`
    ).run(booking3Id, seller1Id, buyer1Id);

    // Seed Notifications
    const insertNotif = db.prepare(
      `INSERT INTO notifications (user_id, event_type, title, body, link_path, delivery_channel, is_read)
       VALUES (?, ?, ?, ?, ?, 'IN_APP', 0)`
    );
    insertNotif.run(seller1Id, 'OFFER_RECEIVED', '2 offers on LST-2026-1001', 'Metro Recycle Traders and GreenLoop Materials submitted offers on your listing.', '/seller/offers');
    insertNotif.run(buyer1Id, 'OFFER_RECEIVED', 'New open listing in South Delhi', 'LST-2026-1002 matches your supported materials and service area.', '/buyer/marketplace');
    insertNotif.run(adminId, 'VERIFICATION_UPDATED', '1 dealer verification pending', 'NewEra Scrap Works submitted onboarding documents for review.', '/admin/verification');

    // Audit Log Entry
    db.prepare(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, metadata_json)
       VALUES (?, 'SYSTEM', 'SEED_DATABASE', 'SYSTEM', 'init', '{"note":"Demo seed records initialized with is_demo_seed=1"}')`
    ).run(adminId);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
