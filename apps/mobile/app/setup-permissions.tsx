import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { BatteryCharging, Bell, CheckCircle2, Rocket, Zap } from 'lucide-react-native';
import { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { setStep } from '../lib/onboarding';
import { notificationPermission, registerForPush } from '../lib/push';
import { useColors } from '../lib/theme';
import { Button, Card, Row, T } from '../components/ui';
import { Animated, Orbs, popIn } from '../components/motion';

const BRAND: [RegExp, string][] = [
  [/xiaomi|redmi|poco/i, 'App info → Autostart ON · Battery saver → No restrictions'],
  [/oppo|realme|oneplus/i, 'App info → Battery → Allow background activity & auto launch'],
  [/vivo|iqoo/i, 'App info → Battery → Allow background power · enable Autostart'],
  [/samsung/i, 'App info → Battery → Unrestricted'],
  [/huawei|honor/i, 'App launch → DesignForge AI → Manage manually (all ON)'],
];

/** Screen 3 of the first-run flow: notifications, battery and background permissions. */
export default function SetupPermissions() {
  const { me } = useAuth();
  const c = useColors();
  const [notif, setNotif] = useState<string>('undetermined');
  const [battery, setBattery] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const tip = BRAND.find(([re]) => re.test(`${Device.manufacturer ?? ''} ${Device.brand ?? ''}`))?.[1];
  const check = useCallback(() => { notificationPermission().then(setNotif).catch(() => undefined); }, []);
  useEffect(() => { check(); const s = AppState.addEventListener('change', (st) => st === 'active' && check()); return () => s.remove(); }, [check]);

  const allowNotif = async () => {
    const t = await registerForPush({ prompt: true }).catch(() => null);
    const st = await notificationPermission(); setNotif(st);
    if (st !== 'granted' && !t) Linking.openSettings();
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };
  const allowBattery = async () => {
    setBattery(true);
    try { await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'); } catch { Linking.openSettings(); }
  };
  const allowAutostart = () => { setAutostart(true); Linking.openSettings(); };
  const finish = () => { if (me) { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); setStep(me.user.uid, 'done'); } };

  const items = [
    { icon: Bell, title: 'Notifications', body: 'Know when your design is ready — even when the app is closed.', done: notif === 'granted', cta: 'Allow', onPress: allowNotif, color: c.primary },
    ...(Platform.OS === 'android' ? [
      { icon: BatteryCharging, title: 'Battery: no restrictions', body: 'Find DesignForge AI in the list and choose “Don’t optimise / Allow”, so notifications aren’t blocked.', done: battery, cta: 'Open', onPress: allowBattery, color: c.green },
      { icon: Zap, title: 'Run in background / Autostart', body: tip ?? 'App info → Battery → allow background activity.', done: autostart, cta: 'Open', onPress: allowAutostart, color: c.ember },
    ] : []),
  ];

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
          <T muted>So DesignForge can notify you the moment your designs are ready.</T>
        </Animated.View>
        {items.map((it, i) => (
          <Animated.View key={it.title} entering={FadeInDown.delay(160 + i * 120).springify().damping(16)}>
            <Card style={{ gap: 12, borderWidth: 1, borderColor: it.done ? c.green + '88' : c.border }}>
              <Row gap={12}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: it.color + '22', alignItems: 'center', justifyContent: 'center' }}><it.icon size={22} color={it.color} /></View>
                <View style={{ flex: 1 }}><T weight="700">{it.title}</T><T muted size={12}>{it.body}</T></View>
                {it.done ? <Animated.View entering={ZoomIn.springify()}><CheckCircle2 size={26} color={c.green} /></Animated.View> : <Button small title={it.cta} onPress={it.onPress} />}
              </Row>
            </Card>
          </Animated.View>
        ))}
        <View style={{ flex: 1 }} />
        <Animated.View entering={FadeInDown.delay(600).springify()}>
          <Button title="Open DesignForge" icon={<Rocket size={18} color="#fff" />} onPress={finish} />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
