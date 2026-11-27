import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { BatteryCharging, Bell, CheckCircle2, Lock, Rocket, Zap } from 'lucide-react-native';
import { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { setStep } from '../lib/onboarding';
import { allGranted, readPermissions, type PermState } from '../lib/permissions';
import { registerForPush } from '../lib/push';
import { useColors } from '../lib/theme';
import { Power } from '../modules/designo-power';
import { Button, Card, Row, T } from '../components/ui';
import { Animated, Orbs, Pulse, popIn, useShake } from '../components/motion';
import { toast } from '../components/Dialog';

const BRAND: [RegExp, string][] = [
  [/xiaomi|redmi|poco/i, 'Also turn Autostart ON for Designo.'],
  [/oppo|realme|oneplus/i, 'Also allow “Auto launch” for Designo.'],
  [/vivo|iqoo/i, 'Also enable Autostart / background start for Designo.'],
  [/huawei|honor/i, 'Also set App launch → Designo → Manage manually.'],
];

/** Screen 3 of the first-run flow. ALL permissions are mandatory and verified with Android. */
export default function SetupPermissions() {
  const { me } = useAuth();
  const c = useColors();
  const [p, setP] = useState<PermState>({ notifications: false, battery: false, background: false });
  const [checked, setChecked] = useState(false);
  const { style: shakeStyle, shake } = useShake();
  const tip = BRAND.find(([re]) => re.test(`${Device.manufacturer ?? ''} ${Device.brand ?? ''}`))?.[1];

  const check = useCallback(async () => { const s = await readPermissions(); setP(s); setChecked(true); return s; }, []);
  useEffect(() => {
    check();
    // Re-check every time the user comes back from Android settings.
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') setTimeout(check, 300); });
    return () => sub.remove();
  }, [check]);

  const allowNotif = async () => {
    await registerForPush({ prompt: true }).catch(() => null);
    const s = await check();
    if (!s.notifications) Linking.openSettings(); // already denied once → only Android settings can enable it
  };
  const allowBattery = () => { if (!Power?.requestIgnoreBatteryOptimizations()) Linking.openSettings(); };
  const allowBackground = () => { if (!Power?.openAppDetails()) Linking.openSettings(); };
  const ok = allGranted(p);
  const finish = async () => {
    const s = await check();
    if (!allGranted(s)) {
      shake(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      toast('Please allow all permissions first', 'warning');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    if (me) setStep(me.user.uid, 'done');
  };

  const items = [
    { key: 'notifications', icon: Bell, title: 'Notifications', body: 'Know when your design is ready — even when the app is closed.', done: p.notifications, onPress: allowNotif, color: c.primary },
    ...(Platform.OS === 'android' ? [
      { key: 'battery', icon: BatteryCharging, title: 'Battery: unrestricted', body: 'Tap Allow, then choose “Allow” in the pop-up (or set Designo to “Don’t optimise / Unrestricted”).', done: p.battery, onPress: allowBattery, color: c.green },
      { key: 'background', icon: Zap, title: 'Background activity', body: `App info → Battery → allow background activity.${tip ? ` ${tip}` : ''}`, done: p.background, onPress: allowBackground, color: c.ember },
    ] : []),
  ];
  const left = items.filter((i) => !i.done).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Orbs />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40, flexGrow: 1 }}>
        <Animated.View entering={popIn} style={{ gap: 6, marginTop: 8 }}>
          <Row>{[0, 1, 2].map((n) => <View key={n} style={{ height: 6, flex: 1, borderRadius: 3, backgroundColor: c.primary }} />)}</Row>
          <T muted size={12}>Step 3 of 3</T>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(60).springify()} style={{ gap: 6 }}>
          <T size={26} weight="800">Allow permissions</T>
          <T muted>All three are required so Designo can notify you the moment your designs are ready. A tick appears only when Android confirms the setting is on.</T>
        </Animated.View>
        {items.map((it, i) => (
          <Animated.View key={it.key} entering={FadeInDown.delay(160 + i * 120).springify().damping(16)}>
            <Card style={{ gap: 12, borderWidth: 1, borderColor: it.done ? c.green + '88' : c.amber + '55' }}>
              <Row gap={12}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: it.color + '22', alignItems: 'center', justifyContent: 'center' }}><it.icon size={22} color={it.color} /></View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}><T weight="700">{it.title}</T>{!it.done && <T size={10} weight="800" style={{ color: c.amber }}>REQUIRED</T>}</Row>
                  <T muted size={12}>{it.body}</T>
                </View>
                {it.done
                  ? <Animated.View key="ok" entering={ZoomIn.springify()}><CheckCircle2 size={28} color={c.green} /></Animated.View>
                  : <Button small title="Allow" onPress={it.onPress} />}
              </Row>
              {!it.done && checked && <Row gap={6}><Pulse color={c.amber} size={8} /><T size={11} style={{ color: c.amber }}>Not enabled yet</T></Row>}
            </Card>
          </Animated.View>
        ))}
        {Platform.OS === 'android' && Power && (
          <Pressable onPress={() => Power?.openAutostartSettings()} hitSlop={8} style={{ alignSelf: 'center' }}>
            <T size={12} style={{ color: c.primary }}>Open Autostart settings (Xiaomi, Oppo, Vivo, Realme…)</T>
          </Pressable>
        )}
        <View style={{ flex: 1 }} />
        <Animated.View entering={FadeInDown.delay(600).springify()} style={shakeStyle}>
          <Button title={ok ? 'Open Designo' : `Allow ${left} more permission${left === 1 ? '' : 's'}`} icon={ok ? <Rocket size={18} color="#fff" /> : <Lock size={18} color="#fff" />} disabled={!ok} onPress={finish} />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
