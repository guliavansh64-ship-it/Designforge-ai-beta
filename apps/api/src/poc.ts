/**
 * PHASE 1 PROOF OF CONCEPT — run with YOUR OWN Stitch API key:
 *   STITCH_API_KEY=xxxx npm run poc
 * Steps: list tools → create project → generate screen → fetch HTML + screenshot → audit → export validation.
 * This script is the only place an env Stitch key is read; the server strips it at boot.
 */
import 'dotenv/config';
import { Stitch, StitchToolClient } from '@google/stitch-sdk';
import fs from 'node:fs/promises';
import { auditHtml } from './services/audit.js';
import { buildReactExport } from './services/exporter.js';

const apiKey = process.env.STITCH_API_KEY;
if (!apiKey) { console.error('Set STITCH_API_KEY (create one at https://stitch.withgoogle.com → Settings → API Keys)'); process.exit(1); }

const client = new StitchToolClient({ apiKey, timeout: 300_000 });
const sdk = new Stitch(client);
try {
  const { tools } = await client.listTools();
  console.log(`✔ Connected to Stitch MCP. ${tools.length} tools:`, tools.map((t: any) => t.name).join(', '));
  const project = await sdk.createProject('DesignForge POC');
  console.log('✔ Created project', project.projectId);
  console.log('… generating (30–120s)');
  const screen = await project.generate('A modern SaaS analytics dashboard with sidebar navigation, KPI cards, a revenue chart and a recent orders table', 'DESKTOP', 'GEMINI_3_FLASH');
  console.log('✔ Generated screen', screen.screenId);
  const htmlUrl = await screen.getHtml();
  const html = await (await fetch(htmlUrl)).text();
  await fs.writeFile('poc-output.html', html);
  console.log(`✔ HTML downloaded (${html.length} bytes) → poc-output.html`);
  console.log('✔ Screenshot URL:', (await screen.getImage()).slice(0, 80) + '…');
  const audit = auditHtml(html, 'ui', 'DESKTOP');
  console.log(`✔ Heuristic audit: ${audit.score}/100; failing:`, audit.checks.filter((c) => !c.passed).map((c) => c.id).join(', ') || 'none');
  const exp = await buildReactExport('POC', [{ name: 'Dashboard', html }]);
  console.log(`✔ React export: ${exp.report.files} files, ${exp.report.errors.length} validation errors`);
  if (exp.report.errors.length) console.log(exp.report.errors.slice(0, 5).join('\n'));
  console.log('\nPOC PASSED — real design generated with your own Stitch account.');
} catch (e: any) {
  console.error('✘ POC failed:', e?.code ?? '', e?.message ?? e);
  if (e?.code === 'PERMISSION_DENIED') console.error('Your Google account may not have Stitch access. Open https://stitch.withgoogle.com first.');
  process.exitCode = 1;
} finally {
  await client.close();
}
