/**
 * @designforge/shared — types and constants shared by API, Web and Android.
 * Contains NO secrets. Safe to bundle into clients.
 */

export type DeviceType = 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC';
/** Stitch model IDs currently accepted by the Stitch API (SDK 0.4.0). */
export type StitchModel = 'GEMINI_3_8_FLASH' | 'GEMINI_3_5_FLASH_LITE';
export const DEFAULT_STITCH_MODEL: StitchModel = 'GEMINI_3_8_FLASH';
export const STITCH_MODELS: { id: StitchModel; label: string; short: string; hint: string }[] = [
  { id: 'GEMINI_3_8_FLASH', label: 'Gemini 3.8 Flash', short: '3.8 Flash', hint: 'Best quality' },
  { id: 'GEMINI_3_5_FLASH_LITE', label: 'Gemini 3.5 Flash-Lite', short: '3.5 Lite', hint: 'Fastest' },
];
/**
 * Stitch retired the 0.3.x model IDs (GEMINI_3_FLASH / GEMINI_3_PRO / GEMINI_3_1_PRO) — sending them
 * now fails with "Request contains an invalid argument". Old clients and stored preferences are mapped.
 */
export function normalizeStitchModel(m: unknown): StitchModel {
  return m === 'GEMINI_3_5_FLASH_LITE' ? 'GEMINI_3_5_FLASH_LITE' : DEFAULT_STITCH_MODEL;
}
export type PlanId = 'free' | 'pro' | 'premium' | 'lifetime';
export type BillingCycle = 'monthly' | 'annual' | 'one_time';
export type ProjectKind = 'ui' | 'website' | 'logo' | 'improve';
export type Provider = 'stitch' | 'gemini';

export type Feature =
  | 'ui_generation'
  | 'website_studio'
  | 'logo_studio'
  | 'html_export'
  | 'react_export'
  | 'auto_improve'
  | 'variants'
  /** @deprecated Stitch retired its Pro model; kept so stored plans still type-check. Not advertised. */
  | 'pro_model'
  | 'priority_queue'
  | 'project_sharing';

/** Credit cost per operation — DesignForge platform credits, NOT Google quota. */
export const CREDIT_COSTS = {
  generate_flash: 2,
  /** Legacy (retired Pro model) — kept only so old ledger entries still have a label. */
  generate_pro: 5,
  edit: 2,
  variants: 4,
  improve_iteration: 3,
  logo_batch: 4,
  html_export: 1,
  react_export: 2,
  chat_edit: 2,
} as const;
export type CreditOperation = keyof typeof CREDIT_COSTS;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  tagline: string;
  priceInrMonthly: number; // paise are computed server side (x100)
  priceInrAnnual: number;
  priceInrOneTime?: number;
  monthlyCredits: number;
  annualCredits: number;
  oneTimeCredits?: number;
  maxProjects: number;
  maxImproveIterations: number;
  features: Feature[];
  active: boolean;
}

/** Default plan catalogue. Admin can override in Firestore `subscription_plans`. */
export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    id: 'free', name: 'Free', tagline: 'Explore with your own Stitch account',
    priceInrMonthly: 0, priceInrAnnual: 0, monthlyCredits: 40, annualCredits: 480,
    maxProjects: 5, maxImproveIterations: 1,
    features: ['ui_generation', 'html_export'], active: true,
  },
  {
    id: 'pro', name: 'Pro', tagline: 'For freelancers and makers',
    priceInrMonthly: 499, priceInrAnnual: 4790, monthlyCredits: 400, annualCredits: 5200,
    maxProjects: 50, maxImproveIterations: 3,
    features: ['ui_generation', 'website_studio', 'logo_studio', 'html_export', 'react_export', 'auto_improve', 'variants'],
    active: true,
  },
  {
    id: 'premium', name: 'Premium', tagline: 'For studios and teams',
    priceInrMonthly: 1299, priceInrAnnual: 12470, monthlyCredits: 1500, annualCredits: 19000,
    maxProjects: 500, maxImproveIterations: 5,
    features: ['ui_generation', 'website_studio', 'logo_studio', 'html_export', 'react_export', 'auto_improve', 'variants', 'priority_queue', 'project_sharing'],
    active: true,
  },
  {
    id: 'lifetime', name: 'Lifetime', tagline: 'One payment, premium platform features',
    priceInrMonthly: 0, priceInrAnnual: 0, priceInrOneTime: 14999,
    monthlyCredits: 0, annualCredits: 0, oneTimeCredits: 6000,
    maxProjects: 500, maxImproveIterations: 5,
    features: ['ui_generation', 'website_studio', 'logo_studio', 'html_export', 'react_export', 'auto_improve', 'variants', 'project_sharing'],
    active: true,
  },
];

