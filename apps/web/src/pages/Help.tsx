import { useState } from 'react';
import { LifeBuoy, MessageSquarePlus, ChevronDown, Activity, Send } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApi, timeAgo } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, cx } from '../components/ui';

interface Ticket { id: string; subject: string; type: string; status: string; messages: { from: string; text: string; at: number }[]; updatedAt: number }
const FAQ = [
  ['Why do I need my own Stitch account?', 'Google Stitch is a Google product with per-account quotas. DesignForge connects to your account with your explicit authorization, so generations use your quota and your designs live in your Stitch account. We never use a shared key.'],
  ['What are credits for, if Stitch is free?', 'Credits pay for DesignForge itself: the job queue, auditing & improvement engine, version history, editor, exports and hosting. Google\'s Stitch quota is separate.'],
  ['A generation failed. Was I charged?', 'No. Credits are reserved when a job starts and automatically refunded if it fails or you cancel before completion.'],
  ['Why is my Stitch key "invalid" or "no access"?', 'The key may have been deleted/rotated, or your Google account hasn\'t opened Stitch yet. Visit stitch.withgoogle.com once, then reconnect in Integrations.'],
  ['Can Stitch generate logos?', 'No — Stitch generates UI screens. Logo Studio uses a separate Gemini image model with your own Gemini key.'],
  ['Is the quality score objective?', 'No. It\'s the share of DesignForge\'s automated heuristics (contrast, headings, landmarks, spacing, responsiveness…) that pass. Treat it as a checklist.'],
  ['Can I export to Figma?', 'Not currently — there\'s no reliable public API path. You can export HTML or React + TypeScript.'],
  ['How do refunds work for payments?', 'Contact support with your invoice number. Approved refunds are issued through Razorpay to the original payment method.'],
];

export default function Help() {
  const toast = useToast();
  const tickets = useApi<{ tickets: Ticket[] }>('/tickets');
  const status = useApi<{ api: string; maintenance: boolean; generationSuccessRateToday: number | null }>('/status');
  const [faq, setFaq] = useState<number | null>(0);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', type: 'question', message: '' });
  const [err, setErr] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');

  const create = async () => { setErr(null); try { await api.post('/tickets', form); toast('success', 'Ticket created — we usually reply within 1 business day.'); setCreating(false); setForm({ subject: '', type: 'question', message: '' }); tickets.reload(); } catch (e) { setErr(e as ApiError); } };
  const sendReply = async () => { if (!open) return; try { await api.post(`/tickets/${open.id}/reply`, { message: reply }); setReply(''); const r = await api.get<{ tickets: Ticket[] }>('/tickets'); tickets.setData(r); setOpen(r.tickets.find((t) => t.id === open.id) ?? null); } catch (e) { toast('error', (e as Error).message); } };

  return (
    <div>
      <PageHeader title="Help & Support" actions={<Button icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New ticket</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card className="divide-y divide-ink-100 dark:divide-ink-850">
            {FAQ.map(([q, a], i) => (
              <div key={q}><button onClick={() => setFaq(faq === i ? null : i)} className="flex w-full items-center justify-between gap-4 p-4 text-left text-sm font-medium" aria-expanded={faq === i}>{q}<ChevronDown className={cx('h-4 w-4 shrink-0 transition', faq === i && 'rotate-180')} /></button>
                {faq === i && <p className="muted px-4 pb-4 text-sm leading-relaxed">{a}</p>}</div>
            ))}
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-500" /><p className="font-medium">System status</p></div>
            <p className="mt-2 text-sm">{status.data?.maintenance ? <Badge tone="amber">Maintenance</Badge> : <Badge tone="green">{status.data?.api ?? '…'}</Badge>}</p>
            {status.data?.generationSuccessRateToday != null && <p className="muted mt-2 text-xs">Generation success rate today: {status.data.generationSuccessRateToday}%</p>}
          </Card>
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2"><LifeBuoy className="h-4 w-4 text-forge-500" /><p className="font-medium">Your tickets</p></div>
            {!tickets.data?.tickets.length ? <p className="muted text-sm">No tickets yet.</p> : tickets.data.tickets.map((t) => (
              <button key={t.id} onClick={() => setOpen(t)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-850"><span className="flex-1 truncate">{t.subject}</span><Badge tone={t.status === 'resolved' ? 'green' : t.status === 'pending' ? 'amber' : 'forge'}>{t.status}</Badge></button>
            ))}
          </Card>
        </div>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="Contact support">
        <div className="space-y-3">
          <input className="field" placeholder="Subject" maxLength={120} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          <select className="field" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="question">Question</option><option value="bug">Bug report</option><option value="feature">Feature request</option><option value="billing">Billing / refund</option><option value="account">Account</option></select>
          <textarea className="field min-h-[140px]" placeholder="Describe the issue (include steps to reproduce for bugs). Never paste API keys." maxLength={5000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <ErrorBox error={err} />
          <div className="flex justify-end"><Button disabled={form.subject.length < 3 || form.message.length < 10} onClick={create}>Submit</Button></div>
        </div>
      </Modal>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject ?? ''}>
        <div className="max-h-80 space-y-2 overflow-y-auto">{open?.messages.map((m, i) => <div key={i} className={cx('rounded-xl p-3 text-sm', m.from === 'user' ? 'ml-8 bg-forge-500/10' : 'surface-2 mr-8')}><p className="whitespace-pre-wrap">{m.text}</p><p className="muted mt-1 text-[10px]">{m.from === 'user' ? 'You' : 'Support'} · {timeAgo(m.at)}</p></div>)}</div>
        {open?.status !== 'resolved' && <div className="mt-3 flex gap-2"><input className="field" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply…" /><Button onClick={sendReply} disabled={!reply.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button></div>}
      </Modal>
    </div>
  );
}
