import path from 'node:path';
import crypto from 'node:crypto';

const ephemeralJwtSecret = crypto.randomBytes(32).toString('hex');
const ephemeralRefreshSecret = crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET || ephemeralJwtSecret,
  refreshSecret: process.env.REFRESH_SECRET || ephemeralRefreshSecret,
  accessTokenTtl: '15m',
  refreshTokenTtlDays: 7,
  databasePath: path.resolve(process.cwd(), process.env.DATABASE_PATH || './data/scrapwala.db'),
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || './storage/private_uploads'),
  maxUploadBytes: 5 * 1024 * 1024, // 5MB
  allowedImageMimes: ['image/jpeg', 'image/png', 'image/webp'],
  allowedDocMimes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  otpProvider: process.env.OTP_PROVIDER || 'development_adapter',
  emailProvider: process.env.EMAIL_PROVIDER || 'development_adapter',
  pytorchModelWeightsPath: process.env.PYTORCH_MODEL_WEIGHTS_PATH || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  loginRateLimitWindowMs: 15 * 60 * 1000,
  loginRateLimitMaxAttempts: 20,
};
