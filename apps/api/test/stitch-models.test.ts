import { describe, expect, it, vi } from 'vitest';
import { StitchError } from '@google/stitch-sdk';
import { normalizeStitchModel, STITCH_MODELS } from '@designforge/shared';

vi.mock('../src/services/connections.js', () => ({ markConnection: vi.fn(async () => undefined), getCredential: vi.fn() }));
const { mapStitchError } = await import('../src/services/stitch.js');

describe('Stitch model IDs (SDK 0.4)', () => {
  it('maps retired 0.3.x IDs to a model the Stitch API still accepts', () => {
    for (const legacy of ['GEMINI_3_FLASH', 'GEMINI_3_PRO', 'GEMINI_3_1_PRO', undefined, '', 'garbage']) {
      expect(normalizeStitchModel(legacy)).toBe('GEMINI_3_8_FLASH');
    }
    expect(normalizeStitchModel('GEMINI_3_5_FLASH_LITE')).toBe('GEMINI_3_5_FLASH_LITE');
  });
  it('only offers current models in the UI list', () => {
    expect(STITCH_MODELS.map((m) => m.id)).toEqual(['GEMINI_3_8_FLASH', 'GEMINI_3_5_FLASH_LITE']);
  });
});

describe('mapStitchError', () => {
  it('turns a clarification question into an actionable 422', async () => {
    const e = new StitchError({ code: 'CLARIFICATION_REQUIRED', message: 'q', recoverable: true, clarification: { question: 'Which colour scheme?', suggestions: ['Dark', 'Light'] } });
    const r = await mapStitchError(undefined, e);
    expect(r.status).toBe(422);
    expect(r.code).toBe('STITCH_CLARIFICATION');
    expect(r.message).toContain('Which colour scheme?');
  });
  it('maps SERVICE_UNAVAILABLE to a retryable 502', async () => {
    const r = await mapStitchError(undefined, new StitchError({ code: 'SERVICE_UNAVAILABLE', message: 'x', recoverable: true }));
    expect(r.status).toBe(502);
  });
});
