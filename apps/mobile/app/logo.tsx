import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { PenTool, Maximize2, Wand2 } from 'lucide-react-native';
import { api, assetUrl, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useJob } from '../lib/hooks';
import { useColors } from '../lib/theme';
import type { Project, Version } from '../lib/types';
import { JobCard } from '../components/JobCard';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Animated, PressScale, Skeleton, popIn } from '../components/motion';
import { FadeIn } from 'react-native-reanimated';

const STYLES = ['Minimalist', 'Modern', 'Wordmark', 'Icon', 'Emblem', 'Abstract'];

function AssetImage({ url, size, fill }: { url?: string; size: number; fill?: boolean }) {
  const [uri, setUri] = useState<string>();
  useEffect(() => { assetUrl(url).then(setUri); }, [url]);
  const box = fill ? { width: '100%' as const, aspectRatio: 1 } : { width: size, height: size };
  return uri
    ? <Animated.View entering={FadeIn.duration(300)}><Image source={{ uri }} style={{ ...box, borderRadius: 12, backgroundColor: '#fff' }} resizeMode="contain" accessibilityLabel="Logo concept" /></Animated.View>
    : <View style={{ ...box, borderRadius: 12, overflow: 'hidden' }}><Skeleton height={fill ? 400 : size} radius={12} /></View>;
}

export default function Logo() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const [pid, setPid] = useState<string | undefined>(id);
  const [brand, setBrand] = useState(''); const [industry, setIndustry] = useState(''); const [colors, setColors] = useState('');
  const [styles, setStyles] = useState<string[]>(['Minimalist', 'Icon']);
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<Version[]>([]);
  const stitch = me?.connections.find((x) => x.provider === 'stitch');
  const allowed = me?.plan.features.includes('logo_studio');

  const load = async (p: string) => {
    const [{ project }, { versions }] = await Promise.all([api.get<{ project: Project }>(`/projects/${p}`), api.get<{ versions: Version[] }>(`/projects/${p}/versions?limit=50`)]);
    const heads = new Set(project.pages.map((x) => x.currentVersionId));
    const list = versions.filter((v) => v.source === 'logo' && heads.has(v.id));
    setConcepts(list);
    if (!brand) setBrand(project.name.replace(/ brand$/i, ''));
  };
  useEffect(() => { if (pid) load(pid).catch((e) => setErr(e)); /* eslint-disable-next-line */ }, [pid]);
  // Coming back from the full logo page: pick up any logo the user changed there.
  const seen = useRef(false);
  useFocusEffect(useCallback(() => { if (seen.current && pid) load(pid).catch(() => undefined); seen.current = true; /* eslint-disable-next-line */ }, [pid]));
  const job = useJob(jobId, (j) => { refresh(); if (j.status === 'succeeded' && pid) load(pid).catch((e) => setErr(e)); });
  const running = job && !['succeeded', 'failed', 'cancelled'].includes(job.status);

  const generate = async () => {
    setBusy(true); setErr(null);
    try {
      let p = pid;
      if (!p) { const r = await api.post<{ project: Project }>('/projects', { name: `${brand} brand`, kind: 'logo', deviceType: 'AGNOSTIC' }); p = r.project.id; setPid(p); }
      const { job: j } = await api.post<{ job: { id: string } }>(`/projects/${p}/logos`, { brandName: brand, industry, styles, colorHints: colors || undefined, count, idempotencyKey: newKey() });
      setJobId(j.id);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      {!allowed && <ErrorBox error={Object.assign(new Error('Logo Studio is available on Pro and above.'), { action: 'upgrade_plan' }) as any} />}
      {allowed && !stitch?.connected && <ErrorBox error={Object.assign(new Error('Connect your Stitch key to generate logos.'), { action: 'open_integrations' }) as any} />}
      {concepts.length > 0 && pid && (
        <Card index={1} style={{ gap: 12 }}>
          <Row><T weight="700" style={{ flex: 1 }}>Your logos</T><T muted size={12}>Tap one to open it</T></Row>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {concepts.map((v, i) => (
              <Animated.View key={v.id} entering={popIn.delay(i * 70)} style={{ width: '47%' }}>
                <PressScale onPress={() => router.push({ pathname: '/logo-view/[id]', params: { id: pid, v: v.id } })} scaleTo={0.95} accessibilityLabel={`Open logo concept ${i + 1}`}
                  style={{ borderRadius: 16, borderWidth: 1, borderColor: c.border, backgroundColor: c.card2, padding: 8, gap: 8 }}>
                  <AssetImage url={v.imageUrl} size={0} fill />
                  <Row gap={6}><T size={12} weight="600" style={{ flex: 1 }}>Concept {i + 1}</T><Wand2 size={14} color={c.primary} /><Maximize2 size={14} color={c.muted} /></Row>
                </PressScale>
              </Animated.View>
            ))}
          </View>
        </Card>
      )}
      {job && <JobCard job={job} onDismiss={() => setJobId(null)} />}
      <Card index={2} style={{ gap: 10 }}>
        <Label>Brand name</Label><Field value={brand} onChangeText={setBrand} maxLength={40} placeholder="Kora" />
        <Label>Industry</Label><Field value={industry} onChangeText={setIndustry} maxLength={60} placeholder="Organic skincare" />
        <Label>Colours (optional)</Label><Field value={colors} onChangeText={setColors} maxLength={120} placeholder="sage green and cream" />
        <Label>Styles</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{STYLES.map((s) => <Chip key={s} label={s} active={styles.includes(s)} onPress={() => setStyles(styles.includes(s) ? styles.filter((x) => x !== s) : [...styles, s])} />)}</View>
        <Label>Concepts</Label><Row>{[1, 2, 3, 4].map((n) => <Chip key={n} label={String(n)} active={count === n} onPress={() => setCount(n)} />)}</Row>
        <ErrorBox error={err} />
        <Button title={`Generate · ${4 * Math.ceil(count / 2)} cr`} icon={<PenTool color="#fff" size={18} />} loading={busy} disabled={!allowed || !stitch?.connected || !!running || !brand.trim() || industry.trim().length < 2 || !styles.length} onPress={generate} />
        {!allowed && <Button variant="ghost" title="See plans" onPress={() => router.push('/billing')} />}
      </Card>
    </ScrollView>
  );
}
