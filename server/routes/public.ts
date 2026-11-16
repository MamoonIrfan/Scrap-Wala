import { Router } from 'express';
import { getDb } from '../db/database';
import { getContextualGuidance } from '../services/ai';

const router = Router();

router.get('/taxonomy', (_req, res) => {
  const db = getDb();
  const materials = db
    .prepare(
      `SELECT m.id, m.slug, m.name, m.description, m.handling_guidance, m.image_url,
              mu.id as default_unit_id, mu.code as default_unit_code, mu.name as default_unit_name
       FROM materials m
       JOIN material_units mu ON mu.id = m.default_unit_id
       WHERE m.is_active = 1
       ORDER BY m.id ASC`
    )
    .all();

  const units = db
    .prepare(
      `SELECT id, code, name, dimension, base_factor
       FROM material_units WHERE is_active = 1 ORDER BY id ASC`
    )
    .all();

  const serviceAreas = db
    .prepare(
      `SELECT id, name, city, postal_prefixes
       FROM service_areas WHERE is_active = 1 ORDER BY name ASC`
    )
    .all();

  const activeFeeRule = db
    .prepare(
      `SELECT name, fee_type, rate_value, min_fee, max_fee
       FROM platform_fee_rules WHERE is_active = 1 ORDER BY id DESC LIMIT 1`
    )
    .get();

  res.json({ materials, units, serviceAreas, activeFeeRule });
});

router.get('/platform-snapshot', (_req, res) => {
  const db = getDb();
  const counts = {
    verifiedBuyers: (
      db
        .prepare("SELECT COUNT(*) as c FROM buyer_profiles WHERE verification_status = 'VERIFIED'")
        .get() as { c: number }
    ).c,
    activeServiceAreas: (
      db.prepare('SELECT COUNT(*) as c FROM service_areas WHERE is_active = 1').get() as { c: number }
    ).c,
    activeMaterials: (
      db.prepare('SELECT COUNT(*) as c FROM materials WHERE is_active = 1').get() as { c: number }
    ).c,
    publishedListings: (
      db.prepare("SELECT COUNT(*) as c FROM listings WHERE status = 'PUBLISHED'").get() as {
        c: number;
      }
    ).c,
    completedPickups: (
      db.prepare("SELECT COUNT(*) as c FROM bookings WHERE status = 'COMPLETED'").get() as {
        c: number;
      }
    ).c,
  };
  res.json({
    counts,
    includesDemoSeedData: true,
    note: 'Counts reflect live database records, including clearly flagged demo seed accounts.',
  });
});

router.get('/guidance', (req, res) => {
  const topic = typeof req.query.topic === 'string' ? req.query.topic : undefined;
  res.json({ guidance: getContextualGuidance(topic) });
});

router.post('/contact', (req, res) => {
  const { name, email, topic, message } = req.body || {};
  if (!name || !email || !topic || !message) {
    res.status(400).json({ error: 'Name, email, topic, and message are required.' });
    return;
  }
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO contact_inquiries (name, email, topic, message) VALUES (?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(email).trim(),
      String(topic).trim(),
      String(message).trim()
    );
  res.status(201).json({
    id: Number(info.lastInsertRowid),
    status: 'NEW',
    message: 'Your inquiry has been recorded in our database.',
  });
});

export default router;
