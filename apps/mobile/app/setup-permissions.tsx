import { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, Linking, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { BatteryCharging, Bell, CheckCircle2, Rocket, Zap, ShieldAlert } from 'lucide-react-native';
import { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useAuth } from '../lib/auth';
import { setStep } from '../lib/onboarding';
import { notificationPermission, registerForPush } from '../lib/push';
import {
  isBatteryOptimizationIgnored,
  requestIgnoreBatteryOptimizations,
  openAutostartSettings,
  isBackgroundRestricted,
} from '../lib/permissions';
import { useColors } from '../lib/theme';
import { Button, Card, Row, T } from '../components/ui';
import { Animated, Orbs, popIn } from '../components/motion';

const BRAND: [RegExp, string][] = [
  [/xiaomi|redmi|poco/i, 'App info → Autostart ON · Battery saver → No restrictions'],
  [/oppo|realme|oneplus/i, 'App info → Battery → Allow background activity & auto launch'],
  [/vivo|iqoo/i, 'App info → Battery → Allow background power · enable Autostart'],
  [/samsung/i, 'App info → Battery → Unrestricted'],
  [/huawei|honor/i, 'App launch → Designo → Manage manually (all ON)'],
];

/** Screen 3 of the first-run flow: notifications, battery and background permissions. */
export default function SetupPermissions() {
  const { me } = useAuth();
  const c = useColors();
  const [notif, setNotif] = useState<string>('undetermined');
  const [battery, setBattery] = useState(false);
  const [autostart, setAutostart] = useState(false);
  const [autostartOpened, setAutostartOpened] = useState(false);

  const tip = BRAND.find(([re]) => re.test(`${Device.manufacturer ?? ''} ${Device.brand ?? ''}`))?.[1];

  const check = useCallback(async () => {
    // 1. Verify notification permission from system
    try {
      const st = await notificationPermission();
      setNotif(st);
    } catch {
      // Keep existing state
    }

    // 2. Verify battery optimization status from system
    if (Platform.OS === 'android') {
      try {
        const isIgnored = await isBatteryOptimizationIgnored();
        setBattery(Boolean(isIgnored));
      } catch {
        setBattery(false);
      }

      // 3. Verify background restriction status
      try {
        const restricted = await isBackgroundRestricted();
        if (restricted) {
          // If background is restricted by user in settings, un-tick autostart
          setAutostart(false);
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    check();
    const s = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        check();
      }
    });
    // Also periodically verify permissions while on screen
    const interval = setInterval(check, 2500);
    return () => {
      s.remove();
      clearInterval(interval);
    };
  }, [check]);

  const allowNotif = async () => {
    const t = await registerForPush({ prompt: true }).catch(() => null);
    const st = await notificationPermission();
    setNotif(st);
    if (st !== 'granted' && !t) {
      Linking.openSettings();
    } else if (st === 'granted') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  };

  const allowBattery = async () => {
    // Must NOT tick immediately on click! Only verify from system.
    await requestIgnoreBatteryOptimizations();
    // Re-check system status
    setTimeout(async () => {
      const isIgnored = await isBatteryOptimizationIgnored();
      setBattery(Boolean(isIgnored));
      if (isIgnored) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      }
    }, 500);
  };

  const allowAutostart = async () => {
    // Open settings without automatically ticking
    setAutostartOpened(true);
    await openAutostartSettings();
  };

  const confirmAutostart = async () => {
    const restricted = await isBackgroundRestricted();
    if (restricted) {
      Alert.alert(
        'Background Restricted',
        'Background activity is still restricted for Designo in system settings. Please set Battery to Unrestricted / Allow background power.',
        [
          { text: 'Open Settings', onPress: openAutostartSettings },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
      return;
    }

    Alert.alert(
      'Confirm Autostart Enabled',
      tip
        ? `Have you enabled Autostart / Background power in settings?\n\n(${tip})`
        : 'Have you enabled Autostart / Background power for Designo in settings?',
      [
        {
          text: 'Not Yet',
          style: 'cancel',
          onPress: () => {
            openAutostartSettings();
          },
        },
        {
          text: 'Yes, Enabled',
          onPress: () => {
            setAutostart(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
          },
        },
      ]
    );
  };

  const allGranted = notif === 'granted' && (Platform.OS !== 'android' || (battery && autostart));

  const finish = () => {
    if (!allGranted) {
      Alert.alert(
        'Mandatory Permissions',
        'All permissions are mandatory so Designo can notify you when your designs are ready. Please enable Notifications, Battery (No restrictions), and Autostart/Background activity to continue.'
      );
      return;
    }
    if (me) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setStep(me.user.uid, 'done');
    }
  };

  const items = [
    {
      icon: Bell,
      title: 'Notifications',
      body: 'Know when your design is ready — even when the app is closed.',
      done: notif === 'granted',
      cta: 'Allow',
      onPress: allowNotif,
      color: c.primary,
    },
    ...(Platform.OS === 'android'
      ? [
          {
            icon: BatteryCharging,
            title: 'Battery: no restrictions',
            body: 'Find Designo in the list and choose “Don’t optimise / Allow / Unrestricted”, so notifications aren’t blocked.',
            done: battery,
            cta: 'Open',
            onPress: allowBattery,
            color: c.green,
          },
          {
            icon: Zap,
            title: 'Run in background / Autostart',
            body: tip ?? 'App info → Battery → allow background activity & enable Autostart.',
            done: autostart,
            cta: autostartOpened ? 'Confirm' : 'Open',
            onPress: autostartOpened ? confirmAutostart : allowAutostart,
            color: c.ember,
          },
        ]
      : []),
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
          <T muted>So Designo can notify you the moment your designs are ready.</T>
          <Row gap={6} style={{ marginTop: 4 }}>
            <ShieldAlert size={14} color={c.amber} />
            <T size={12} weight="600" style={{ color: c.amber }}>All permissions are mandatory</T>
          </Row>
        </Animated.View>

        {items.map((it, i) => (
          <Animated.View key={it.title} entering={FadeInDown.delay(160 + i * 120).springify().damping(16)}>
            <Card style={{ gap: 12, borderWidth: 1, borderColor: it.done ? c.green + '88' : c.border }}>
              <Row gap={12}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: it.color + '22', alignItems: 'center', justifyContent: 'center' }}>
                  <it.icon size={22} color={it.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Row gap={6}>
                    <T weight="700">{it.title}</T>
                    <T size={11} style={{ color: it.done ? c.green : c.amber, fontWeight: '600' }}>
                      {it.done ? 'Enabled' : 'Required'}
                    </T>
                  </Row>
                  <T muted size={12}>{it.body}</T>
                </View>
                {it.done ? (
                  <Animated.View entering={ZoomIn.springify()}>
                    <CheckCircle2 size={26} color={c.green} />
                  </Animated.View>
                ) : (
                  <Button small title={it.cta} onPress={it.onPress} />
                )}
              </Row>
            </Card>
          </Animated.View>
        ))}

        <View style={{ flex: 1 }} />

        {!allGranted && (
          <T muted size={12} style={{ textAlign: 'center', color: c.amber }}>
            Please enable all required permissions above to continue.
          </T>
        )}

        <Animated.View entering={FadeInDown.delay(600).springify()}>
          <Button
            title="Open Designo"
            icon={<Rocket size={18} color="#fff" />}
            disabled={!allGranted}
            onPress={finish}
          />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}
