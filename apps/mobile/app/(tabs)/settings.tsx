import { Image, Linking, ScrollView, Switch, View } from 'react-native';
import { showAlert } from '../../components/Dialog';
import { useRouter } from 'expo-router';
import { Plug, CreditCard, Bell, LifeBuoy, LogOut, Trash2, ChevronRight, Shield, Smartphone, BellRing } from 'lucide-react-native';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { registerForPush, unregisterPush } from '../../lib/push';
import { useColors } from '../../lib/theme';
import { Card, Chip, Label, Row, T } from '../../components/ui';
import { Animated, CountUp, PressScale, popIn } from '../../components/motion';
import { ServerUrlCard } from '../../components/ServerUrlCard';

export default function Settings() {
  const { me, logout, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const patch = async (b: Record<string, unknown>) => { try { await api.patch('/me', b); refresh(); } catch (e) { showAlert('Error', (e as Error).message); } };
  const Item = ({ icon: I, label, sub, onPress, danger }: any) => (
    <PressScale onPress={onPress} scaleTo={0.97} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
      <I size={20} color={danger ? c.red : c.text} /><View style={{ flex: 1 }}><T style={danger ? { color: c.red } : undefined}>{label}</T>{sub && <T muted size={12}>{sub}</T>}</View>{!danger && <ChevronRight size={18} color={c.muted} />}
    </PressScale>
  );
  const push = me?.preferences.notificationPrefs?.push ?? true;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card index={0}><Row>
        <Animated.View entering={popIn.delay(100)}>{me?.user.photoURL ? <Image source={{ uri: me.user.photoURL }} style={{ width: 52, height: 52, borderRadius: 26 }} /> : <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: c.primary }} />}</Animated.View>
        <View style={{ flex: 1 }}><T weight="600">{me?.user.displayName}</T><T muted size={13}>{me?.user.email}</T><Row gap={4}><T muted size={12}>{me?.plan.name} plan ·</T><CountUp value={me?.credits ?? 0} style={{ color: c.muted, fontSize: 12 }} /><T muted size={12}>credits</T></Row></View>
      </Row></Card>
      <Card index={1}>
        <Item icon={Plug} label="Integrations" sub="Stitch & Gemini keys (stored encrypted on our server)" onPress={() => router.push('/integrations')} />
        <Item icon={CreditCard} label="Plans & credits" sub="Buy credits or a plan with UPI" onPress={() => router.push('/billing')} />
        <Item icon={Bell} label="Notifications" onPress={() => router.push('/notifications')} />
        <Item icon={LifeBuoy} label="Help & support" onPress={() => router.push('/support')} />
        {me?.user.isAdmin && <Item icon={BellRing} label="Admin · Send push notification" sub="Notify all users, a plan, or one user" onPress={() => router.push('/admin-push')} />}
      </Card>
      <Card index={2} style={{ gap: 12 }}>
        <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><T>Push notifications</T><T muted size={12}>Generation finished/failed, payments, renewals</T></View>
          <Switch value={push} trackColor={{ true: c.primary }} onValueChange={async (v) => { await patch({ preferences: { notificationPrefs: { push: v } } }); v ? registerForPush() : unregisterPush(); }} /></Row>
        <View><Label>Default device</Label><Row>{(['MOBILE', 'TABLET', 'DESKTOP'] as const).map((d) => <Chip key={d} label={d.toLowerCase()} active={me?.preferences.defaultDevice === d} onPress={() => patch({ preferences: { defaultDevice: d } })} />)}</Row></View>
      </Card>
      {/* Developer setting: only admins can see / change the server address. */}
      {me?.user.isAdmin && <ServerUrlCard index={3} onChanged={refresh} />}
      <Card index={3}>
        <Item icon={Smartphone} label="Sign out on all devices" onPress={() => showAlert('Sign out everywhere?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: async () => { await api.post('/me/logout-all').catch(() => undefined); logout(); } }])} />
        <Item icon={Shield} label="Privacy policy" onPress={() => Linking.openURL('https://designforge.app/privacy')} />
        <Item icon={LogOut} label="Sign out" danger onPress={logout} />
        <Item icon={Trash2} label="Delete account" danger onPress={() => showAlert('Delete account?', 'Permanently deletes your projects, versions, connections and credits. Payment records are retained as required by law.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete forever', style: 'destructive', onPress: async () => { try { await api.del('/me', { confirm: 'DELETE' }); logout(); } catch (e) { showAlert('Error', (e as Error).message); } } }])} />
      </Card>
      <T muted size={11} style={{ textAlign: 'center' }}>DesignForge AI · Google Stitch is a Google product; we connect with your authorization.</T>
    </ScrollView>
  );
}
