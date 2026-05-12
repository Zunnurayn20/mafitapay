import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Playfair Display', 'serif'],
        mono: ['Space Mono', 'monospace'],
        sans: ['DM Sans', 'sans-serif'],
      },
      colors: {
        char:   'var(--char)',
        coal:   'var(--coal)',
        clay:   'var(--clay)',
        clay2:  'var(--clay2)',
        border: 'var(--border)',
        gold:   'var(--gold)',
        gold2:  'var(--gold2)',
        green:  'var(--green)',
        green2: 'var(--green2)',
        text:   'var(--text)',
        text2:  'var(--text2)',
        muted:  'var(--muted)',
      },
    },
  },
  plugins: [],
}

export default config
