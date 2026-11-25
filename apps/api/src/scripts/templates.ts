/**
 * Built-in starter templates. Pure HTML + CSS (no external runtime), responsive,
 * semantic and WCAG-AA contrast by construction — they pass the DesignForge audit.
 */
export interface TemplateSpec {
  id: string; name: string; category: string; description: string; tags: string[];
  brand: string; headline: string; sub: string; cta: string; nav: string[];
  features: [string, string][]; palette: { bg: string; fg: string; primary: string; onPrimary: string; muted: string; card: string };
  font: string; extra?: 'pricing' | 'menu' | 'stats' | 'schedule' | 'courses' | 'gallery'; kind?: 'website' | 'ui'; deviceType?: 'DESKTOP' | 'MOBILE';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function extraSection(t: TemplateSpec) {
  switch (t.extra) {
    case 'pricing':
      return `<section id="pricing" class="wrap"><h2>Simple pricing</h2><div class="grid3">${[['Starter', '₹0', 'For individuals'], ['Growth', '₹999', 'For small teams'], ['Scale', '₹2,999', 'For companies']].map(([n, p, d], i) => `<article class="card${i === 1 ? ' hl' : ''}"><h3>${n}</h3><p class="price">${p}<span>/mo</span></p><p>${d}</p><a class="btn${i === 1 ? '' : ' ghost'}" href="#contact">Choose ${n}</a></article>`).join('')}</div></section>`;
    case 'menu':
      return `<section id="menu" class="wrap"><h2>Signature menu</h2><div class="grid2">${[['Truffle risotto', '₹640'], ['Wood-fired margherita', '₹520'], ['Charred broccolini', '₹380'], ['Saffron panna cotta', '₹320']].map(([n, p]) => `<div class="row"><span>${n}</span><strong>${p}</strong></div>`).join('')}</div></section>`;
    case 'stats':
      return `<section id="stats" class="wrap"><h2>By the numbers</h2><div class="grid3">${[['12k+', 'Active customers'], ['99.9%', 'Uptime'], ['4.8/5', 'Average rating']].map(([n, l]) => `<div class="card stat"><p class="big">${n}</p><p>${l}</p></div>`).join('')}</div></section>`;
    case 'schedule':
      return `<section id="classes" class="wrap"><h2>Class schedule</h2><div class="grid3">${[['HIIT', 'Mon · Wed · Fri — 7:00'], ['Strength', 'Tue · Thu — 18:30'], ['Yoga', 'Sat · Sun — 9:00']].map(([n, l]) => `<div class="card"><h3>${n}</h3><p>${l}</p></div>`).join('')}</div></section>`;
    case 'courses':
      return `<section id="courses" class="wrap"><h2>Popular courses</h2><div class="grid3">${[['Data Science 101', '8 weeks'], ['UX Foundations', '6 weeks'], ['Full-stack Web', '12 weeks']].map(([n, l]) => `<div class="card"><h3>${n}</h3><p>${l} · Certificate</p></div>`).join('')}</div></section>`;
    case 'gallery':
      return `<section id="work" class="wrap"><h2>Selected work</h2><div class="grid3">${['Brand identity', 'Mobile banking app', 'E-commerce redesign'].map((n, i) => `<figure class="card"><div class="ph" role="img" aria-label="${n} preview" style="background:linear-gradient(135deg,${t.palette.primary},${['#22c55e', '#f59e0b', '#06b6d4'][i]})"></div><figcaption>${n}</figcaption></figure>`).join('')}</div></section>`;
    default: return '';
  }
}

export function renderTemplate(t: TemplateSpec): string {
  const p = t.palette;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.brand)} — ${esc(t.headline)}</title>
