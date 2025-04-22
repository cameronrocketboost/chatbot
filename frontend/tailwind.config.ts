import type { Config } from 'tailwindcss';

const config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '*.{js,ts,jsx,tsx,mdx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      keyframes: {
        loading: {
          '0%': { opacity: '.2' },
          '20%': { opacity: '1' },
          '100%': { opacity: '.2' },
        },
        'thinking-progress': {
          '0%': { width: '15%', left: '0%', backgroundColor: 'rgb(111, 193, 182)' }, // sladen-teal
          '25%': { width: '30%', left: '25%', backgroundColor: 'rgb(226, 75, 75)' },  // sladen-red
          '50%': { width: '30%', left: '40%', backgroundColor: 'rgb(156, 100, 166)' }, // sladen-purple
          '75%': { width: '25%', left: '60%', backgroundColor: 'rgb(226, 75, 75)' },  // sladen-red
          '100%': { width: '15%', left: '85%', backgroundColor: 'rgb(111, 193, 182)' }, // sladen-teal
        },
      },
      animation: {
        loading: 'loading 1s ease-in-out infinite',
        'thinking-progress': 'thinking-progress 1.5s ease-in-out infinite',
      },
      colors: {
        'sladen-navy': '#0A2E4C',    // Deep Blue
        'sladen-red': '#E24B4B',     // Bright Red
        'sladen-teal': '#6FC1B6',    // Teal/Aqua
        'sladen-peach': '#FFDAD6',   // Soft Peach
        'sladen-purple': '#9C64A6',  // Purple for additional accent
        'sladen-white': '#FFFFFF',   // White
        'sladen-gray': '#B0BEC5',    // Keeping existing gray for supporting elements
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        'sans': ['Poppins', 'Nunito', 'Open Sans', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config;

export default config;
