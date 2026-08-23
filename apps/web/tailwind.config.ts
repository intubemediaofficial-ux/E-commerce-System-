import type { Config } from 'tailwindcss';

/**
 * Palette values are CSS variables so the whole product can switch between the
 * light and dark themes without touching utility classes in the pages.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        white: 'var(--surface)',
        slate: {
          50: 'var(--slate-50)',
          100: 'var(--slate-100)',
          200: 'var(--slate-200)',
          300: 'var(--slate-300)',
          400: 'var(--slate-400)',
          500: 'var(--slate-500)',
          600: 'var(--slate-600)',
          700: 'var(--slate-700)',
          800: 'var(--slate-800)',
          900: 'var(--slate-900)',
        },
        brand: {
          50: 'var(--brand-50)',
          100: 'var(--brand-100)',
          200: 'var(--brand-200)',
          300: 'var(--brand-300)',
          400: 'var(--brand-400)',
          500: 'var(--brand-500)',
          600: 'var(--brand-600)',
          700: 'var(--brand-700)',
          800: 'var(--brand-800)',
          900: 'var(--brand-900)',
        },
      },
      textColor: {
        white: '#ffffff',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.18)',
        lifted: '0 10px 40px -18px rgba(15, 23, 42, 0.35)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, var(--brand-600) 0%, var(--brand-400) 100%)',
        'page-glow':
          'radial-gradient(1200px 400px at 10% -10%, var(--brand-100) 0%, transparent 60%)',
      },
    },
  },
  plugins: [],
};

export default config;
