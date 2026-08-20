import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          500: '#3b6bf5',
          600: '#2c55d4',
          700: '#2444ab',
        },
      },
    },
  },
  plugins: [],
};

export default config;
