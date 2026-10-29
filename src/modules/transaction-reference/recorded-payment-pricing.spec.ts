import { BadRequestException } from '@nestjs/common';
import {
  resolveChargedAmountKobo,
  resolveGrossAmountKobo,
  resolveCreatorPayableKobo,
  resolvePlatformFeeKobo,
} from './payment-pricing.util';

describe('Recorded payment pricing across risk and settlements', () => {
  const payment = {
    amount: 525000,
    creatorPayable: 0,
    platformFee: 12500,
    providerFee: 12500,
    metadata: {
      amountUnit: 'KOBO',
      pricing: {
        chargeAmountKobo: 525000,
        grossAmountKobo: 500000,
        creatorPayableKobo: 500000,
        platformFeeKobo: 12500,
      },
    },
  };
  it('separates buyer checkout charges, gross and net without deducting buyer fees twice', () => {
    expect(resolveChargedAmountKobo(payment)).toBe(525000);
    expect(resolveGrossAmountKobo(payment)).toBe(500000);
    expect(resolveCreatorPayableKobo(payment)).toBe(500000);
  });
  it('preserves recorded zero payable and zero fees instead of recalculating them', () => {
    const zero = {
      ...payment,
      creatorPayable: 9999,
      platformFee: 9999,
      metadata: {
        amountUnit: 'KOBO',
        pricing: {
          grossAmountKobo: 500000,
          creatorPayableKobo: 0,
          platformFeeKobo: 0,
        },
      },
    };
    expect(resolveCreatorPayableKobo(zero)).toBe(0);
    expect(resolvePlatformFeeKobo(zero)).toBe(0);
  });
  it('converts existing legacy naira amounts once and retains recorded creator deductions', () => {
    const legacy = {
      amount: 1000,
      creatorPayable: 85000,
      platformFee: 10000,
      providerFee: 5000,
      metadata: {},
    };
    expect(resolveChargedAmountKobo(legacy)).toBe(100000);
    expect(resolveGrossAmountKobo(legacy)).toBe(100000);
    expect(resolveCreatorPayableKobo(legacy)).toBe(85000);
    expect(
      resolveGrossAmountKobo({
        ...legacy,
        amount: 100000,
        metadata: { amountUnit: 'KOBO' },
      }),
    ).toBe(100000);
  });
  it('rejects invalid recorded monetary values instead of silently changing the payment', () => {
    expect(() =>
      resolveCreatorPayableKobo({
        ...payment,
        metadata: { pricing: { creatorPayableKobo: -1 } },
      }),
    ).toThrow(BadRequestException);
  });
});
