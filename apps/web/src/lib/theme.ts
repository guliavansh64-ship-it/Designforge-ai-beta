export type Theme = 'light' | 'dark' | 'system';
export function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('df_theme', t);
}
export const storedTheme = (): Theme => (localStorage.getItem('df_theme') as Theme) || 'dark';
