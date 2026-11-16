# Scrap Wala — Setup, Deployment & Operations Guide

## 1. Local Setup
1. Copy `.env.example` to `.env` and set strong random values for `JWT_SECRET` and `REFRESH_SECRET`.
2. Optional: Set `GEMINI_API_KEY` for server-side Gemini Vision image classification and structured listing suggestions.
3. Install dependencies: `npm install`
4. Run automated unit & end-to-end API tests: `npm test`
5. Start development server on port 3000: `npm run dev`

## 2. Production Build & Execution
1. Build frontend bundle: `npm run build`
2. Start server: `NODE_ENV=production npm start`

## 3. Environment & Architecture Notes
- **Active Runtime**: Node.js v22 + Express + TypeScript (`tsx`) + SQLite (`node:sqlite` in WAL mode with `PRAGMA foreign_keys = ON`, `CHECK` constraints, `UNIQUE` constraints, and transactional `BEGIN IMMEDIATE`).
- **PostgreSQL Migration Path**: All queries live inside `/server/routes/*.ts` and `/server/db/migrations/001_initial.ts` using standard ANSI SQL. To target PostgreSQL in a dedicated container/VM, replace `DatabaseSync` with `pg` pool queries and run `001_initial.ts` adapted to `SERIAL` / `TIMESTAMPTZ`.
- **External Adapters**:
  - `OTP_PROVIDER`: Currently `development_adapter` (generates 6-digit hashed OTP challenges stored in `otp_verifications`; never falsely claims SMS delivery).
  - `EMAIL_PROVIDER`: Currently `development_adapter` (logs password reset tokens in dev only; never falsely claims email delivery).
  - `PYTORCH_MODEL_WEIGHTS_PATH`: Replaceable model loader check in `server/services/ai.ts`. Supply mounted `.pt`/`.onnx` weights + a Python TorchServe sidecar if running dedicated PyTorch inference.
- **No RAG**: Per product specification, no vector databases, embeddings, or retrieval-augmented pipelines are included.

## 4. Backup & Recovery Guidance
- **Database**: With SQLite WAL mode enabled, perform consistent hot backups via `sqlite3 data/scrapwala.db ".backup 'backup-scrapwala.db'"` on a scheduled cron interval.
- **Private Media Storage**: Back up `UPLOAD_DIR` (`./storage/private_uploads`) alongside database snapshots so `media_files.storage_key` records remain synchronized.
- **Audit Trail**: Never truncate `audit_logs`, `platform_fee_ledger`, or `transaction_receipts`; use reversal entries for financial corrections.
