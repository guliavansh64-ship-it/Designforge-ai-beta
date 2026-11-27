import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Code2, FileArchive, FileCode2, FolderDown, Image as ImageIcon, Images, Lock, X } from 'lucide-react-native';
import { api, newKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { Power } from '../modules/designo-power';
import type { Project, Version } from '../lib/types';
import { showAlert, toast } from './Dialog';
import { Badge, Row, T } from './ui';
import { PressScale } from './motion';

const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';

/** Runs a download, then tells the user where the file went (Downloads/Designo). */
export async function saveDownload(method: 'GET' | 'POST', path: string, body: unknown, filename: string, mime: string) {
  const r = await api.download(method, path, body, filename, mime);
  if (r.saved) {
    if (!r.uri || !Power?.openFile) { toast(`Saved to Downloads/Designo · ${r.name}`); return r; }
    {
      showAlert('Downloaded', `${r.name}\nSaved in Downloads › Designo.`, [
        { text: 'OK', style: 'cancel' },
        { text: 'Open', onPress: () => { Power?.openFile?.(r.uri!, mime); } },
      ], 'success');
    }
  }
  return r;
}

type Item = { key: string; title: string; sub: string; icon: React.ReactNode; cost?: number; locked?: string; disabled?: boolean; run: () => Promise<unknown> };

/**
 * Every download for a project in one list. Paid exports respect the plan: if the plan doesn't include
 * an export type it shows a lock and opens the plans screen instead of downloading.
 */
export function DownloadOptions({ project, pageName, version, onDone }: { project: Project; pageName?: string; version: Version | null; onDone?: () => void }) {
  const c = useColors();
  const router = useRouter();
  const { me, refresh } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const designed = project.pages.filter((x) => x.currentVersionId).length;
  const base = `${safe(project.name)}-${safe(pageName ?? 'screen')}`;
  const can = (f: string) => !!me?.plan.features.includes(f);

  const items: { section: string; list: Item[] }[] = [
    {
      section: `This screen${pageName ? ` · ${pageName}` : ''}`,
      list: [
        { key: 'png', title: 'Screenshot (PNG)', sub: 'Free · image of this screen', icon: <ImageIcon size={18} color={c.text} />, disabled: !version?.imageUrl,
          run: () => saveDownload('GET', `/versions/${version!.id}/download?format=png`, null, `${base}.png`, 'image/png') },
        { key: 'html1', title: 'HTML file', sub: 'Free · this screen as one .html file', icon: <FileCode2 size={18} color={c.text} />, disabled: !version,
          run: () => saveDownload('GET', `/versions/${version!.id}/download?format=html`, null, `${base}.html`, 'text/html') },
      ],
    },
    {
      section: `All screens${designed ? ` · ${designed}` : ''}`,
      list: [
        { key: 'shots', title: 'All screenshots (ZIP)', sub: 'Free · every screen as an image, no code', icon: <Images size={18} color={c.text} />, disabled: !designed,
          run: () => saveDownload('GET', `/projects/${project.id}/screenshots`, null, `${safe(project.name)}-screens.zip`, 'application/zip') },
        { key: 'html', title: 'HTML / CSS / JS project (ZIP)', sub: 'Website files for every screen', icon: <FileArchive size={18} color={c.text} />, cost: 1, disabled: !designed,
          locked: can('html_export') ? undefined : 'Upgrade',
          run: async () => { await saveDownload('POST', `/projects/${project.id}/export`, { format: 'html', idempotencyKey: newKey() }, `${safe(project.name)}-html.zip`, 'application/zip'); refresh(); } },
        { key: 'react', title: 'React + TypeScript project (ZIP)', sub: 'Vite app with a component per screen', icon: <Code2 size={18} color={c.text} />, cost: 2, disabled: !designed,
          locked: can('react_export') ? undefined : 'Pro',
          run: async () => { await saveDownload('POST', `/projects/${project.id}/export`, { format: 'react', idempotencyKey: newKey() }, `${safe(project.name)}-react.zip`, 'application/zip'); refresh(); } },
      ],
    },
  ];

  const press = async (it: Item) => {
    if (it.locked) {
      showAlert(`${it.title.replace(/ \(ZIP\)$/, '')} needs ${it.locked === 'Pro' ? 'the Pro plan or higher' : 'a higher plan'}`, 'Your current plan does not include this download. See plans to unlock it.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => { onDone?.(); router.push('/billing'); } },
      ], 'info');
      return;
    }
    if (it.cost && (me?.credits ?? 0) < it.cost) { showAlert('Not enough credits', `This download costs ${it.cost} credit${it.cost > 1 ? 's' : ''}. You have ${me?.credits ?? 0}.`, [{ text: 'OK', style: 'cancel' }, { text: 'Get credits', onPress: () => { onDone?.(); router.push('/billing'); } }], 'warning'); return; }
    setBusy(it.key);
    try { await it.run(); onDone?.(); } catch (e) { showAlert('Download failed', (e as Error).message, undefined, 'error'); } finally { setBusy(null); }
  };

  return (
    <View style={{ gap: 14 }}>
      {items.map((sec) => (
        <View key={sec.section} style={{ gap: 8 }}>
          <T weight="700" size={14}>{sec.section}</T>
          {sec.list.map((it) => (
            <PressScale key={it.key} onPress={() => press(it)} disabled={it.disabled || !!busy} accessibilityLabel={it.title}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: c.card2, borderWidth: 1, borderColor: c.border, opacity: it.disabled ? 0.45 : 1 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primary + '1f' }}>{busy === it.key ? <FolderDown size={18} color={c.primary} /> : it.icon}</View>
              <View style={{ flex: 1 }}>
                <T size={14} weight="600">{busy === it.key ? 'Downloading…' : it.title}</T>
                <T muted size={12}>{it.sub}</T>
              </View>
              {it.locked ? <Row gap={4}><Lock size={13} color={c.amber} /><Badge label={it.locked} tone="amber" /></Row>
                : it.cost ? <Badge label={`${it.cost} cr`} tone="primary" /> : <Badge label="Free" tone="green" />}
            </PressScale>
          ))}
        </View>
      ))}
      <T muted size={11}>Files are saved to your phone’s Downloads › Designo folder. Paid project exports are checked first; you’re only charged if the build check passes.</T>
    </View>
  );
}

/** Bottom sheet version (opened from the download button in the top-right corner). */
export function DownloadSheet({ visible, onClose, ...rest }: { visible: boolean; onClose: () => void; project: Project; pageName?: string; version: Version | null }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <Pressable onPress={() => undefined} style={{ backgroundColor: c.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 16 + insets.bottom, maxHeight: '88%' }}>
          <Row style={{ marginBottom: 10 }}><T weight="800" size={18} style={{ flex: 1 }}>Download</T><PressScale onPress={onClose} accessibilityLabel="Close" style={{ padding: 6 }}><X size={20} color={c.text} /></PressScale></Row>
          <ScrollView><DownloadOptions {...rest} onDone={onClose} /></ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
