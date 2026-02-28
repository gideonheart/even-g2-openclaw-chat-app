import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ command }) => {
  const input: Record<string, string> = {
    main: resolve(__dirname, 'index.html'),
  };

  // Only include simulator in dev mode
  if (command === 'serve') {
    input.simulator = resolve(__dirname, 'preview-glasses.html');
  }

  return {
    root: '.',
    base: './',
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    build: {
      outDir: 'dist',
      rollupOptions: { input },
    },
    server: { port: 3200, open: true },
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
    },
  };
});
