export type Device = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'AGNOSTIC';
export interface Conn { provider: 'stitch' | 'gemini'; connected: boolean; keyHint?: string; status: string; lastVerifiedAt?: number; lastError?: string }
export interface Plan { id: string; name: string; tagline: string; priceInrMonthly: number; priceInrAnnual: number; priceInrOneTime?: number; monthlyCredits: number; annualCredits: number; oneTimeCredits?: number; maxProjects: number; maxImproveIterations: number; features: string[]; active: boolean }
export interface Me {
  user: { uid: string; email: string; displayName: string | null; photoURL: string | null; isAdmin: boolean; createdAt: number };
  plan: Plan; subscription: { planId: string; cycle: string; status: string; currentPeriodEnd?: number; cancelAtPeriodEnd?: boolean };
  credits: number; connections: Conn[];
  preferences: { theme: string; defaultDevice: Device; defaultModel: string; notificationPrefs?: { push?: boolean } };
}
export interface Page { id: string; name: string; currentVersionId?: string; stitchScreenId?: string }
export interface Project { id: string; ownerId: string; name: string; kind: 'ui' | 'website' | 'logo' | 'improve'; archived: boolean; folder?: string; deviceType: Device; pages: Page[]; createdAt: number; updatedAt: number; access?: 'owner' | 'editor' | 'viewer' }
export interface Audit { score: number; checks: { id: string; label: string; passed: boolean; severity: string; detail: string }[] }
export interface Version { id: string; projectId: string; pageId: string; source: string; prompt?: string; html: string; imageUrl?: string; audit?: Audit; createdAt: number; logo?: { style: string; palette: string[]; assets: Record<string, string | null>; typography: { heading: string; body: string; why: string } } }
export interface Job { id: string; type: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; stage?: string; progress: number; creditsReserved: number; resultVersionIds?: string[]; error?: { code: string; message: string }; improvementHistory?: { iteration: number; before: number; after: number; fixed: string[]; regressed: string[] }[] }
