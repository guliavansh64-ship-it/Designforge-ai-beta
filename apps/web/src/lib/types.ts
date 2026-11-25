import type { ConnectionStatus, PlanDefinition, Project, ProjectVersion, QualityAudit, GenerationJob } from '@designforge/shared';
export type { ConnectionStatus, PlanDefinition, Project, ProjectVersion, QualityAudit, GenerationJob };

export interface Me {
  user: { uid: string; email: string; displayName: string | null; photoURL: string | null; isAdmin: boolean; adminRole: string | null; createdAt: number };
  plan: PlanDefinition;
  subscription: { planId: string; cycle: string; status: string; currentPeriodEnd?: number; cancelAtPeriodEnd?: boolean; pendingPlanId?: string };
  credits: number;
  connections: ConnectionStatus[];
  preferences: { theme: 'light' | 'dark' | 'system'; defaultDevice: string; defaultModel: string; notificationPrefs?: { push?: boolean; email?: boolean } };
}
export type ProjectWithAccess = Project & { access: 'owner' | 'editor' | 'viewer' };
export type VersionListItem = Omit<ProjectVersion, 'html'> & { hasHtml: boolean; isVariant?: boolean };
