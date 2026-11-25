import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  LayoutDashboard, Sparkles, Smartphone, Globe, PenTool, Wand2, FolderKanban, LayoutTemplate, Palette, Download,
  Coins, CreditCard, Plug, Settings, LifeBuoy, Bell, Menu, X, Sun, Moon, LogOut, Shield, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { applyTheme, storedTheme } from '../lib/theme';
import { uiPreview } from '../lib/firebase';
import { timeAgo } from '../lib/hooks';
import { Avatar, Badge, Logo, cx } from './ui';

const NAV = [
  { group: 'Create', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/studio', label: 'AI Design Studio', icon: Sparkles },
    { to: '/ui-designer', label: 'UI/UX Designer', icon: Smartphone },
    { to: '/website-designer', label: 'Website Designer', icon: Globe },
    { to: '/logo-studio', label: 'Logo Studio', icon: PenTool },
    { to: '/improve', label: 'Design Improvement', icon: Wand2 },
  ] },
  { group: 'Library', items: [
    { to: '/projects', label: 'My Projects', icon: FolderKanban },
    { to: '/templates', label: 'Templates', icon: LayoutTemplate },
    { to: '/brand-kits', label: 'Brand Kits', icon: Palette },
    { to: '/exports', label: 'Export Center', icon: Download },
  ] },
  { group: 'Account', items: [
    { to: '/credits', label: 'Credits & Usage', icon: Coins },
    { to: '/subscription', label: 'Subscription', icon: CreditCard },
    { to: '/integrations', label: 'Integrations', icon: Plug },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/help', label: 'Help & Support', icon: LifeBuoy },
  ] },
];

interface Notif { id: string; title: string; body: string; read: boolean; createdAt: number; type: string }

