import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Sparkles, Globe, PenTool, Wand2, Coins, Plug, Bell, ChevronRight, CheckCircle2, AlertTriangle } from 'lucide-react-native';
import { useAuth } from '../../lib/auth';
import { useApi, timeAgo } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Badge, Button, Card, Row, T } from '../../components/ui';
import { Animated, Appear, CountUp, Float, PressScale, Skeleton, popIn } from '../../components/motion';
import { Logo } from '../../components/Logo';
import { LinearGradient } from 'expo-linear-gradient';

export default function Dashboard() {
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=5');
  const notifs = useApi<{ unread: number }>('/notifications');
  const ann = useApi<{ announcements: { id: string; title: string; body: string }[] }>('/announcements');
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => { setRefreshing(true); await Promise.all([refresh(), projects.reload(), notifs.reload()]); setRefreshing(false); };
  useFocusEffect(useCallback(() => { projects.reload(); /* eslint-disable-next-line */ }, []));
  const stitch = me?.connections.find((x) => x.provider === 'stitch');

  const actions = [
    { icon: Sparkles, t: 'App UI', to: '/studio?kind=ui', col: c.primary },
    { icon: Globe, t: 'Website', to: '/studio?kind=website', col: '#38bdf8' },
    { icon: PenTool, t: 'Logo', to: '/logo', col: c.ember },
    { icon: Wand2, t: 'Improve', to: '/improve', col: c.green },
  ];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}>
      <Appear><Row style={{ justifyContent: 'space-between' }}>
        <Row gap={12} style={{ flex: 1 }}><Logo size={44} ring={false} /><View style={{ flex: 1 }}><T muted size={13}>Welcome back 👋</T><T size={22} weight="800">{me?.user.displayName?.split(' ')[0] ?? 'Designer'}</T></View></Row>
        <PressScale onPress={() => router.push('/notifications')} accessibilityLabel={`Notifications, ${notifs.data?.unread ?? 0} unread`} style={{ padding: 8 }} scaleTo={0.85}>
          <Bell color={c.text} size={22} />{!!notifs.data?.unread && <Animated.View entering={popIn} style={{ position: 'absolute', right: 6, top: 6, width: 10, height: 10, borderRadius: 5, backgroundColor: c.ember }} />}
        </PressScale>
      </Row></Appear>
      {ann.data?.announcements[0] && <Card index={1} style={{ backgroundColor: c.primary + '1a', borderColor: c.primary + '44' }}><T weight="600" size={14}>{ann.data.announcements[0].title}</T><T muted size={13}>{ann.data.announcements[0].body}</T></Card>}
      {stitch && !stitch.connected && (
        <Card index={1} style={{ borderColor: c.ember + '66', gap: 10 }}>
          <Row><Plug color={c.ember} size={20} /><T weight="600" style={{ flex: 1 }}>{stitch.status === 'invalid' ? 'Your Stitch key needs attention' : 'Connect your Google Stitch account'}</T></Row>
          <T muted size={13}>Generation runs on your own Stitch account and quota. Takes about 2 minutes; disconnect any time.</T>
          <Button title="Connect Stitch" onPress={() => router.push('/integrations')} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {actions.map((a, i) => (
          <Appear key={a.t} index={2 + i} style={{ width: '47%', flexGrow: 1 }}>
            <Card onPress={() => router.push(a.to as any)} accessibilityLabel={a.t} style={{ gap: 18 }}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: a.col + '1f', alignItems: 'center', justifyContent: 'center' }}><a.icon color={a.col} size={24} /></View>
              <T weight="600">{a.t}</T>
            </Card>
          </Appear>
        ))}
      </View>
      <Appear index={6}>
        <PressScale onPress={() => router.push('/billing')} scaleTo={0.97} accessibilityLabel="Plans and credits">
          <LinearGradient colors={[c.primary, '#a855f7', c.ember]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 22, padding: 18, gap: 6 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T size={13} style={{ color: '#ffffffcc' }}>Your credits</T>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: '#ffffff26' }}><T size={12} weight="700" style={{ color: '#fff' }}>{me?.plan.name} plan</T></View>
            </Row>
            <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Row gap={8}><Float amplitude={3}><Coins color="#fff" size={26} /></Float><CountUp value={me?.credits ?? 0} style={{ color: '#fff', fontSize: 34, fontWeight: '800' }} /></Row>
              <Row gap={2}><T size={13} weight="700" style={{ color: '#fff' }}>Plans & credits</T><ChevronRight color="#fff" size={16} /></Row>
            </Row>
          </LinearGradient>
        </PressScale>
      </Appear>
      <Card index={7} style={{ gap: 4 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 6 }}><T weight="600">Recent projects</T><Pressable onPress={() => router.push('/projects')}><T size={13} style={{ color: c.primary }}>All</T></Pressable></Row>
        {projects.loading && !projects.data && <View style={{ gap: 14, paddingVertical: 6 }}>{[0, 1, 2].map((i) => <View key={i} style={{ gap: 6 }}><Skeleton height={14} width="55%" /><Skeleton height={10} width="30%" /></View>)}</View>}
        {projects.data && !projects.data.projects.length && <T muted size={14}>No projects yet — tap App UI or Website to start.</T>}
        {projects.data?.projects.map((p, i) => (
          <Appear key={p.id} index={i}>
            <PressScale scaleTo={0.98} onPress={() => router.push(p.kind === 'logo' ? `/logo?id=${p.id}` : `/project/${p.id}`)} style={{ paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}><T weight="500" numberOfLines={1}>{p.name}</T><T muted size={12}>{p.pages.length} pages · {timeAgo(p.updatedAt)}</T></View><Badge label={p.kind} />
            </PressScale>
          </Appear>
        ))}
      </Card>
      <Card index={8} style={{ gap: 8 }}>
        <T weight="600">Connections</T>
        {me?.connections.map((x) => (
          <Row key={x.provider}>{x.connected ? <CheckCircle2 color={c.green} size={18} /> : <AlertTriangle color={c.amber} size={18} />}<T style={{ flex: 1 }}>{x.provider === 'stitch' ? 'Google Stitch' : 'Gemini'}</T><T muted size={12}>{x.connected ? `…${x.keyHint?.replace('…', '')}` : 'Not connected'}</T></Row>
        ))}
      </Card>
    </ScrollView>
  );
}
