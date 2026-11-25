import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PenTool, Download, Info } from 'lucide-react-native';
import { api, assetUrl, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useJob } from '../lib/hooks';
import { useColors } from '../lib/theme';
import type { Project, Version } from '../lib/types';
import { JobCard } from '../components/JobCard';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Animated, PressScale, Skeleton, popIn } from '../components/motion';
import { FadeIn, FadeInDown } from 'react-native-reanimated';

const STYLES = ['Minimalist', 'Modern', 'Wordmark', 'Icon', 'Emblem', 'Abstract'];

function AssetImage({ url, size }: { url?: string; size: number }) {
  const [uri, setUri] = useState<string>();
  useEffect(() => { assetUrl(url).then(setUri); }, [url]);
  return uri ? <Animated.View entering={FadeIn.duration(300)}><Image source={{ uri }} style={{ width: size, height: size, borderRadius: 12, backgroundColor: '#fff' }} resizeMode="contain" accessibilityLabel="Logo concept" /></Animated.View> : <Skeleton width={size} height={size} radius={12} />;
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
  const [active, setActive] = useState<Version | null>(null);
  const gemini = me?.connections.find((x) => x.provider === 'gemini');
  const allowed = me?.plan.features.includes('logo_studio');

  const load = async (p: string) => {
    const [{ project }, { versions }] = await Promise.all([api.get<{ project: Project }>(`/projects/${p}`), api.get<{ versions: Version[] }>(`/projects/${p}/versions?limit=50`)]);
    const heads = new Set(project.pages.map((x) => x.currentVersionId));
    const list = versions.filter((v) => v.source === 'logo' && heads.has(v.id));
    setConcepts(list); setActive((a) => a ?? list[0] ?? null);
    if (!brand) setBrand(project.name.replace(/ brand$/i, ''));
  };
  useEffect(() => { if (pid) load(pid).catch((e) => setErr(e)); /* eslint-disable-next-line */ }, [pid]);
  const job = useJob(jobId, (j) => { refresh(); if (j.status === 'succeeded' && pid) load(pid); });
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
      <Card index={0}><Row style={{ alignItems: 'flex-start' }}><Info size={18} color="#38bdf8" /><T size={12} muted style={{ flex: 1 }}>Stitch generates UI screens, not logos. Logo Studio uses a separate Gemini image model with your own Gemini key. AI logos are raster; Wordmark concepts also get a true SVG. Check trademarks before commercial use.</T></Row></Card>
      {!allowed && <ErrorBox error={Object.assign(new Error('Logo Studio is available on Pro and above.'), { action: 'upgrade_plan' }) as any} />}
      {allowed && !gemini?.connected && <ErrorBox error={Object.assign(new Error('Connect your Gemini key to generate logos.'), { action: 'open_integrations' }) as any} />}
      {concepts.length > 0 && (
        <Card index={1} style={{ gap: 12 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {concepts.map((v, i) => <Animated.View key={v.id} entering={popIn.delay(i * 70)}><PressScale onPress={() => setActive(v)} scaleTo={0.92} style={{ borderWidth: 2, borderColor: active?.id === v.id ? c.primary : 'transparent', borderRadius: 14 }}><AssetImage url={v.imageUrl} size={96} /></PressScale></Animated.View>)}
          </ScrollView>
          {active?.logo && (<Animated.View key={active.id} entering={FadeInDown.springify().damping(18)} style={{ gap: 12 }}>
            <Row style={{ justifyContent: 'center', gap: 12 }}>
              <AssetImage url={active.imageUrl} size={140} />
              {active.logo.assets.dark && <View style={{ backgroundColor: '#0a0a0f', borderRadius: 12 }}><AssetImage url={`/api/assets/${active.logo.assets.dark}`} size={140} /></View>}
            </Row>
            <Label>Palette</Label>
            <Row>{active.logo.palette.map((col, i) => <Animated.View key={col} entering={popIn.delay(i * 60)} style={{ alignItems: 'center', gap: 2 }}><View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: col }} /><T size={10} muted>{col}</T></Animated.View>)}</Row>
            <T size={13}><T weight="700" size={13}>{active.logo.typography.heading}</T> + {active.logo.typography.body}</T>
            <T muted size={12}>{active.logo.typography.why}</T>
            <Button title="Download brand kit" icon={<Download color="#fff" size={18} />} onPress={() => api.downloadAndShare('GET', `/versions/${active.id}/brand-kit`, undefined, 'brand-kit.zip').catch((e) => Alert.alert('Error', e.message))} />
          </Animated.View>)}
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
        <Button title={`Generate · ${4 * Math.ceil(count / 2)} cr`} icon={<PenTool color="#fff" size={18} />} loading={busy} disabled={!allowed || !gemini?.connected || !!running || !brand.trim() || industry.trim().length < 2 || !styles.length} onPress={generate} />
        {!allowed && <Button variant="ghost" title="See plans" onPress={() => router.push('/billing')} />}
      </Card>
    </ScrollView>
  );
}
