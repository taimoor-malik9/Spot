import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname)

function logProjectRoot() {
  return {
    name: 'log-project-root',
    configureServer() {
      console.log(`\n[Vite] Project root: ${projectRoot}\n`)
    },
    buildStart() {
      console.log(`\n[Vite build] Project root: ${projectRoot}\n`)
    },
  }
}

export default defineConfig({
  plugins: [logProjectRoot(), tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:5000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
})