import type { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/database';
import { getSafeUserById, verifyAccessToken, type SafeUser } from '../services/auth';

export interface AuthenticatedRequest extends Request {
  authUser?: SafeUser;
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const queryToken = typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
  const token =
    header && header.startsWith('Bearer ') ? header.slice(7).trim() : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    const db = getDb();
    const user = getSafeUserById(db, payload.userId);
    if (!user) {
      res.status(401).json({ error: 'User account not found.' });
      return;
    }
    if (user.accountStatus !== 'ACTIVE') {
      res.status(403).json({
        error: `Account is ${user.accountStatus}. Contact administration for support.`,
      });
      return;
    }
    req.authUser = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token.' });
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const hasRole = req.authUser.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
      });
      return;
    }
    next();
  };
}
