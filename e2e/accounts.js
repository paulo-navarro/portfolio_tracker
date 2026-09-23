/**
 * Fase 5 — contas pela tela, de ponta a ponta, num Chrome headless.
 *
 *   make e2e
 *
 * Cadastra uma chave falsa da Binance pelo formulário e espera a Binance de
 * verdade recusar: só dá para ela recusar se o worker abriu o que o navegador
 * selou. Troca a chave, cria uma conta manual com posições digitadas em pt-BR,
 * remove a conta, e confere que nenhuma requisição levou a chave em claro.
 * O alvo do Makefile apaga o que o teste criou (portfólio "E2E").
 */
const puppeteer = require('puppeteer')
const BASE = 'http://frontend:5175'
const FAKE_KEY = 'e2eFakeApiKey' + 'x'.repeat(40) + 'Zq9w'
const FAKE_KEY_2 = 'e2eOtherApiKey' + 'y'.repeat(40) + 'Km4t'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
;(async () => {
  const browser = await (globalThis.__browser = puppeteer.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'], executablePath: '/usr/bin/chromium-browser' }))
  const page = await browser.newPage()
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const logs = (globalThis.__logs = [])
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
  // Nada da chave em claro pode sair do navegador.
  const leaks = []
  page.on('request', (r) => { const body = r.postData() || ''; if (body.includes(FAKE_KEY) || body.includes(FAKE_KEY_2) || r.url().includes(FAKE_KEY)) leaks.push(r.url()) })

  const clickText = async (text, selector = 'button') => {
    const els = await page.$$(selector)
    for (const el of els) if ((await el.evaluate((e) => e.textContent.trim())) === text) return el.click()
    throw new Error(`não achei ${selector} "${text}"`)
  }
  const waitText = (text, timeout = 30000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
  const step = (m) => console.log('•', m)

  await page.goto(`${BASE}/api/auth/dev`, { waitUntil: 'networkidle0' })
  // Portfólio próprio do teste, criado pela api como a tela criaria.
  const PID = await page.evaluate(async () => {
    const res = await fetch('/api/portfolios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'E2E' }) })
    return (await res.json()).id
  })
  await page.goto(`${BASE}/p/${PID}/contas`, { waitUntil: 'networkidle0' })

  step('cadastrar Binance com chave falsa')
  await clickText('Binance')
  await page.waitForSelector('.key-form')
  const inputs = await page.$$('.key-form input')
  await inputs[0].click({ clickCount: 3 }); await inputs[0].type('Binance e2e')
  await inputs[1].type(FAKE_KEY)
  await inputs[2].type('e2eFakeSecret' + 's'.repeat(40))
  await clickText('selar e cadastrar')
  await waitText('Binance e2e')
  await waitText('a corretora recusou a chave (Invalid Api-Key ID.)', 30000)
  step('recusada pela Binance de verdade, motivo na tela')
  
  step('trocar a chave (painel já destacado)')
  await clickText('trocar chave')
  await page.waitForSelector('.panel .key-form')
  const k2 = await page.$$('.panel .key-form input')
  await k2[0].type(FAKE_KEY_2)
  await k2[1].type('e2eOtherSecret' + 't'.repeat(40))
  await clickText('selar e trocar')
  await waitText('chave …Km4t')
  await waitText('a corretora recusou a chave', 30000)
  step('chave trocada, …Km4t, recusada de novo')

  step('conta manual com posições')
  await clickText('Manual')
  await page.waitForSelector('.inline-form.panel input')
  const lbl = await page.$('.inline-form.panel input')
  await lbl.click({ clickCount: 3 }); await lbl.type('Ledger e2e')
  await clickText('criar')
  await page.waitForSelector('.holdings')
  await clickText('+ ativo')
  let rows = await page.$$('.holdings-row')
  let cells = await rows[0].$$('input')
  await cells[0].type('btc'); await cells[1].type('0,5'); await cells[2].type('cold wallet')
  await clickText('+ ativo')
  rows = await page.$$('.holdings-row')
  cells = await rows[1].$$('input')
  await cells[0].type('ETH'); await cells[1].type('1.234,5')
  await clickText('salvar posições')
  await waitText('salvo; o total atualiza em segundos')
  step('posições salvas')
  // A coleta pedida ao salvar fala com as corretoras de verdade (as contas
  // reais do dev entram junto): recarrega até ela chegar.
  let hero = 'sem coleta ainda'
  for (let i = 0; i < 30 && hero.includes('sem coleta'); i++) {
    await sleep(2000)
    await page.goto(`${BASE}/p/${PID}`, { waitUntil: 'networkidle0' })
    hero = await page.$eval('.hero-value', (e) => e.textContent)
  }
  if (hero.includes('sem coleta')) throw new Error('a coleta não chegou em 60 s')
  step(`total do portfólio depois da coleta: ${hero}`)

  step('investido: valor que não dá para entender avisa, "12.345" vira doze mil')
  await clickText('+ quanto você investiu? (para ver o resultado)')
  await page.waitForSelector('.invested-form input')
  await page.type('.invested-form input', 'vinte mil')
  await clickText('salvar')
  await waitText('Não entendi esse valor')
  await page.$eval('.invested-form input', (el) => { el.value = '' })
  const inv = await page.$('.invested-form input')
  await inv.click({ clickCount: 3 })
  await inv.press('Backspace')
  await inv.type('12.345')
  await clickText('salvar')
  await waitText('Investido R$ 12.345,00')
  step('investido salvo: R$ 12.345,00')

  step('remover a Binance e2e')
  await page.goto(`${BASE}/p/${PID}/contas`, { waitUntil: 'networkidle0' })
  const accs = await page.$$('.account')
  for (const a of accs) {
    if ((await a.evaluate((e) => e.innerText)).includes('Binance e2e')) {
      const btns = await a.$$('button')
      for (const b of btns) if ((await b.evaluate((e) => e.textContent.trim())) === 'remover') { await b.click(); break }
      await page.waitForSelector('.panel-danger')
      const danger = await a.$$('.panel-danger button')
      await danger[0].click()
      break
    }
  }
  await page.waitForFunction(() => !document.body.innerText.includes('Binance e2e'), { timeout: 10000 })
  step('removida da lista')

  console.log('vazamentos da chave em requisição:', leaks.length ? leaks : 'nenhum')
  console.log(logs.length ? logs.join('\n') : 'sem erros de console')
  await browser.close()
  if (leaks.length || logs.length) process.exit(1)
})().catch(async (e) => {
  console.error('FALHOU:', e.message)
  try {
    const pages = await (await globalThis.__browser).pages()
    const p = pages[pages.length - 1]
    await p.screenshot({ path: '/out/e2e-fail.png', fullPage: true }).catch(() => {})
    console.error('erros na tela:', await p.evaluate(() => [...document.querySelectorAll('.notice-error')].map((n) => n.innerText).join(' | ')))
  } catch (err) { console.error('sem captura:', err.message) }
  console.error(globalThis.__logs?.join('\n'))
  process.exit(1)
})
