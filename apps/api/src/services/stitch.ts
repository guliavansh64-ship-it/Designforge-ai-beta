import { Stitch, StitchToolClient, StitchError } from '@google/stitch-sdk';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DeviceType, StitchModel } from '@designforge/shared';
import { ERROR_CODES } from '@designforge/shared';
import { AppError } from '../lib/errors.js';
import { getCredential, markConnection } from './connections.js';
import { logger } from '../lib/logger.js';

/**
 * Stitch engine adapter — the ONLY module that talks to Google Stitch.
 *
 * Uses the official `@google/stitch-sdk` against the official MCP endpoint
 * https://stitch.googleapis.com/mcp, authenticated with the *requesting user's own*
 * Stitch API key (X-Goog-Api-Key). A fresh client is created per operation so
 * credentials can never leak between users via a shared connection.
 */

export interface StitchScreenResult {
  screenId: string;
  stitchProjectId: string;
  html: string;
  imageUrl?: string;
  raw?: unknown;
}

const MCP_URL = 'https://stitch.googleapis.com/mcp';

async function withUserClient<T>(uid: string, fn: (sdk: Stitch, client: StitchToolClient) => Promise<T>): Promise<T> {
  const apiKey = await getCredential(uid, 'stitch');
  // apiKey passed explicitly — ambient env credentials are stripped at boot (config.ts).
  const client = new StitchToolClient({ apiKey, baseUrl: MCP_URL, timeout: 300_000 });
  try {
    return await fn(new Stitch(client), client);
  } catch (e) {
    throw await mapStitchError(uid, e);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function mapStitchError(uid: string | undefined, e: unknown): Promise<AppError> {
  if (e instanceof AppError) return e;
  const se = e instanceof StitchError ? e : StitchError.fromUnknown(e);
  logger.warn({ uid, code: se.code, msg: se.message }, 'stitch error');
  switch (se.code) {
    case 'AUTH_FAILED':
      if (uid) await markConnection(uid, 'stitch', 'invalid', 'Stitch rejected this API key (expired or revoked).');
      return new AppError(401, ERROR_CODES.STITCH_AUTH_FAILED,
        'Google Stitch rejected your API key. It may have been revoked — create a new key in Stitch settings and reconnect.', 'open_integrations');
    case 'PERMISSION_DENIED':
      if (uid) await markConnection(uid, 'stitch', 'no_access', 'This Google account lacks access to the requested Stitch capability.');
      return new AppError(403, ERROR_CODES.STITCH_NO_ACCESS,
        'Your Google account does not have access to this Stitch capability. Open stitch.withgoogle.com to confirm access.', 'open_integrations');
    case 'RATE_LIMITED':
      if (uid) await markConnection(uid, 'stitch', 'quota_exceeded', 'Stitch quota reached for this Google account.');
      return new AppError(429, ERROR_CODES.STITCH_RATE_LIMITED,
        'Your Google Stitch quota or rate limit has been reached. This is a Google limit on your account, not a DesignForge credit limit.');
    case 'NOT_FOUND':
      return new AppError(404, ERROR_CODES.STITCH_ERROR, 'The linked Stitch project or screen no longer exists in your Stitch account.');
    case 'VALIDATION_ERROR':
      return new AppError(400, ERROR_CODES.STITCH_ERROR, `Stitch rejected the request: ${se.message}`);
    case 'NETWORK_ERROR':
      return new AppError(502, ERROR_CODES.STITCH_ERROR, 'Could not reach Google Stitch. Please retry.');
    default:
      return new AppError(502, ERROR_CODES.STITCH_ERROR, `Stitch error: ${se.message}`);
  }
}

/** Download helper with retry (safe: idempotent GET). Only Google-hosted URLs are fetched. */
export async function fetchText(url: string, attempts = 3): Promise<string> {
  assertGoogleAssetUrl(url);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500 * 2 ** i));
    }
  }
  throw new AppError(502, ERROR_CODES.STITCH_ERROR, `Could not download generated HTML: ${(lastErr as Error)?.message}`);
}

