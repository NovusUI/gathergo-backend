import { PaymentProvider } from '@prisma/client';

export type FeeBearer = 'BUYER' | 'CREATOR' | 'PLATFORM';

type ProviderFeeRule = {
  percentageBps: number;
  fixedFeeKobo: number;
  fixedFeeWaiverBelowKobo: number | null;
  capKobo: number | null;
  appliesTo: 'charged_amount';
};

export type PricingSummary = {
  grossAmountKobo: number;
  grossAmountNaira: number;
  chargeAmountKobo: number;
  chargeAmountNaira: number;
  buyerFeeTotalKobo: number;
  buyerFeeTotalNaira: number;
  buyerProviderFeeKobo: number;
  buyerPlatformFeeKobo: number;
  providerFeeKobo: number;
  platformFeeKobo: number;
  creatorBorneProviderFeeKobo: number;
  creatorBornePlatformFeeKobo: number;
  creatorPayableKobo: number;
  creatorPayableNaira: number;
  platformFeeFixedKobo: number;
  platformFeeBps: number;
};

export type CheckoutPricingConfig = {
  currency: 'NGN';
  minorUnit: 'KOBO';
  feeBearers: {
    providerFee: FeeBearer;
    platformFee: FeeBearer;
    settlementFee: FeeBearer;
  };
  buyerTotalMayVaryByProvider: boolean;
  platformFee: {
    percentageBps: number;
    fixedFeeKobo: number;
    capKobo: number | null;
    appliesTo: 'base_amount';
  };
  providers: Record<
    PaymentProvider,
    ProviderFeeRule & {
      available: boolean;
      feeBearer: FeeBearer;
    }
  >;
  settlement: {
    includedInCheckout: false;
    note: string;
  };
};

const DEFAULT_PROVIDER_RULES: Record<PaymentProvider, ProviderFeeRule> = {
  [PaymentProvider.PAYSTACK]: {
    percentageBps: 150,
    fixedFeeKobo: 10000,
    fixedFeeWaiverBelowKobo: 250000,
    capKobo: 200000,
    appliesTo: 'charged_amount',
  },
  [PaymentProvider.ALAT_TRANSFER]: {
    percentageBps: 50,
    fixedFeeKobo: 0,
    fixedFeeWaiverBelowKobo: null,
    capKobo: 150000,
    appliesTo: 'charged_amount',
  },
};

export function getPlatformFeeBps() {
  return Number(process.env.PLATFORM_FEE_BPS || 0);
}

export function getPlatformFixedFeeKobo() {
  return Number(process.env.PLATFORM_FIXED_FEE_KOBO || 12500);
}

export function calculatePlatformFeeKobo(baseAmountKobo: number) {
  if (baseAmountKobo <= 0) {
    return 0;
  }

  const fixedFeeKobo = getPlatformFixedFeeKobo();
  if (fixedFeeKobo > 0) {
    return fixedFeeKobo;
  }

  return Math.round((baseAmountKobo * getPlatformFeeBps()) / 10000);
}

export function getProviderFeeRule(provider: PaymentProvider): ProviderFeeRule {
  const prefix = provider === PaymentProvider.PAYSTACK ? 'PAYSTACK' : 'ALAT';
  const defaults = DEFAULT_PROVIDER_RULES[provider];

  return {
    percentageBps: Number(
      process.env[`${prefix}_PROVIDER_FEE_BPS`] || defaults.percentageBps,
    ),
    fixedFeeKobo: Number(
      process.env[`${prefix}_PROVIDER_FIXED_FEE_KOBO`] || defaults.fixedFeeKobo,
    ),
    fixedFeeWaiverBelowKobo:
      Number(
        process.env[`${prefix}_PROVIDER_FIXED_FEE_WAIVER_BELOW_KOBO`] ||
          defaults.fixedFeeWaiverBelowKobo ||
          0,
      ) || null,
    capKobo: Number(
      process.env[`${prefix}_PROVIDER_FEE_CAP_KOBO`] || defaults.capKobo || 0,
    ) || null,
    appliesTo: 'charged_amount',
  };
}

