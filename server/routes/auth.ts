import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb, withTransaction } from '../db/database';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  createPhoneOtp,
  getSafeUserById,
  hashPassword,
  hashToken,
  issueAuthTokens,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyPassword,
  verifyPhoneOtp,
} from '../services/auth';
import { recordAuditLog } from '../services/audit';
import { config } from '../config';

const router = Router();

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/register', (req, res) => {
  const {
    email,
    password,
    fullName,
    phone,
    role,
    sellerType,
    organizationName,
    businessName,
    registrationNumber,
    gstOrTaxId,
    warehouseArea,
  } = req.body || {};

  if (!email || !validateEmail(String(email))) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (!password || String(password).length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  if (!fullName || String(fullName).trim().length < 2) {
    res.status(400).json({ error: 'Full name is required.' });
    return;
  }

  // Only SELLER or BUYER can self-register; COLLECTOR and ADMIN require authorized workflows
  const targetRole = role === 'BUYER' ? 'BUYER' : 'SELLER';
  if (role && role !== 'SELLER' && role !== 'BUYER') {
    res.status(403).json({
      error: 'Self-registration is restricted to SELLER and BUYER roles.',
    });
    return;
  }
  if (targetRole === 'BUYER' && (!businessName || !warehouseArea)) {
    res.status(400).json({
      error: 'Business name and warehouse area are required for buyer registration.',
    });
    return;
  }

  const db = getDb();
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const passwordHash = hashPassword(String(password));
  const createdUser = withTransaction(db, () => {
    const userRes = db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, phone, phone_verified, email_verified, account_status, is_demo_seed)
         VALUES (?, ?, ?, ?, 0, 0, 'ACTIVE', 0)`
      )
      .run(
        normalizedEmail,
        passwordHash,
        String(fullName).trim(),
        phone ? String(phone).trim() : null
      );
    const userId = Number(userRes.lastInsertRowid);

    const roleRow = db.prepare('SELECT id FROM roles WHERE name = ?').get(targetRole) as {
      id: number;
    };
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleRow.id);

    if (targetRole === 'SELLER') {
      db.prepare(
        `INSERT INTO seller_profiles (user_id, seller_type, organization_name)
         VALUES (?, ?, ?)`
      ).run(
        userId,
        sellerType === 'SMALL_BUSINESS' ? 'SMALL_BUSINESS' : 'HOUSEHOLD',
        organizationName ? String(organizationName).trim() : null
      );
    } else {
      db.prepare(
        `INSERT INTO buyer_profiles (user_id, business_name, registration_number, gst_or_tax_id, contact_person, business_phone, warehouse_area, verification_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`
      ).run(
        userId,
        String(businessName).trim(),
        registrationNumber ? String(registrationNumber).trim() : null,
        gstOrTaxId ? String(gstOrTaxId).trim() : null,
        String(fullName).trim(),
        phone ? String(phone).trim() : 'Not provided',
        String(warehouseArea).trim()
      );
      db.prepare(
        `INSERT INTO buyer_capacity (buyer_user_id, max_weight_kg, max_daily_pickups, active_bookings_count)
         VALUES (?, 500, 5, 0)`
      ).run(userId);
    }

    recordAuditLog(db, {
      actorUserId: userId,
      actorRole: targetRole,
      action: 'USER_REGISTERED',
      entityType: 'USER',
      entityId: userId,
      metadata: { role: targetRole },
      ipAddress: req.ip,
    });

    return getSafeUserById(db, userId)!;
  });

  const tokens = issueAuthTokens(db, createdUser);
  res.status(201).json({
    user: createdUser,
    ...tokens,
    emailVerificationStatus:
      config.emailProvider === 'development_adapter'
        ? 'NO_EMAIL_PROVIDER_CONFIGURED'
        : 'VERIFICATION_EMAIL_QUEUED',
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const limitKey = `${req.ip}:${normalizedEmail}`;

  const rate = checkLoginRateLimit(limitKey);
  if (!rate.allowed) {
    res.status(429).json({
      error: `Too many login attempts. Retry after ${rate.retryAfterSec} seconds.`,
    });
    return;
  }

  if (!normalizedEmail || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, password_hash, account_status FROM users WHERE email = ? AND deleted_at IS NULL`
    )
    .get(normalizedEmail) as
    | { id: number; password_hash: string; account_status: string }
    | undefined;

  if (!row || !verifyPassword(String(password), row.password_hash)) {
    recordAuditLog(db, {
      actorRole: 'ANONYMOUS',
      action: 'LOGIN_FAILED',
      entityType: 'USER',
      entityId: normalizedEmail,
      ipAddress: req.ip,
    });
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (row.account_status !== 'ACTIVE') {
    res.status(403).json({
      error: `Account is ${row.account_status}. Access is blocked.`,
    });
    return;
  }

  clearLoginRateLimit(limitKey);
  const user = getSafeUserById(db, row.id)!;
  const tokens = issueAuthTokens(db, user);

  recordAuditLog(db, {
    actorUserId: user.id,
    actorRole: user.roles.join(','),
    action: 'LOGIN_SUCCESS',
    entityType: 'USER',
    entityId: user.id,
    ipAddress: req.ip,
  });

  res.json({ user, ...tokens });
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token is required.' });
    return;
  }
  const db = getDb();
  const rotated = rotateRefreshToken(db, String(refreshToken));
  if (!rotated) {
    res.status(401).json({ error: 'Invalid or expired refresh token.' });
    return;
  }
  res.json(rotated);
});

