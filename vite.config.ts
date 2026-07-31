import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function resolveVendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) {
    return undefined;
  }

  if (id.includes('@monaco-editor') || id.includes('monaco-editor')) {
    return 'vendor-monaco';
  }

  if (id.includes('reactflow')) {
    return 'vendor-reactflow';
  }

  if (id.includes('@tanstack/react-query') || id.includes('@google/genai') || id.includes('socket.io-client')) {
    return 'vendor-runtime';
  }

  if (
    id.includes('/react/')
    || id.includes('/react-dom/')
    || id.includes('/scheduler/')
    || id.includes('/use-sync-external-store/')
    || id.includes('/zustand/')
  ) {
    return 'vendor-react-core';
  }

  return 'vendor';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  // Workaround for Windows IPv6 EACCES issues
  // Force Node to use IPv4 only
  if (process.platform === 'win32') {
    process.env.NODE_NO_READLINE = '1';
  }

  return {
    server: {
      port: 4000,
      host: '127.0.0.1',
      strictPort: true,
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            return resolveVendorChunk(id);
          },
        },
      },
    }
  };
});
