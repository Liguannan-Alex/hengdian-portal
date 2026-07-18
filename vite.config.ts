import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: './',
  cacheDir: '.vite-cache',
  // inspectAttr 仅服务本地标注调试，生产构建不注入任何检查属性或运行时代码。
  plugins: [command === 'serve' ? inspectAttr() : null, react()].filter(Boolean),
  server: {
    port: 3000,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes('node_modules') ? 'vendor' : undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