router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  const { refreshToken } = req.body || {};
  const db = getDb();
  if (refreshToken) {
    revokeRefreshToken(db, String(refreshToken));
  }
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: req.authUser!.roles.join(','),
    action: 'LOGOUT',
    entityType: 'USER',
    entityId: req.authUser!.id,
    ipAddress: req.ip,
  });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});

router.post('/phone-otp/request', requireAuth, (req: AuthenticatedRequest, res) => {
  const { phone } = req.body || {};
  const cleanPhone = String(phone || '').trim();
  if (!/^[+\d][\d\s-]{6,18}$/.test(cleanPhone)) {
    res.status(400).json({ error: 'Please provide a valid phone number.' });
    return;
  }
  const db = getDb();
  const result = createPhoneOtp(db, req.authUser!.id, cleanPhone);
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: req.authUser!.roles.join(','),
    action: 'PHONE_OTP_REQUESTED',
    entityType: 'USER',
    entityId: req.authUser!.id,
    metadata: { provider: result.provider, delivered: result.delivered },
  });
  res.json(result);
});

router.post('/phone-otp/verify', requireAuth, (req: AuthenticatedRequest, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    res.status(400).json({ error: 'Phone number and verification code are required.' });
    return;
  }
  const db = getDb();
  const result = verifyPhoneOtp(db, req.authUser!.id, String(phone).trim(), String(code));
  if (!result.verified) {
    res.status(400).json({ error: result.reason });
    return;
  }
  recordAuditLog(db, {
    actorUserId: req.authUser!.id,
    actorRole: req.authUser!.roles.join(','),
    action: 'PHONE_OTP_VERIFIED',
    entityType: 'USER',
    entityId: req.authUser!.id,
  });
  res.json({ verified: true, user: getSafeUserById(db, req.authUser!.id) });
});

router.post('/forgot-password', (req, res) => {
  const { email } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }
  const db = getDb();
  const user = db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .get(normalizedEmail) as { id: number } | undefined;

  let devResetToken: string | undefined;
  if (user) {
    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
    ).run(user.id, tokenHash, expiresAt);
    if (config.nodeEnv !== 'production') {
      devResetToken = rawToken;
    }
    recordAuditLog(db, {
      actorUserId: user.id,
      actorRole: 'USER',
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: req.ip,
    });
  }

  res.json({
    ok: true,
    provider: config.emailProvider,
    delivered: false,
    message:
      'If an account matches this email, a password reset challenge has been created. No live email server is configured in this environment.',
    devResetToken,
  });
});

router.post('/reset-password', (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword || String(newPassword).length < 8) {
    res.status(400).json({ error: 'Valid reset token and password (min 8 chars) required.' });
    return;
  }
  const db = getDb();
  const tokenHash = hashToken(String(token).trim());
  const row = db
    .prepare(
      `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;

  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired password reset token.' });
    return;
  }

  const newHash = hashPassword(String(newPassword));
  withTransaction(db, () => {
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
      newHash,
      row.user_id
    );
    db.prepare(`UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?`).run(
      row.id
    );
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?`).run(
      row.user_id
    );
    recordAuditLog(db, {
      actorUserId: row.user_id,
      actorRole: 'USER',
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'USER',
      entityId: row.user_id,
      ipAddress: req.ip,
    });
  });

  res.json({ ok: true, message: 'Password updated. All existing sessions have been invalidated.' });
});

export default router;
