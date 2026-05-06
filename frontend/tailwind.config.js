/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#533afd',
        'primary-hover': '#4434d4',
        navy: '#061b31',
        danger: '#EF4444',
        success: '#15be53',
        warning: '#F59E0B',
        body: '#64748d',
        muted: '#6B7280',
        brand: {
          dark: '#1c1e54'
        }
      },
      boxShadow: {
        card: '0px 4px 12px rgba(0,0,0,0.3)',
        'card-hover': '0px 8px 24px rgba(0,0,0,0.45)',
        panel: '0 24px 48px rgba(0,0,0,0.6)',
      },
      animation: {
        'fade-in': 'fadeIn 0.18s ease-out',
        'slide-up': 'slideUp 0.18s ease-out',
        'ping-slow': 'pingSlow 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pingSlow: {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '75%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        }
      }
    },
  },
  plugins: [],
};
