/**
 * DEV-ONLY UI preview fixtures (VITE_UI_PREVIEW=1 and `vite dev`).
 * Lets designers review screens without a backend. Every screen shows a
 * "UI preview" banner and all mutations are rejected — nothing here pretends
 * to be a real generation. Tree-shaken out of production builds.
 */
import { DEFAULT_PLANS, CREDIT_PACKS } from '@designforge/shared';

export const SAMPLE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pulse — Analytics</title>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:#f6f7fb;color:#0f172a}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}aside{background:#0f172a;color:#e2e8f0;padding:24px 16px}
aside h2{font-size:18px;margin:0 0 24px;color:#fff}aside a{display:block;padding:8px 16px;border-radius:8px;color:#cbd5e1;text-decoration:none;margin-bottom:4px}
aside a.on{background:#1e293b;color:#fff}main{padding:32px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
h1{font-size:24px;margin:0}.btn{background:#4f46e5;color:#fff;border:0;padding:8px 16px;border-radius:8px;font-weight:600}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}.card{background:#fff;border-radius:16px;padding:16px;border:1px solid #e2e8f0}
.card p{margin:0;color:#475569;font-size:14px}.card strong{display:block;font-size:24px;margin-top:8px}
.chart{height:220px;display:flex;align-items:flex-end;gap:8px;padding-top:16px}.bar{flex:1;background:linear-gradient(#818cf8,#4f46e5);border-radius:8px 8px 0 0}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:8px 0;border-bottom:1px solid #f1f5f9}
@media (max-width:800px){.app{grid-template-columns:1fr}aside{display:none}.kpis{grid-template-columns:1fr 1fr}}
@media (max-width:480px){.kpis{grid-template-columns:1fr}main{padding:16px}}</style></head>
<body><div class="app"><aside><h2>Pulse</h2><nav aria-label="Main"><a class="on" href="#">Overview</a><a href="#">Revenue</a><a href="#">Customers</a><a href="#">Settings</a></nav></aside>
<main><header><h1>Overview</h1><button class="btn" type="button">Export report</button></header>
<section class="kpis"><div class="card"><p>Revenue</p><strong>₹18.4L</strong></div><div class="card"><p>Orders</p><strong>2,341</strong></div><div class="card"><p>Conversion</p><strong>3.8%</strong></div><div class="card"><p>Churn</p><strong>1.2%</strong></div></section>
<section class="card" id="revenue-chart"><h2 style="font-size:16px;margin:0">Revenue trend</h2><div class="chart" role="img" aria-label="Bar chart of monthly revenue">${[40, 55, 48, 70, 62, 85, 78, 92, 88, 100, 95, 110].map((h) => `<div class="bar" style="height:${h * 1.8}px"></div>`).join('')}</div></section>
<section class="card" style="margin-top:16px" id="orders"><h2 style="font-size:16px;margin:0 0 8px">Recent orders</h2><table><thead><tr><th>Customer</th><th>Plan</th><th>Amount</th></tr></thead><tbody><tr><td>Aarav Shah</td><td>Pro</td><td>₹499</td></tr><tr><td>Meera Iyer</td><td>Premium</td><td>₹1,299</td></tr><tr><td>Kabir Das</td><td>Pro</td><td>₹4,790</td></tr></tbody></table></section>
</main></div></body></html>`;

const now = Date.now();
const day = 86400_000;
const audit = {
  score: 86, measuredAt: now, methodology: 'Severity-weighted percentage of Designo automated heuristics that pass. Not an industry-standard score.',
  checks: [
    { id: 'viewport', category: 'responsive', label: 'Has responsive viewport meta', passed: true, severity: 'high', detail: 'Present.' },
    { id: 'single_h1', category: 'hierarchy', label: 'Exactly one primary heading (h1)', passed: true, severity: 'high', detail: 'Found 1.' },
    { id: 'contrast', category: 'contrast', label: 'Text contrast ≥ 4.5:1 (where measurable)', passed: true, severity: 'high', detail: '18 nodes measured.' },
    { id: 'heading_order', category: 'hierarchy', label: 'Heading levels are not skipped', passed: true, severity: 'medium', detail: '1 → 2 → 2' },
    { id: 'landmarks', category: 'structure', label: 'Uses semantic landmarks', passed: true, severity: 'medium', detail: 'main, header, nav' },
    { id: 'spacing_scale', category: 'spacing', label: 'Consistent spacing scale', passed: false, severity: 'low', detail: '12 distinct values.', fixInstruction: 'Use a consistent 4/8px spacing scale.' },
    { id: 'dead_links', category: 'navigation', label: 'Links have destinations', passed: true, severity: 'low', detail: '0' },
    { id: 'form_labels', category: 'accessibility', label: 'Form fields are labelled', passed: true, severity: 'medium', detail: '0 fields' },
    { id: 'breakpoints', category: 'responsive', label: 'Adapts across breakpoints', passed: false, severity: 'medium', detail: '2 rules', fixInstruction: 'Add tablet breakpoint.' },
  ],
};

const project = (id: string, name: string, kind: string, days: number) => ({
  id, ownerId: 'preview', name, kind, archived: false, deviceType: 'DESKTOP', folder: kind === 'website' ? 'Clients' : '',
  pages: [{ id: 'pg1', name: kind === 'website' ? 'Home' : 'Overview', currentVersionId: 'v3', stitchScreenId: 's1' }, { id: 'pg2', name: 'Settings' }],
  currentVersionId: 'v3', createdAt: now - days * day, updatedAt: now - days * day * 0.3,
});
const projects = [project('p1', 'Pulse Analytics', 'ui', 2), project('p2', 'Ember & Oak Website', 'website', 5), project('p3', 'Kora Brand', 'logo', 9), project('p4', 'Habitly Onboarding', 'ui', 14)];

export function previewGet(path: string): unknown {
  const p = path.split('?')[0];
  if (p === '/me') return {
    user: { uid: 'preview', email: 'you@example.com', displayName: 'Preview User', photoURL: null, isAdmin: true, adminRole: 'owner', createdAt: now - 40 * day },
    plan: DEFAULT_PLANS[1], subscription: { planId: 'pro', cycle: 'monthly', status: 'active', currentPeriodEnd: now + 18 * day },
    credits: 286, preferences: { theme: 'dark', defaultDevice: 'DESKTOP', defaultModel: 'GEMINI_3_8_FLASH', notificationPrefs: { push: true } },
    connections: [{ provider: 'stitch', connected: true, status: 'active', keyHint: '…a1F3', lastVerifiedAt: now - 3600_000 }, { provider: 'gemini', connected: false, status: 'not_connected' }],
  };
  if (p === '/connections') return { connections: (previewGet('/me') as any).connections };
  if (p === '/projects') return { projects, nextCursor: null };
  if (p === '/folders') return { folders: ['Clients'] };
  if (/^\/projects\/[^/]+$/.test(p)) return { project: { ...(projects.find((x) => p.endsWith(x.id)) ?? projects[0]), access: 'owner' } };
  if (/^\/projects\/[^/]+\/versions$/.test(p)) return { versions: ['v3', 'v2', 'v1'].map((id, i) => ({ id, pageId: 'pg1', projectId: 'p1', source: ['improve', 'stitch_edit', 'stitch_generate'][i], prompt: ['Improve hierarchy', 'Make the sidebar darker', 'SaaS analytics dashboard'][i], audit: { ...audit, score: [86, 74, 69][i] }, createdAt: now - i * 3600_000, hasHtml: true })) };
  if (/^\/versions\//.test(p)) return { version: { id: 'v3', pageId: 'pg1', projectId: 'p1', source: 'improve', html: SAMPLE_HTML, audit, createdAt: now } };
  if (/\/jobs$/.test(p)) return { jobs: [] };
  if (/\/chat$/.test(p)) return { messages: [{ id: 'm1', role: 'user', text: 'Make the sidebar darker', createdAt: now - 7200_000 }, { id: 'm2', role: 'assistant', text: 'Applying your change to this page…', createdAt: now - 7190_000 }] };
  if (p === '/templates') return { templates: ['SaaS Launch|SaaS|#4f46e5', 'Consulting Firm|Business|#0f766e', 'D2C Store|E-commerce|#b45309', 'Designer Portfolio|Portfolio|#a78bfa', 'Modern Bistro|Restaurant|#f59e0b', 'Online Academy|Education|#2563eb', 'Performance Gym|Fitness|#22c55e', 'Fintech App|Finance|#7c3aed'].map((s, i) => { const [name, category, accent] = s.split('|'); return { id: 't' + i, name, category, accent, dark: [3, 4, 6].includes(i), description: `${category} starter template`, featured: i < 4, qualityScore: 94 + (i % 5), uses: 120 - i * 9 }; }) };
  if (p.startsWith('/templates/')) return { template: { id: 't0', name: 'SaaS Launch', html: SAMPLE_HTML } };
  if (p === '/plans') return { plans: DEFAULT_PLANS, packs: CREDIT_PACKS, razorpayKeyId: null };
  if (p === '/billing/summary') return { plan: DEFAULT_PLANS[1], subscription: { planId: 'pro', cycle: 'monthly', status: 'active', currentPeriodEnd: now + 18 * day }, credits: 286, transactions: [{ id: 'x1', type: 'debit', op: 'generate_flash', amount: 2, status: 'committed', createdAt: now - 3600_000 }, { id: 'x2', type: 'grant', amount: 400, status: 'granted', reason: 'Monthly Pro allowance', createdAt: now - 12 * day }, { id: 'x3', type: 'debit', op: 'improve_iteration', amount: 3, status: 'refunded', createdAt: now - 2 * day }], payments: [{ id: 'order_1', status: 'paid', amountPaise: 49900, description: 'Pro monthly', invoiceNumber: 'DF-202611-ABC123', method: 'upi', createdAt: now - 12 * day, paidAt: now - 12 * day }] };
  if (p === '/billing/usage') return { usage: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * day).toISOString().slice(0, 10), credits: Math.round(Math.abs(Math.sin(i / 3)) * 18) })) };
  if (p === '/notifications') return { notifications: [{ id: 'n1', type: 'generation_completed', title: 'Design ready', body: 'Your improve job finished.', read: false, createdAt: now - 600_000 }, { id: 'n2', type: 'payment_success', title: 'Payment successful', body: 'Pro monthly — ₹499.00', read: true, createdAt: now - 12 * day }], unread: 1 };
  if (p === '/announcements') return { announcements: [{ id: 'a1', title: 'Stitch models updated', body: 'Gemini 3.8 Flash and 3.5 Flash-Lite are now available in every studio.', level: 'info', createdAt: now - day }] };
  if (p === '/tickets') return { tickets: [{ id: 'tk1', subject: 'Export question', type: 'question', status: 'pending', messages: [{ from: 'user', text: 'Can I export to Next.js?', at: now - 2 * day }, { from: 'support', text: 'React (Vite) export is available today; Next.js is on the roadmap.', at: now - day }], updatedAt: now - day }] };
  if (p === '/status') return { api: 'operational', maintenance: false, generationSuccessRateToday: 97, stitchEndpoint: 'https://stitch.googleapis.com/mcp' };
  if (p === '/admin/stats') return { users: 1284, activeUsers7d: 412, newRegistrations30d: 233, paidSubscribers: 96, projects: 5310, generationsSucceeded: 18220, generationsFailed: 512, successRate: 97, revenueMonthInr: 61240, revenueYearInr: 512300, daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * day).toISOString().slice(0, 10), registrations: 4 + (i % 7), revenue_paise: (1500 + (i % 5) * 900) * 100, gen_success_generate: 400 + i * 5, gen_failed_generate: 8 + (i % 4) })) };
  if (p === '/admin/users') return { users: ['aarav@ex.in', 'meera@ex.in', 'kabir@ex.in', 'zoya@ex.in'].map((e, i) => ({ id: 'u' + i, email: e, displayName: e.split('@')[0], status: i === 3 ? 'suspended' : 'active', createdAt: now - i * 9 * day, lastSeenAt: now - i * day })), nextCursor: null };
  if (p.startsWith('/admin/users/')) return { user: { id: 'u0', email: 'aarav@ex.in', displayName: 'aarav', status: 'active', createdAt: now - 30 * day }, plan: DEFAULT_PLANS[1], subscription: { planId: 'pro', status: 'active' }, credits: 120, connections: (previewGet('/me') as any).connections, projectCount: 7, transactions: [], payments: [] };
  if (p === '/admin/plans') return { plans: DEFAULT_PLANS };
  if (p === '/admin/coupons') return { coupons: [{ id: 'LAUNCH50', type: 'percent', value: 50, redeemed: 31, maxRedemptions: 100, active: true, appliesTo: ['pro'] }, { id: 'WELCOME100', type: 'credits', value: 100, redeemed: 210, maxRedemptions: 0, active: true, appliesTo: [] }] };
  if (p === '/admin/payments') return { payments: [{ id: 'order_1', ownerId: 'u0', status: 'paid', amountPaise: 49900, description: 'Pro monthly', method: 'upi', createdAt: now - day }, { id: 'order_2', ownerId: 'u1', status: 'failed', amountPaise: 129900, description: 'Premium monthly', createdAt: now - 2 * day }] };
  if (p === '/admin/subscriptions') return { subscriptions: [] };
  if (p === '/admin/templates') return previewGet('/templates');
  if (p === '/admin/settings') return { settings: { platformName: 'Designo', primaryColor: '#7C5CFF', maintenanceMode: false, supportEmail: 'support@designforge.app', featureFlags: { logoStudio: true, chatAssistant: true, autoImprove: true, sharing: true, reactExport: true }, limits: { maxPromptChars: 4000, maxUploadBytes: 5242880, maxProjectsFree: 5 } } };
  if (p === '/admin/announcements') return previewGet('/announcements');
  if (p === '/admin/tickets') return previewGet('/tickets');
  if (p === '/admin/errors') return { errors: [{ id: 'e1', type: 'generate', error: { code: 'STITCH_RATE_LIMITED', message: 'Your Google Stitch quota has been reached.' }, createdAt: now - 3600_000 }] };
  if (p === '/admin/audit-logs') return { logs: [{ id: 'l1', actorUid: 'owner', action: 'credits.adjust', target: 'u2', details: { amount: 50, reason: 'Goodwill' }, at: now - 7200_000 }] };
  return {};
}
