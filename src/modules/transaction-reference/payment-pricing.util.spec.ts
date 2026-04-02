import { PaymentProvider } from '@prisma/client';
import {
  estimateProviderFeeKobo,
  getCheckoutPricingConfig,
} from './payment-pricing.util';

describe('payment-pricing util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.ALAT_PROVIDER_FEE_BEARER;
    delete process.env.PAYSTACK_PROVIDER_FEE_BEARER;
    delete process.env.CHECKOUT_PROVIDER_FEE_BEARER;
    delete process.env.CHECKOUT_PLATFORM_FEE_BEARER;
    delete process.env.PLATFORM_FIXED_FEE_KOBO;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the ALAT 5 percent fee with no fixed fee and a 1500 naira cap', () => {
    expect(
      estimateProviderFeeKobo(PaymentProvider.ALAT_TRANSFER, 100000),
    ).toBe(5000);
    expect(
      estimateProviderFeeKobo(PaymentProvider.ALAT_TRANSFER, 5000000),
    ).toBe(150000);
  });

  it('exposes the ALAT fee bearer in checkout pricing config', () => {
    const pricingConfig = getCheckoutPricingConfig({
      availableProviders: [PaymentProvider.ALAT_TRANSFER],
    });

    expect(pricingConfig.providers.ALAT_TRANSFER.fixedFeeKobo).toBe(0);
    expect(pricingConfig.providers.ALAT_TRANSFER.percentageBps).toBe(500);
    expect(pricingConfig.providers.ALAT_TRANSFER.capKobo).toBe(150000);
  });
});
