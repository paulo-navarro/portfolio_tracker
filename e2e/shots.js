/**
 * Capturas de todas as telas, desktop (1400px) e celular (390px, 2×), no tema
 * escolhido. Mede também se a página fica ocupada e se transborda.
 *
 *   make shots            (escuro)      make shots SCHEME=light
 *
 * Usa o portfólio "Planilha (demo)" (make demo). Saída em e2e/out/.
 */
const puppeteer = require('puppeteer')
const BASE = 'http://frontend:5175'
const SCREENS = (process.env.SCREENS || 'home,portfolio,contas,ajustes').split(',')
const SCHEME = process.env.SCHEME || 'dark'
;(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium-browser' })
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: SCHEME }])
  const logs = []
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
  await page.goto(`${BASE}/api/auth/dev`, { waitUntil: 'networkidle0' })
  const PID = await page.evaluate(async () => (await (await fetch('/api/portfolios')).json()).find((p) => p.name === 'Planilha (demo)')?.id)
  if (!PID) throw new Error('sem o portfólio "Planilha (demo)": rode make demo')

  const paths = { home: '/', portfolio: `/p/${PID}`, contas: `/p/${PID}/contas`, ajustes: '/ajustes' }
  for (const [name, w, h, mobile] of [['desktop', 1400, 1000, false], ['mobile', 390, 844, true]]) {
    const vp = (height) => page.setViewport({ width: w, height, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
    await vp(h)
    for (const screen of SCREENS) {
      await page.goto(`${BASE}${paths[screen]}`, { waitUntil: 'networkidle0' })
      await new Promise((r) => setTimeout(r, 800))
      if (screen === 'portfolio' && mobile) {
        const row = await page.$('.position-row')
        if (row) await row.click()
      }
      const lag = await page.evaluate(async () => {
        const lags = []
        for (let i = 0; i < 5; i++) { const t = performance.now(); await new Promise((r) => setTimeout(r, 20)); lags.push(Math.round(performance.now() - t)) }
        return Math.max(...lags)
      })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      const tableOverflow = await page.evaluate(() => {
        const t = document.querySelector('.table-wrap')
        return t && t.offsetParent ? t.scrollWidth - t.clientWidth : null
      })
      // Sem fullPage: ele redimensiona na hora e pega o gráfico redesenhando.
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      await vp(height)
      await new Promise((r) => setTimeout(r, 700))
      if (screen === 'portfolio') {
        const chart = await page.$('.history-chart')
        if (chart) { const b = await chart.boundingBox(); await page.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2); await new Promise((r) => setTimeout(r, 300)) }
      }
      await page.screenshot({ path: `/out/${name}-${screen}-${SCHEME}.png` })
      await vp(h)
      console.log(`${name} ${screen}: lag ${lag}ms, page overflow ${overflow}px, table overflow ${tableOverflow}`)
    }
  }
  console.log(logs.length ? logs.join('\n') : 'no console errors')
  await browser.close()
})().catch((e) => { console.error(e); process.exit(1) })
