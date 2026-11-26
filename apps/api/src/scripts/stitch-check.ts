/**
 * End-to-end Stitch check: runs ONE real generation through the production code path using a connected
 * user's OWN Stitch key, then deletes the temporary Stitch project. Uses 1 generation of that user's quota.
 *   npm run stitch:check -- [GEMINI_3_8_FLASH|GEMINI_3_5_FLASH_LITE] [email]
 */
import { StitchToolClient } from '@google/stitch-sdk';
import { auth, db, C } from '../lib/firebase.js';
import { getCredential } from '../services/connections.js';
import { stitchEngine } from '../services/stitch.js';
const model = (process.argv[2] ?? 'GEMINI_3_5_FLASH_LITE') as any;
const email = process.argv[3];
const uid = email
  ? (await auth().getUserByEmail(email)).uid
  : (await db().collection(C.connections).where('provider', '==', 'stitch').where('status', '==', 'active').limit(1).get()).docs[0]?.data().ownerId;
if (!uid) { console.log('No active Stitch connection found. Connect a Stitch key in the app first.'); process.exit(1); }
const t0 = Date.now();
const pid = await stitchEngine.ensureProject(uid, 'DesignForge diagnostic (auto-deleted)');
console.log('project ok', Date.now() - t0, 'ms');
try {
  const r = await stitchEngine.generate(uid, pid, 'A simple mobile login screen for a coffee shop app with email, password and a sign-in button', 'MOBILE', model);
  console.log('GENERATE OK', model, (Date.now() - t0) / 1000, 's; screen', r.screenId, '; html chars', r.html.length, '; image bytes', r.image?.data.length ?? 0, r.image?.mime, '; has <html', /<html/i.test(r.html));
} catch (e: any) {
  console.log('GENERATE FAILED', e?.code, e?.status, e?.message);
} finally {
  const key = await getCredential(uid, 'stitch');
  const client = new StitchToolClient({ apiKey: key, baseUrl: 'https://stitch.googleapis.com/mcp', timeout: 30_000 });
  await client.callTool('delete_project', { name: `projects/${pid}` }).then(() => console.log('cleanup ok')).catch((e: any) => console.log('cleanup failed', e?.message));
  await client.close();
}
process.exit(0);