<style>
:root{--bg:${p.bg};--fg:${p.fg};--primary:${p.primary};--on:${p.onPrimary};--muted:${p.muted};--card:${p.card}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:${t.font},system-ui,sans-serif;line-height:1.6}
a{color:inherit}.wrap{max-width:1120px;margin:0 auto;padding:64px 24px}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid #8882;z-index:10}
header .wrap{display:flex;align-items:center;justify-content:space-between;padding:16px 24px}
.logo{font-weight:800;font-size:20px;text-decoration:none}nav ul{display:flex;gap:24px;list-style:none;margin:0;padding:0}nav a{text-decoration:none;font-weight:500}
.btn{display:inline-block;background:var(--primary);color:var(--on);padding:16px 24px;border-radius:16px;text-decoration:none;font-weight:600}
.btn.ghost{background:transparent;color:var(--fg);border:1px solid #8886;font:inherit;cursor:pointer}
.hero{text-align:center;padding:96px 24px}.hero h1{font-size:48px;line-height:1.1;margin:0 auto 16px;max-width:780px}
.hero p{font-size:18px;color:var(--muted);max-width:620px;margin:0 auto 32px}
h2{font-size:32px;margin:0 0 32px}h3{margin:0 0 8px;font-size:20px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px 48px}
.card{background:var(--card);border-radius:16px;padding:24px;border:1px solid #8882}.card p{color:var(--muted);margin:0}
.card.hl{outline:2px solid var(--primary)}.price{font-size:32px;font-weight:800;color:var(--fg)!important;margin:8px 0!important}.price span{font-size:16px;color:var(--muted)}
.card .btn{margin-top:16px}.row{display:flex;justify-content:space-between;border-bottom:1px dashed #8885;padding:16px 0}
.stat .big{font-size:40px;font-weight:800;color:var(--fg)}.ph{height:180px;border-radius:16px;margin-bottom:16px}figure{margin:0}
.cta{background:var(--primary);color:var(--on);border-radius:24px;text-align:center;padding:64px 24px}.cta h2{margin-bottom:16px}.cta .btn{background:var(--on);color:var(--primary)}
footer{border-top:1px solid #8882}footer .wrap{display:flex;justify-content:space-between;gap:16px;padding:32px 24px;color:var(--muted);flex-wrap:wrap}
@media (max-width:900px){.grid3{grid-template-columns:1fr 1fr}}
@media (max-width:640px){nav ul{display:none}.hero h1{font-size:34px}.grid3,.grid2{grid-template-columns:1fr}.wrap{padding:48px 24px}}
@media (min-width:1440px){.wrap{max-width:1280px}.hero h1{font-size:56px}}
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="#">${esc(t.brand)}</a><nav aria-label="Primary"><ul>${t.nav.map((n) => `<li><a href="#${n.toLowerCase().replace(/\s+/g, '-')}">${esc(n)}</a></li>`).join('')}</ul></nav><a class="btn" href="#contact">${esc(t.cta)}</a></div></header>
<main>
<section class="hero" id="home"><h1>${esc(t.headline)}</h1><p>${esc(t.sub)}</p><a class="btn" href="#contact">${esc(t.cta)}</a> ${t.kind === 'ui' ? '<button type="button" class="btn ghost">View details</button>' : '<a class="btn ghost" href="#features">Learn more</a>'}</section>
<section id="features" class="wrap"><h2>Why ${esc(t.brand)}</h2><div class="grid3">${t.features.map(([h, d]) => `<article class="card"><h3>${esc(h)}</h3><p>${esc(d)}</p></article>`).join('')}</div></section>
${extraSection(t)}
<section id="contact" class="wrap"><div class="cta"><h2>Ready to get started?</h2><p>Join thousands who chose ${esc(t.brand)}.</p><a class="btn" href="mailto:hello@example.com">${esc(t.cta)}</a></div></section>
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(t.brand)}</span><span><a href="#">Privacy</a> · <a href="#">Terms</a> · <a href="mailto:hello@example.com">Contact</a></span></div></footer>
</body>
</html>`;
}

const light = (primary: string) => ({ bg: '#ffffff', fg: '#0f172a', primary, onPrimary: '#ffffff', muted: '#475569', card: '#f8fafc' });
const dark = (primary: string, on = '#0b0b12') => ({ bg: '#0b0b12', fg: '#f1f5f9', primary, onPrimary: on, muted: '#a1a1aa', card: '#15151f' });

export const TEMPLATE_SPECS: TemplateSpec[] = [
  { id: 'saas-launch', name: 'SaaS Launch', category: 'SaaS', description: 'Product-led SaaS landing with pricing tiers.', tags: ['startup', 'pricing'], brand: 'Orbitly', headline: 'Ship analytics your whole team understands', sub: 'Dashboards, alerts and AI insights — set up in minutes, not sprints.', cta: 'Start free', nav: ['Features', 'Pricing', 'Contact'], features: [['Live dashboards', 'Real-time metrics from every source.'], ['Smart alerts', 'Know about anomalies before customers do.'], ['AI summaries', 'Weekly digests written for humans.']], palette: light('#4f46e5'), font: 'Inter', extra: 'pricing' },
  { id: 'business-consult', name: 'Consulting Firm', category: 'Business', description: 'Trust-building professional services site.', tags: ['corporate'], brand: 'Northbridge', headline: 'Strategy that turns into results', sub: 'Operations, finance and growth advisory for ambitious mid-size companies.', cta: 'Book a call', nav: ['Features', 'Stats', 'Contact'], features: [['Growth strategy', 'Market entry and pricing playbooks.'], ['Operations', 'Lean processes that scale.'], ['Finance', 'Fundraising and FP&A support.']], palette: light('#0f766e'), font: 'Georgia', extra: 'stats' },
  { id: 'ecom-store', name: 'D2C Store', category: 'E-commerce', description: 'Direct-to-consumer storefront home page.', tags: ['shop', 'retail'], brand: 'Kora Living', headline: 'Handmade homeware, delivered across India', sub: 'Sustainably sourced ceramics and textiles from independent artisans.', cta: 'Shop now', nav: ['Features', 'Work', 'Contact'], features: [['Free shipping', 'On orders above ₹999.'], ['Easy returns', '14-day no-questions returns.'], ['Artisan made', 'Every piece is one of a kind.']], palette: light('#b45309'), font: 'Inter', extra: 'gallery' },
  { id: 'portfolio-dark', name: 'Designer Portfolio', category: 'Portfolio', description: 'Dark, minimal portfolio for creatives.', tags: ['personal', 'creative'], brand: 'Aanya Rao', headline: 'Product designer crafting calm interfaces', sub: 'Seven years designing fintech and health products used by millions.', cta: 'Hire me', nav: ['Work', 'Features', 'Contact'], features: [['Product design', 'From discovery to shipped UI.'], ['Design systems', 'Scalable, accessible component libraries.'], ['Prototyping', 'High-fidelity, testable prototypes.']], palette: dark('#a78bfa'), font: 'Inter', extra: 'gallery' },
  { id: 'restaurant-bistro', name: 'Modern Bistro', category: 'Restaurant', description: 'Restaurant site with menu highlights and booking CTA.', tags: ['food', 'menu'], brand: 'Ember & Oak', headline: 'Seasonal plates, wood-fired flavour', sub: 'A neighbourhood bistro serving local produce cooked over open flame.', cta: 'Reserve a table', nav: ['Menu', 'Features', 'Contact'], features: [['Seasonal menu', 'Changes with the harvest.'], ['Private dining', 'Space for up to 24 guests.'], ['Natural wines', 'Small producers, big character.']], palette: dark('#f59e0b'), font: 'Georgia', extra: 'menu' },
  { id: 'edu-academy', name: 'Online Academy', category: 'Education', description: 'Course marketplace landing page.', tags: ['courses', 'learning'], brand: 'Learnloop', headline: 'Learn job-ready skills with live mentors', sub: 'Cohort-based courses in data, design and engineering — with placement support.', cta: 'Explore courses', nav: ['Courses', 'Features', 'Contact'], features: [['Live cohorts', 'Learn together, not alone.'], ['Mentor reviews', '1:1 feedback every week.'], ['Placement help', 'Resume and interview prep.']], palette: light('#2563eb'), font: 'Inter', extra: 'courses' },
  { id: 'fitness-gym', name: 'Performance Gym', category: 'Fitness', description: 'High-energy gym site with class schedule.', tags: ['gym', 'health'], brand: 'IronPulse', headline: 'Train harder. Recover smarter.', sub: 'Coached strength, conditioning and mobility classes for every level.', cta: 'Claim free trial', nav: ['Classes', 'Features', 'Contact'], features: [['Expert coaches', 'Certified and results-driven.'], ['Small groups', 'Max 12 per class.'], ['Recovery zone', 'Sauna, cold plunge and physio.']], palette: dark('#22c55e'), font: 'Inter', extra: 'schedule' },
  { id: 'finance-app', name: 'Fintech App', category: 'Finance', description: 'Personal finance app marketing page.', tags: ['fintech', 'app'], brand: 'Paisa+', headline: 'Every rupee, finally organised', sub: 'Track spending, automate savings and invest — all in one secure app.', cta: 'Get the app', nav: ['Features', 'Stats', 'Contact'], features: [['Auto-categorise', 'UPI and card spends sorted instantly.'], ['Goals', 'Save automatically for what matters.'], ['Bank-grade security', 'Encrypted and RBI-compliant partners.']], palette: light('#7c3aed'), font: 'Inter', extra: 'stats' },
  { id: 'travel-agency', name: 'Travel Agency', category: 'Travel', description: 'Destination-led travel agency homepage.', tags: ['tourism'], brand: 'Wanderwise', headline: 'Curated journeys across the Himalayas', sub: 'Small-group treks and boutique stays planned by local experts.', cta: 'Plan my trip', nav: ['Work', 'Features', 'Contact'], features: [['Local guides', 'Born and raised in the mountains.'], ['Boutique stays', 'Handpicked homestays and lodges.'], ['24/7 support', 'Someone always on call.']], palette: light('#0369a1'), font: 'Inter', extra: 'gallery' },
  { id: 'health-clinic', name: 'Health Clinic', category: 'Healthcare', description: 'Calm, accessible clinic website.', tags: ['medical', 'clinic'], brand: 'CarePoint', headline: 'Compassionate care, close to home', sub: 'General practice, diagnostics and specialist consultations — same-week appointments.', cta: 'Book appointment', nav: ['Features', 'Stats', 'Contact'], features: [['Same-week visits', 'No long waiting lists.'], ['In-house labs', 'Results within 24 hours.'], ['Teleconsults', 'See a doctor from home.']], palette: light('#0d9488'), font: 'Inter', extra: 'stats' },
  { id: 'dashboard-admin', name: 'Admin Overview', category: 'Dashboard', description: 'Admin-style overview page with KPI cards.', tags: ['admin', 'analytics'], brand: 'OpsBoard', headline: 'Your operations at a glance', sub: 'Revenue, orders and support load in one responsive overview.', cta: 'Open dashboard', nav: ['Stats', 'Features', 'Contact'], features: [['Revenue', '₹18.4L this month, +12%.'], ['Orders', '2,341 processed, 98% on time.'], ['Support', '42 open tickets, 3h median response.']], palette: dark('#38bdf8'), font: 'Inter', extra: 'stats', kind: 'ui' },
  { id: 'mobile-onboarding', name: 'App Onboarding', category: 'Mobile', description: 'Mobile app onboarding / welcome screen.', tags: ['mobile', 'onboarding'], brand: 'Habitly', headline: 'Build habits that stick', sub: 'Tiny daily actions, streaks and gentle reminders.', cta: 'Get started', nav: ['Features', 'Contact'], features: [['Streaks', 'Stay motivated every day.'], ['Reminders', 'Nudges at the right time.'], ['Insights', 'See your progress weekly.']], palette: light('#e11d48'), font: 'Inter', kind: 'ui', deviceType: 'MOBILE' },
];
