import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Server, CheckCircle2, XCircle } from 'lucide-react-native';
import { API_OVERRIDE_ALLOWED, getApiUrl, getBuildApiUrl, onApiUrlChange, setApiUrlOverride, testApiUrl } from '../lib/api';
import { useColors } from '../lib/theme';
import { Button, Card, Field, Row, T } from './ui';
import { Animated, Swap, Pulse, popIn, useShake } from './motion';
import { showAlert, toast } from './Dialog';

/** Current server URL (any build). */
export function useApiUrl() {
  const [url, setUrl] = useState(getApiUrl());
  useEffect(() => onApiUrlChange(setUrl), []);
  return url;
}

type Status = 'idle' | 'checking' | 'ok' | 'down';

/**
 * TEST BUILDS ONLY (EXPO_PUBLIC_ALLOW_API_OVERRIDE=1) — renders nothing in production builds.
 *  - inline (login screen): the URL field is always visible, with a live reachability status.
 *  - compact (settings): shows the URL with a "Change server" button that expands the editor.
 */
export function ServerUrlCard({ index, onChanged, inline }: { index?: number; onChanged?: () => void; inline?: boolean }) {
  const c = useColors();
  const url = useApiUrl();
  const [editing, setEditing] = useState(!!inline);
  const [draft, setDraft] = useState(url);
  const [status, setStatus] = useState<Status>('idle');
  const [err, setErr] = useState<string | null>(null);
  const { style: shakeStyle, shake } = useShake();
  const checked = useRef<string | null>(null);

  // Login screen: silently check the saved/built-in server once so the user sees if it is reachable.
  useEffect(() => {
    if (!API_OVERRIDE_ALLOWED || !inline || !url || checked.current === url) return;
    checked.current = url; setStatus('checking');
    testApiUrl(url).then(() => setStatus('ok')).catch(() => setStatus('down'));
  }, [inline, url]);
  useEffect(() => { setDraft(url); }, [url]);

  if (!API_OVERRIDE_ALLOWED) return null;

  const save = async () => {
    setStatus('checking'); setErr(null);
    try {
      const base = await testApiUrl(draft);
      await setApiUrlOverride(base === getBuildApiUrl() ? null : base);
      checked.current = base; setStatus('ok');
      if (!inline) setEditing(false);
      toast('Server connected');
      onChanged?.();
    } catch (e) { setErr((e as Error).message); setStatus('down'); shake(); }
  };
  const reset = async () => { await setApiUrlOverride(null); setEditing(!!inline); setStatus('idle'); checked.current = null; onChanged?.(); };

  const dirty = draft.trim().replace(/\/+$/, '') !== url;
  const statusRow = (
    <Row gap={6}>
      {status === 'checking' && <><Pulse color={c.amber} size={6} /><T muted size={12}>Checking server…</T></>}
      {status === 'ok' && !dirty && <Animated.View entering={popIn} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><CheckCircle2 size={14} color={c.green} /><T size={12} style={{ color: c.green }}>Server reachable</T></Animated.View>}
      {status === 'down' && !err && <Animated.View entering={popIn} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><XCircle size={14} color={c.red} /><T size={12} style={{ color: c.red }}>Server not reachable. Enter a new URL.</T></Animated.View>}
    </Row>
  );

  return (
    <Card index={index} style={{ gap: 8 }}>
      <Row><Server size={18} color={c.primary} /><T weight="600" style={{ flex: 1 }}>{inline ? 'Server URL' : 'Server (test build)'}</T></Row>
      <Swap id={editing ? 'edit' : 'view'}>
        {editing ? (
          <View style={{ gap: 8 }}>
            <Animated.View style={shakeStyle}>
              <Field value={draft} onChangeText={(t) => { setDraft(t); setErr(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url"
                placeholder="https://your-api.trycloudflare.com" accessibilityLabel="Server URL" returnKeyType="go" onSubmitEditing={save} />
            </Animated.View>
            {err ? <Animated.View entering={popIn}><T size={12} style={{ color: c.red }}>{err}</T></Animated.View> : statusRow}
            <Row>
              <Button small title={dirty || status !== 'ok' ? 'Connect' : 'Re-check'} loading={status === 'checking'} disabled={!draft.trim()} onPress={save} style={{ flex: 1 }} />
              {!inline && <Button small variant="secondary" title="Cancel" onPress={() => { setEditing(false); setErr(null); setDraft(url); }} />}
            </Row>
            {inline && <T muted size={11}>Paste the address of your DesignForge API (Render, a tunnel, or http://PC-IP:8080 on the same Wi-Fi).</T>}
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <T muted size={12} numberOfLines={2}>{url || 'Not set'}{url && url !== getBuildApiUrl() ? '  (custom)' : ''}</T>
            <Row>
              <Button small variant="secondary" title="Change server" onPress={() => { setDraft(url); setEditing(true); }} style={{ flex: 1 }} />
              {url !== getBuildApiUrl() && !!getBuildApiUrl() && <Button small variant="ghost" title="Reset" onPress={() => showAlert('Reset server?', getBuildApiUrl(), [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', onPress: reset }])} />}
            </Row>
          </View>
        )}
      </Swap>
    </Card>
  );
}
