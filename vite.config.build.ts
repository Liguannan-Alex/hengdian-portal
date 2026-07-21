import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 构建专用配置：不引入 kimi-plugin-inspect-react。
// 该插件仅服务 Kimi IDE 的本地标注调试，且在 IDE 未运行时 import 阶段会同步阻塞，
// 导致 vite build 连配置都加载不完。生产构建与 vite.config.ts 的 build 分支完全一致。
export default defineConfig({
  base: './',
  cacheDir: '.vite-cache',
  plugins: [react()],
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
})
