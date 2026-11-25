import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { Upload, Wand2 } from 'lucide-react-native';
import { api, newKey, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi, useJob } from '../lib/hooks';
import { useColors } from '../lib/theme';
import type { Job, Project } from '../lib/types';
import { JobCard } from '../components/JobCard';
import { Button, Card, Chip, ErrorBox, Field, Label, Row, T } from '../components/ui';
import { Animated, Appear, Pulse, Swap, popIn } from '../components/motion';
import { FadeInDown } from 'react-native-reanimated';

const STAGES = ['Import / read design', 'Analyse structure', 'Inspect hierarchy & type', 'Inspect spacing, contrast, responsive', 'Build improvement plan', 'Send fixes to Stitch', 'Receive improved screen', 'Re-audit & compare', 'Final result'];

export default function Improve() {
  const { me, refresh } = useAuth();
  const c = useColors();
  const router = useRouter();
  const projects = useApi<{ projects: Project[] }>('/projects?limit=40');
  const eligible = (projects.data?.projects ?? []).filter((p) => p.kind !== 'logo' && p.pages.some((x) => x.currentVersionId));
  const [src, setSrc] = useState<'project' | 'upload'>('project');
  const [pid, setPid] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; b64: string; ext: string } | null>(null);
  const [goals, setGoals] = useState('');
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<ApiError | null>(null);
  const [jobId, setJobId] = useState<string | null>(null); const [resultPid, setResultPid] = useState<string | null>(null);
  const job = useJob(jobId, () => refresh());
  const canAuto = me?.plan.features.includes('auto_improve');
  const maxIt = me?.plan.maxImproveIterations ?? 1;

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/html', 'image/png', 'image/jpeg', 'image/webp'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    if ((a.size ?? 0) > 5 * 1024 * 1024) { setErr(new ApiError(400, 'TOO_BIG', 'Max 5 MB')); return; }
    const ext = '.' + (a.name.split('.').pop() ?? '').toLowerCase();
    setFile({ name: a.name, ext, b64: await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 }) });
  };
  const start = async () => {
    setBusy(true); setErr(null);
    try {
      let projectId = pid; let pageId: string | undefined;
      const body: Record<string, unknown> = { instructions: goals || undefined, autoIterate: !!(auto && canAuto), maxIterations: auto && canAuto ? maxIt : 1, targetScore: 90, idempotencyKey: newKey() };
      if (src === 'upload') {
        if (!file) throw new Error('Choose a file');
        const r = await api.post<{ project: Project }>('/projects', { name: `Improve · ${file.name}`.slice(0, 80), kind: 'improve', deviceType: me?.preferences.defaultDevice ?? 'MOBILE' });
        projectId = r.project.id; pageId = r.project.pages[0].id; Object.assign(body, { importAssetBase64: file.b64, importExt: file.ext });
      } else pageId = eligible.find((p) => p.id === pid)?.pages.find((x) => x.currentVersionId)?.id;
      const { job: j } = await api.post<{ job: Job }>(`/projects/${projectId}/improve`, { ...body, pageId });
      setJobId(j.id); setResultPid(projectId);
    } catch (e) { setErr(e as ApiError); } finally { setBusy(false); }
  };
  const stageIdx = job ? (job.status === 'succeeded' ? 9 : Math.floor(job.progress / 100 * 9)) : -1;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Appear><T muted size={13}>DesignForge audits your design against a transparent checklist, plans fixes, applies them through your Stitch account, then re-audits and shows what changed. Scores are DesignForge heuristics, not objective ratings.</T></Appear>
      <Row><Chip label="From a project" active={src === 'project'} onPress={() => setSrc('project')} /><Chip label="Upload HTML / screenshot" active={src === 'upload'} onPress={() => setSrc('upload')} /></Row>
      <Card index={1} style={{ gap: 10 }}>
        <Swap id={src} style={{ gap: 10 }}>{src === 'project' ? (<><Label>Project</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{eligible.map((p) => <Chip key={p.id} label={p.name} active={pid === p.id} onPress={() => setPid(p.id)} />)}</View>{!eligible.length && <T muted size={13}>No generated designs yet.</T>}</>)
          : <Button variant="secondary" title={file ? file.name : 'Choose file (max 5 MB)'} icon={<Upload size={18} color={c.text} />} onPress={pick} />}</Swap>
        <Label>Goals (optional)</Label><Field multiline value={goals} onChangeText={setGoals} style={{ minHeight: 80 }} placeholder="More premium, better readability on mobile…" />
        <Row style={{ justifyContent: 'space-between' }}><View style={{ flex: 1 }}><T>Auto-iterate (up to {maxIt})</T><T muted size={12}>{canAuto ? 'Stops at target, limit, or no measurable gain' : 'Pro and above'}</T></View><Switch value={auto && !!canAuto} disabled={!canAuto} onValueChange={setAuto} trackColor={{ true: c.primary }} /></Row>
        <ErrorBox error={err} />
        <Button title="Start improvement · 3 cr / iteration" icon={<Wand2 color="#fff" size={18} />} loading={busy} disabled={src === 'project' ? !pid : !file} onPress={start} />
      </Card>
      {job && <JobCard job={job} onDismiss={() => setJobId(null)} />}
      {job && <Card index={2} style={{ gap: 6 }}>{STAGES.map((st, i) => (
        <Animated.View key={st} entering={FadeInDown.delay(i * 50)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 26, alignItems: 'center' }}>
            {i < stageIdx ? <Animated.View entering={popIn}><T size={14} style={{ color: c.green }}>✓</T></Animated.View> : i === stageIdx && job.status !== 'failed' && job.status !== 'cancelled' ? <Pulse color={c.primary} size={7} /> : <T size={13} muted>○</T>}
          </View>
          <T size={13} muted={i > stageIdx} style={i < stageIdx ? { color: c.green } : i === stageIdx ? { fontWeight: '600' } : undefined}>{i + 1}. {st}</T>
        </Animated.View>
      ))}</Card>}
      {job?.status === 'succeeded' && resultPid && <Appear><Button title="Open result (compare in Versions)" onPress={() => router.push(`/project/${resultPid}`)} /></Appear>}
    </ScrollView>
  );
}
