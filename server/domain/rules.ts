export interface UnitDef {
  id: number;
  code: string;
  dimension: 'MASS' | 'COUNT' | 'BUNDLE';
  baseFactor: number;
}

export interface ListingContext {
  serviceAreaId: number;
  materialIds: number[];
  totalKnownMassKg: number;
}

export interface BuyerEligibilityInput {
  accountStatus: string;
  verificationStatus: string;
  isAvailable: boolean;
  serviceAreaIds: number[];
  supportedMaterialIds: number[];
  maxWeightKg: number;
  maxDailyPickups: number;
  activeBookingsCount: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: string[];
}

export interface OfferForRanking {
  id: number;
  referenceCode: string;
  buyerUserId: number;
  buyerBusinessName: string;
  estimatedTotalValue: number;
  coveredItemsCount: number;
  totalItemsCount: number;
  proposedPickupDate: string;
  proposedPickupWindow: string;
  completedTransactionsCount: number;
  averageRating: number;
}

export interface RankedOffer extends OfferForRanking {
  rank: number;
  isFullCoverage: boolean;
  coverageRatio: number;
  compositeScore: number;
  reliabilityBasis: string;
  comparisonNote: string;
  breakdown: {
    coverageScore: number;
    payoutScore: number;
    timingScore: number;
    reliabilityScore: number;
  };
}

