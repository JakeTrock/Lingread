import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Use relative asset paths so the built output can be hosted from any subpath
  // (e.g. /lingread/) instead of requiring site root (/).
  base: './',
  plugins: [preact()],
});

