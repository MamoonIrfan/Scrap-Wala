import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { resetDbForTests, runMigrations } from '../db/database';
import { seedDatabase } from '../db/seed';
import { createApiApp } from '../app';

function createTestServer() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  resetDbForTests(db);
  runMigrations(db);
  seedDatabase(db);
  const app = createApiApp();
  const server = http.createServer(app);
  return new Promise<{ server: http.Server; baseUrl: string; db: DatabaseSync }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, db });
    });
  });
}

async function api(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

test('End-to-end Scrap Wala lifecycle, RBAC isolation, privacy redaction, settlement revision, and fee ledger', async () => {
  const { server, baseUrl } = await createTestServer();

  try {
    // 1. Admin login & verification check
    const adminLogin = await api(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@scrapwala.demo', password: 'Admin@1234' },
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = String(adminLogin.json.accessToken);

    // 2. Register a new Seller
    const sellerReg = await api(baseUrl, '/api/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'newseller@example.com',
        password: 'Password123!',
        fullName: 'Neha Kapoor',
        phone: '+919911223344',
        role: 'SELLER',
      },
    });
    assert.equal(sellerReg.status, 201);
    const sellerToken = String(sellerReg.json.accessToken);

    // 3. Enforce role isolation: Seller cannot access Admin or Buyer routes
    const forbiddenAdmin = await api(baseUrl, '/api/v1/admin/analytics', { token: sellerToken });
    assert.equal(forbiddenAdmin.status, 403);
    const forbiddenBuyer = await api(baseUrl, '/api/v1/buyer/marketplace', { token: sellerToken });
    assert.equal(forbiddenBuyer.status, 403);

    // 4. Seller verifies phone OTP via development adapter
    const otpReq = await api(baseUrl, '/api/v1/auth/phone-otp/request', {
      method: 'POST',
      token: sellerToken,
      body: { phone: '+919911223344' },
    });
    assert.equal(otpReq.status, 200);
    assert.equal(otpReq.json.delivered, false);
    const devCode = String(otpReq.json.devVerificationCode);
    assert.equal(devCode.length, 6);

    const otpVer = await api(baseUrl, '/api/v1/auth/phone-otp/verify', {
      method: 'POST',
      token: sellerToken,
      body: { phone: '+919911223344', code: devCode },
    });
    assert.equal(otpVer.status, 200);
    assert.equal(otpVer.json.verified, true);

    // 5. Seller creates pickup address in South Delhi (id = 1)
    const taxRes = await api(baseUrl, '/api/v1/public/taxonomy');
    const areas = taxRes.json.serviceAreas as Array<{ id: number; name: string }>;
    const materials = taxRes.json.materials as Array<{ id: number; slug: string }>;
    const units = taxRes.json.units as Array<{ id: number; code: string }>;

    const southDelhi = areas.find((a) => a.name === 'South Delhi')!;
    const paperMat = materials.find((m) => m.slug === 'paper')!;
    const kgUnit = units.find((u) => u.code === 'kg')!;

    const addrRes = await api(baseUrl, '/api/v1/seller/addresses', {
      method: 'POST',
      token: sellerToken,
      body: {
        serviceAreaId: southDelhi.id,
        label: 'Apartment',
        streetLine: '99 Secret Street, Apartment 4B',
        postalCode: '110016',
        isDefault: true,
      },
    });
    assert.equal(addrRes.status, 201);
    const addressId = Number(addrRes.json.id);

    // 6. Seller creates and publishes listing
    const listRes = await api(baseUrl, '/api/v1/seller/listings', {
      method: 'POST',
      token: sellerToken,
      body: {
        addressId,
        title: 'Clean Office Paper Batch',
        description: 'Dry office stacks tied in bundles',
        preferredPickupDate: '2026-11-22',
        preferredPickupWindow: '09:00-12:00',
        status: 'PUBLISHED',
        items: [
          {
            materialId: paperMat.id,
            unitId: kgUnit.id,
            estimatedQuantity: 25,
            quantityUnknown: false,
          },
        ],
      },
    });
    assert.equal(listRes.status, 201);
    const listingId = Number(listRes.json.id);

    // 7. Verified Buyer views marketplace: exact street address MUST NOT be revealed yet!
    const buyerLogin = await api(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'buyer1@scrapwala.demo', password: 'Buyer@1234' },
    });
    assert.equal(buyerLogin.status, 200);
    const buyerToken = String(buyerLogin.json.accessToken);

    const marketRes = await api(baseUrl, '/api/v1/buyer/marketplace', { token: buyerToken });
    assert.equal(marketRes.status, 200);
    const matchedListing = (marketRes.json.listings as Array<Record<string, unknown>>).find(
      (l) => Number(l.id) === listingId
    )!;
    assert.ok(matchedListing);
    assert.equal(matchedListing.street_line, undefined);
    assert.equal(JSON.stringify(matchedListing).includes('99 Secret Street'), false);

    // 8. Unverified Buyer (buyer3) cannot submit offer (403)
    const buyer3Login = await api(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'buyer3@scrapwala.demo', password: 'Buyer@1234' },
    });
    const buyer3Token = String(buyer3Login.json.accessToken);
    const listingItems = matchedListing.items as Array<{ id: number }>;
    const unverifiedOffer = await api(baseUrl, '/api/v1/buyer/offers', {
      method: 'POST',
      token: buyer3Token,
      body: {
        listingId,
        proposedPickupDate: '2026-11-22',
        proposedPickupWindow: '09:00-12:00',
        items: [{ listingItemId: listingItems[0].id, isCovered: true, unitRate: 15, unitId: kgUnit.id }],
      },
    });
    assert.equal(unverifiedOffer.status, 403);

    // 9. Verified Buyer submits offer
    const offerRes = await api(baseUrl, '/api/v1/buyer/offers', {
      method: 'POST',
      token: buyerToken,
      body: {
        listingId,
        proposedPickupDate: '2026-11-22',
        proposedPickupWindow: '09:00-12:00',
        conditionsText: 'Digital weighing at gate',
        items: [{ listingItemId: listingItems[0].id, isCovered: true, unitRate: 16, unitId: kgUnit.id }],
      },
    });
    assert.equal(offerRes.status, 201);
    assert.equal(offerRes.json.estimatedTotalValue, 400);
    const offerId = Number(offerRes.json.id);

    // 10. Seller accepts offer with idempotency key; duplicate retry returns deduplicated booking
    const accept1 = await api(baseUrl, `/api/v1/seller/offers/${offerId}/accept`, {
      method: 'POST',
      token: sellerToken,
      body: { idempotencyKey: 'e2e-accept-key-1' },
    });
    assert.equal(accept1.status, 201);
    const bookingId = Number((accept1.json.booking as { id: number }).id);

    const acceptRetry = await api(baseUrl, `/api/v1/seller/offers/${offerId}/accept`, {
      method: 'POST',
      token: sellerToken,
      body: { idempotencyKey: 'e2e-accept-key-1' },
    });
    assert.equal(acceptRetry.status, 200);
    assert.equal(acceptRetry.json.deduplicated, true);

    // 11. Now Buyer sees exact address on accepted booking
    const buyerBookings = await api(baseUrl, '/api/v1/buyer/bookings', { token: buyerToken });
    const myBooking = (buyerBookings.json.bookings as Array<Record<string, unknown>>).find(
      (b) => Number(b.id) === bookingId
    )!;
    assert.equal(myBooking.street_line, '99 Secret Street, Apartment 4B');

    // 12. Collector logs in, marks arrival, weighs actual 30 kg, proposes rate revision 16 -> 15 due to moisture
    const colLogin = await api(baseUrl, '/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'collector1@scrapwala.demo', password: 'Collector@1234' },
    });
    const colToken = String(colLogin.json.accessToken);

    const arrivedRes = await api(baseUrl, `/api/v1/collector/jobs/${bookingId}/status`, {
      method: 'POST',
      token: colToken,
      body: { action: 'ARRIVED' },
    });
    assert.equal(arrivedRes.status, 200);

    const weighRes = await api(baseUrl, `/api/v1/collector/jobs/${bookingId}/record-weights`, {
      method: 'POST',
      token: colToken,
      body: {
        inspectionNotes: 'Slightly damp edges on lower stack',
        revisionReason: 'Moisture adjustment from 16 to 15 per kg',
        items: [
          {
            listingItemId: listingItems[0].id,
            actualQuantity: 30,
            proposedRate: 15,
            materialGrade: 'MIXED_OFFICE',
          },
        ],
      },
    });
    assert.equal(weighRes.status, 201);
    assert.equal(weighRes.json.needsSellerApproval, true);
    assert.equal(weighRes.json.originalTotal, 480);
    assert.equal(weighRes.json.revisedTotal, 450);
    const revisionId = Number(weighRes.json.revisionId);

    // 13. Payment cannot be recorded while revision is pending seller approval
    const blockedPay = await api(baseUrl, `/api/v1/collector/jobs/${bookingId}/acknowledge-payment`, {
      method: 'POST',
      token: colToken,
      body: { paymentMethod: 'CASH' },
    });
    assert.equal(blockedPay.status, 409);

    // 14. Seller approves revision -> Collector records cash payment & handover -> Seller acks payment & handover -> Receipt & Fee!
    const approveRev = await api(
      baseUrl,
      `/api/v1/seller/settlement-revisions/${revisionId}/decide`,
      {
        method: 'POST',
        token: sellerToken,
        body: { decision: 'APPROVED', notes: 'Agreed after inspection' },
      }
    );
    assert.equal(approveRev.status, 200);

    const colPay = await api(baseUrl, `/api/v1/collector/jobs/${bookingId}/acknowledge-payment`, {
      method: 'POST',
      token: colToken,
      body: { paymentMethod: 'CASH', notes: 'Paid cash at doorstep' },
    });
    assert.equal(colPay.status, 200);
    assert.equal(colPay.json.amount, 450);

    const colHandover = await api(baseUrl, `/api/v1/collector/jobs/${bookingId}/acknowledge-handover`, {
      method: 'POST',
      token: colToken,
      body: { notes: 'Loaded onto EV pickup' },
    });
    assert.equal(colHandover.status, 200);
    assert.equal(colHandover.json.completed, false); // Seller hasn't acked payment & handover yet

    const sellerPay = await api(baseUrl, `/api/v1/seller/bookings/${bookingId}/acknowledge-payment`, {
      method: 'POST',
      token: sellerToken,
      body: { disputed: false },
    });
    assert.equal(sellerPay.status, 200);

    const sellerHandover = await api(
      baseUrl,
      `/api/v1/seller/bookings/${bookingId}/acknowledge-handover`,
      {
        method: 'POST',
        token: sellerToken,
        body: {},
      }
    );
    assert.equal(sellerHandover.status, 200);
    assert.equal(sellerHandover.json.completed, true);
    assert.ok(sellerHandover.json.receiptNumber);
    assert.equal(sellerHandover.json.feeAssessed, 11.25); // 2.5% of 450

    // 15. Verify Admin sees updated ledger and audit logs
    const feeRes = await api(baseUrl, '/api/v1/admin/fees', { token: adminToken });
    assert.equal(feeRes.status, 200);
    const matchingFee = (feeRes.json.ledger as Array<Record<string, unknown>>).find(
      (f) => Number(f.booking_id) === bookingId
    );
    assert.ok(matchingFee);
    assert.equal(Number(matchingFee.fee_amount), 11.25);
  } finally {
    server.close();
  }
});
