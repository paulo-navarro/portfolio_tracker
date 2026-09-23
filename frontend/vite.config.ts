import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Em dev o browser só fala com o Vite; o Vite repassa /api para a api, então o
// cookie de sessão é first-party como em prod. Sem changeOrigin: a api confere
// o Origin das escritas contra o Host, e o Host tem que ser o que o navegador usou.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3001'

/**
 * A chave pública do worker entra no build, nunca é buscada em runtime: quem
 * controlasse a resposta da api escolheria para quem o navegador sela a chave
 * da corretora. Sem o arquivo, o build falha.
 */
function sealingPublicKey(): string {
  const file = process.env.SEALING_PUBLIC_KEY_FILE
  if (!file) throw new Error('SEALING_PUBLIC_KEY_FILE is not set (run `make keys`)')
  const key = readFileSync(file, 'utf8').trim()
  if (Buffer.from(key, 'base64').length !== 32) throw new Error(`${file} is not a 32-byte base64 key`)
  return key
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: o service worker é nosso (o push da fase 7 mora nele).
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      // O manifest é um arquivo de verdade em public/, para editar à mão.
      manifest: false,
      injectManifest: {
        // Só o app: nada de /api, e o mapa de fontes não precisa ser guardado.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/*.map'],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __SEALING_PUBLIC_KEY__: JSON.stringify(sealingPublicKey()),
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID ?? new Date().toISOString().slice(0, 16)),
  },
  build: {
    rollupOptions: {
      output: {
        // Os gráficos são a maior parte do app e só aparecem numa tela.
        manualChunks: (id) => (id.includes('recharts') || id.includes('d3-') || id.includes('victory-vendor') ? 'charts' : undefined),
      },
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    // Alcançável pela LAN, para abrir no celular.
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: apiTarget },
    },
  },
})
