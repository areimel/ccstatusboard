// @ts-check
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Deployed to https://areimel.github.io/ccstatusboard (GitHub Pages project site).
export default defineConfig({
  site: 'https://areimel.github.io',
  base: '/ccstatusboard',
  trailingSlash: 'ignore',
  output: 'static',
  // React is used only to server-render InstrumentGraphic; never add a client:* directive.
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
