import { useState } from 'react';
import { User, Palette, Bell, Shield, Download, LogOut, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { applyTheme, type Theme } from '../lib/theme';
import { useToast } from '../lib/toast';
import { Avatar, Button, Card, Modal, PageHeader, Toggle } from '../components/ui';

function Section({ icon: I, title, children }: { icon: typeof User; title: string; children: React.ReactNode }){
  return (
    <Card className="p-6"><div className="mb-5 flex items-center gap-2"><I className="h-4 w-4 text-forge-500" /><h2 className="font-display font-semibold">{title}</h2></div>{children}</Card>
  );
}

export default function Settings() {
  const { me, refresh, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(me?.user.displayName ?? '');
  const [del, setDel] = useState(false);
  const [confirm, setConfirm] = useState('');
  const prefs = me?.preferences;

  const patch = async (body: Record<string, unknown>, msg = 'Saved') => { try { await api.patch('/me', body); toast('success', msg); refresh(); } catch (e) { toast('error', (e as Error).message); } };
  const setTheme = (t: Theme) => { applyTheme(t); patch({ preferences: { theme: t } }, 'Theme updated'); };
  const exportData = async () => { try { await api.download('GET', '/me/export', undefined, 'designforge-data.json'); } catch (e) { toast('error', (e as Error).message); } };
  const logoutAll = async () => { try { await api.post('/me/logout-all'); toast('success', 'Signed out on all devices.'); logout(); } catch (e) { toast('error', (e as Error).message); } };
  const deleteAccount = async () => { try { await api.del('/me', { confirm: 'DELETE' }); toast('success', 'Account deleted.'); logout(); } catch (e) { toast('error', (e as Error).message); } };

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <Section icon={User} title="Profile">
          <div className="flex items-center gap-4"><Avatar src={me?.user.photoURL} name={me?.user.displayName} size={56} /><div><p className="font-medium">{me?.user.email}</p><p className="muted text-xs">Signed in with Google · member since {me ? new Date(me.user.createdAt).toLocaleDateString('en-IN') : ''}</p></div></div>
          <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); patch({ displayName: name }); }}><input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Display name" /><Button disabled={!name.trim() || name === me?.user.displayName}>Save</Button></form>
        </Section>
        <Section icon={Palette} title="Preferences">
          <div className="grid gap-4 sm:grid-cols-3">
            <label><span className="label">Theme</span><select className="field" value={prefs?.theme ?? 'dark'} onChange={(e) => setTheme(e.target.value as Theme)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>
            <label><span className="label">Default device</span><select className="field" value={prefs?.defaultDevice ?? 'DESKTOP'} onChange={(e) => patch({ preferences: { defaultDevice: e.target.value } })}><option value="MOBILE">Mobile</option><option value="TABLET">Tablet</option><option value="DESKTOP">Desktop</option></select></label>
          </div>
        </Section>
        <Section icon={Bell} title="Notifications">
          {[['push', 'Push notifications on Android', 'Generation complete/failed, payments, subscription reminders'], ['email', 'Email updates', 'Receipts and important account notices']].map(([k, l, d]) => (
            <div key={k} className="flex items-center justify-between py-2"><div><p className="text-sm font-medium">{l}</p><p className="muted text-xs">{d}</p></div>
              <Toggle label={l} checked={(prefs?.notificationPrefs as any)?.[k] ?? true} onChange={(v) => patch({ preferences: { notificationPrefs: { [k]: v } } })} /></div>
          ))}
        </Section>
        <Section icon={Shield} title="Privacy & security">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={exportData}>Download my data</Button>
            <Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={logoutAll}>Sign out everywhere</Button>
            <Button variant="ghost" className="!text-red-600" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDel(true)}>Delete account</Button>
          </div>
          <p className="muted mt-3 text-xs">Your Stitch/Gemini keys are managed in Integrations. Payment details are held by Razorpay, never by DesignForge.</p>
        </Section>
      </div>
      <Modal open={del} onClose={() => setDel(false)} title="Delete your account?">
        <p className="text-sm">This permanently deletes your projects, versions, chat history, connections and remaining credits. Active subscriptions are cancelled. Payment records are kept as required by law. This cannot be undone.</p>
        <label className="label mt-4" htmlFor="cf">Type DELETE to confirm</label><input id="cf" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" onClick={() => setDel(false)}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE'} onClick={deleteAccount}>Delete forever</Button></div>
      </Modal>
    </div>
  );
}
