import { api, ApiError, newKey } from './api';
import { showAlert } from '../components/Dialog';

const PER_SCREEN = 5;

/** True for projects that are apps/websites (not logos or imported designs). */
export const canCompleteApp = (kind?: string) => kind === 'ui' || kind === 'website';

/**
 * Asks to confirm, then designs the app's missing screens (one per tab in its bar), 5 cr per screen,
 * all reserved up front. Resolves with the job id, or null when cancelled / not possible.
 */
export function completeApp(project: { id: string; name: string; kind: string }, credits: number, onError?: (e: ApiError) => void): Promise<string | null> {
  const affordable = Math.floor(credits / PER_SCREEN);
  const unit = project.kind === 'website' ? 'page' : 'screen';
  return new Promise((resolve) => {
    if (affordable < 1) {
      showAlert('Not enough credits', `Each ${unit} costs ${PER_SCREEN} credits and you have ${credits}. Nothing will be generated until you add credits.`, [{ text: 'OK', onPress: () => resolve(null) }], 'warning');
      return;
    }
    const max = Math.min(affordable, 5);
    showAlert(
      'Complete this app?',
      `Designo reads the tab bar of your current ${unit} and designs every missing ${unit} in the same style, so Play opens the whole app.\n\n${PER_SCREEN} credits per ${unit}, up to ${max} ${unit}s (${max * PER_SCREEN} cr max). If your credits can’t cover all of them, nothing is made and nothing is charged.`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(null) },
        {
          text: 'Complete app',
          onPress: async () => {
            try {
              const { job } = await api.post<{ job: { id: string } }>(`/projects/${project.id}/generate`, {
                prompt: `Complete the ${project.name} app`, completeApp: true, mode: 'app', idempotencyKey: newKey(),
              });
              resolve(job.id);
            } catch (e) {
              onError?.(e as ApiError);
              if (!onError) showAlert('Could not start', (e as Error).message, undefined, 'error');
              resolve(null);
            }
          },
        },
      ],
      'info',
    );
  });
}
