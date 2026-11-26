import { memo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { CheckCircle2, ChevronDown, ChevronUp, Circle, Loader, Sparkles, XCircle } from 'lucide-react-native';
import { FadeInDown } from 'react-native-reanimated';
import { useColors } from '../lib/theme';
import type { DesignPlan } from '../lib/types';
import { Badge, Row, T } from './ui';
import { Animated } from './motion';

/**
 * Shows what the prompt enhancer produced: app name, shared theme (swatches + fonts) and the screen
 * list. With `done`/`active`, each screen also shows its generation state (used inside JobCard).
 */
function PlanCardImpl({ plan, done, active, failed, compact }: { plan: DesignPlan; done?: number; active?: boolean; failed?: boolean; compact?: boolean }) {
  const c = useColors();
  const [open, setOpen] = useState(!compact);
  const t = plan.theme;
  return (
    <View style={{ gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}>
      <Row>
        <Sparkles size={16} color={c.primary} />
        <T weight="700" style={{ flex: 1 }} numberOfLines={1}>{plan.appName}</T>
        <Badge label={plan.enhancer === 'gemini' ? 'Enhanced by Gemini' : 'Enhanced (built-in)'} tone={plan.enhancer === 'gemini' ? 'primary' : 'neutral'} />
      </Row>
      <Row style={{ flexWrap: 'wrap' }} gap={6}>
        {[t.primary, t.accent, t.background].map((col, i) => (
          <View key={i} style={{ width: 22, height: 22, borderRadius: 7, backgroundColor: col, borderWidth: 1, borderColor: c.border }} accessibilityLabel={`Theme colour ${col}`} />
        ))}
        <T muted size={12} style={{ flex: 1 }} numberOfLines={2}>{t.dark ? 'Dark' : 'Light'} · {t.headingFont} / {t.bodyFont} · {t.mood}</T>
      </Row>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={open ? 'Hide screens' : 'Show screens'}>
        <Row>
          <T size={13} weight="600" style={{ flex: 1 }}>{plan.screens.length > 1 ? `${plan.screens.length} screens · one shared theme` : '1 screen'}</T>
          {open ? <ChevronUp size={16} color={c.muted} /> : <ChevronDown size={16} color={c.muted} />}
        </Row>
      </Pressable>
      {open && plan.screens.map((s, i) => {
        const state = done === undefined ? 'plan' : i < done ? 'done' : i === done && active ? 'active' : i === done && failed ? 'failed' : 'todo';
        return (
          <Animated.View key={s.name + i} entering={FadeInDown.delay(i * 50).duration(220)}>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ paddingTop: 2 }}>
                {state === 'done' ? <CheckCircle2 size={15} color={c.green} /> : state === 'active' ? <Loader size={15} color={c.primary} /> : state === 'failed' ? <XCircle size={15} color={c.red} /> : <Circle size={15} color={c.muted} />}
              </View>
              <View style={{ flex: 1 }}>
                <T size={13} weight="600">{i + 1}. {s.name}</T>
                {done === undefined && <T muted size={12} numberOfLines={3}>{s.prompt}</T>}
              </View>
            </Row>
          </Animated.View>
        );
      })}
    </View>
  );
}

export const PlanCard = memo(PlanCardImpl);
