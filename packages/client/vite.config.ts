import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el build funciona servido desde cualquier subcarpeta.
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