function assertGoogleAssetUrl(url: string) {
  const u = new URL(url);
  const ok = u.protocol === 'https:' && (/\.googleapis\.com$/.test(u.hostname) || /\.googleusercontent\.com$/.test(u.hostname) || u.hostname === 'storage.googleapis.com');
  if (!ok) throw new AppError(502, ERROR_CODES.STITCH_ERROR, 'Unexpected asset host returned by Stitch');
}

async function materialize(screen: { screenId: string; projectId: string; getHtml(): Promise<string>; getImage(): Promise<string>; data: unknown }): Promise<StitchScreenResult> {
  const htmlUrl = await screen.getHtml();
  const html = await fetchText(htmlUrl);
  let imageUrl: string | undefined;
  try {
    imageUrl = await screen.getImage();
  } catch {
    imageUrl = undefined; // screenshot is optional
  }
  return { screenId: screen.screenId, stitchProjectId: screen.projectId, html, imageUrl, raw: screen.data };
}

export const stitchEngine = {
  /** Verifies a candidate key by listing projects (read-only; never generates). */
  async verifyKey(apiKey: string): Promise<{ ok: true; projectCount: number } | { ok: false; code: string; message: string }> {
    const client = new StitchToolClient({ apiKey, baseUrl: MCP_URL, timeout: 30_000 });
    try {
      const projects = await new Stitch(client).projects();
      return { ok: true, projectCount: projects.length };
    } catch (e) {
      const err = await mapStitchError(undefined, e);
      return { ok: false, code: err.code, message: err.message };
    } finally {
      await client.close().catch(() => undefined);
    }
  },

  async ensureProject(uid: string, title: string, existingId?: string): Promise<string> {
    if (existingId) return existingId;
    return withUserClient(uid, async (sdk) => (await sdk.createProject(title.slice(0, 120))).projectId);
  },

  async generate(uid: string, stitchProjectId: string, prompt: string, device: DeviceType, model: StitchModel): Promise<StitchScreenResult> {
    return withUserClient(uid, async (sdk) => {
      const screen = await sdk.project(stitchProjectId).generate(prompt, device, model);
      return materialize(screen);
    });
  },

  async edit(uid: string, stitchProjectId: string, screenId: string, prompt: string, device: DeviceType, model: StitchModel): Promise<StitchScreenResult> {
    return withUserClient(uid, async (sdk) => {
      const screen = await sdk.project(stitchProjectId).screen(screenId).edit(prompt, device, model);
      return materialize(screen);
    });
  },

  async variants(
    uid: string, stitchProjectId: string, screenId: string, prompt: string, count: number,
    creativeRange: 'REFINE' | 'EXPLORE' | 'REIMAGINE', device: DeviceType, model: StitchModel,
  ): Promise<StitchScreenResult[]> {
    return withUserClient(uid, async (sdk) => {
      const screens = await sdk.project(stitchProjectId).screen(screenId).variants(
        prompt, { variantCount: Math.min(Math.max(count, 1), 5), creativeRange }, device, model,
      );
      return Promise.all(screens.map((s) => materialize(s)));
    });
  },

  /**
   * Imports an existing design (user HTML or screenshot) into the user's Stitch project via
   * the SDK's official upload (BatchCreateScreens). Used by "Improve existing design" & chat references.
   */
  async importAsset(uid: string, stitchProjectId: string, data: Buffer, ext: '.html' | '.png' | '.jpg' | '.jpeg' | '.webp', title: string): Promise<StitchScreenResult[]> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-up-'));
    const file = path.join(dir, `upload${ext}`);
    try {
      await fs.writeFile(file, data);
      return await withUserClient(uid, async (sdk) => {
        const screens = await sdk.project(stitchProjectId).upload(file, { title });
        return Promise.all(screens.map((s) => materialize(s)));
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  },

  async listRemoteProjects(uid: string) {
    return withUserClient(uid, async (sdk) => (await sdk.projects()).map((p) => ({ id: p.projectId, title: (p.data as any)?.title ?? 'Untitled' })));
  },
};
