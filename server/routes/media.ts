import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config';
import { getDb } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';

const router = Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes },
});

router.post('/upload', requireAuth, upload.single('file'), (req: AuthenticatedRequest, res) => {
  const file = req.file;
  const scope = String(req.body?.scope || 'LISTING_IMAGE');
  const validScopes = [
    'LISTING_IMAGE',
    'VERIFICATION_DOC',
    'COLLECTION_EVIDENCE',
    'COMPLAINT_EVIDENCE',
  ];
  if (!validScopes.includes(scope)) {
    res.status(400).json({ error: 'Invalid upload scope.' });
    return;
  }
  if (!file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  const allowedMimes =
    scope === 'VERIFICATION_DOC' || scope === 'COMPLAINT_EVIDENCE'
      ? config.allowedDocMimes
      : config.allowedImageMimes;
  if (!allowedMimes.includes(file.mimetype)) {
    res.status(400).json({
      error: `Unsupported file type (${file.mimetype}). Allowed: ${allowedMimes.join(', ')}`,
    });
    return;
  }

  const ext =
    file.mimetype === 'application/pdf'
      ? '.pdf'
      : file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
      ? '.webp'
      : '.jpg';
  const storageKey = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const fullPath = path.join(config.uploadDir, storageKey);
  fs.writeFileSync(fullPath, file.buffer);

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO media_files (owner_user_id, storage_key, original_name, mime_type, byte_size, scope)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.authUser!.id,
      storageKey,
      file.originalname.slice(0, 120),
      file.mimetype,
      file.size,
      scope
    );

  res.status(201).json({
    id: Number(info.lastInsertRowid),
    originalName: file.originalname,
    mimeType: file.mimetype,
    byteSize: file.size,
    scope,
    url: `/api/v1/media/${Number(info.lastInsertRowid)}`,
  });
});

router.get('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const mediaId = Number(req.params.id);
  if (!Number.isInteger(mediaId)) {
    res.status(400).json({ error: 'Invalid media ID.' });
    return;
  }

  const db = getDb();
  const media = db
    .prepare('SELECT * FROM media_files WHERE id = ?')
    .get(mediaId) as
    | {
        id: number;
        owner_user_id: number;
        storage_key: string;
        mime_type: string;
        scope: string;
      }
    | undefined;

  if (!media) {
    res.status(404).json({ error: 'Media file not found.' });
    return;
  }

  const user = req.authUser!;
  let authorized = user.roles.includes('ADMIN') || media.owner_user_id === user.id;

  // Allow buyers/collectors to view listing images ONLY if listing is published or assigned to them
  if (!authorized && media.scope === 'LISTING_IMAGE') {
    const linkedListing = db
      .prepare(
        `SELECT l.status, l.id FROM listing_images li
         JOIN listings l ON l.id = li.listing_id
         WHERE li.media_file_id = ?`
      )
      .get(mediaId) as { status: string; id: number } | undefined;

    if (linkedListing && user.roles.includes('BUYER') && linkedListing.status === 'PUBLISHED') {
      authorized = true;
    } else if (linkedListing && (user.roles.includes('BUYER') || user.roles.includes('COLLECTOR'))) {
      const bookingMatch = db
        .prepare(
          `SELECT b.id FROM bookings b
           LEFT JOIN collector_assignments ca ON ca.booking_id = b.id
           WHERE b.listing_id = ? AND (b.buyer_user_id = ? OR ca.collector_user_id = ?)`
        )
        .get(linkedListing.id, user.id, user.id);
      if (bookingMatch) authorized = true;
    }
  }

  // Allow seller/buyer/collector involved in a booking to view collection evidence
  if (!authorized && media.scope === 'COLLECTION_EVIDENCE') {
    const bookingMatch = db
      .prepare(
        `SELECT b.id FROM collection_items ci
         JOIN collection_records cr ON cr.id = ci.collection_record_id
         JOIN bookings b ON b.id = cr.booking_id
         WHERE ci.evidence_media_id = ? AND (b.seller_user_id = ? OR b.buyer_user_id = ?)`
      )
      .get(mediaId, user.id, user.id);
    if (bookingMatch) authorized = true;
  }

  if (!authorized) {
    res.status(403).json({ error: 'You are not authorized to access this private file.' });
    return;
  }

  const fullPath = path.join(config.uploadDir, media.storage_key);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Stored file missing on disk.' });
    return;
  }

  res.setHeader('Content-Type', media.mime_type);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(fullPath);
});

export default router;
