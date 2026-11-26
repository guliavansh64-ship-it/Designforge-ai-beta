/**
 * Stitch model IDs accepted by the Stitch API (SDK 0.4.0). Mirrors packages/shared (mobile is outside the
 * npm workspaces). The server normalises IDs too, so older app versions keep working.
 */
export type StitchModel = 'GEMINI_3_8_FLASH' | 'GEMINI_3_5_FLASH_LITE';
export const STITCH_MODELS: { id: StitchModel; label: string; hint: string }[] = [
  { id: 'GEMINI_3_8_FLASH', label: 'Gemini 3.8 Flash', hint: 'Best quality' },
  { id: 'GEMINI_3_5_FLASH_LITE', label: '3.5 Flash-Lite', hint: 'Fastest' },
];
export const normalizeModel = (m: unknown): StitchModel => (m === 'GEMINI_3_5_FLASH_LITE' ? 'GEMINI_3_5_FLASH_LITE' : 'GEMINI_3_8_FLASH');
