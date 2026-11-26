import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import * as Device from 'expo-device';
import { BellRing, BatteryCharging, Settings2 } from 'lucide-react-native';
import { api } from '../lib/api';
import { notificationPermission, registerForPush } from '../lib/push';
import { useColors } from '../lib/theme';
import { showAlert } from './Dialog';
import { Button, Card, Row, T } from './ui';

/**
 * Helps users get pushes while the app is CLOSED. Android shows our pushes itself (the app does not
 * need to run), but some phone brands block apps that were swiped away unless Autostart / "No
 * restrictions" battery mode is allowed. Includes a test push sent 15 s later so it can be checked
 * with the app closed.
 */
const BRAND_TIPS: [RegExp, string][] = [
  [/xiaomi|redmi|poco/i, 'Xiaomi / Redmi / POCO: Settings → Apps → DesignForge AI → Autostart ON, and Battery saver → "No restrictions".'],
  [/oppo|realme|oneplus/i, 'OPPO / Realme / OnePlus: Settings → Apps → DesignForge AI → Battery → "Allow background activity" and "Allow auto launch".'],
  [/vivo|iqoo/i, 'Vivo / iQOO: Settings → Battery → Background power consumption → DesignForge AI → Allow, and enable Autostart.'],
  [/samsung/i, 'Samsung: Settings → Apps → DesignForge AI → Battery → "Unrestricted", and remove it from "Sleeping apps".'],
  [/huawei|honor/i, 'Huawei / Honor: Settings → Battery → App launch → DesignForge AI → Manage manually (all ON).'],
];

export function PushHealthCard({ index = 3 }: { index?: number }) {
  const c = useColors();
  const [perm, setPerm] = useState<string>('undetermined');
  const [busy, setBusy] = useState(false);
  const tip = BRAND_TIPS.find(([re]) => re.test(`${Device.manufacturer ?? ''} ${Device.brand ?? ''}`))?.[1];
  useEffect(() => { notificationPermission().then(setPerm).catch(() => undefined); }, []);

  const test = async () => {
    setBusy(true);
    try {
      const token = await registerForPush({ prompt: true });
      setPerm(await notificationPermission());
      if (!token) { showAlert('Notifications are off', 'Allow notifications for DesignForge AI in your phone settings, then try again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() }]); return; }
      const r = await api.post<{ ok: boolean; queued?: boolean; wait?: boolean; devices?: number }>('/me/push-test');
      if (r.wait) showAlert('Just a moment', 'A test was sent less than 30 seconds ago.');
      else if (!r.ok) showAlert('Not registered yet', 'This phone is not registered for push yet. Make sure you are online and try again.');
      else showAlert('Close the app now', 'Swipe DesignForge AI away from recent apps. A test notification will arrive in about 15 seconds — even though the app is closed.');
    } catch (e) { showAlert('Error', (e as Error).message); } finally { setBusy(false); }
  };
  const battery = async () => {
    try { await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'); } catch { Linking.openSettings(); }
  };

  return (
    <Card index={index} style={{ gap: 10 }}>
      <Row><BellRing size={18} color={c.primary} /><T weight="700" style={{ flex: 1 }}>Notifications when the app is closed</T></Row>
      <T muted size={12}>Pushes are delivered by Android even when DesignForge is closed. {perm === 'granted' ? 'Notifications are allowed ✓' : 'Notifications are not allowed yet.'}</T>
      {tip && <T size={12} style={{ color: c.amber }}>{tip}</T>}
      <Button small title="Send a test notification" icon={<BellRing size={15} color="#fff" />} loading={busy} onPress={test} />
      <Row>
        <View style={{ flex: 1 }}><Button small variant="secondary" title="Battery: allow" icon={<BatteryCharging size={15} color={c.text} />} onPress={battery} /></View>
        <View style={{ flex: 1 }}><Button small variant="secondary" title="App settings" icon={<Settings2 size={15} color={c.text} />} onPress={() => Linking.openSettings()} /></View>
      </Row>
    </Card>
  );
}
