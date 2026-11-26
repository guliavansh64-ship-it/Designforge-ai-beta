import { memo } from 'react';
import { View } from 'react-native';
import { CheckCircle2, XCircle, Ban } from 'lucide-react-native';
import { FadeInDown, FadeOut } from 'react-native-reanimated';
import { api } from '../lib/api';
import { useColors } from '../lib/theme';
import type { Job } from '../lib/types';
import { Button, Card, Progress, Row, T } from './ui';
import { Animated, Pulse, listLayout, popIn } from './motion';

function JobCardImpl({ job, onDismiss }: { job: Job; onDismiss?: () => void }) {
  const c = useColors();
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(job.status);
  const tone = job.status === 'succeeded' ? c.green : job.status === 'failed' ? c.red : job.status === 'cancelled' ? c.muted : c.primary;
  return (
    <Animated.View entering={FadeInDown.duration(260)} exiting={FadeOut.duration(180)}>
      <Card style={{ gap: 10, borderColor: tone + '55' }}>
        <Row>
          <View style={{ width: 32, alignItems: 'center' }}>
            {/* keyed by status so the icon pops when the state changes */}
            <Animated.View key={job.status} entering={popIn}>
              {job.status === 'succeeded' ? <CheckCircle2 size={22} color={c.green} /> : job.status === 'failed' ? <XCircle size={22} color={c.red} /> : job.status === 'cancelled' ? <Ban size={22} color={c.muted} /> : <Pulse color={c.primary} size={10} />}
            </Animated.View>
          </View>
          <View style={{ flex: 1 }}>
            <T weight="600" style={{ textTransform: 'capitalize' }}>{job.type} · {job.status}</T>
            <Animated.View key={job.stage} entering={FadeInDown.duration(220)}><T muted size={13} numberOfLines={2}>{job.stage}</T></Animated.View>
          </View>
          {!terminal && <T size={13} weight="600" style={{ color: c.primary }}>{Math.round(job.progress)}%</T>}
        </Row>
        {!terminal && <Progress value={job.progress} />}
        {!terminal && job.progress >= 20 && <Animated.View entering={FadeInDown}><T muted size={12}>Stitch usually takes 30–120 s. You can leave — we'll send a notification.</T></Animated.View>}
        {job.error && <Animated.View entering={FadeInDown}><T size={13} style={{ color: c.red }}>{job.error.message}</T></Animated.View>}
        {job.improvementHistory?.map((h, i) => (
          <Animated.View key={h.iteration} entering={FadeInDown.delay(i * 80)}>
            <T size={12} muted>Iteration {h.iteration}: {h.before} → {h.after} (heuristic){h.fixed.length ? ` · fixed: ${h.fixed.join(', ')}` : ''}</T>
          </Animated.View>
        ))}
        <Row style={{ justifyContent: 'space-between' }}>
          <T muted size={12}>{job.creditsReserved} credits{job.status === 'failed' || job.status === 'cancelled' ? ' · refunded' : ''}</T>
          {!terminal ? <Button small variant="secondary" title="Cancel" onPress={() => api.post(`/jobs/${job.id}/cancel`).catch(() => undefined)} /> : onDismiss && <Button small variant="ghost" title="Dismiss" onPress={onDismiss} />}
        </Row>
      </Card>
    </Animated.View>
  );
}

export const JobCard = memo(JobCardImpl);
