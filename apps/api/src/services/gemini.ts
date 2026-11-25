import { ERROR_CODES } from '@designforge/shared';
import { AppError } from '../lib/errors.js';
import { getCredential, markConnection } from './connections.js';

/**
 * Gemini adapter (user-owned API key from aistudio.google.com).
 * Stitch does not generate logos/images, so Logo Studio uses the official
 * Gemini API image model with the user's OWN key. No operator key exists.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL_DEFAULT || 'gemini-2.5-flash-image';
export const DEFAULT_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL_DEFAULT || 'gemini-2.5-flash';

async function call(apiKey: string, pathName: string, body?: unknown, timeoutMs = 120_000) {
  const r = await fetch(`${BASE}${pathName}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json: any = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

function mapError(status: number, json: any): AppError {
  const msg = json?.error?.message ?? `HTTP ${status}`;
  if (status === 400 && /API key not valid/i.test(msg)) return new AppError(401, ERROR_CODES.GEMINI_ERROR, 'Your Gemini API key is invalid. Reconnect it in Integrations.', 'open_integrations');
  if (status === 401 || status === 403) return new AppError(403, ERROR_CODES.GEMINI_ERROR, `Gemini denied access: ${msg}`, 'open_integrations');
  if (status === 429) return new AppError(429, ERROR_CODES.GEMINI_ERROR, 'Your Gemini quota is exhausted (Google limit on your key). Check billing/quota in Google AI Studio.');
  return new AppError(502, ERROR_CODES.GEMINI_ERROR, `Gemini error: ${msg}`);
}

export const gemini = {
  async verifyKey(apiKey: string) {
    const { status, json } = await call(apiKey, '/models?pageSize=1', undefined, 20_000);
    if (status === 200) return { ok: true as const };
    const err = mapError(status, json);
    return { ok: false as const, code: err.code, message: err.message };
  },

  /** Returns PNG/JPEG buffers. Throws mapped errors; marks connection invalid on auth failure. */
  async generateImage(uid: string, prompt: string, model = DEFAULT_IMAGE_MODEL): Promise<{ data: Buffer; mime: string }> {
    const key = await getCredential(uid, 'gemini');
    const { status, json } = await call(key, `/models/${encodeURIComponent(model)}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    });
    if (status !== 200) {
      const err = mapError(status, json);
      if (status === 400 || status === 401 || status === 403) await markConnection(uid, 'gemini', 'invalid', err.message);
      if (status === 429) await markConnection(uid, 'gemini', 'quota_exceeded', err.message);
      throw err;
    }
    const parts: any[] = json?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    if (!img) {
      const reason = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason ?? 'no image returned';
      throw new AppError(422, ERROR_CODES.GEMINI_ERROR, `Gemini did not return an image (${reason}). Try rephrasing the brief.`);
    }
    const inline = img.inlineData ?? img.inline_data;
    return { data: Buffer.from(inline.data, 'base64'), mime: inline.mimeType ?? inline.mime_type ?? 'image/png' };
  },

  /** Optional text helper (used when the user has connected Gemini) — returns plain text. */
  async generateText(uid: string, prompt: string, model = DEFAULT_TEXT_MODEL): Promise<string> {
    const key = await getCredential(uid, 'gemini');
    const { status, json } = await call(key, `/models/${encodeURIComponent(model)}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    }, 60_000);
    if (status !== 200) throw mapError(status, json);
    return (json?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  },
};
