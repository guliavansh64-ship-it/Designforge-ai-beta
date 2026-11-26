import { useState } from 'react';
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Users, CreditCard, Ticket, LayoutTemplate, Settings, Megaphone, LifeBuoy, AlertOctagon, ScrollText, ArrowLeft, Package, Search, Shield, BellRing } from 'lucide-react';
import { DEFAULT_PLANS, type PlanDefinition } from '@designforge/shared';
import { api, newKey, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useApi, useDebounced, inr, timeAgo } from '../../lib/hooks';
import { useToast } from '../../lib/toast';
import { Badge, BarChart, Button, Card, ErrorBox, Logo, Modal, PageHeader, Spinner, Toggle, cx } from '../../components/ui';

const NAV = [
  { to: '', label: 'Overview', icon: BarChart3, end: true }, { to: 'users', label: 'Users', icon: Users }, { to: 'plans', label: 'Plans', icon: Package },
  { to: 'payments', label: 'Payments', icon: CreditCard }, { to: 'coupons', label: 'Coupons', icon: Ticket }, { to: 'templates', label: 'Templates', icon: LayoutTemplate },
  { to: 'announcements', label: 'Announcements', icon: Megaphone }, { to: 'push', label: 'Push notifications', icon: BellRing }, { to: 'tickets', label: 'Support', icon: LifeBuoy }, { to: 'errors', label: 'Failed jobs', icon: AlertOctagon },
  { to: 'audit', label: 'Audit log', icon: ScrollText }, { to: 'settings', label: 'Settings', icon: Settings },
];

