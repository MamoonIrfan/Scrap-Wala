import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePlatformFee,
  calculateSettlementTotals,
  computeItemAmount,
  evaluateBuyerEligibility,
  rankOffers,
  validateUnitCompatibility,
} from './rules';

test('unit compatibility allows mass conversions and blocks cross-dimension comparisons', () => {
  const kg = { id: 1, code: 'kg', dimension: 'MASS' as const, baseFactor: 1 };
  const g = { id: 2, code: 'g', dimension: 'MASS' as const, baseFactor: 0.001 };
  const piece = { id: 3, code: 'piece', dimension: 'COUNT' as const, baseFactor: 1 };

  const same = validateUnitCompatibility(kg, kg);
  assert.equal(same.compatible, true);
  assert.equal(same.conversionFactor, 1);

  const massConv = validateUnitCompatibility(kg, g);
  assert.equal(massConv.compatible, true);
  assert.equal(massConv.conversionFactor, 1000);

  const crossDim = validateUnitCompatibility(kg, piece);
  assert.equal(crossDim.compatible, false);
  assert.match(crossDim.reason || '', /Incompatible units/);
});

test('computeItemAmount handles unknown quantities cleanly without inventing values', () => {
  assert.equal(computeItemAmount(null, true, 15), 0);
  assert.equal(computeItemAmount(12.5, false, 14), 175);
});

test('evaluateBuyerEligibility enforces verification, area, material, and capacity rules', () => {
  const baseBuyer = {
    accountStatus: 'ACTIVE',
    verificationStatus: 'VERIFIED',
    isAvailable: true,
    serviceAreaIds: [1, 2],
    supportedMaterialIds: [1, 2, 3],
    maxWeightKg: 500,
    maxDailyPickups: 5,
    activeBookingsCount: 2,
  };
  const listing = { serviceAreaId: 1, materialIds: [2, 4], totalKnownMassKg: 40 };

  const eligibleRes = evaluateBuyerEligibility(baseBuyer, listing);
  assert.equal(eligibleRes.eligible, true);
  assert.equal(eligibleRes.reasons.length, 0);

  const unverifiedRes = evaluateBuyerEligibility(
    { ...baseBuyer, verificationStatus: 'PENDING' },
    listing
  );
  assert.equal(unverifiedRes.eligible, false);
  assert.ok(unverifiedRes.reasons.some((r) => r.includes('VERIFIED')));

  const wrongAreaRes = evaluateBuyerEligibility(
    { ...baseBuyer, serviceAreaIds: [99] },
    listing
  );
  assert.equal(wrongAreaRes.eligible, false);

  const overCapRes = evaluateBuyerEligibility(
    { ...baseBuyer, maxWeightKg: 20 },
    listing
  );
  assert.equal(overCapRes.eligible, false);
});

test('rankOffers prioritizes full-basket coverage and avoids comparing partial baskets as identical', () => {
  const ranked = rankOffers(
    [
      {
        id: 2,
        referenceCode: 'OFR-PARTIAL',
        buyerUserId: 20,
        buyerBusinessName: 'Partial Buyer',
        estimatedTotalValue: 600,
        coveredItemsCount: 1,
        totalItemsCount: 3,
        proposedPickupDate: '2026-11-18',
        proposedPickupWindow: '09:00-12:00',
        completedTransactionsCount: 1,
        averageRating: 0,
      },
      {
        id: 1,
        referenceCode: 'OFR-FULL',
        buyerUserId: 10,
        buyerBusinessName: 'Full Basket Buyer',
        estimatedTotalValue: 500,
        coveredItemsCount: 3,
        totalItemsCount: 3,
        proposedPickupDate: '2026-11-18',
        proposedPickupWindow: '09:00-12:00',
        completedTransactionsCount: 5,
        averageRating: 4.8,
      },
    ],
    '2026-11-17T00:00:00Z'
  );

  assert.equal(ranked[0].id, 1);
  assert.equal(ranked[0].isFullCoverage, true);
  assert.equal(ranked[1].isFullCoverage, false);
  assert.match(ranked[1].comparisonNote, /Partial basket/);
  assert.match(ranked[1].reliabilityBasis, /Neutral baseline/);
});

test('calculateSettlementTotals computes itemized revision delta accurately', () => {
  const res = calculateSettlementTotals([
    { listingItemId: 1, actualQuantity: 20, acceptedRate: 10, proposedRate: 10 },
    { listingItemId: 2, actualQuantity: 5, acceptedRate: 20, proposedRate: 16 },
  ]);
  assert.equal(res.originalTotal, 300);
  assert.equal(res.revisedTotal, 280);
  assert.equal(res.netDelta, -20);
  assert.equal(res.hasRateChange, true);
});

test('calculatePlatformFee only charges completed transactions and enforces bounds', () => {
  const rule = {
    id: 1,
    feeType: 'PERCENTAGE' as const,
    rateValue: 2.5,
    minFee: 10,
    maxFee: 200,
    appliesToStatus: 'COMPLETED' as const,
  };

  assert.equal(calculatePlatformFee(1000, 'CONFIRMED', rule), 0);
  assert.equal(calculatePlatformFee(100, 'COMPLETED', rule), 10); // minFee applied
  assert.equal(calculatePlatformFee(1000, 'COMPLETED', rule), 25);
  assert.equal(calculatePlatformFee(20000, 'COMPLETED', rule), 200); // maxFee applied
});
