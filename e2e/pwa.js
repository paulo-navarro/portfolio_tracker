/**
 * Fase 6 — o app instala, guarda só a si mesmo e nunca cacheia /api.
 *
 *   make pwa-check
 *
 * Roda contra o **build de produção** servido pelo nginx com a CSP de verdade
 * (BASE), num Chrome headless que trata essa origem como segura.
 */
const puppeteer = require('puppeteer')
const BASE = process.env.BASE || 'http://cripto-prodtest'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', `--unsafely-treat-insecure-origin-as-secure=${BASE}`, '--user-data-dir=/tmp/chrome-pwa'],
    executablePath: '/usr/bin/chromium-browser',
  })
  const page = await browser.newPage()
  const logs = []
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
  await page.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 })
  let fail = 0
  const check = (ok, label, detail = '') => { console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!ok) fail++ }

  await page.goto(`${BASE}/api/auth/dev`, { waitUntil: 'networkidle0' })
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await sleep(2500)

  const csp = (await page.goto(BASE, { waitUntil: 'networkidle0' })).headers()['content-security-policy']
  check(Boolean(csp && csp.includes("default-src 'self'") && csp.includes("frame-ancestors 'none'")), 'CSP estrita no nginx', csp?.slice(0, 60) + '…')

  const sw = await page.evaluate(async () => {
    if (!navigator.serviceWorker) return { error: 'sem serviceWorker (contexto inseguro)' }
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return { error: 'não registrou' }
    await navigator.serviceWorker.ready
    const names = await caches.keys()
    const urls = []
    for (const n of names) urls.push(...(await (await caches.open(n)).keys()).map((r) => r.url))
    return { names, urls }
  })
  check(!sw.error, 'service worker registrado', sw.error ?? `${sw.urls.length} arquivos`)
  check(Boolean(sw.urls?.some((u) => u.endsWith('.js'))) && Boolean(sw.urls?.some((u) => u.includes('index'))), 'app no cache (shell)')
  check(!sw.urls?.some((u) => u.includes('/api/')), 'nada de /api no cache')

  const m = await page.evaluate(async () => {
    const res = await fetch('/manifest.webmanifest')
    const man = await res.json()
    const icons = []
    for (const i of man.icons) icons.push(`${i.src}=${(await fetch(i.src)).status}`)
    const apple = (await fetch('/apple-touch-icon.png')).status
    return { name: man.name, display: man.display, start: man.start_url, icons, apple, maskable: man.icons.some((i) => i.purpose === 'maskable') }
  })
  check(m.display === 'standalone' && Boolean(m.name), 'manifest instalável', `${m.name} · ${m.display}`)
  check(m.icons.every((i) => i.endsWith('=200')) && m.apple === 200 && m.maskable, 'ícones 192/512/maskable e apple-touch', m.icons.join(' '))

  // Offline: recarrega com a rede desligada e a tela tem que abrir.
  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const offline = await page.evaluate(() => ({
    rendered: Boolean(document.querySelector('.app, .login, .splash')),
    text: document.body.innerText.slice(0, 200),
  }))
  check(offline.rendered, 'abre offline (app shell do cache)', offline.text.split('\n')[0])
  check(offline.text.includes('Sem conexão'), 'avisa que está offline')
  await page.setOfflineMode(false)

  console.log(logs.length ? `\nconsole:\n${logs.join('\n')}` : '\nsem erros de console')
  // Violação de CSP aparece como erro de console; qualquer uma reprova.
  if (logs.some((l) => /Content Security Policy/i.test(l))) fail++
  await browser.close()
  console.log(fail ? `\n${fail} falha(s)` : '\ntudo certo')
  process.exit(fail ? 1 : 0)
})().catch((e) => { console.error('FALHOU:', e.message); process.exit(1) })