export function estimateProviderFeeKobo(
  provider: PaymentProvider,
  chargedAmountKobo: number,
) {
  if (chargedAmountKobo <= 0) {
    return 0;
  }

  const rule = getProviderFeeRule(provider);
  const percentageFee = Math.round((chargedAmountKobo * rule.percentageBps) / 10000);
  const fixedFeeKobo =
    rule.fixedFeeWaiverBelowKobo && chargedAmountKobo < rule.fixedFeeWaiverBelowKobo
      ? 0
      : rule.fixedFeeKobo;
  const uncappedFee = percentageFee + fixedFeeKobo;

  if (!rule.capKobo) {
    return uncappedFee;
  }

  return Math.min(uncappedFee, rule.capKobo);
}

function parseFeeBearer(
  value: string | undefined,
  fallback: FeeBearer,
): FeeBearer {
  const normalizedValue = value?.toUpperCase();

  if (
    normalizedValue === 'BUYER' ||
    normalizedValue === 'CREATOR' ||
    normalizedValue === 'PLATFORM'
  ) {
    return normalizedValue;
  }

  return fallback;
}

export function getProviderFeeBearer(provider: PaymentProvider): FeeBearer {
  const providerSpecificValue =
    provider === PaymentProvider.PAYSTACK
      ? process.env.PAYSTACK_PROVIDER_FEE_BEARER
      : process.env.ALAT_PROVIDER_FEE_BEARER;
  const sharedValue =
    provider === PaymentProvider.PAYSTACK
      ? process.env.CHECKOUT_PROVIDER_FEE_BEARER
      : undefined;

  return parseFeeBearer(
    providerSpecificValue || sharedValue,
    'BUYER',
  );
}

export function getPlatformFeeBearer(): FeeBearer {
  return parseFeeBearer(process.env.CHECKOUT_PLATFORM_FEE_BEARER, 'BUYER');
}

export function getSettlementFeeBearer(): FeeBearer {
  return parseFeeBearer(process.env.SETTLEMENT_FEE_BEARER, 'PLATFORM');
}

function resolveEstimatedChargeAmountKobo(input: {
  baseAmountKobo: number;
  buyerPlatformFeeKobo: number;
  provider: PaymentProvider;
  providerFeeBearer: FeeBearer;
}) {
  let chargeAmountKobo = input.baseAmountKobo + input.buyerPlatformFeeKobo;

  if (input.providerFeeBearer !== 'BUYER' || chargeAmountKobo <= 0) {
    return chargeAmountKobo;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const estimatedProviderFeeKobo = estimateProviderFeeKobo(
      input.provider,
      chargeAmountKobo,
    );
    const nextChargeAmountKobo =
      input.baseAmountKobo + input.buyerPlatformFeeKobo + estimatedProviderFeeKobo;

    if (nextChargeAmountKobo === chargeAmountKobo) {
      break;
    }

    chargeAmountKobo = nextChargeAmountKobo;
  }

  return chargeAmountKobo;
}

