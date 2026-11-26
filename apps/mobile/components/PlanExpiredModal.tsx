import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { CalendarX2 } from 'lucide-react-native';
import { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { Animated, Float } from './motion';
import { Button, T } from './ui';

/**
 * Plans are prepaid (UPI, no auto-debit), so they never renew on their own. When the server reports
 * the plan as expired we show this pop-up (at most once a day) until the user renews.
 */
export function PlanExpiredModal() {
  const { me } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sub = me?.subscription;
  const expired = !!sub && sub.planId !== 'free' && sub.planId !== 'lifetime' && (sub.status === 'expired' || (!!sub.currentPeriodEnd && sub.currentPeriodEnd < Date.now()));
  const planName = sub?.planId ? sub.planId[0].toUpperCase() + sub.planId.slice(1) : 'Your';
  const seenKey = `df.expiredSeen.${me?.user.uid}.${sub?.currentPeriodEnd ?? 0}`;

  useEffect(() => {
    if (!expired) { setOpen(false); return; }
    AsyncStorage.getItem(seenKey).then((v) => {
      if (!v || Date.now() - Number(v) > 24 * 3600_000) { setOpen(true); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined); }
    }).catch(() => setOpen(true));
  }, [expired, seenKey]);

  const close = () => { setOpen(false); AsyncStorage.setItem(seenKey, String(Date.now())).catch(() => undefined); };
  if (!open) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={close} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(200)} style={{ flex: 1, backgroundColor: '#000000aa', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Animated.View entering={ZoomIn.springify().damping(14)} style={{ width: '100%', maxWidth: 380, backgroundColor: c.card, borderRadius: 24, padding: 22, gap: 14, borderWidth: 1, borderColor: c.ember + '66', alignItems: 'center' }}>
          <Float amplitude={5}><View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.ember + '22', alignItems: 'center', justifyContent: 'center' }}><CalendarX2 size={30} color={c.ember} /></View></Float>
          <T size={20} weight="800" style={{ textAlign: 'center' }}>Your plan has expired</T>
          <T muted style={{ textAlign: 'center' }}>
            {planName} plan ended{sub?.currentPeriodEnd ? ` on ${new Date(sub.currentPeriodEnd).toDateString()}` : ''}. Plans don't renew automatically — please renew it again to keep your monthly credits and features.
          </T>
          <Button title="Renew now" style={{ alignSelf: 'stretch' }} onPress={() => { close(); router.push('/billing'); }} />
          <Button title="Later" variant="ghost" small onPress={close} />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