export const CREDIT_PACKS = [
  { id: 'pack_100', credits: 100, priceInr: 149 },
  { id: 'pack_500', credits: 500, priceInr: 599 },
  { id: 'pack_2000', credits: 2000, priceInr: 1999 },
] as const;
export type CreditPackId = (typeof CREDIT_PACKS)[number]['id'];

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobType = 'generate' | 'edit' | 'variants' | 'improve' | 'logo' | 'chat';

export interface GenerationJob {
  id: string;
  ownerId: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  prompt: string;
  deviceType?: DeviceType;
  model?: StitchModel;
  progress: number; // 0..100
  stage?: string;
  creditsReserved: number;
  creditTxnId?: string;
  resultVersionIds?: string[];
  error?: { code: string; message: string };
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  kind: ProjectKind;
  description?: string;
  folder?: string;
  archived: boolean;
  thumbnailUrl?: string;
  stitchProjectId?: string;
  deviceType: DeviceType;
  currentVersionId?: string;
  pages: ProjectPage[];
  sharedWith?: Record<string, 'viewer' | 'editor'>;
  sharedUids?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectPage {
  id: string;
  name: string;
  currentVersionId?: string;
  stitchScreenId?: string;
}

export interface ProjectVersion {
  id: string;
  projectId: string;
  ownerId: string;
  pageId: string;
  parentVersionId?: string;
  source: 'stitch_generate' | 'stitch_edit' | 'stitch_variant' | 'manual_edit' | 'improve' | 'template' | 'logo';
  prompt?: string;
  html: string; // sanitized-at-render; stored in Firestore if <900KB else in storage
  htmlStorageUrl?: string;
  imageUrl?: string;
  stitchScreenId?: string;
  audit?: QualityAudit;
  createdAt: number;
}

export interface AuditCheck {
  id: string;
  category: 'hierarchy' | 'typography' | 'spacing' | 'contrast' | 'color' | 'responsive' | 'accessibility' | 'navigation' | 'structure' | 'code';
  label: string;
  passed: boolean;
  severity: 'low' | 'medium' | 'high';
  detail: string;
  fixInstruction?: string;
}

/**
 * Heuristic quality audit. The score is the weighted percentage of DesignForge's
 * own automated checks that pass. It is NOT an industry-standard metric.
 */
export interface QualityAudit {
  score: number;
  checks: AuditCheck[];
  measuredAt: number;
  methodology: string;
}

export interface ConnectionStatus {
  provider: Provider;
  connected: boolean;
  keyHint?: string; // last 4 chars only
  status: 'active' | 'invalid' | 'revoked' | 'not_connected' | 'no_access' | 'quota_exceeded';
  lastVerifiedAt?: number;
  lastError?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; action?: string };
}

export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  SUSPENDED: 'ACCOUNT_SUSPENDED',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION_ERROR',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  FEATURE_LOCKED: 'FEATURE_LOCKED',
  STITCH_NOT_CONNECTED: 'STITCH_NOT_CONNECTED',
  STITCH_AUTH_FAILED: 'STITCH_AUTH_FAILED',
  STITCH_NO_ACCESS: 'STITCH_NO_ACCESS',
  STITCH_RATE_LIMITED: 'STITCH_RATE_LIMITED',
  STITCH_ERROR: 'STITCH_ERROR',
  /** Stitch answered with a question instead of a design — rephrase the prompt with more detail. */
  STITCH_CLARIFICATION: 'STITCH_CLARIFICATION',
  GEMINI_NOT_CONNECTED: 'GEMINI_NOT_CONNECTED',
  GEMINI_ERROR: 'GEMINI_ERROR',
  PAYMENT_INVALID: 'PAYMENT_INVALID',
  MAINTENANCE: 'MAINTENANCE_MODE',
  RATE_LIMITED: 'RATE_LIMITED',
  PROJECT_LIMIT: 'PROJECT_LIMIT_REACHED',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export const TEMPLATE_CATEGORIES = [
  'SaaS', 'Business', 'E-commerce', 'Portfolio', 'Restaurant', 'Education',
  'Fitness', 'Finance', 'Travel', 'Healthcare', 'Dashboard', 'Mobile',
] as const;

export const WEBSITE_CATEGORIES = [
  'Business', 'Portfolio', 'E-commerce', 'Restaurant', 'SaaS', 'Agency', 'Education',
  'Gym', 'Landing page', 'Blog', 'Personal', 'Admin dashboard',
] as const;

export const LOGO_STYLES = ['Minimalist', 'Modern', 'Wordmark', 'Icon', 'Emblem', 'Abstract'] as const;

export function planHasFeature(plan: Pick<PlanDefinition, 'features'>, f: Feature): boolean {
  return plan.features.includes(f);
}
