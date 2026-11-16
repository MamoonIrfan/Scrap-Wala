# Scrap Wala — Development Progress & Architecture Log

## 1. Requirements Summary & Environment Notes
Scrap Wala is an AI-assisted scrap trading and pickup management marketplace connecting households/small businesses (**Sellers**) with verified independent scrap dealers (**Buyers**), their field staff (**Collectors**), and platform operators (**Administrators**).

### Runtime & Stack Adaptation Note
The master specification expresses a preference for Python/FastAPI/PostgreSQL. Because this runtime container provides Node.js v22, TypeScript (`tsx`), Express, Vite on port 3000, and built-in `node:sqlite` (without a local PostgreSQL daemon or FastAPI runtime installed), the implemented application runs on **Node.js + Express + TypeScript + SQLite (WAL mode with strict foreign keys, CHECK constraints, unique constraints, and migrations)** while preserving full architectural parity, strict REST `/api/v1/*` contracts, RBAC, and transactional integrity. A PostgreSQL/FastAPI deployment migration guide is included in deployment docs.

---

## 2. Phase Checklist

- [x] **Phase 1 — Requirements & Environment Inspection**
  - Inspected container runtime (`Node v22.23.2`, `node:sqlite`, `tsx`, Vite, Express).
  - Generated domain visual assets (`hero_scrap_collection`, `material_paper`, `material_cardboard`, `material_plastic`, `material_metal`).
- [x] **Phase 2 — Database Schema, Migrations & Seed Data**
  - Normalized relational schema (`30+` tables) with FK/CHECK/UNIQUE constraints, soft-deletes, and WAL transactions (`server/db/migrations/001_initial.ts`).
  - Idempotent seed data clearly flagged `is_demo_seed = 1` (`server/db/seed.ts`).
- [x] **Phase 3 — Pure Domain Rules & Unit Tests (`node:test`)**
  - Unit compatibility validation, deterministic buyer eligibility, explainable offer ranking, settlement diff math, fee calculation (`server/domain/rules.ts`, `server/domain/rules.test.ts`).
- [x] **Phase 4 — Backend Services & API Routes (`/api/v1/*`)**
  - Auth (bcrypt, JWT access + rotating refresh tokens, rate limiter, OTP dev adapter, password reset).
  - Private media storage & authorized file streaming (`/api/v1/media/*`).
  - Seller, Buyer, Collector, Admin, Notifications, Public, and AI endpoints.
- [x] **Phase 5 — AI Integration (Strictly No RAG)**
  - Image classification module (PyTorch weights loader interface + Server-side Gemini Vision when `GEMINI_API_KEY` set + honest development adapter).
  - AI listing suggestion & contextual application-owned guidance (`server/services/ai.ts`).
- [x] **Phase 6 — Frontend Design System & Multi-Role Workspace**
  - Public pages (Landing, About, How It Works, Materials, Contact, Login, Register, Forgot Password).
  - Seller, Buyer, Collector, Admin complete interactive dashboards & workflows (`src/pages/*`, `src/components/*`).
- [x] **Phase 7 — Automated & End-to-End Verification**
  - Pure logic unit tests & full-stack API integration test (`npx --yes tsx --test server/domain/rules.test.ts server/tests/api.test.ts` — 7/7 passing).
  - Real browser verification via `playwright-cli` across Desktop (`1440x900`) and Mobile (`390x844`), public pages, and full 4-role E2E transaction lifecycle.

---

## 3. Files Created / Modified
- **Config & Docs**: `metadata.json`, `index.html`, `.env.example`, `package.json`, `src/index.css`, `DEVELOPMENT_PROGRESS.md`, `DEPLOYMENT.md`
- **Backend**: `server.ts`, `server/app.ts`, `server/config.ts`, `server/db/*`, `server/domain/*`, `server/middleware/*`, `server/services/*`, `server/routes/*`, `server/tests/api.test.ts`
- **Frontend**: `src/App.tsx`, `src/types/domain.ts`, `src/lib/api.ts`, `src/context/AuthContext.tsx`, `src/components/ui/Primitives.tsx`, `src/components/layout/*`, `src/pages/public/*`, `src/pages/seller/SellerWorkspace.tsx`, `src/pages/buyer/BuyerWorkspace.tsx`, `src/pages/collector/CollectorWorkspace.tsx`, `src/pages/admin/AdminWorkspace.tsx`

## 4. External Dependencies & Limitations
- **SMS OTP & Email Delivery**: Implemented via clearly labeled `development_adapter` in `server/services/auth.ts` and `server/services/audit.ts`. Production requires wiring Twilio/MSG91/SES credentials.
- **PyTorch Image Classifier**: `server/services/ai.ts` implements `PYTORCH_MODEL_WEIGHTS_PATH` verification; when no `.pt`/`.onnx` weights are mounted, it uses server-side `@google/genai` (`gemini-4-hydrogen`) when `GEMINI_API_KEY` is configured, or an honest low-confidence development fallback. No trained model accuracy is claimed without evaluation.
- **Payment Gateway**: Settlements record separate Buyer and Seller payment acknowledgements (`CASH`, `BANK_TRANSFER`, `UPI_DIRECT`); Scrap Wala does not hold escrow or customer funds.