export default function Admin() {
  const { me } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex h-full flex-col bg-ink-50 dark:bg-ink-950 lg:flex-row">
      <aside className="shrink-0 border-b border-ink-200 bg-white dark:border-ink-850 dark:bg-ink-900 lg:w-60 lg:border-b-0 lg:border-r">
        <div className="flex h-16 items-center justify-between px-5"><Logo /><Badge tone="red"><Shield className="h-3 w-3" />Admin</Badge></div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-sm', isActive ? 'bg-forge-500/10 font-medium text-forge-600 dark:text-white' : 'muted hover:bg-ink-100 dark:hover:bg-ink-850')}><n.icon className="h-4 w-4" />{n.label}</NavLink>)}
          <button onClick={() => nav('/')} className="mt-4 flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm muted hover:bg-ink-100 dark:hover:bg-ink-850"><ArrowLeft className="h-4 w-4" />Back to app</button>
        </nav>
        <p className="muted hidden px-5 pb-5 text-[11px] lg:block">Role: <b>{me?.user.adminRole}</b>. All actions are audit-logged.</p>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <Routes>
          <Route index element={<Overview />} /><Route path="users" element={<UsersPage />} /><Route path="users/:uid" element={<UserDetail />} />
          <Route path="plans" element={<Plans />} /><Route path="payments" element={<Payments />} /><Route path="coupons" element={<Coupons />} />
          <Route path="templates" element={<TemplatesAdmin />} /><Route path="announcements" element={<Announcements />} /><Route path="push" element={<PushPage />} /><Route path="tickets" element={<Tickets />} />
          <Route path="errors" element={<Errors />} /><Route path="audit" element={<AuditLog />} /><Route path="settings" element={<SystemSettings />} />
        </Routes>
      </div></main>
    </div>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => <Card className="p-4"><p className="muted text-xs">{label}</p><p className="mt-1 font-display text-2xl font-semibold">{value}</p>{sub && <p className="muted text-[11px]">{sub}</p>}</Card>;
const useAct = () => { const toast = useToast(); return async (fn: () => Promise<unknown>, ok: string, after?: () => void) => { try { await fn(); toast('success', ok); after?.(); } catch (e) { toast('error', (e as Error).message); } }; };

function Overview() {
  const { data, loading, error } = useApi<any>('/admin/stats');
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const d = data.daily as any[];
  return (
    <div>
      <PageHeader title="Overview" subtitle="Platform health and revenue. Counts are computed from Firestore aggregates." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Users" value={data.users.toLocaleString('en-IN')} sub={`${data.newRegistrations30d} new in 30d`} /><Stat label="Active (7d)" value={data.activeUsers7d} />
        <Stat label="Paid subscribers" value={data.paidSubscribers} /><Stat label="Projects" value={data.projects.toLocaleString('en-IN')} />
        <Stat label="Revenue (month)" value={`₹${data.revenueMonthInr.toLocaleString('en-IN')}`} /><Stat label="Revenue (year)" value={`₹${data.revenueYearInr.toLocaleString('en-IN')}`} />
        <Stat label="Generations OK" value={data.generationsSucceeded.toLocaleString('en-IN')} sub={`${data.generationsFailed} failed`} /><Stat label="Success rate" value={`${data.successRate}%`} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5"><p className="mb-3 text-sm font-medium">Registrations (30d)</p><BarChart data={d.map((x) => ({ label: x.day, value: x.registrations ?? 0 }))} /></Card>
        <Card className="p-5"><p className="mb-3 text-sm font-medium">Revenue ₹ (30d)</p><BarChart data={d.map((x) => ({ label: x.day, value: (x.revenue_paise ?? 0) / 100 }))} format={(n) => `₹${n}`} /></Card>
        <Card className="p-5"><p className="mb-3 text-sm font-medium">Generations (30d)</p><BarChart data={d.map((x) => ({ label: x.day, value: Object.entries(x).filter(([k]) => k.startsWith('gen_success')).reduce((s, [, v]) => s + Number(v), 0) }))} /></Card>
      </div>
    </div>
  );
}

function UsersPage() {
  const nav = useNavigate();
  const [q, setQ] = useState(''); const [status, setStatus] = useState('');
  const dq = useDebounced(q, 350);
  const { data, loading } = useApi<{ users: any[] }>(`/admin/users?${new URLSearchParams({ ...(dq && { q: dq }), ...(status && { status }) })}`);
  return (
    <div>
      <PageHeader title="Users" />
      <div className="mb-4 flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 muted" /><input className="field !pl-9" placeholder="Search by email prefix" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="field !w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
      <Card className="overflow-x-auto">{loading ? <div className="p-6"><Spinner /></div> : (
        <table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">User</th><th className="p-3">Status</th><th className="p-3">Joined</th><th className="p-3">Last seen</th></tr></thead>
          <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{data?.users.map((u) => (
            <tr key={u.id} className="cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-850" onClick={() => nav(u.id)}><td className="p-3"><p className="font-medium">{u.displayName ?? '—'}</p><p className="muted text-xs">{u.email}</p></td>
              <td className="p-3"><Badge tone={u.status === 'suspended' ? 'red' : 'green'}>{u.status ?? 'active'}</Badge></td><td className="p-3 text-xs">{timeAgo(u.createdAt)}</td><td className="p-3 text-xs">{timeAgo(u.lastSeenAt)}</td></tr>
          ))}</tbody></table>)}
      </Card>
    </div>
  );
}

function UserDetail() {
  const { uid } = useParams();
  const act = useAct();
  const { data, loading, reload } = useApi<any>(`/admin/users/${uid}`);
  const [modal, setModal] = useState<'credits' | 'plan' | 'status' | 'delete' | null>(null);
  const [f, setF] = useState<any>({});
  if (loading || !data) return <Spinner />;
  const close = () => { setModal(null); setF({}); reload(); };
  return (
    <div>
      <PageHeader title={data.user.displayName ?? data.user.email} subtitle={data.user.email} actions={<>
        <Button variant="secondary" onClick={() => setModal('credits')}>Adjust credits</Button><Button variant="secondary" onClick={() => setModal('plan')}>Set plan</Button>
        <Button variant="secondary" onClick={() => { setF({ status: data.user.status === 'suspended' ? 'active' : 'suspended' }); setModal('status'); }}>{data.user.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Button>
        <Button variant="danger" onClick={() => setModal('delete')}>Delete</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Plan" value={data.plan?.name ?? '—'} sub={data.subscription?.status} /><Stat label="Credits" value={data.credits} /><Stat label="Projects" value={data.projectCount} /><Stat label="Status" value={data.user.status ?? 'active'} /></div>
      <Card className="mt-4 p-5"><p className="mb-2 text-sm font-medium">Connections (credentials are never shown)</p>{data.connections.map((c: any) => <p key={c.provider} className="text-sm">{c.provider}: <Badge tone={c.connected ? 'green' : 'neutral'}>{c.status}</Badge> {c.keyHint && <span className="muted text-xs">…{c.keyHint.replace('…', '')}</span>}</p>)}</Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5"><p className="mb-2 text-sm font-medium">Credit transactions</p>{(data.transactions ?? []).slice(0, 20).map((t: any) => <p key={t.id} className="flex justify-between text-xs"><span>{t.op ?? t.reason ?? t.type} · {t.status}</span><span>{t.type === 'debit' ? '−' : '+'}{Math.abs(t.amount)}</span></p>)}{!data.transactions?.length && <p className="muted text-xs">None</p>}</Card>
        <Card className="p-5"><p className="mb-2 text-sm font-medium">Payments</p>{(data.payments ?? []).map((p: any) => <p key={p.id} className="flex justify-between text-xs"><span>{p.description} · {p.status}</span><span>{inr(p.amountPaise)}</span></p>)}{!data.payments?.length && <p className="muted text-xs">None</p>}</Card>
      </div>
      <Modal open={modal === 'credits'} onClose={() => setModal(null)} title="Adjust credits">
        <input type="number" className="field" placeholder="Amount (negative to deduct)" onChange={(e) => setF({ ...f, amount: parseInt(e.target.value, 10) })} />
        <input className="field mt-2" placeholder="Reason (required, audit-logged)" onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="mt-4 flex justify-end"><Button disabled={!f.amount || !f.reason || f.reason.length < 3} onClick={() => act(() => api.post(`/admin/users/${uid}/credits`, { amount: f.amount, reason: f.reason, ref: newKey() }), 'Credits adjusted', close)}>Apply</Button></div>
      </Modal>
      <Modal open={modal === 'plan'} onClose={() => setModal(null)} title="Set plan manually">
        <select className="field" defaultValue="" onChange={(e) => setF({ ...f, planId: e.target.value })}><option value="" disabled>Plan…</option>{DEFAULT_PLANS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="number" className="field mt-2" placeholder="Days (0 = no expiry for lifetime/free)" onChange={(e) => setF({ ...f, days: parseInt(e.target.value, 10) })} />
        <input className="field mt-2" placeholder="Reason" onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="mt-4 flex justify-end"><Button disabled={!f.planId || f.days == null || isNaN(f.days) || !f.reason} onClick={() => act(() => api.post(`/admin/users/${uid}/subscription`, f), 'Plan updated', close)}>Apply</Button></div>
      </Modal>
      <Modal open={modal === 'status'} onClose={() => setModal(null)} title={f.status === 'suspended' ? 'Suspend user' : 'Reactivate user'}>
        <input className="field" placeholder="Reason" onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="mt-4 flex justify-end"><Button variant={f.status === 'suspended' ? 'danger' : 'primary'} disabled={!f.reason} onClick={() => act(() => api.post(`/admin/users/${uid}/status`, f), 'Status updated', close)}>Confirm</Button></div>
      </Modal>
      <Modal open={modal === 'delete'} onClose={() => setModal(null)} title="Delete user">
        <p className="text-sm">Deletes the user's account and data. Payment records are retained. This is irreversible.</p>
        <input className="field mt-3" placeholder="Reason (min 5 chars)" onChange={(e) => setF({ ...f, reason: e.target.value })} />
        <div className="mt-4 flex justify-end"><Button variant="danger" disabled={!f.reason || f.reason.length < 5} onClick={() => act(() => api.del(`/admin/users/${uid}`, { reason: f.reason }), 'User deleted', () => history.back())}>Delete</Button></div>
      </Modal>
    </div>
  );
}

function Plans() {
  const act = useAct();
  const { data, reload } = useApi<{ plans: (PlanDefinition & { razorpayPlanIds?: { monthly?: string; annual?: string } })[] }>('/admin/plans');
  const [edit, setEdit] = useState<any>(null);
  const FEATS = ['ui_generation', 'website_studio', 'logo_studio', 'html_export', 'react_export', 'auto_improve', 'variants', 'pro_model', 'priority_queue', 'project_sharing'];
  const num = (k: string, label: string) => <label className="block"><span className="label">{label}</span><input type="number" className="field" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>;
  return (
    <div>
      <PageHeader title="Plans" subtitle="Prices are in INR (whole rupees). Changes apply to new purchases; for auto-renew, create matching Razorpay Plans and paste their IDs." />
      <div className="grid gap-4 md:grid-cols-2">{data?.plans.map((p) => (
        <Card key={p.id} className="p-5"><div className="flex items-center justify-between"><p className="font-display font-semibold">{p.name}</p><Badge tone={p.active ? 'green' : 'neutral'}>{p.active ? 'active' : 'hidden'}</Badge></div>
          <p className="muted mt-1 text-xs">₹{p.priceInrMonthly}/mo · ₹{p.priceInrAnnual}/yr{p.priceInrOneTime ? ` · ₹${p.priceInrOneTime} once` : ''} · {p.monthlyCredits || p.oneTimeCredits} credits · {p.maxProjects} projects</p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEdit({ ...p })}>Edit</Button></Card>
      ))}</div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name}`} wide>
        {edit && (<div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Name</span><input className="field" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label><label><span className="label">Tagline</span><input className="field" value={edit.tagline} onChange={(e) => setEdit({ ...edit, tagline: e.target.value })} /></label></div>
          <div className="grid gap-3 sm:grid-cols-4">{num('priceInrMonthly', '₹ monthly')}{num('priceInrAnnual', '₹ annual')}{num('priceInrOneTime', '₹ one-time')}{num('maxProjects', 'Max projects')}{num('monthlyCredits', 'Credits / month')}{num('annualCredits', 'Credits / year')}{num('oneTimeCredits', 'One-time credits')}{num('maxImproveIterations', 'Improve iterations')}</div>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Razorpay plan id (monthly)</span><input className="field" value={edit.razorpayPlanIds?.monthly ?? ''} onChange={(e) => setEdit({ ...edit, razorpayPlanIds: { ...edit.razorpayPlanIds, monthly: e.target.value || undefined } })} /></label><label><span className="label">Razorpay plan id (annual)</span><input className="field" value={edit.razorpayPlanIds?.annual ?? ''} onChange={(e) => setEdit({ ...edit, razorpayPlanIds: { ...edit.razorpayPlanIds, annual: e.target.value || undefined } })} /></label></div>
          <div><span className="label">Features</span><div className="flex flex-wrap gap-1.5">{FEATS.map((ft) => <button key={ft} type="button" onClick={() => setEdit({ ...edit, features: edit.features.includes(ft) ? edit.features.filter((x: string) => x !== ft) : [...edit.features, ft] })} className={cx('rounded-full border px-2.5 py-1 text-xs', edit.features.includes(ft) ? 'border-forge-500 bg-forge-500/15' : 'border-ink-200 muted dark:border-ink-700')}>{ft}</button>)}</div></div>
          <div className="flex items-center gap-2"><Toggle checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" /><span className="text-sm">Visible to customers</span></div>
          <div className="flex justify-end"><Button onClick={() => { const { id, updatedAt, ...body } = edit; act(() => api.put(`/admin/plans/${id}`, body), 'Plan saved', () => { setEdit(null); reload(); }); }}>Save plan</Button></div>
        </div>)}
      </Modal>
    </div>
  );
}

function Payments() {
  const act = useAct();
  const [status, setStatus] = useState('');
  const { data, reload } = useApi<{ payments: any[] }>(`/admin/payments${status ? `?status=${status}` : ''}`);
  const [refund, setRefund] = useState<any>(null); const [reason, setReason] = useState('');
  return (
    <div>
      <PageHeader title="Payments" actions={<select className="field !w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="paid">Paid</option><option value="failed">Failed</option><option value="created">Pending</option><option value="refunded">Refunded</option></select>} />
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">Date</th><th className="p-3">Order</th><th className="p-3">Description</th><th className="p-3">Amount</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{data?.payments.map((p) => (
          <tr key={p.id}><td className="p-3 text-xs">{new Date(p.createdAt).toLocaleString('en-IN')}</td><td className="p-3 font-mono text-[11px]">{p.id}</td><td className="p-3">{p.description}</td><td className="p-3">{inr(p.amountPaise)}</td>
            <td className="p-3"><Badge tone={p.status === 'paid' ? 'green' : p.status === 'failed' ? 'red' : 'neutral'}>{p.status}</Badge></td><td className="p-3 text-right">{p.status === 'paid' && <Button size="sm" variant="ghost" onClick={() => setRefund(p)}>Refund</Button>}</td></tr>
        ))}</tbody></table></Card>
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Issue refund">
        <p className="text-sm">Full refund of {refund && inr(refund.amountPaise)} via Razorpay. Credits granted by this order are reversed where possible.</p>
        <input className="field mt-3" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex justify-end"><Button variant="danger" disabled={reason.length < 3} onClick={() => act(() => api.post(`/admin/payments/${refund.id}/refund`, { reason }), 'Refund requested', () => { setRefund(null); setReason(''); reload(); })}>Refund</Button></div>
      </Modal>
    </div>
  );
}

function Coupons() {
  const act = useAct();
  const { data, reload } = useApi<{ coupons: any[] }>('/admin/coupons');
  const [f, setF] = useState<any>({ code: '', type: 'percent', value: 10, maxRedemptions: 0, appliesTo: [], active: true });
  return (
    <div>
      <PageHeader title="Coupons" subtitle="Percent/flat discounts apply to one-time plan payments; credit codes are redeemed in Credits." />
      <Card className="mb-4 grid gap-2 p-4 sm:grid-cols-6">
        <input className="field sm:col-span-2" placeholder="CODE" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <select className="field" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="percent">% off</option><option value="flat">₹ off</option><option value="credits">Credits</option></select>
        <input type="number" className="field" placeholder="Value" value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} />
        <input type="number" className="field" placeholder="Max uses (0=∞)" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: Number(e.target.value) })} />
        <Button disabled={f.code.length < 3 || f.value <= 0} onClick={() => { const { code, ...body } = f; act(() => api.put(`/admin/coupons/${code}`, body), 'Coupon saved', () => { reload(); setF({ ...f, code: '' }); }); }}>Save</Button>
      </Card>
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">Code</th><th className="p-3">Type</th><th className="p-3">Value</th><th className="p-3">Used</th><th className="p-3">Active</th></tr></thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{data?.coupons.map((c) => (
          <tr key={c.id}><td className="p-3 font-mono">{c.id}</td><td className="p-3">{c.type}</td><td className="p-3">{c.type === 'percent' ? `${c.value}%` : c.type === 'flat' ? `₹${c.value}` : `${c.value} cr`}</td><td className="p-3">{c.redeemed}/{c.maxRedemptions || '∞'}</td>
            <td className="p-3"><Toggle checked={c.active} label="Active" onChange={(v) => act(() => api.put(`/admin/coupons/${c.id}`, { type: c.type, value: c.value, maxRedemptions: c.maxRedemptions ?? 0, appliesTo: c.appliesTo ?? [], active: v, expiresAt: c.expiresAt }), v ? 'Activated' : 'Deactivated', reload)} /></td></tr>
        ))}</tbody></table></Card>
    </div>
  );
}

function TemplatesAdmin() {
  const act = useAct();
  const { data, reload } = useApi<{ templates: any[] }>('/admin/templates');
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Templates" subtitle="Seed defaults with `npm run seed`. Uploaded HTML is audited automatically." actions={<Button onClick={() => setEdit({ id: 'tpl_' + newKey().slice(0, 10), name: '', category: 'SaaS', description: '', kind: 'website', deviceType: 'DESKTOP', featured: false, published: true, tags: [] })}>New template</Button>} />
      <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">Name</th><th className="p-3">Category</th><th className="p-3">Score</th><th className="p-3">Uses</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
        <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{data?.templates.map((t) => (
          <tr key={t.id}><td className="p-3 font-medium">{t.name}</td><td className="p-3">{t.category}</td><td className="p-3">{t.qualityScore ?? '—'}</td><td className="p-3">{t.uses ?? 0}</td><td className="p-3">{t.published ? <Badge tone="green">published</Badge> : <Badge>draft</Badge>}{t.featured && <Badge tone="forge" className="ml-1">featured</Badge>}</td>
            <td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ ...t })}>Edit</Button><Button size="sm" variant="ghost" className="!text-red-600" onClick={() => window.confirm('Delete template?') && act(() => api.del(`/admin/templates/${t.id}`), 'Deleted', reload)}>Delete</Button></td></tr>
        ))}</tbody></table></Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Template" wide>
        {edit && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3"><input className="field" placeholder="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /><input className="field" placeholder="Category" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
            <select className="field" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="website">Website</option><option value="ui">App UI</option></select></div>
          <input className="field" placeholder="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <textarea className="field min-h-[160px] font-mono text-xs" placeholder="Full HTML document (leave empty to keep current)" value={edit.html ?? ''} onChange={(e) => setEdit({ ...edit, html: e.target.value })} />
          <div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><Toggle checked={edit.published} onChange={(v) => setEdit({ ...edit, published: v })} label="Published" />Published</label><label className="flex items-center gap-2"><Toggle checked={edit.featured} onChange={(v) => setEdit({ ...edit, featured: v })} label="Featured" />Featured</label></div>
          <div className="flex justify-end"><Button onClick={() => { const { id, uses, qualityScore, updatedAt, createdAt, thumbnailUrl, accent, dark, ...b } = edit; if (!b.html) delete b.html; act(() => api.put(`/admin/templates/${id}`, b), 'Template saved', () => { setEdit(null); reload(); }); }}>Save</Button></div>
        </div>}
      </Modal>
    </div>
  );
}

function Announcements() {
  const act = useAct();
  const { data, reload } = useApi<{ announcements: any[] }>('/admin/announcements');
  const [f, setF] = useState({ title: '', body: '', level: 'info' });
  return (
    <div>
      <PageHeader title="Announcements" subtitle="Shown as a banner in web and mobile apps." />
      <Card className="mb-4 space-y-2 p-4"><input className="field" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /><textarea className="field" placeholder="Body" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="flex justify-between"><select className="field !w-40" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option></select>
          <Button disabled={f.title.length < 3 || f.body.length < 3} onClick={() => act(() => api.post('/admin/announcements', { ...f, active: true }), 'Published', () => { reload(); setF({ title: '', body: '', level: 'info' }); })}>Publish</Button></div></Card>
      <div className="space-y-2">{data?.announcements.map((a) => <Card key={a.id} className="flex items-center gap-3 p-4"><div className="flex-1"><p className="font-medium">{a.title}</p><p className="muted text-sm">{a.body}</p></div><Toggle checked={a.active} label="Active" onChange={(v) => act(() => api.patch(`/admin/announcements/${a.id}`, { active: v }), 'Updated', reload)} /></Card>)}</div>
    </div>
  );
}

function PushPage() {
  const toast = useToast();
  const { data, reload } = useApi<{ campaigns: any[] }>('/admin/push');
  const empty = { title: '', body: '', audience: 'all', planId: 'pro', user: '', link: 'none' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const send = async () => {
    if (f.audience !== 'user' && !confirm(`Send this push to ${f.audience === 'all' ? 'ALL users' : `all ${f.planId} users`}?`)) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ users: number; devices: number; failed: number }>('/admin/push', { title: f.title, body: f.body, audience: f.audience, planId: f.audience === 'plan' ? f.planId : undefined, user: f.audience === 'user' ? f.user : undefined, link: f.link });
      toast('success', `Sent to ${r.users} user(s) · ${r.devices} device(s) reached${r.failed ? ` · ${r.failed} failed` : ''}`);
      setF(empty); reload();
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title="Push notifications" subtitle="Manual push to phones (+ in-app inbox). Automatic pushes — design ready, generation failed, payment success/failed, low credits, plan expiring — are sent by the server on their own." />
      <ErrorBox error={err} className="mb-4" />
      <Card className="mb-4 space-y-3 p-4">
        <input className="field" placeholder="Title (e.g. New templates are live 🎉)" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="field" placeholder="Message" maxLength={500} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        <div className="grid gap-2 sm:grid-cols-3">
          <select className="field" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="all">All users</option><option value="plan">Users on a plan</option><option value="user">One user</option></select>
          {f.audience === 'plan' && <select className="field" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}><option value="free">Free</option><option value="pro">Pro</option><option value="premium">Premium</option><option value="lifetime">Lifetime</option></select>}
          {f.audience === 'user' && <input className="field" placeholder="User email or uid" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} />}
          <select className="field" value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })}><option value="none">Tap opens: Notifications</option><option value="studio">Tap opens: Studio</option><option value="billing">Tap opens: Plans & credits</option><option value="projects">Tap opens: Projects</option></select>
        </div>
        <div className="flex justify-end"><Button loading={busy} icon={<BellRing className="h-4 w-4" />} disabled={f.title.trim().length < 2 || f.body.trim().length < 2 || (f.audience === 'user' && !f.user.trim())} onClick={send}>Send push</Button></div>
      </Card>
      <h2 className="mb-2 font-display font-semibold">Recent pushes</h2>
      <div className="space-y-2">{data?.campaigns.map((c) => <Card key={c.id} className="flex items-center gap-3 p-4"><div className="flex-1"><p className="font-medium">{c.title}</p><p className="muted text-sm">{c.body}</p><p className="muted text-xs">{c.audience === 'plan' ? `Plan: ${c.planId}` : c.audience === 'user' ? `User: ${c.user}` : 'All users'} · {timeAgo(c.createdAt)}</p></div><Badge>{c.users} users · {c.devices} devices</Badge></Card>)}
        {!data?.campaigns.length && <p className="muted text-sm">No pushes sent yet.</p>}</div>
    </div>
  );
}

function Tickets() {
  const act = useAct();
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi<{ tickets: any[] }>(`/admin/tickets${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState<any>(null); const [msg, setMsg] = useState(''); const [next, setNext] = useState('pending');
  return (
    <div>
      <PageHeader title="Support tickets" actions={<select className="field !w-40" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="open">Open</option><option value="pending">Pending</option><option value="resolved">Resolved</option></select>} />
      <div className="space-y-2">{data?.tickets.map((t) => <Card key={t.id} className="flex cursor-pointer items-center gap-3 p-4 hover:ring-1 hover:ring-forge-500/40" onClick={() => setOpen(t)}><div className="flex-1"><p className="font-medium">{t.subject}</p><p className="muted text-xs">{t.email} · {t.type} · {timeAgo(t.updatedAt)}</p></div><Badge>{t.status}</Badge></Card>)}
        {!data?.tickets.length && <p className="muted text-sm">No tickets.</p>}</div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? ''}>
        <div className="max-h-72 space-y-2 overflow-y-auto">{open?.messages.map((m: any, i: number) => <div key={i} className={cx('rounded-xl p-3 text-sm', m.from === 'user' ? 'surface-2' : 'bg-forge-500/10')}><p className="whitespace-pre-wrap">{m.text}</p><p className="muted text-[10px]">{m.from} · {timeAgo(m.at)}</p></div>)}</div>
        <textarea className="field mt-3" placeholder="Reply" value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="mt-3 flex justify-between"><select className="field !w-40" value={next} onChange={(e) => setNext(e.target.value)}><option value="pending">→ Pending</option><option value="resolved">→ Resolved</option><option value="open">→ Open</option></select>
          <Button disabled={!msg.trim()} onClick={() => act(() => api.post(`/admin/tickets/${open.id}/reply`, { message: msg, status: next }), 'Reply sent', () => { setOpen(null); setMsg(''); reload(); })}>Send</Button></div>
      </Modal>
    </div>
  );
}

function Errors() {
  const { data } = useApi<{ errors: any[] }>('/admin/errors');
  return (<div><PageHeader title="Failed jobs" subtitle="Recent generation failures (no prompts' secrets or credentials are stored)." />
    <Card className="divide-y divide-ink-100 dark:divide-ink-850">{data?.errors.map((e) => <div key={e.id} className="p-4 text-sm"><div className="flex justify-between"><Badge tone="red">{e.error?.code}</Badge><span className="muted text-xs">{timeAgo(e.createdAt ?? e.updatedAt)}</span></div><p className="mt-1">{e.error?.message}</p><p className="muted text-xs">{e.type} · {e.ownerId}</p></div>)}{!data?.errors.length && <p className="muted p-6 text-sm">No failures 🎉</p>}</Card></div>);
}

function AuditLog() {
  const { data } = useApi<{ logs: any[] }>('/admin/audit-logs');
  return (<div><PageHeader title="Admin audit log" subtitle="Append-only record of privileged actions." />
    <Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs muted"><tr><th className="p-3">When</th><th className="p-3">Actor</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Details</th></tr></thead>
      <tbody className="divide-y divide-ink-100 dark:divide-ink-850">{data?.logs.map((l) => <tr key={l.id}><td className="p-3 text-xs">{new Date(l.at).toLocaleString('en-IN')}</td><td className="p-3 font-mono text-[11px]">{l.actorUid}</td><td className="p-3"><Badge>{l.action}</Badge></td><td className="p-3 font-mono text-[11px]">{l.target}</td><td className="p-3 font-mono text-[11px] muted">{JSON.stringify(l.details).slice(0, 120)}</td></tr>)}</tbody></table></Card></div>);
}

function SystemSettings() {
  const act = useAct();
  const { data, reload } = useApi<{ settings: any }>('/admin/settings');
  const [s, setS] = useState<any>(null);
  const cur = s ?? data?.settings;
  if (!cur) return <Spinner />;
  const set = (k: string, v: unknown) => setS({ ...cur, [k]: v });
  return (
    <div className="max-w-3xl">
      <PageHeader title="System settings" />
      <div className="space-y-4">
        <Card className="space-y-3 p-5"><p className="font-medium">Branding</p>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className="label">Platform name</span><input className="field" value={cur.platformName ?? ''} onChange={(e) => set('platformName', e.target.value)} /></label><label><span className="label">Primary colour</span><input className="field" value={cur.primaryColor ?? ''} onChange={(e) => set('primaryColor', e.target.value)} /></label>
            <label><span className="label">Support email</span><input className="field" value={cur.supportEmail ?? ''} onChange={(e) => set('supportEmail', e.target.value)} /></label><label><span className="label">Terms URL</span><input className="field" value={cur.termsUrl ?? ''} onChange={(e) => set('termsUrl', e.target.value)} /></label></div></Card>
        <Card className="space-y-3 p-5"><div className="flex items-center justify-between"><div><p className="font-medium">Maintenance mode</p><p className="muted text-xs">Blocks new generations and payments; admins keep access.</p></div><Toggle checked={!!cur.maintenanceMode} onChange={(v) => set('maintenanceMode', v)} label="Maintenance" /></div>
          <input className="field" placeholder="Maintenance message" value={cur.maintenanceMessage ?? ''} onChange={(e) => set('maintenanceMessage', e.target.value)} /></Card>
        <Card className="p-5"><p className="mb-3 font-medium">Feature flags</p>{Object.entries(cur.featureFlags ?? {}).map(([k, v]) => <div key={k} className="flex items-center justify-between py-1.5 text-sm"><span>{k}</span><Toggle checked={!!v} label={k} onChange={(nv) => set('featureFlags', { ...cur.featureFlags, [k]: nv })} /></div>)}</Card>
        <Card className="p-5"><p className="mb-3 font-medium">Limits</p><div className="grid gap-3 sm:grid-cols-3">{Object.entries(cur.limits ?? {}).map(([k, v]) => <label key={k}><span className="label">{k}</span><input type="number" className="field" value={v as number} onChange={(e) => set('limits', { ...cur.limits, [k]: Number(e.target.value) })} /></label>)}</div></Card>
        <div className="flex justify-end"><Button onClick={() => { const { updatedAt, ...body } = cur; act(() => api.put('/admin/settings', body), 'Settings saved', () => { setS(null); reload(); }); }}>Save settings</Button></div>
      </div>
    </div>
  );
}

export type { ApiError };
