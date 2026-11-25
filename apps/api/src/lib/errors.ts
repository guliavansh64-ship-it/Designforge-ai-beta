import { ERROR_CODES } from '@designforge/shared';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public action?: string,
  ) {
    super(message);
  }
}

export const Errors = {
  unauth: (m = 'Sign in required') => new AppError(401, ERROR_CODES.UNAUTHENTICATED, m),
  forbidden: (m = 'You do not have access to this resource') => new AppError(403, ERROR_CODES.FORBIDDEN, m),
  notFound: (what = 'Resource') => new AppError(404, ERROR_CODES.NOT_FOUND, `${what} not found`),
  validation: (m: string) => new AppError(400, ERROR_CODES.VALIDATION, m),
  credits: (need: number, have: number) =>
    new AppError(402, ERROR_CODES.INSUFFICIENT_CREDITS, `This action needs ${need} credits; you have ${have}.`, 'open_billing'),
  feature: (f: string) => new AppError(403, ERROR_CODES.FEATURE_LOCKED, `Your plan does not include "${f}".`, 'upgrade_plan'),
  stitchNotConnected: () =>
    new AppError(412, ERROR_CODES.STITCH_NOT_CONNECTED, 'Connect your own Stitch account in Integrations first.', 'open_integrations'),
  geminiNotConnected: () =>
    new AppError(412, ERROR_CODES.GEMINI_NOT_CONNECTED, 'Logo Studio needs your own Gemini API key. Connect it in Integrations.', 'open_integrations'),
};
