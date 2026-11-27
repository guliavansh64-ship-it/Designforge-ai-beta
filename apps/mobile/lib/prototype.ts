/**
 * Clickable prototype ("Play"): every generated screen is a real HTML page. When the user taps a link,
 * button, tab or menu item, we read its visible text / icon name / aria-label and open the screen whose
 * name matches best (e.g. a bottom-nav "shopping_cart Cart" → the "Cart" screen).
 */

const STOP = new Set(['the', 'a', 'an', 'my', 'your', 'our', 'to', 'and', 'of', 'for', 'in', 'on', 'at', 'with', 'go', 'see', 'view', 'all', 'now', 'more', 'screen', 'page', 'tab', 'icon', 'button', 'open', 'show', 'here', 'this', 'new', 'app', 'ios', 'outline', 'outlined', 'fill', 'filled', 'rounded', 'sharp']);

/** Words that mean the same place in an app (Material icon names included — Stitch uses them as text). */
const GROUPS: string[][] = [
  ['home', 'dashboard', 'index', 'main', 'feed', 'start', 'overview', 'house', 'today'],
  ['cart', 'basket', 'bag', 'shopping', 'trolley', 'shopping_cart', 'shopping_bag', 'local_mall'],
  ['checkout', 'payment', 'pay', 'billing', 'purchase', 'credit_card', 'payments'],
  ['profile', 'account', 'person', 'me', 'user', 'avatar', 'account_circle', 'face'],
  ['settings', 'preferences', 'gear', 'tune', 'options', 'configuration', 'manage'],
  ['search', 'find', 'lookup', 'magnify'],
  ['explore', 'discover', 'browse', 'trending', 'travel_explore'],
  ['orders', 'order', 'history', 'receipt', 'receipt_long', 'purchases', 'tracking', 'track', 'delivery', 'deliveries', 'local_shipping'],
  ['menu', 'restaurant', 'food', 'dishes', 'dish', 'meals', 'catalog', 'catalogue', 'products', 'product', 'shop', 'store', 'items', 'category', 'categories', 'restaurant_menu', 'storefront', 'grid_view'],
  ['notifications', 'notification', 'alerts', 'alert', 'bell', 'notifications_active', 'updates'],
  ['messages', 'message', 'chat', 'chats', 'inbox', 'mail', 'conversation', 'conversations', 'forum', 'sms'],
  ['favorites', 'favourites', 'favorite', 'favourite', 'saved', 'heart', 'wishlist', 'bookmark', 'bookmarks', 'likes', 'liked'],
  ['login', 'signin', 'sign_in', 'log_in', 'logon'],
  ['signup', 'register', 'registration', 'join', 'create_account', 'onboarding', 'welcome', 'get_started'],
  ['details', 'detail', 'info', 'information', 'about'],
  ['map', 'maps', 'location', 'nearby', 'directions', 'place', 'location_on', 'near_me'],
  ['calendar', 'schedule', 'booking', 'bookings', 'book', 'reservation', 'reservations', 'appointment', 'appointments', 'event', 'events', 'calendar_month'],
  ['wallet', 'balance', 'account_balance_wallet', 'money', 'finance', 'transactions', 'transaction'],
  ['stats', 'statistics', 'analytics', 'insights', 'reports', 'report', 'bar_chart', 'leaderboard', 'progress'],
  ['help', 'support', 'faq', 'contact', 'help_center', 'support_agent'],
  ['pricing', 'plans', 'plan', 'subscription', 'upgrade', 'premium'],
  ['workout', 'workouts', 'exercise', 'training', 'fitness', 'fitness_center'],
  ['community', 'social', 'friends', 'people', 'group', 'groups', 'team'],
];
const GROUP_OF = new Map<string, number>();
GROUPS.forEach((g, i) => g.forEach((w) => GROUP_OF.set(w, i)));

const BACK = /^(back|arrow_back|arrow_back_ios|arrow_back_ios_new|chevron_left|navigate_before|go back|keyboard_arrow_left|close|cancel)$/i;

