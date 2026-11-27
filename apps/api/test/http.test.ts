import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';

let app: any;
beforeAll(async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'wh_secret';
  process.env.CORS_ORIGINS = 'https://app.designforge.test';
  process.env.STITCH_API_KEY = 'operator-key-should-be-stripped';
  const cfg = await import('../src/config.js');
  cfg.stripAmbientProviderCredentials();
  app = (await import('../src/app.js')).createApp();
}, 30000);

describe('HTTP security', () => {
  it('health is public', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
  });
  it('strips any operator Stitch key from the environment at boot', () => {
    expect(process.env.STITCH_API_KEY).toBeUndefined();
  });
  it.each(['/api/me', '/api/projects', '/api/connections', '/api/admin/stats', '/api/billing/summary'])('%s requires auth', async (path) => {
    const r = await request(app).get(path);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });
  it('rejects webhooks with invalid signatures', async () => {
    const r = await request(app).post('/api/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', 'bad').send(JSON.stringify({ event: 'payment.captured' }));
    expect(r.status).toBe(400);
  });
  it('blocks disallowed CORS origins', async () => {
    const r = await request(app).get('/health').set('origin', 'https://evil.example');
    expect(r.status).toBe(500);
    const ok = await request(app).get('/health').set('origin', 'https://app.designforge.test');
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.designforge.test');
  });
  it('sets security headers', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
