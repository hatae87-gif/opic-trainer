import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages는 hatae87-gif.github.io/opic-trainer/ 하위 경로에 서빙된다
  base: '/opic-trainer/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OPIc 트레이너',
        short_name: 'OPIc',
        description: 'OPIc 스크립트 복습',
        lang: 'ko',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1115',
        theme_color: '#0f1115',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // 앱 셸만 캐싱한다. 자료(오디오·스크립트)는 IndexedDB에 있으므로 네트워크가 필요 없다
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
    }),
  ],
})