export function Layout() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(storedTheme());
  const [notifs, setNotifs] = useState<{ notifications: Notif[]; unread: number }>({ notifications: [], unread: 0 });
  const [showNotifs, setShowNotifs] = useState(false);
  const [announcement, setAnnouncement] = useState<{ id: string; title: string; body: string } | null>(null);
  const loc = useLocation();
  const nav = useNavigate();
  const isStudio = /^\/studio\/.+/.test(loc.pathname);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => { applyTheme(theme); }, [theme]);
  useEffect(() => {
    const load = () => api.get<typeof notifs>('/notifications').then(setNotifs).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    api.get<{ announcements: any[] }>('/announcements').then((r) => {
      const a = r.announcements[0];
      if (a && localStorage.getItem('df_dismissed_ann') !== a.id) setAnnouncement(a);
    }).catch(() => undefined);
    return () => clearInterval(t);
  }, []);

  const stitch = me?.connections.find((c) => c.provider === 'stitch');
  const markRead = async () => { await api.post('/notifications/read', {}).catch(() => undefined); setNotifs((n) => ({ notifications: n.notifications.map((x) => ({ ...x, read: true })), unread: 0 })); };

  const sidebar = (
    <nav className="flex h-full flex-col" aria-label="Main navigation">
      <div className="flex h-16 items-center px-5"><Logo /></div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-400 dark:text-ink-500">{g.group}</p>
            {g.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => cx('focus-ring group relative mb-0.5 flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition',
                  isActive ? 'bg-forge-500/10 font-medium text-forge-600 dark:bg-forge-500/15 dark:text-white' : 'text-ink-600 hover:bg-ink-100 dark:text-ink-400 dark:hover:bg-ink-850 dark:hover:text-ink-100')}>
                {({ isActive }) => (<>
                  {isActive && <motion.span layoutId="navpill" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-forge-gradient" />}
                  <i.icon className={cx('h-[18px] w-[18px]', isActive ? 'text-forge-500 dark:text-forge-300' : '')} />{i.label}
                </>)}
              </NavLink>
            ))}
          </div>
        ))}
        {me?.user.isAdmin && (
          <NavLink to="/admin" className="focus-ring flex items-center gap-3 rounded-xl border border-dashed border-ink-300 px-3 py-2 text-sm text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-400 dark:hover:bg-ink-850">
            <Shield className="h-[18px] w-[18px]" /> Admin panel
          </NavLink>
        )}
      </div>
      <div className="m-3 rounded-2xl border border-ink-200 bg-gradient-to-br from-forge-500/10 to-ember-500/10 p-4 dark:border-ink-800">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium muted">{me?.plan.name ?? '—'} plan</span>
          <Badge tone="forge"><Coins className="h-3 w-3" />{me?.credits ?? 0}</Badge>
        </div>
        <button onClick={() => nav('/subscription')} className="mt-2 text-xs font-semibold text-forge-600 hover:underline dark:text-forge-300">Manage plan →</button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className={cx('hidden w-64 shrink-0 border-r border-ink-200 bg-white dark:border-ink-850 dark:bg-ink-950 lg:block', isStudio && 'lg:hidden')}>{sidebar}</aside>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink-950/60" onClick={() => setOpen(false)} />
            <motion.aside initial={{ x: -280 }} animate={{ x: 0 }} exit={{ x: -280 }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="absolute inset-y-0 left-0 w-72 bg-white dark:bg-ink-950">
              <button className="absolute right-3 top-4 rounded-lg p-1 muted" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
              {sidebar}
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        {uiPreview && <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-ink-950">UI PREVIEW — sample data, no backend connected. Generation, payments and saves are disabled.</div>}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/80 px-4 backdrop-blur-xl dark:border-ink-850 dark:bg-ink-950/80 sm:px-6">
          <button className={cx('focus-ring rounded-lg p-2 muted', !isStudio && 'lg:hidden')} onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className={cx(isStudio ? '' : 'lg:hidden')}><Logo compact /></div>
          <div className="flex-1" />
          {stitch && !stitch.connected && (
            <button onClick={() => nav('/integrations')} className="hidden items-center gap-2 rounded-full border border-ember-500/40 bg-ember-500/10 px-3 py-1.5 text-xs font-medium text-ember-600 dark:text-ember-400 md:flex">
              <AlertTriangle className="h-3.5 w-3.5" /> Connect your Stitch account to generate
            </button>
          )}
          <button onClick={() => nav('/credits')} className="focus-ring hidden items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1.5 text-xs font-semibold dark:bg-ink-850 sm:flex"><Coins className="h-3.5 w-3.5 text-amber-500" />{me?.credits ?? 0} credits</button>
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="focus-ring rounded-lg p-2 muted hover:text-ink-900 dark:hover:text-white" aria-label="Toggle theme">{theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
          <div className="relative">
            <button onClick={() => setShowNotifs((s) => !s)} className="focus-ring relative rounded-lg p-2 muted hover:text-ink-900 dark:hover:text-white" aria-label={`Notifications (${notifs.unread} unread)`}>
              <Bell className="h-5 w-5" />
              {notifs.unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-bold text-white">{notifs.unread}</span>}
            </button>
            <AnimatePresence>
              {showNotifs && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="surface absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl shadow-2xl">
                  <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3 dark:border-ink-800"><span className="text-sm font-semibold">Notifications</span><button onClick={markRead} className="text-xs text-forge-500 hover:underline">Mark all read</button></div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifs.notifications.length === 0 && <p className="muted p-6 text-center text-sm">You're all caught up.</p>}
                    {notifs.notifications.map((n) => (
                      <div key={n.id} className={cx('border-b border-ink-100 px-4 py-3 text-sm last:border-0 dark:border-ink-850', !n.read && 'bg-forge-500/5')}>
                        <div className="flex items-center justify-between gap-2"><span className="font-medium">{n.title}</span><span className="muted shrink-0 text-[11px]">{timeAgo(n.createdAt)}</span></div>
                        <p className="muted mt-0.5 text-xs">{n.body}</p>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="group relative">
            <button className="focus-ring rounded-full" aria-label="Account menu"><Avatar src={me?.user.photoURL} name={me?.user.displayName ?? me?.user.email} /></button>
            <div className="surface invisible absolute right-0 top-11 z-50 w-56 rounded-2xl p-2 opacity-0 shadow-2xl transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <div className="px-3 py-2"><p className="truncate text-sm font-medium">{me?.user.displayName}</p><p className="muted truncate text-xs">{me?.user.email}</p></div>
              <button onClick={() => nav('/settings')} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-850">Account settings</button>
              <button onClick={logout} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10"><LogOut className="h-4 w-4" />Sign out</button>
            </div>
          </div>
        </header>
        {announcement && !isStudio && (
          <div className="flex items-center gap-3 border-b border-forge-500/20 bg-forge-500/10 px-6 py-2 text-sm">
            <Sparkles className="h-4 w-4 text-forge-500" /><span className="font-medium">{announcement.title}</span><span className="muted hidden truncate sm:inline">{announcement.body}</span>
            <button className="ml-auto muted" aria-label="Dismiss announcement" onClick={() => { localStorage.setItem('df_dismissed_ann', announcement.id); setAnnouncement(null); }}><X className="h-4 w-4" /></button>
          </div>
        )}
        <main className={cx('min-h-0 flex-1', isStudio ? 'overflow-hidden' : 'overflow-y-auto')}>
          {isStudio ? <Outlet /> : <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><Outlet /></div>}
        </main>
      </div>
    </div>
  );
}
