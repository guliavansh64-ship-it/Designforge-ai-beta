import { useEffect } from 'react';
import { RefreshControl } from 'react-native';
import { Bell } from 'lucide-react-native';
import { api } from '../lib/api';
import { useApi, timeAgo } from '../lib/hooks';
import { useColors } from '../lib/theme';
import { Card, Empty, Row, T } from '../components/ui';
import { Animated, SkeletonList, listLayout } from '../components/motion';

export default function Notifications() {
  const c = useColors();
  const { data, loading, reload } = useApi<{ notifications: { id: string; title: string; body: string; read: boolean; createdAt: number }[] }>('/notifications');
  useEffect(() => { api.post('/notifications/read', {}).catch(() => undefined); }, []);
  return (
    <Animated.FlatList itemLayoutAnimation={listLayout} data={data?.notifications ?? []} keyExtractor={(n) => n.id} contentContainerStyle={{ padding: 16, gap: 8 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />}
      ListEmptyComponent={loading ? <SkeletonList rows={4} /> : <Empty icon={<Bell size={32} color={c.primary} />} title="You're all caught up" />}
      renderItem={({ item: n, index }) => (
        <Card index={index} style={{ borderColor: n.read ? c.border : c.primary + '66' }}><Row style={{ justifyContent: 'space-between' }}><T weight="600" style={{ flex: 1 }}>{n.title}</T><T muted size={11}>{timeAgo(n.createdAt)}</T></Row><T muted size={13}>{n.body}</T></Card>
      )} />
  );
}