function stem(w: string) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Splits a label into meaningful words (keeps Material icon names like "shopping_cart" as one word too). */
export function words(label: string): string[] {
  const raw = label.toLowerCase();
  const out = new Set<string>();
  for (const t of raw.split(/[^a-z_]+/)) {
    if (!t) continue;
    if (t.includes('_')) out.add(t); // icon name as a whole
    for (const p of t.split('_')) if (p.length > 1 && !STOP.has(p)) out.add(p);
  }
  return [...out];
}

function groupsOf(ws: string[]) {
  const g = new Set<number>();
  for (const w of ws) { const i = GROUP_OF.get(w) ?? GROUP_OF.get(stem(w)); if (i !== undefined) g.add(i); }
  return g;
}

export interface ProtoScreen { id: string; name: string }
export type TapResult = { kind: 'go'; id: string } | { kind: 'back' } | { kind: 'none' };

/**
 * Decides where a tap goes. `label` is the tapped element's text/aria-label/icon text, `href` its link.
 * Returns the best matching OTHER screen, "back", or none.
 */
export function resolveTap(label: string, href: string, screens: ProtoScreen[], currentId: string): TapResult {
  const text = `${label} ${href.replace(/^[#/.]+/, '').replace(/\.html?$/i, '').replace(/[-/]/g, ' ')}`.trim();
  const clean = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!clean) return { kind: 'none' };
  if (BACK.test(clean) || BACK.test(clean.split(' ')[0] ?? '') && clean.split(' ').length <= 2) return { kind: 'back' };
  const lw = words(clean);
  // "Long" = card/paragraph text (counted on raw tokens, so numbers, ratings and prices count too).
  const long = clean.split(' ').length > 6;
  const ls = new Set(lw.map(stem));
  const lg = groupsOf(lw);
  let best: { id: string; score: number } | null = null;
  for (const s of screens) {
    const nameClean = s.name.toLowerCase().trim();
    const sw = words(nameClean);
    if (!sw.length) continue;
    let score = 0;
    if (clean === nameClean || clean.endsWith(` ${nameClean}`) || clean.startsWith(`${nameClean} `)) score += 10;
    for (const w of sw) if (ls.has(stem(w))) score += 4;
    // Synonyms only count for short labels (buttons, tabs); a long card text needs the actual screen name.
    if (!long) for (const g of groupsOf(sw)) if (lg.has(g)) score += 3;
    // Long labels (paragraphs, cards) match weakly: favour short, button-like labels.
    if (long) score -= 2;
    if (score > 0 && (!best || score > best.score)) best = { id: s.id, score };
  }
  // Long labels (whole cards, paragraphs) need a real name match, not just a loose synonym.
  if (!best || best.score < (long ? 5 : 3)) return { kind: 'none' };
  if (best.id === currentId) return { kind: 'none' };
  return { kind: 'go', id: best.id };
}

/**
 * Script injected into every screen: reports taps on interactive elements to the app and gives instant
 * pressed feedback. Text fields, checkboxes, sliders and toggles keep working normally.
 */
export const TAP_SCRIPT = `(function(){
  var SEL='a,button,[role=button],[role=tab],[role=link],[role=menuitem],[onclick],input[type=submit],input[type=button],summary,nav li,[class*="cursor-pointer"]';
  function txt(el){
    if(!el)return '';
    var t=[el.getAttribute('aria-label'),el.getAttribute('title'),el.getAttribute('alt'),el.getAttribute('value'),el.innerText||el.textContent].filter(Boolean).join(' ');
    return t.replace(/\\s+/g,' ').trim().slice(0,140);
  }
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t.closest('input:not([type=submit]):not([type=button]),textarea,select,label input'))return;
    var el=t.closest(SEL); if(!el)return;
    var a=el.closest('a'); var isSubmit=el.matches('[type=submit]')||(el.tagName==='BUTTON'&&el.form&&(el.getAttribute('type')||'submit')==='submit');
    if(a||isSubmit)e.preventDefault();
    var label=txt(el); if(!label&&el.parentElement)label=txt(el.parentElement);
    el.style.transition='opacity .12s'; el.style.opacity='0.55'; setTimeout(function(){el.style.opacity='';},160);
    try{window.ReactNativeWebView.postMessage(JSON.stringify({t:'tap',label:label,href:(a&&a.getAttribute('href'))||''}));}catch(_){}
  },true);
  document.addEventListener('submit',function(e){e.preventDefault();},true);
})();`;
