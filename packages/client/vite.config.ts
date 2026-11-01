import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: el build funciona servido desde cualquier subcarpeta.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        sandbox: resolve(__dirname, 'index.html'),
        embestida: resolve(__dirname, 'prototipo-embestida.html'),
      },
    },
  },
});
