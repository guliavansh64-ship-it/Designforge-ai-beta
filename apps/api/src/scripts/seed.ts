/** Seeds plans, system settings and the built-in template library. Idempotent. */
import { DEFAULT_PLANS } from '@designforge/shared';
import { db, C } from '../lib/firebase.js';
import { DEFAULT_SETTINGS } from '../services/settings.js';
import { auditHtml } from '../services/audit.js';
import { renderTemplate, TEMPLATE_SPECS } from './templates.js';

for (const p of DEFAULT_PLANS) await db().collection(C.plans).doc(p.id).set(p, { merge: true });
await db().collection(C.settings).doc('global').set(DEFAULT_SETTINGS, { merge: true });
for (const t of TEMPLATE_SPECS) {
  const html = renderTemplate(t);
  const kind = t.kind ?? 'website';
  const score = auditHtml(html, kind, t.deviceType ?? 'DESKTOP').score;
  await db().collection(C.templates).doc(t.id).set({
    name: t.name, category: t.category, description: t.description, tags: t.tags, kind, deviceType: t.deviceType ?? 'DESKTOP',
    html, featured: ['saas-launch', 'portfolio-dark', 'restaurant-bistro', 'finance-app'].includes(t.id), published: true,
    qualityScore: score, uses: 0, accent: t.palette.primary, dark: t.palette.bg !== '#ffffff', updatedAt: Date.now(),
  }, { merge: true });
  console.log(`template ${t.id}: audit ${score}/100`);
}
console.log('Seed complete.');
process.exit(0);
