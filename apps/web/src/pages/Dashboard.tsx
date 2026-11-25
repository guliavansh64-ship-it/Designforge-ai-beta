import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles, Globe, PenTool, Wand2, ArrowUpRight, Plug, Coins, FolderKanban, CheckCircle2, AlertTriangle, LayoutTemplate } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useApi, timeAgo } from '../lib/hooks';
import type { Project } from '../lib/types';
import { Badge, BarChart, Button, Card, Empty, Skeleton } from '../components/ui';

const KIND_ICON = { ui: Sparkles, website: Globe, logo: PenTool, improve: Wand2 } as const;
export const projectLink = (p: Pick<Project, 'id' | 'kind'>) => (p.kind === 'logo' ? `/logo-studio/${p.id}` : `/studio/${p.id}`);

export default function Dashboard() {
  const { me } = useAuth();
  const nav = useNavigate();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=8');
  const usage = useApi<{ usage: { day: string; credits: number }[] }>('/billing/usage');
  const stitch = me?.connections.find((c) => c.provider === 'stitch');
  const gemini = me?.connections.find((c) => c.provider === 'gemini');
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const used30 = (usage.data?.usage ?? []).reduce((s, d) => s + d.credits, 0);

  const actions = [
    { to: '/ui-designer', icon: Sparkles, title: 'Design an app UI', body: 'Mobile, tablet or desktop screens', grad: 'from-forge-500/20 to-forge-500/0' },
    { to: '/website-designer', icon: Globe, title: 'Build a website', body: 'Multi-page sites from a brief', grad: 'from-sky-500/20 to-sky-500/0' },
    { to: '/logo-studio', icon: PenTool, title: 'Create a brand', body: 'Logos, palettes & brand kit', grad: 'from-ember-500/20 to-ember-500/0' },
    { to: '/improve', icon: Wand2, title: 'Improve a design', body: 'Audit → fix → compare', grad: 'from-emerald-500/20 to-emerald-500/0' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm muted">{hello},</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{me?.user.displayName?.split(' ')[0] ?? 'Designer'} <span className="gradient-text">— what are we forging?</span></h1>
        </div>
        <Button variant="ember" icon={<Sparkles className="h-4 w-4" />} onClick={() => nav('/studio')}>New design</Button>
      </div>

      {stitch && !stitch.connected && (
        <Card className="flex flex-col gap-4 border-ember-500/30 bg-gradient-to-r from-ember-500/10 to-transparent p-5 sm:flex-row sm:items-center">
          <div className="rounded-xl bg-ember-500/15 p-2.5 text-ember-500"><Plug className="h-5 w-5" /></div>
          <div className="flex-1">
            <p className="font-semibold">{stitch.status === 'invalid' ? 'Your Stitch key needs attention' : 'Connect your Google Stitch account'}</p>
            <p className="muted text-sm">Design generation runs on <b>your own</b> Stitch account and quota. It takes about 2 minutes and you can disconnect any time.</p>
          </div>
          <Button onClick={() => nav('/integrations')}>Connect Stitch</Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((a, i) => (
          <motion.div key={a.to} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Link to={a.to} className={`focus-ring surface group relative block overflow-hidden rounded-2xl bg-gradient-to-br ${a.grad} p-5 transition hover:-translate-y-0.5 hover:shadow-glow`}>
              <a.icon className="h-6 w-6 text-forge-500 dark:text-forge-300" />
              <p className="mt-6 font-display font-semibold">{a.title}</p>
              <p className="muted text-sm">{a.body}</p>
              <ArrowUpRight className="absolute right-4 top-4 h-4 w-4 muted transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display font-semibold">Recent projects</h2>
            <Link to="/projects" className="text-sm text-forge-500 hover:underline">View all</Link>
          </div>
          {projects.loading ? <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
            : !projects.data?.projects.length ? <Empty icon={<FolderKanban className="h-6 w-6" />} title="No projects yet" body="Start from a prompt or a template." action={<Button size="sm" onClick={() => nav('/templates')} icon={<LayoutTemplate className="h-4 w-4" />}>Browse templates</Button>} />
            : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.data.projects.map((p) => {
                  const I = KIND_ICON[p.kind];
                  return (
                    <Link key={p.id} to={projectLink(p)} className="focus-ring surface-2 flex items-center gap-3 rounded-xl p-3 transition hover:ring-1 hover:ring-forge-500/40">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-forge-500 dark:bg-ink-800"><I className="h-5 w-5" /></div>
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.name}</p><p className="muted text-xs">{p.pages.length} page{p.pages.length === 1 ? '' : 's'} · {timeAgo(p.updatedAt)}</p></div>
                      <Badge>{p.kind}</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between"><h2 className="font-display font-semibold">Credits</h2><Badge tone="forge">{me?.plan.name}</Badge></div>
            <p className="mt-3 font-display text-4xl font-semibold">{me?.credits ?? 0}</p>
            <p className="muted text-xs">DesignForge credits · {used30} used in 30 days</p>
            <div className="mt-4">{usage.data && <BarChart height={60} data={usage.data.usage.map((d) => ({ label: d.day, value: d.credits }))} />}</div>
            <div className="mt-4 flex gap-2"><Button size="sm" variant="secondary" icon={<Coins className="h-4 w-4" />} onClick={() => nav('/credits')}>Buy credits</Button><Button size="sm" variant="ghost" onClick={() => nav('/subscription')}>Upgrade</Button></div>
            <p className="muted mt-3 text-[11px]">Credits are separate from your Google Stitch quota, which is set by Google for your account.</p>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-display font-semibold">Connections</h2>
            {[{ c: stitch, name: 'Google Stitch', role: 'UI & website generation' }, { c: gemini, name: 'Gemini (images)', role: 'Logo Studio' }].map(({ c, name, role }) => (
              <div key={name} className="flex items-center gap-3 py-2">
                {c?.connected ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <AlertTriangle className="h-5 w-5 text-amber-500" />}
                <div className="flex-1"><p className="text-sm font-medium">{name}</p><p className="muted text-xs">{c?.connected ? `Connected · key ${c.keyHint}` : role}</p></div>
                <Link to="/integrations" className="text-xs text-forge-500 hover:underline">{c?.connected ? 'Manage' : 'Connect'}</Link>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
