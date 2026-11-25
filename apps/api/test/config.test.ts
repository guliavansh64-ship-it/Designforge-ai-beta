import { describe, expect, it } from 'vitest';
import { checkProductionConfig } from '../src/config.js';

const base = { NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT_BASE64: 'x', ENCRYPTION_KEY: 'y' };

describe('checkProductionConfig', () => {
  it('ignores non-production', () => expect(checkProductionConfig({ NODE_ENV: 'development' })).toEqual([]));
  it('requires firebase + encryption key', () =>
    expect(checkProductionConfig({ NODE_ENV: 'production' })).toEqual(['FIREBASE_SERVICE_ACCOUNT_BASE64', 'ENCRYPTION_KEY']));
  it('allows running with payments fully disabled', () => expect(checkProductionConfig(base)).toEqual([]));
  it('rejects a partial Razorpay config', () =>
    expect(checkProductionConfig({ ...base, RAZORPAY_KEY_ID: 'rzp_test_1' })).toEqual(['RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']));
  it('accepts a full Razorpay config', () =>
    expect(checkProductionConfig({ ...base, RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b', RAZORPAY_WEBHOOK_SECRET: 'c' })).toEqual([]));
});
