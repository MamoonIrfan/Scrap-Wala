import type { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
  db.exec(`
    -- 1. Core Identity, RBAC & Auth
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      phone TEXT,
      phone_verified INTEGER NOT NULL DEFAULT 0 CHECK (phone_verified IN (0, 1)),
      email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
      account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
      is_demo_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_seed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE CHECK (name IN ('SELLER', 'BUYER', 'COLLECTOR', 'ADMIN')),
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, role_id)
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'development_adapter',
      expires_at TEXT NOT NULL,
      verified_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 2. Service Areas & Profiles
    CREATE TABLE IF NOT EXISTS service_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      city TEXT NOT NULL,
      postal_prefixes TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS seller_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      seller_type TEXT NOT NULL DEFAULT 'HOUSEHOLD' CHECK (seller_type IN ('HOUSEHOLD', 'SMALL_BUSINESS')),
      organization_name TEXT,
      preferred_payment_method TEXT NOT NULL DEFAULT 'CASH',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      service_area_id INTEGER NOT NULL REFERENCES service_areas(id),
      label TEXT NOT NULL,
      street_line TEXT NOT NULL,
      landmark TEXT,
      postal_code TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS buyer_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      business_name TEXT NOT NULL,
      registration_number TEXT,
      gst_or_tax_id TEXT,
      contact_person TEXT NOT NULL,
      business_phone TEXT NOT NULL,
      warehouse_area TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED')),
      verification_notes TEXT,
      verified_by INTEGER REFERENCES users(id),
      verified_at TEXT,
      is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
      completed_transactions_count INTEGER NOT NULL DEFAULT 0,
      average_rating REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collector_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      vehicle_number TEXT NOT NULL,
      vehicle_type TEXT NOT NULL DEFAULT 'MINI_TRUCK',
      license_ref TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. Private Media & Verification Docs
    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      scope TEXT NOT NULL CHECK (scope IN ('LISTING_IMAGE', 'VERIFICATION_DOC', 'COLLECTION_EVIDENCE', 'COMPLAINT_EVIDENCE')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      media_file_id INTEGER REFERENCES media_files(id) ON DELETE SET NULL,
      doc_type TEXT NOT NULL,
      doc_reference TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (review_status IN ('PENDING', 'APPROVED', 'REJECTED')),
      reviewer_notes TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 4. Materials Taxonomy & Units
    CREATE TABLE IF NOT EXISTS material_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      dimension TEXT NOT NULL CHECK (dimension IN ('MASS', 'COUNT', 'BUNDLE')),
      base_factor REAL NOT NULL DEFAULT 1 CHECK (base_factor > 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      default_unit_id INTEGER NOT NULL REFERENCES material_units(id),
      handling_guidance TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS buyer_material_capabilities (
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      PRIMARY KEY (buyer_user_id, material_id)
    );

    CREATE TABLE IF NOT EXISTS buyer_service_areas (
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      service_area_id INTEGER NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
      PRIMARY KEY (buyer_user_id, service_area_id)
    );

    CREATE TABLE IF NOT EXISTS buyer_capacity (
      buyer_user_id INTEGER PRIMARY KEY REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      max_weight_kg REAL NOT NULL DEFAULT 1000 CHECK (max_weight_kg >= 0),
      max_daily_pickups INTEGER NOT NULL DEFAULT 10 CHECK (max_daily_pickups >= 0),
      active_bookings_count INTEGER NOT NULL DEFAULT 0 CHECK (active_bookings_count >= 0),
      preferred_slots_json TEXT NOT NULL DEFAULT '["09:00-12:00","14:00-17:00"]',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 5. Scrap Listings
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT NOT NULL UNIQUE,
      seller_user_id INTEGER NOT NULL REFERENCES users(id),
      address_id INTEGER NOT NULL REFERENCES addresses(id),
      service_area_id INTEGER NOT NULL REFERENCES service_areas(id),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      preferred_pickup_date TEXT NOT NULL,
      preferred_pickup_window TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'BOOKED', 'IN_COLLECTION', 'COMPLETED', 'CANCELLED')),
      ai_assisted INTEGER NOT NULL DEFAULT 0 CHECK (ai_assisted IN (0, 1)),
      ai_tags_json TEXT NOT NULL DEFAULT '[]',
      is_demo_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_seed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS listing_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      unit_id INTEGER NOT NULL REFERENCES material_units(id),
      estimated_quantity REAL CHECK (estimated_quantity IS NULL OR estimated_quantity >= 0),
      quantity_unknown INTEGER NOT NULL DEFAULT 0 CHECK (quantity_unknown IN (0, 1)),
      item_notes TEXT NOT NULL DEFAULT '',
      ai_suggested_category TEXT,
      ai_confidence REAL
    );

    CREATE TABLE IF NOT EXISTS listing_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
      caption TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 6. Offers & Offer Items
    CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT NOT NULL UNIQUE,
      listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id),
      proposed_pickup_date TEXT NOT NULL,
      proposed_pickup_window TEXT NOT NULL,
      conditions_text TEXT NOT NULL DEFAULT '',
      expires_at TEXT NOT NULL,
      estimated_total_value REAL NOT NULL CHECK (estimated_total_value >= 0),
      covered_items_count INTEGER NOT NULL DEFAULT 0,
      total_items_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
      is_demo_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_seed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS offer_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      listing_item_id INTEGER NOT NULL REFERENCES listing_items(id) ON DELETE CASCADE,
      is_covered INTEGER NOT NULL DEFAULT 1 CHECK (is_covered IN (0, 1)),
      unit_rate REAL NOT NULL CHECK (unit_rate >= 0),
      unit_id INTEGER NOT NULL REFERENCES material_units(id),
      estimated_amount REAL NOT NULL CHECK (estimated_amount >= 0),
      UNIQUE (offer_id, listing_item_id)
    );

    -- 7. Pickup Slots, Bookings & Collector Assignments
    CREATE TABLE IF NOT EXISTS pickup_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id) ON DELETE CASCADE,
      slot_date TEXT NOT NULL,
      slot_window TEXT NOT NULL,
      booking_id INTEGER,
      status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('AVAILABLE', 'RESERVED', 'COMPLETED', 'RELEASED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_reference TEXT NOT NULL UNIQUE,
      listing_id INTEGER NOT NULL UNIQUE REFERENCES listings(id),
      offer_id INTEGER NOT NULL UNIQUE REFERENCES offers(id),
      seller_user_id INTEGER NOT NULL REFERENCES users(id),
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id),
      address_id INTEGER NOT NULL REFERENCES addresses(id),
      pickup_date TEXT NOT NULL,
      pickup_window TEXT NOT NULL,
      accepted_rates_snapshot_json TEXT NOT NULL,
      accepted_conditions TEXT NOT NULL DEFAULT '',
      estimated_total_amount REAL NOT NULL CHECK (estimated_total_amount >= 0),
      final_settlement_amount REAL CHECK (final_settlement_amount IS NULL OR final_settlement_amount >= 0),
      status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN (
        'CONFIRMED',
        'COLLECTOR_ASSIGNED',
        'ARRIVED',
        'COLLECTING',
        'WEIGHED_PENDING_APPROVAL',
        'SETTLEMENT_APPROVED',
        'COMPLETED',
        'CANCELLED',
        'DISPUTED'
      )),
      idempotency_key TEXT UNIQUE,
      is_demo_seed INTEGER NOT NULL DEFAULT 0 CHECK (is_demo_seed IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collector_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      collector_user_id INTEGER NOT NULL REFERENCES collector_profiles(user_id),
      assigned_by INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'REASSIGNED')),
      arrived_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 8. Weighing, Collection & Settlement Revisions
    CREATE TABLE IF NOT EXISTS collection_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      collector_user_id INTEGER NOT NULL REFERENCES collector_profiles(user_id),
      inspection_notes TEXT NOT NULL DEFAULT '',
      discrepancy_notes TEXT NOT NULL DEFAULT '',
      calculated_total REAL NOT NULL DEFAULT 0 CHECK (calculated_total >= 0),
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS collection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_record_id INTEGER NOT NULL REFERENCES collection_records(id) ON DELETE CASCADE,
      listing_item_id INTEGER NOT NULL REFERENCES listing_items(id),
      material_id INTEGER NOT NULL REFERENCES materials(id),
      unit_id INTEGER NOT NULL REFERENCES material_units(id),
      actual_quantity REAL NOT NULL CHECK (actual_quantity >= 0),
      material_grade TEXT NOT NULL DEFAULT 'STANDARD',
      accepted_unit_rate REAL NOT NULL CHECK (accepted_unit_rate >= 0),
      line_total REAL NOT NULL CHECK (line_total >= 0),
      evidence_media_id INTEGER REFERENCES media_files(id),
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS settlement_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      proposed_by_user_id INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      original_total REAL NOT NULL CHECK (original_total >= 0),
      revised_total REAL NOT NULL CHECK (revised_total >= 0),
      status TEXT NOT NULL DEFAULT 'PENDING_SELLER' CHECK (status IN ('PENDING_SELLER', 'APPROVED', 'REJECTED')),
      seller_decision_notes TEXT,
      decided_by_user_id INTEGER REFERENCES users(id),
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settlement_revision_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_revision_id INTEGER NOT NULL REFERENCES settlement_revisions(id) ON DELETE CASCADE,
      listing_item_id INTEGER NOT NULL REFERENCES listing_items(id),
      original_material_id INTEGER NOT NULL REFERENCES materials(id),
      revised_material_id INTEGER NOT NULL REFERENCES materials(id),
      original_rate REAL NOT NULL CHECK (original_rate >= 0),
      revised_rate REAL NOT NULL CHECK (revised_rate >= 0),
      actual_quantity REAL NOT NULL CHECK (actual_quantity >= 0),
      revised_grade TEXT NOT NULL DEFAULT 'STANDARD',
      original_line_total REAL NOT NULL CHECK (original_line_total >= 0),
      revised_line_total REAL NOT NULL CHECK (revised_line_total >= 0)
    );

    -- 9. Payment Acknowledgements, Handover & Digital Receipts
    CREATE TABLE IF NOT EXISTS payment_acknowledgements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'UPI_DIRECT', 'OTHER')),
      amount REAL NOT NULL CHECK (amount >= 0),
      state TEXT NOT NULL DEFAULT 'PAYMENT_PENDING' CHECK (state IN (
        'PAYMENT_PENDING',
        'ACKNOWLEDGED_BY_BUYER',
        'ACKNOWLEDGED_BY_SELLER',
        'PAYMENT_DISPUTED',
        'PROVIDER_VERIFIED'
      )),
      buyer_ack_by INTEGER REFERENCES users(id),
      buyer_ack_at TEXT,
      buyer_reference TEXT,
      seller_ack_by INTEGER REFERENCES users(id),
      seller_ack_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS handover_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      collector_confirmed_by INTEGER REFERENCES users(id),
      collector_confirmed_at TEXT,
      seller_confirmed_by INTEGER REFERENCES users(id),
      seller_confirmed_at TEXT,
      handover_notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS transaction_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT NOT NULL UNIQUE,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      receipt_payload_json TEXT NOT NULL,
      final_amount REAL NOT NULL CHECK (final_amount >= 0),
      issued_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 10. Complaints, Ratings & Notifications
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_code TEXT NOT NULL UNIQUE,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
      raised_by_user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL CHECK (category IN ('WEIGHT_DISCREPANCY', 'PAYMENT_ISSUE', 'NO_SHOW', 'CONDUCT', 'PLATFORM_ISSUE', 'OTHER')),
      description TEXT NOT NULL,
      evidence_media_id INTEGER REFERENCES media_files(id),
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
      admin_response TEXT,
      resolution_notes TEXT,
      resolved_by INTEGER REFERENCES users(id),
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaint_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      sender_user_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      seller_user_id INTEGER NOT NULL REFERENCES users(id),
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id),
      score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link_path TEXT NOT NULL DEFAULT '',
      delivery_channel TEXT NOT NULL DEFAULT 'IN_APP' CHECK (delivery_channel IN ('IN_APP', 'EMAIL_ADAPTER', 'SMS_ADAPTER')),
      is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL UNIQUE,
      title_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 11. Platform Fee Rules & Ledger
    CREATE TABLE IF NOT EXISTS platform_fee_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      fee_type TEXT NOT NULL CHECK (fee_type IN ('PERCENTAGE', 'FLAT')),
      rate_value REAL NOT NULL CHECK (rate_value >= 0),
      min_fee REAL NOT NULL DEFAULT 0 CHECK (min_fee >= 0),
      max_fee REAL,
      applies_to_status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (applies_to_status IN ('COMPLETED')),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS platform_fee_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      buyer_user_id INTEGER NOT NULL REFERENCES buyer_profiles(user_id),
      fee_rule_id INTEGER NOT NULL REFERENCES platform_fee_rules(id),
      transaction_reference TEXT NOT NULL,
      gross_transaction_amount REAL NOT NULL CHECK (gross_transaction_amount >= 0),
      fee_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'ASSESSED' CHECK (status IN ('ASSESSED', 'INVOICED', 'PAID', 'REVERSED')),
      reversal_reason TEXT,
      reversed_by INTEGER REFERENCES users(id),
      reversed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 12. Settings, Audit Logs, AI Inference Logs & Contact Inquiries
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER REFERENCES users(id),
      actor_role TEXT NOT NULL DEFAULT 'SYSTEM',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_inference_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      feature_type TEXT NOT NULL CHECK (feature_type IN ('IMAGE_CLASSIFICATION', 'LISTING_ASSIST')),
      model_name TEXT NOT NULL,
      model_version TEXT NOT NULL,
      adapter_mode TEXT NOT NULL,
      predicted_category TEXT,
      confidence_score REAL,
      low_confidence_flag INTEGER NOT NULL DEFAULT 0 CHECK (low_confidence_flag IN (0, 1)),
      latency_ms INTEGER NOT NULL DEFAULT 0,
      input_summary TEXT NOT NULL DEFAULT '',
      output_summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      topic TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACKNOWLEDGED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for frequent queries
    CREATE INDEX IF NOT EXISTS idx_listings_status_area ON listings(status, service_area_id);
    CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_user_id);
    CREATE INDEX IF NOT EXISTS idx_offers_listing_status ON offers(listing_id, status);
    CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_seller ON bookings(seller_user_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_buyer ON bookings(buyer_user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_fee_ledger_buyer ON platform_fee_ledger(buyer_user_id, status);
  `);
}
