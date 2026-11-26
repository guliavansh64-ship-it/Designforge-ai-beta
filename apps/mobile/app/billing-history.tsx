import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { CheckCircle2, Clock, Coins, ReceiptIndianRupee, RotateCcw, XCircle } from 'lucide-react-native';
import { useApi } from '../lib/hooks';
import { useColors } from '../lib/theme';
import { Badge, Card, Chip, Empty, Row, T } from '../components/ui';
import { Appear, SkeletonList, Swap } from '../components/motion';

interface Payment { id: string; status: string; amountPaise: number; description?: string; invoiceNumber?: string; method?: string; refundStatus?: string; createdAt: number; paidAt?: number }
interface Txn { id: string; type: string; op?: string; reason?: string; amount: number; status: string; createdAt: number }

const fmtDate = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const OP: Record<string, string> = { generate_flash: 'Design generated', generate_pro: 'Design generated', chat_edit: 'Edit', edit: 'Edit', variants: 'Variations', improve_iteration: 'Improve', export_html: 'HTML ZIP export', export_react: 'React export', logo_batch: 'Logo Studio', monthly_allowance: 'Monthly credits', purchase: 'Credits purchased', plan: 'Plan credits', refund: 'Refund', admin: 'Added by support', coupon: 'Promo code' };

/** Plans & credits → History: every payment (UPI) and every credit movement. */
export default function BillingHistory() {
  const c = useColors();
  const [tab, setTab] = useState<'payments' | 'credits'>('payments');
  const s = useApi<{ payments: Payment[]; transactions: Txn[] }>('/billing/summary');
  const pays = s.data?.payments ?? [];
  const txns = s.data?.transactions ?? [];
  const statusOf = (p: Payment) => (p.refundStatus ? 'refunded' : p.status);
  const tone = (st: string) => (st === 'paid' || st === 'success' ? 'green' : st === 'failed' ? 'red' : st === 'refunded' ? 'primary' : 'amber') as 'green' | 'red' | 'primary' | 'amber';
  const Icon = (st: string) => (st === 'paid' || st === 'success' ? CheckCircle2 : st === 'failed' ? XCircle : st === 'refunded' ? RotateCcw : Clock);
  const totalPaid = pays.filter((p) => p.status === 'paid' && !p.refundStatus).reduce((a, p) => a + p.amountPaise, 0) / 100;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={s.loading && !!s.data} onRefresh={s.reload} tintColor={c.primary} />}>
      <Row><Chip label={`Payments${pays.length ? ` · ${pays.length}` : ''}`} active={tab === 'payments'} onPress={() => setTab('payments')} /><Chip label="Credit usage" active={tab === 'credits'} onPress={() => setTab('credits')} /></Row>
      {s.loading && !s.data && <SkeletonList rows={4} />}
      <Swap id={tab} style={{ gap: 10 }}>
        {tab === 'payments' ? (<>
          {pays.length > 0 && <Card style={{ backgroundColor: c.primary + '18', borderColor: c.primary + '44' }}><T muted size={12}>Total paid</T><T size={22} weight="800">₹{totalPaid.toLocaleString('en-IN')}</T></Card>}
          {pays.map((p, i) => {
            const st = statusOf(p); const I = Icon(st);
            return (
              <Appear key={p.id} index={i}><Card style={{ gap: 6 }}>
                <Row>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c[tone(st) === 'primary' ? 'primary' : tone(st)] + '22', alignItems: 'center', justifyContent: 'center' }}><I size={18} color={c[tone(st) === 'primary' ? 'primary' : tone(st)]} /></View>
                  <View style={{ flex: 1 }}><T weight="600" numberOfLines={1}>{p.description ?? 'Payment'}</T><T muted size={12}>{fmtDate(p.paidAt ?? p.createdAt)}</T></View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}><T weight="800">₹{(p.amountPaise / 100).toLocaleString('en-IN')}</T><Badge label={st} tone={tone(st)} /></View>
                </Row>
                {(p.invoiceNumber || p.method) && <T muted size={11}>{[p.invoiceNumber && `Invoice ${p.invoiceNumber}`, p.method && `via ${p.method.toUpperCase()}`].filter(Boolean).join(' · ')}</T>}
                <T muted size={10}>Order {p.id}</T>
              </Card></Appear>
            );
          })}
          {s.data && !pays.length && <Empty icon={<ReceiptIndianRupee size={32} color={c.primary} />} title="No payments yet" body="Plan and credit purchases will appear here." />}
        </>) : (<>
          {txns.map((t, i) => (
            <Appear key={t.id} index={i}><Card style={{ paddingVertical: 12 }}><Row>
              <Coins size={18} color={t.type === 'debit' ? c.ember : c.green} />
              <View style={{ flex: 1 }}><T size={14}>{OP[t.op ?? ''] ?? OP[t.reason ?? ''] ?? (t.op ?? t.reason ?? t.type).replace(/_/g, ' ')}</T><T muted size={11}>{fmtDate(t.createdAt)}{t.status === 'refunded' ? ' · refunded' : ''}</T></View>
              <T weight="700" style={{ color: t.type === 'debit' && t.status !== 'refunded' ? c.ember : c.green }}>{t.type === 'debit' ? '−' : '+'}{Math.abs(t.amount)}</T>
            </Row></Card></Appear>
          ))}
          {s.data && !txns.length && <Empty icon={<Coins size={32} color={c.primary} />} title="No credit activity yet" />}
        </>)}
      </Swap>
    </ScrollView>
  );
}
