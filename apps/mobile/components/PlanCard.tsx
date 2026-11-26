import { memo } from 'react';
import { View } from 'react-native';
import { CheckCircle2, Circle, Loader, Sparkles, XCircle } from 'lucide-react-native';
import { FadeInDown } from 'react-native-reanimated';
import { useColors } from '../lib/theme';
import { Row, T } from './ui';
import { Animated } from './motion';

/**
 * Screen-by-screen progress of a generation. Shows only screen NAMES — the enhanced prompts are
 * internal and are sent only to Stitch.
 */
function ScreenProgressImpl({ appName, names, done, active, failed }: { appName?: string; names: string[]; done: number; active?: boolean; failed?: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
      <Row><Sparkles size={16} color={c.primary} /><T weight="700" style={{ flex: 1 }} numberOfLines={1}>{appName ?? 'Your design'}</T><T muted size={12}>{names.length > 1 ? `${names.length} screens` : '1 screen'}</T></Row>
      {names.map((n, i) => {
        const state = i < done ? 'done' : i === done && active ? 'active' : i === done && failed ? 'failed' : 'todo';
        return (
          <Animated.View key={n + i} entering={FadeInDown.delay(i * 50).duration(220)}>
            <Row>
              {state === 'done' ? <CheckCircle2 size={15} color={c.green} /> : state === 'active' ? <Loader size={15} color={c.primary} /> : state === 'failed' ? <XCircle size={15} color={c.red} /> : <Circle size={15} color={c.muted} />}
              <T size={13} weight={state === 'active' ? '700' : '500'} style={{ flex: 1 }}>{i + 1}. {n}</T>
            </Row>
          </Animated.View>
        );
      })}
    </View>
  );
}
export const ScreenProgress = memo(ScreenProgressImpl);