export interface FeeRuleInput {
  id: number;
  feeType: 'PERCENTAGE' | 'FLAT';
  rateValue: number;
  minFee: number;
  maxFee: number | null;
  appliesToStatus: 'COMPLETED';
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function validateUnitCompatibility(listingUnit: UnitDef, offerUnit: UnitDef): {
  compatible: boolean;
  conversionFactor: number;
  reason?: string;
} {
  if (listingUnit.id === offerUnit.id) {
    return { compatible: true, conversionFactor: 1 };
  }
  if (listingUnit.dimension === 'MASS' && offerUnit.dimension === 'MASS') {
    return {
      compatible: true,
      conversionFactor: listingUnit.baseFactor / offerUnit.baseFactor,
    };
  }
  return {
    compatible: false,
    conversionFactor: 0,
    reason: `Incompatible units: listing uses ${listingUnit.code} (${listingUnit.dimension}) while offer uses ${offerUnit.code} (${offerUnit.dimension}).`,
  };
}

export function computeItemAmount(
  quantity: number | null,
  quantityUnknown: boolean,
  unitRate: number,
  conversionFactor = 1
): number {
  if (unitRate < 0 || !Number.isFinite(unitRate)) {
    throw new Error('Unit rate must be a non-negative finite number.');
  }
  if (quantityUnknown || quantity === null) {
    return 0;
  }
  if (quantity < 0 || !Number.isFinite(quantity)) {
    throw new Error('Quantity must be a non-negative finite number.');
  }
  return roundCurrency(quantity * conversionFactor * unitRate);
}

export function evaluateBuyerEligibility(
  buyer: BuyerEligibilityInput,
  listing: ListingContext
): EligibilityResult {
  const reasons: string[] = [];

  if (buyer.accountStatus !== 'ACTIVE') {
    reasons.push(`Buyer account status is ${buyer.accountStatus}.`);
  }
  if (buyer.verificationStatus !== 'VERIFIED') {
    reasons.push(`Buyer verification status is ${buyer.verificationStatus}; only VERIFIED buyers are eligible.`);
  }
  if (!buyer.isAvailable) {
    reasons.push('Buyer has marked availability as paused.');
  }
  if (!buyer.serviceAreaIds.includes(listing.serviceAreaId)) {
    reasons.push('Listing falls outside buyer configured service areas.');
  }
  const hasMaterialOverlap = listing.materialIds.some((id) =>
    buyer.supportedMaterialIds.includes(id)
  );
  if (!hasMaterialOverlap) {
    reasons.push('Buyer does not support any material categories in this listing.');
  }
  if (buyer.activeBookingsCount >= buyer.maxDailyPickups) {
    reasons.push('Buyer has reached maximum daily pickup capacity.');
  }
  if (listing.totalKnownMassKg > 0 && buyer.maxWeightKg < listing.totalKnownMassKg) {
    reasons.push(
      `Estimated mass (${listing.totalKnownMassKg} kg) exceeds buyer configured max weight capacity (${buyer.maxWeightKg} kg).`
    );
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export function rankOffers(offers: OfferForRanking[], referenceDateIso?: string): RankedOffer[] {
  if (offers.length === 0) return [];

  const maxTotal = Math.max(...offers.map((o) => o.estimatedTotalValue), 1);
  const baseTimestamp = referenceDateIso ? Date.parse(referenceDateIso) : Date.now();

  const scored = offers.map((offer) => {
    const coverageRatio =
      offer.totalItemsCount > 0 ? offer.coveredItemsCount / offer.totalItemsCount : 0;
    const isFullCoverage =
      offer.totalItemsCount > 0 && offer.coveredItemsCount === offer.totalItemsCount;

    // 1. Coverage score (40% weight): full basket coverage strongly rewarded so incomplete baskets never look equal
    const coverageScore = roundCurrency(coverageRatio * 40);

    // 2. Comparable payout score (35% weight): scaled by max offer AND penalized if partial basket
    const rawPayoutRatio = offer.estimatedTotalValue / maxTotal;
    const payoutScore = roundCurrency(rawPayoutRatio * 35 * (0.5 + 0.5 * coverageRatio));

    // 3. Pickup timing score (15% weight): sooner pickup dates score higher
    const slotTs = Date.parse(`${offer.proposedPickupDate}T09:00:00Z`);
    const daysOut = Number.isFinite(slotTs)
      ? Math.max(0, (slotTs - baseTimestamp) / (1000 * 60 * 60 * 24))
      : 7;
    const timingFactor = Math.max(0, 1 - Math.min(daysOut, 14) / 14);
    const timingScore = roundCurrency(timingFactor * 15);

    // 4. Verified reliability score (10% weight): requires >= 3 completed transactions for historical score, else neutral 0.6 baseline
    const hasSufficientHistory = offer.completedTransactionsCount >= 3 && offer.averageRating > 0;
    const reliabilityFactor = hasSufficientHistory
      ? Math.min(1, Math.max(0, offer.averageRating / 5))
      : 0.6;
    const reliabilityScore = roundCurrency(reliabilityFactor * 10);
    const reliabilityBasis = hasSufficientHistory
      ? `${offer.averageRating.toFixed(1)}/5 across ${offer.completedTransactionsCount} completed pickups`
      : 'Neutral baseline (fewer than 3 completed transactions)';

    const compositeScore = roundCurrency(
      coverageScore + payoutScore + timingScore + reliabilityScore
    );

    const comparisonNote = isFullCoverage
      ? `Covers all ${offer.totalItemsCount} listed items`
      : `Partial basket: covers ${offer.coveredItemsCount} of ${offer.totalItemsCount} items (not directly comparable to full-basket offers)`;

    return {
      ...offer,
      rank: 0,
      isFullCoverage,
      coverageRatio: roundCurrency(coverageRatio),
      compositeScore,
      reliabilityBasis,
      comparisonNote,
      breakdown: {
        coverageScore,
        payoutScore,
        timingScore,
        reliabilityScore,
      },
    };
  });

  scored.sort((a, b) => {
    if (b.isFullCoverage !== a.isFullCoverage) {
      return a.isFullCoverage ? -1 : 1;
    }
    if (b.compositeScore !== a.compositeScore) {
      return b.compositeScore - a.compositeScore;
    }
    return b.estimatedTotalValue - a.estimatedTotalValue;
  });

  return scored.map((item, idx) => ({
    ...item,
    rank: idx + 1,
  }));
}

export function calculateSettlementTotals(
  items: Array<{
    listingItemId: number;
    actualQuantity: number;
    acceptedRate: number;
    proposedRate?: number;
  }>
): {
  originalTotal: number;
  revisedTotal: number;
  netDelta: number;
  hasRateChange: boolean;
} {
  let originalTotal = 0;
  let revisedTotal = 0;
  let hasRateChange = false;

  for (const item of items) {
    const qty = Math.max(0, item.actualQuantity);
    const origLine = roundCurrency(qty * item.acceptedRate);
    const effectiveRate = item.proposedRate !== undefined ? item.proposedRate : item.acceptedRate;
    const revLine = roundCurrency(qty * effectiveRate);
    if (Math.abs(effectiveRate - item.acceptedRate) > 0.0001) {
      hasRateChange = true;
    }
    originalTotal += origLine;
    revisedTotal += revLine;
  }

  originalTotal = roundCurrency(originalTotal);
  revisedTotal = roundCurrency(revisedTotal);

  return {
    originalTotal,
    revisedTotal,
    netDelta: roundCurrency(revisedTotal - originalTotal),
    hasRateChange,
  };
}

export function calculatePlatformFee(
  grossAmount: number,
  bookingStatus: string,
  rule: FeeRuleInput | null
): number {
  if (!rule || bookingStatus !== rule.appliesToStatus || grossAmount <= 0) {
    return 0;
  }
  let raw =
    rule.feeType === 'PERCENTAGE'
      ? (grossAmount * rule.rateValue) / 100
      : rule.rateValue;
  if (raw < rule.minFee) {
    raw = rule.minFee;
  }
  if (rule.maxFee !== null && raw > rule.maxFee) {
    raw = rule.maxFee;
  }
  return roundCurrency(raw);
}
