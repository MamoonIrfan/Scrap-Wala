import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config';

export interface AuthTokenPayload {
  userId: number;
  email: string;
  roles: string[];
}

export interface SafeUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  accountStatus: string;
  roles: string[];
  isDemoSeed: boolean;
}

const loginAttempts = new Map<string, { count: number; windowStart: number }>();

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.windowStart > config.loginRateLimitWindowMs) {
    loginAttempts.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (entry.count >= config.loginRateLimitMaxAttempts) {
    const retryAfterSec = Math.ceil(
      (config.loginRateLimitWindowMs - (now - entry.windowStart)) / 1000
    );
    return { allowed: false, retryAfterSec };
  }
  entry.count += 1;
  return { allowed: true };
}

export function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function getUserRoles(db: DatabaseSync, userId: number): string[] {
  const rows = db
    .prepare(
      `SELECT r.name FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .all(userId) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function getSafeUserById(db: DatabaseSync, userId: number): SafeUser | null {
  const row = db
    .prepare(
      `SELECT id, email, full_name, phone, phone_verified, email_verified, account_status, is_demo_seed
       FROM users WHERE id = ? AND deleted_at IS NULL`
    )
    .get(userId) as
    | {
        id: number;
        email: string;
        full_name: string;
        phone: string | null;
        phone_verified: number;
        email_verified: number;
        account_status: string;
        is_demo_seed: number;
      }
    | undefined;
  if (!row) return null;
  const roles = getUserRoles(db, row.id);
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    phoneVerified: row.phone_verified === 1,
    emailVerified: row.email_verified === 1,
    accountStatus: row.account_status,
    roles,
    isDemoSeed: row.is_demo_seed === 1,
  };
}

export function issueAuthTokens(
  db: DatabaseSync,
  user: SafeUser
): { accessToken: string; refreshToken: string } {
  const payload: AuthTokenPayload = {
    userId: user.id,
    email: user.email,
    roles: user.roles,
  };
  const accessToken = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(
    Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
  ).toISOString();

  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`
  ).run(user.id, tokenHash, expiresAt);

  return { accessToken, refreshToken };
}

export function verifyAccessToken(token: string): AuthTokenPayload {
  return jwt.verify(token, config.jwtSecret) as AuthTokenPayload;
}

export function rotateRefreshToken(
  db: DatabaseSync,
  rawRefreshToken: string
): { user: SafeUser; accessToken: string; refreshToken: string } | null {
  const tokenHash = hashToken(rawRefreshToken);
  const row = db
    .prepare(
      `SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?`
    )
    .get(tokenHash) as
    | { id: number; user_id: number; expires_at: string; revoked_at: string | null }
    | undefined;

  if (!row || row.revoked_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;

  const user = getSafeUserById(db, row.user_id);
  if (!user || user.accountStatus !== 'ACTIVE') return null;

  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);
  const tokens = issueAuthTokens(db, user);
  return { user, ...tokens };
}

export function revokeRefreshToken(db: DatabaseSync, rawRefreshToken: string): void {
  const tokenHash = hashToken(rawRefreshToken);
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ?`).run(
    tokenHash
  );
}

export function createPhoneOtp(
  db: DatabaseSync,
  userId: number,
  phone: string
): {
  provider: string;
  delivered: boolean;
  limitationNote: string;
  devVerificationCode?: string;
} {
  const code = String(crypto.randomInt(100000, 999999));
  const otpHash = hashToken(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO otp_verifications (user_id, phone, otp_hash, provider, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, phone, otpHash, config.otpProvider, expiresAt);

  // Honest development adapter: never claim SMS was sent externally
  return {
    provider: config.otpProvider,
    delivered: false,
    limitationNote:
      'No external SMS gateway credentials configured. Use the development adapter verification code below to test OTP verification.',
    devVerificationCode: config.nodeEnv !== 'production' ? code : undefined,
  };
}

export function verifyPhoneOtp(
  db: DatabaseSync,
  userId: number,
  phone: string,
  code: string
): { verified: boolean; reason?: string } {
  const latest = db
    .prepare(
      `SELECT id, otp_hash, expires_at, verified_at, attempts
       FROM otp_verifications
       WHERE user_id = ? AND phone = ? AND verified_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, phone) as
    | {
        id: number;
        otp_hash: string;
        expires_at: string;
        verified_at: string | null;
        attempts: number;
      }
    | undefined;

  if (!latest) {
    return { verified: false, reason: 'No active OTP challenge found for this phone number.' };
  }
  if (latest.attempts >= 5) {
    return { verified: false, reason: 'Maximum OTP verification attempts exceeded. Request a new code.' };
  }
  if (Date.parse(latest.expires_at) < Date.now()) {
    return { verified: false, reason: 'OTP code has expired.' };
  }

  const matches = hashToken(code.trim()) === latest.otp_hash;
  if (!matches) {
    db.prepare(`UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?`).run(latest.id);
    return { verified: false, reason: 'Invalid OTP verification code.' };
  }

  db.prepare(`UPDATE otp_verifications SET verified_at = datetime('now') WHERE id = ?`).run(
    latest.id
  );
  db.prepare(`UPDATE users SET phone = ?, phone_verified = 1, updated_at = datetime('now') WHERE id = ?`).run(
    phone,
    userId
  );
  return { verified: true };
}
