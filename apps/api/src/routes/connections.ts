import { Router } from 'express';
import { z } from 'zod';
import { ah, validate } from '../middleware/validate.js';
import { connectLimiter } from '../middleware/rateLimit.js';
import { deleteCredential, getCredential, listConnectionStatus, markConnection, saveCredential } from '../services/connections.js';
import { stitchEngine } from '../services/stitch.js';
import { gemini } from '../services/gemini.js';
import { AppError } from '../lib/errors.js';

/**
 * Provider connections — the user's OWN credentials.
 * Flow: user creates a key in their Google account (Stitch Settings → API Keys, or
 * Google AI Studio), pastes it here over HTTPS, we verify it with a read-only call,
 * encrypt (AES-256-GCM, uid-bound) and store. The raw key is never returned or logged.
 */
export const connectionsRouter = Router();

connectionsRouter.get('/connections', ah(async (req, res) => res.json({ connections: await listConnectionStatus(req.user!.uid) })));

const keySchema = z.object({ apiKey: z.string().trim().min(20).max(200).regex(/^[A-Za-z0-9_\-.]+$/, 'Key contains invalid characters') });

connectionsRouter.post('/connections/:provider', connectLimiter, validate(keySchema), ah(async (req, res) => {
  const provider = req.params.provider;
  if (provider !== 'stitch' && provider !== 'gemini') throw new AppError(404, 'NOT_FOUND', 'Unknown provider');
  const result = provider === 'stitch' ? await stitchEngine.verifyKey(req.body.apiKey) : await gemini.verifyKey(req.body.apiKey);
  if (!result.ok) throw new AppError(400, result.code, result.message);
  await saveCredential(req.user!.uid, provider, req.body.apiKey);
  res.json({ ok: true, connections: await listConnectionStatus(req.user!.uid) });
}));

connectionsRouter.post('/connections/:provider/verify', connectLimiter, ah(async (req, res) => {
  const provider = req.params.provider as 'stitch' | 'gemini';
  if (provider !== 'stitch' && provider !== 'gemini') throw new AppError(404, 'NOT_FOUND', 'Unknown provider');
  const key = await getCredential(req.user!.uid, provider);
  const result = provider === 'stitch' ? await stitchEngine.verifyKey(key) : await gemini.verifyKey(key);
  await markConnection(req.user!.uid, provider, result.ok ? 'active' : 'invalid', result.ok ? undefined : result.message);
  res.json({ ok: result.ok, connections: await listConnectionStatus(req.user!.uid) });
}));

/** Disconnect = delete our encrypted copy. Users should also revoke the key at the provider (link shown in UI). */
connectionsRouter.delete('/connections/:provider', ah(async (req, res) => {
  const provider = req.params.provider as 'stitch' | 'gemini';
  if (provider !== 'stitch' && provider !== 'gemini') throw new AppError(404, 'NOT_FOUND', 'Unknown provider');
  await deleteCredential(req.user!.uid, provider);
  res.json({ ok: true, revokeUrl: provider === 'stitch' ? 'https://stitch.withgoogle.com/settings' : 'https://aistudio.google.com/app/apikey', connections: await listConnectionStatus(req.user!.uid) });
}));
