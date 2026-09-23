const isProduction = process.env.NODE_ENV === 'production'

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function int(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) ? n : fallback
}

export const config = {
  isProduction,
  port: int('PORT', 3001),

  // Montado pelo compose. Cada processo recebe a URL do seu role: migrate é o
  // dono, api é app_api, worker é app_worker.
  databaseUrl: process.env.DATABASE_URL ?? '',

  // Só o worker recebe. A privada nunca existe no container da api.
  sealingPrivateKeyFile: process.env.SEALING_PRIVATE_KEY_FILE ?? '',
  sealingPublicKeyFile: process.env.SEALING_PUBLIC_KEY_FILE ?? '',

  // ── Api ──
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:5175/api/auth/google/callback',
  // Onde o app mora, como o navegador escreve no Origin. Em prod, toda escrita
  // tem que vir exatamente daqui. Em dev vale o Host da requisição (LAN, celular).
  clientOrigin: (process.env.CLIENT_ORIGIN ?? '').replace(/\/$/, ''),
  // Quem pode entrar. Vazio em prod não sobe: o app é fechado.
  allowedEmails: list(process.env.ALLOWED_EMAILS),
  // Entrar sem Google, como o usuário `dev:local` (o do `make seal-account`).
  devLogin: process.env.DEV_LOGIN === 'true',
  // Cookie Secure exige HTTPS; ligado por default em prod.
  secureCookies: (process.env.SECURE_COOKIES ?? (isProduction ? 'true' : 'false')) === 'true',
  // Quantos proxies confiáveis na frente da api (para o IP do rate limit).
  // 1 = nginx do container ou Vite; 2 = nginx de borda + nginx do container.
  trustProxyHops: int('TRUST_PROXY_HOPS', 1),
  // Posição abaixo disso (em dólar) fica fora de /positions.
  hideBelowUsd: Number(process.env.HIDE_BELOW_USD || '0.10'),
  // IP de saída do worker, para a tela sugerir vincular a chave a ele.
  egressIp: process.env.EGRESS_IP ?? '',

  // ── Worker ──
  collectIntervalMin: int('COLLECT_INTERVAL_MIN', 15),
  // Valem 1 dólar; não são cotadas.
  // `||`, não `??`: o compose passa a variável vazia quando ela não está no .env.
  stablecoins: (process.env.STABLECOINS || 'USDT,USDC,FDUSD,BUSD,TUSD,USDP,DAI,USDE,PYUSD,USD1')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  // Conta pendente que não conseguiu falar com a corretora vira `error` depois disso.
  pendingMaxAttempts: int('PENDING_MAX_ATTEMPTS', 5),
  // Contas coletadas ao mesmo tempo.
  collectConcurrency: 4,
}

export function assertConfig(extra: string[] = []): void {
  const problems = [...extra]
  if (!config.databaseUrl) problems.push('DATABASE_URL is empty')
  if (config.collectIntervalMin < 1) problems.push('COLLECT_INTERVAL_MIN must be at least 1')
  if (!Number.isFinite(config.hideBelowUsd) || config.hideBelowUsd < 0) problems.push('HIDE_BELOW_USD must be a non-negative number')
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)
  }
}

/** O que só a api precisa. Em prod, nada de atalho nem app aberto. */
export function assertApiConfig(): void {
  const problems: string[] = []
  if (!Number.isInteger(config.trustProxyHops) || config.trustProxyHops < 0) problems.push('TRUST_PROXY_HOPS must be a non-negative integer')
  if (config.isProduction) {
    if (config.devLogin) problems.push('DEV_LOGIN must never be on in production: it lets anyone in without Google')
    if (!config.clientOrigin.startsWith('https://')) problems.push('CLIENT_ORIGIN must be the https:// address of the app in production')
    if (config.allowedEmails.length === 0) problems.push('ALLOWED_EMAILS is empty: nobody could sign in')
    if (!config.googleClientId || !config.googleClientSecret) problems.push('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are empty')
    if (!config.secureCookies) problems.push('SECURE_COOKIES must be true in production')
  }
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)
  }
}
