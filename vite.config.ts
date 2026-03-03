import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

export default defineConfig(({ command }) => {
  const input: Record<string, string> = {
    main: resolve(__dirname, 'index.html'),
  };

  // Only include simulator in dev mode
  if (command === 'serve') {
    input.simulator = resolve(__dirname, 'preview-glasses.html');
  }

  // Inject build metadata as compile-time constants
  const commitHash = execSync('git rev-parse --short HEAD').toString().trim();
  const buildTime = new Date().toISOString();

  return {
    root: '.',
    base: './',
    define: {
      __COMMIT_HASH__: JSON.stringify(commitHash),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
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
