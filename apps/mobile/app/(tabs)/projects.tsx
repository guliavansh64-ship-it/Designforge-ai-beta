import { useCallback, useState } from 'react';
import { showAlert, toast } from '../../components/Dialog';
import { Pressable, RefreshControl, View } from 'react-native';
import { FadeOutLeft } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { FolderKanban, Search, MoreVertical } from 'lucide-react-native';
import { api } from '../../lib/api';
import { useApi, timeAgo } from '../../lib/hooks';
import { useColors } from '../../lib/theme';
import type { Project } from '../../lib/types';
import { Badge, Card, Chip, Empty, ErrorBox, Field, Row, T } from '../../components/ui';
import { Animated, Appear, Pulse, SkeletonList } from '../../components/motion';

export default function Projects() {
  const c = useColors();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'mine' | 'shared' | 'archived'>('mine');
  const qs = new URLSearchParams({ limit: '40', ...(q.length > 1 && { q }), ...(scope === 'archived' && { archived: 'true' }), ...(scope === 'shared' && { shared: 'true' }) }).toString();
  const { data, loading, error, reload } = useApi<{ projects: Project[] }>(`/projects?${qs}`);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  // While something is generating, refresh the list every 5 s so progress and new pages show up.
  const generating = !!data?.projects.some((p) => p.activeJob);
  useFocusEffect(useCallback(() => { if (!generating) return; const t = setInterval(reload, 5000); return () => clearInterval(t); }, [generating, reload]));

  const act = async (fn: () => Promise<unknown>, done?: string) => { try { await fn(); reload(); if (done) toast(done); } catch (e) { showAlert('Error', (e as Error).message); } };
  const menu = (p: Project) => showAlert(p.name, undefined, [
    { text: 'Duplicate', onPress: () => act(() => api.post(`/projects/${p.id}/duplicate`), 'Project duplicated') },
    { text: p.archived ? 'Restore' : 'Archive', onPress: () => act(() => api.patch(`/projects/${p.id}`, { archived: !p.archived }), p.archived ? 'Project restored' : 'Project archived') },
    { text: 'Delete', style: 'destructive', onPress: () => showAlert('Delete permanently?', 'All versions and chat history are deleted. Your Stitch project is not touched.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => act(() => api.del(`/projects/${p.id}`), 'Project deleted') }]) },
    { text: 'Close', style: 'cancel' },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 16, gap: 10 }}>
        <View><Field value={q} onChangeText={setQ} placeholder="Search projects" style={{ paddingLeft: 40 }} /><View style={{ position: 'absolute', left: 12, top: 14 }}><Search size={18} color={c.muted} /></View></View>
        <Row><Chip label="Mine" active={scope === 'mine'} onPress={() => setScope('mine')} /><Chip label="Shared" active={scope === 'shared'} onPress={() => setScope('shared')} /><Chip label="Archived" active={scope === 'archived'} onPress={() => setScope('archived')} /></Row>
        <ErrorBox error={error} />
      </View>
      <Animated.FlatList removeClippedSubviews initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7} data={data?.projects ?? []} keyExtractor={(p) => p.id} contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />}
        ListEmptyComponent={loading ? <SkeletonList rows={4} /> : <Empty icon={<FolderKanban size={32} color={c.primary} />} title="No projects" body="Create one from the Studio tab." />}
        renderItem={({ item: p, index }) => (
          <Animated.View exiting={FadeOutLeft.duration(220)}><Appear index={index}>
            <Card onPress={() => router.push(p.kind === 'logo' ? `/logo?id=${p.id}` : `/project/${p.id}${p.activeJob ? `?job=${p.activeJob.id}` : ''}`)} accessibilityLabel={p.name}><Row>
              <View style={{ flex: 1, gap: 4 }}><T weight="600" numberOfLines={1}>{p.name}</T><Row><Badge label={p.kind} />{p.activeJob ? <Row gap={6}><Pulse color={c.primary} size={8} /><T size={12} style={{ color: c.primary }}>Generating… {p.activeJob.progress}%</T></Row> : p.kind !== 'logo' && !p.pages.some((pg) => pg.currentVersionId) && <Badge label="No design yet" tone="amber" />}<T muted size={12}>{p.pages.length} pages · {timeAgo(p.updatedAt)}</T></Row></View>
              {scope !== 'shared' && <Pressable onPress={() => menu(p)} accessibilityLabel={`Actions for ${p.name}`} hitSlop={12}><MoreVertical size={20} color={c.muted} /></Pressable>}
            </Row></Card>
          </Appear></Animated.View>
        )} />
    </View>
  );
}
