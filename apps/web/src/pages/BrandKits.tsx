import { useNavigate } from 'react-router-dom';
import { Palette, PenTool, Download } from 'lucide-react';
import { api } from '../lib/api';
import { useApi, timeAgo } from '../lib/hooks';
import { useToast } from '../lib/toast';
import type { Project } from '../lib/types';
import { Badge, Button, Card, Empty, PageHeader, Skeleton } from '../components/ui';
import { useEffect, useState } from 'react';

interface Kit { project: Project; versions: { id: string; logo?: { style: string; palette: string[]; typography: { heading: string; body: string } }; createdAt: number }[] }

export default function BrandKits() {
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading } = useApi<{ projects: Project[] }>('/projects?kind=logo&limit=50');
  const [kits, setKits] = useState<Kit[] | null>(null);
  useEffect(() => {
    if (!data) return;
    Promise.all(data.projects.map(async (p) => {
      const { versions } = await api.get<{ versions: Kit['versions'] & { source: string }[] }>(`/projects/${p.id}/versions?limit=20`);
      const heads = new Set(p.pages.map((x) => x.currentVersionId));
      return { project: p, versions: (versions as any[]).filter((v) => v.source === 'logo' && heads.has(v.id)) };
    })).then(setKits).catch(() => setKits([]));
  }, [data]);
  const dl = async (vid: string) => { try { await api.download('GET', `/versions/${vid}/brand-kit`, undefined, 'brand-kit.zip'); } catch (e) { toast('error', (e as Error).message); } };

  return (
    <div>
      <PageHeader title="Brand Kits" subtitle="Every logo concept comes with a palette, a typography pairing and downloadable assets." actions={<Button icon={<PenTool className="h-4 w-4" />} onClick={() => nav('/logo-studio')}>New brand</Button>} />
      {loading || (data && !kits) ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        : !kits?.length ? <Empty icon={<Palette className="h-6 w-6" />} title="No brand kits yet" body="Generate logo concepts in Logo Studio to build a brand kit." action={<Button onClick={() => nav('/logo-studio')}>Open Logo Studio</Button>} />
        : <div className="space-y-4">{kits.map((k) => (
          <Card key={k.project.id} className="p-5">
            <div className="mb-4 flex items-center justify-between"><button onClick={() => nav(`/logo-studio/${k.project.id}`)} className="font-display font-semibold hover:underline">{k.project.name}</button><span className="muted text-xs">{timeAgo(k.project.updatedAt)}</span></div>
            {!k.versions.length ? <p className="muted text-sm">No concepts yet.</p> : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{k.versions.map((v) => (
                <div key={v.id} className="surface-2 rounded-xl p-3">
                  <div className="flex items-center justify-between"><Badge tone="forge">{v.logo?.style}</Badge><span className="muted text-[11px]">{v.logo?.typography.heading} / {v.logo?.typography.body}</span></div>
                  <div className="mt-3 flex h-8 overflow-hidden rounded-lg">{v.logo?.palette.map((c) => <span key={c} className="flex-1" style={{ background: c }} title={c} />)}</div>
                  <Button size="sm" variant="secondary" className="mt-3 w-full" icon={<Download className="h-3.5 w-3.5" />} onClick={() => dl(v.id)}>Download kit</Button>
                </div>
              ))}</div>
            )}
          </Card>
        ))}</div>}
    </div>
  );
}
