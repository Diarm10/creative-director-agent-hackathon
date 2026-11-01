/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { keyframes: { 'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } } }, animation: { 'fade-up': 'fade-up 0.3s ease-out both' } } },
  plugins: [],
};
