/** DesignForge visual identity: "Ink & Ember" */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 50: '#f6f6f9', 100: '#ececf2', 200: '#d6d6e1', 300: '#b2b2c4', 400: '#8686a0', 500: '#666680', 600: '#4e4e66', 700: '#363649', 800: '#1d1d2a', 850: '#16161f', 900: '#101017', 950: '#0a0a0f' },
        forge: { 50: '#f3f0ff', 100: '#e7e1ff', 200: '#d0c4ff', 300: '#b39cff', 400: '#9a7bff', 500: '#7c5cff', 600: '#6a45f0', 700: '#5733cc', 800: '#4429a3', 900: '#33207a' },
        ember: { 400: '#ff9a6b', 500: '#ff7a45', 600: '#ec5f28' },
      },
      fontFamily: {
        sans: ['"Inter var"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Sora"', '"Inter var"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,92,255,.25), 0 8px 32px -8px rgba(124,92,255,.35)',
        card: '0 1px 0 rgba(255,255,255,.04) inset, 0 8px 24px -12px rgba(0,0,0,.4)',
      },
      backgroundImage: {
        'forge-gradient': 'linear-gradient(135deg, #7c5cff 0%, #b06cff 45%, #ff7a45 100%)',
        'grid-faint': 'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)',
      },
      keyframes: { shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } } },
      animation: { shimmer: 'shimmer 2.2s linear infinite' },
    },
  },
  plugins: [],
};
