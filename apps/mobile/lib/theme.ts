import { useColorScheme } from 'react-native';

const dark = { bg: '#0a0a0f', card: '#16161f', card2: '#1d1d2a', border: '#2a2a3a', text: '#ececf2', muted: '#8686a0', primary: '#7c5cff', primaryText: '#ffffff', ember: '#ff7a45', green: '#22c55e', red: '#ef4444', amber: '#f59e0b' };
const light: typeof dark = { bg: '#f6f6f9', card: '#ffffff', card2: '#ececf2', border: '#d6d6e1', text: '#101017', muted: '#666680', primary: '#6a45f0', primaryText: '#ffffff', ember: '#ec5f28', green: '#16a34a', red: '#dc2626', amber: '#d97706' };
export type Colors = typeof dark;
export function useColors(): Colors { return useColorScheme() === 'light' ? light : dark; }
export const radius = { sm: 10, md: 14, lg: 20 };
export const space = (n: number) => n * 4;