export function buildPricingSummary(
  baseAmountKobo: number,
  provider: PaymentProvider,
  overrides?: {
    chargeAmountKobo?: number;
    providerFeeKobo?: number;
  },
): PricingSummary {
  const platformFeeBps = getPlatformFeeBps();
  const platformFeeKobo = calculatePlatformFeeKobo(baseAmountKobo);
  const platformFeeFixedKobo = getPlatformFixedFeeKobo();
  const providerFeeBearer = getProviderFeeBearer(provider);
  const platformFeeBearer = getPlatformFeeBearer();

  const buyerPlatformFeeKobo = platformFeeBearer === 'BUYER' ? platformFeeKobo : 0;
  const chargeAmountKobo =
    overrides?.chargeAmountKobo ??
    resolveEstimatedChargeAmountKobo({
      baseAmountKobo,
      buyerPlatformFeeKobo,
      provider,
      providerFeeBearer,
    });

  const providerFeeKobo =
    overrides?.providerFeeKobo ?? estimateProviderFeeKobo(provider, chargeAmountKobo);
  const buyerProviderFeeKobo =
    providerFeeBearer === 'BUYER'
      ? Math.max(chargeAmountKobo - baseAmountKobo - buyerPlatformFeeKobo, 0)
      : 0;
  const creatorBornePlatformFeeKobo = platformFeeBearer === 'CREATOR' ? platformFeeKobo : 0;
  const creatorBorneProviderFeeKobo = providerFeeBearer === 'CREATOR' ? providerFeeKobo : 0;
  const buyerFeeTotalKobo = buyerPlatformFeeKobo + buyerProviderFeeKobo;
  const creatorPayableKobo = Math.max(
    baseAmountKobo - creatorBornePlatformFeeKobo - creatorBorneProviderFeeKobo,
    0,
  );

  return {
    grossAmountKobo: baseAmountKobo,
    grossAmountNaira: baseAmountKobo / 100,
    chargeAmountKobo,
    chargeAmountNaira: chargeAmountKobo / 100,
    buyerFeeTotalKobo,
    buyerFeeTotalNaira: buyerFeeTotalKobo / 100,
    buyerProviderFeeKobo,
    buyerPlatformFeeKobo,
    providerFeeKobo,
    platformFeeKobo,
    creatorBorneProviderFeeKobo,
    creatorBornePlatformFeeKobo,
    creatorPayableKobo,
    creatorPayableNaira: creatorPayableKobo / 100,
    platformFeeFixedKobo,
    platformFeeBps,
  };
}

export function getCheckoutPricingConfig(input?: {
  availableProviders?: PaymentProvider[];
}): CheckoutPricingConfig {
  const availableProviderList = input?.availableProviders?.length
    ? input.availableProviders
    : [PaymentProvider.PAYSTACK, PaymentProvider.ALAT_TRANSFER];
  const availableProviders = new Set(availableProviderList);
  const platformFeeBearer = getPlatformFeeBearer();
  const providerFeeBearers = {
    [PaymentProvider.PAYSTACK]: getProviderFeeBearer(PaymentProvider.PAYSTACK),
    [PaymentProvider.ALAT_TRANSFER]: getProviderFeeBearer(
      PaymentProvider.ALAT_TRANSFER,
    ),
  };
  const summaryProvider = availableProviderList[0] || PaymentProvider.PAYSTACK;

  return {
    currency: 'NGN',
    minorUnit: 'KOBO',
    feeBearers: {
      providerFee: providerFeeBearers[summaryProvider],
      platformFee: platformFeeBearer,
      settlementFee: getSettlementFeeBearer(),
    },
    buyerTotalMayVaryByProvider:
      platformFeeBearer === 'BUYER' ||
      availableProviderList.some(
        (provider) => providerFeeBearers[provider] === 'BUYER',
      ),
    platformFee: {
      percentageBps: 0,
      fixedFeeKobo: getPlatformFixedFeeKobo(),
      capKobo: null,
      appliesTo: 'base_amount',
    },
    providers: {
      [PaymentProvider.PAYSTACK]: {
        ...getProviderFeeRule(PaymentProvider.PAYSTACK),
        available: availableProviders.has(PaymentProvider.PAYSTACK),
        feeBearer: providerFeeBearers[PaymentProvider.PAYSTACK],
      },
      [PaymentProvider.ALAT_TRANSFER]: {
        ...getProviderFeeRule(PaymentProvider.ALAT_TRANSFER),
        available: availableProviders.has(PaymentProvider.ALAT_TRANSFER),
        feeBearer: providerFeeBearers[PaymentProvider.ALAT_TRANSFER],
      },
    },
    settlement: {
      includedInCheckout: false,
      note:
        'Settlement happens after collection and may be batched, so it is not included in buyer checkout estimates.',
    },
  };
}
