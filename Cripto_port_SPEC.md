# Crypto Portfolio Tracker — especificação

Sucessor da planilha "Crypto Portfolio Tracker v3". PWA multiusuário que consolida saldos da Binance e da OKX a partir de chaves de API **somente leitura**, com preços das próprias corretoras e ATH do cryptoprices.cc.

Status: rascunho v1, setembro de 2026.

## 1. Objetivo

- Acabar com a entrada manual: quantidades, preço, variação de 24h/7d e câmbio vêm das corretoras; o ATH vem do cryptoprices.cc.
- Vários portfólios por usuário, cada um com suas contas (chaves de API ou posições manuais).
- Multiusuário desde o primeiro commit, mesmo com um usuário só no começo.
- PWA instalável, mobile-first, que abre offline mostrando o último dado conhecido.

### Fora de escopo (v1)

- Qualquer escrita nas corretoras (ordem, saque, transferência). O sistema **recusa** chaves com essas permissões.
- Relatório de IR, custo médio, P&L por lote.
- Carteiras on-chain: o que estiver fora de corretora entra como posição manual.
- App nativo. Moedas de exibição além de USD e BRL.

## 2. Arquitetura

```
 PWA (React) ──HTTPS──> Caddy ──/api──> API (Fastify) ───┐
                          └──> build estático             ├──> Postgres
                                           Worker ────────┘
                                             └──> Binance, OKX, cryptoprices.cc
```

| Componente | Faz | Não faz |
|---|---|---|
| web | UI; sela as credenciais no navegador com a chave pública do worker | nunca envia segredo em claro |
| api | login Google (BFF), sessões, autorização, CRUD, leitura das views | não tem a chave privada; o role do banco nem consegue ler o ciphertext |
| worker | valida chaves, coleta saldos, cotações, ATH, alertas e push | não expõe porta |
| postgres | fonte da verdade; RLS; views calculam os valores | — |

Princípio: **fatos no banco, valores nas views.** Guardamos quantidade, preço e câmbio; valor em US$/R$, distância do ATH e alocação saem das views. Mudar uma regra de cálculo recalcula o histórico inteiro sem migrar dado.

## 3. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Repo | monorepo com pnpm workspaces | TypeScript de ponta a ponta; tipos e schemas compartilhados |
| Web | Vite + React + TS, vite-plugin-pwa (injectManifest), TanStack Query com persistência em IndexedDB, Recharts | injectManifest porque o service worker precisa tratar push |
| API | Node LTS + Fastify + zod, openid-client | cliente OIDC certificado, PKCE pronto |
| Worker | Node LTS + ccxt + pg + web-push | ccxt nasceu em JS; LISTEN/NOTIFY pelo pg |
| Cripto | libsodium (`crypto_box_seal`) via libsodium-wrappers | a mesma lib no navegador e no worker |
| Banco | Postgres ≥ 15; migrations em SQL puro (dbmate); queries com Kysely + kysely-codegen | views com `security_invoker` exigem 15+; SQL é a fonte da verdade e os tipos são gerados do banco |
| Infra | Docker Compose: postgres, api, worker, caddy | Caddy serve o build da web, faz proxy de `/api` e HTTPS automático |
| Testes de API | coleção Bruno versionada em `docs/bruno` | local, sem conta em nuvem |

Worker em Python também funcionaria (o ccxt tem os mesmos métodos), mas aí são duas linguagens e duas implementações de sealed box.

## 4. Repositório

```
crypto-tracker/
├── apps/
│   ├── web/          # PWA
│   ├── api/          # Fastify (BFF + auth)
│   └── worker/       # coleta, validação de chaves, ATH, alertas
├── packages/
│   ├── shared/       # schemas zod, tipos, cálculos puros, formatação pt-BR
│   └── sealing/      # seal/open com libsodium (web + worker)
├── db/
│   ├── migrations/   # SQL (dbmate)
│   └── tests/        # testes de RLS e das views
├── infra/
│   ├── compose.yaml
│   └── Caddyfile
├── scripts/          # gerar par de chaves, allowlist, seed
└── docs/
    ├── SPEC.md
    └── bruno/
```

## 5. Modelo de dados

Esboço; tipos e constraints finais ficam nas migrations. Quantidades e valores são `numeric`.

```sql
-- identidade e acesso
app_user   (id uuid pk, google_sub text unique not null, email citext not null,
            name text, created_at, last_login_at)
allowlist  (email citext pk, invited_by uuid null references app_user, created_at)
session    (token_hash bytea pk,            -- sha256 do token do cookie
            user_id uuid, created_at, last_seen_at, expires_at, user_agent text)

-- portfólios
portfolio        (id uuid pk, name text, invested_brl numeric null,
                  created_at, archived_at null)
portfolio_member (portfolio_id uuid, user_id uuid,
                  role text check (role in ('owner', 'viewer')),
                  primary key (portfolio_id, user_id))

-- contas
account (id uuid pk, portfolio_id uuid,
         kind   text check (kind in ('binance', 'okx', 'manual')),
         label  text,
         status text check (status in ('pending', 'active', 'rejected', 'blocked', 'error')),
         status_reason      text,
         sealed_credentials bytea null,         -- crypto_box_seal({apiKey, secret, passphrase})
         key_hint           text null,          -- últimos 4 caracteres da api key
         key_fingerprint    bytea null unique,  -- sha256(api key), calculado no navegador
         exchange_uid       text null,          -- uid da conta na corretora
         permissions        jsonb null,         -- resposta crua da última checagem
         ip_restricted      boolean null,
         checked_at         timestamptz null,
         created_by uuid, created_at,
         unique (kind, exchange_uid))
manual_holding (id uuid pk, account_id uuid, ticker text, amount numeric,
                note text, updated_at)

-- mercado (global, sem RLS)
asset (ticker text pk, ath_usd numeric, ath_checked_at timestamptz)

-- coletas
run          (id bigserial pk, started_at, finished_at, usd_brl numeric, status text)
account_sync (run_id, account_id, ok boolean, error text,
              primary key (run_id, account_id))
balance      (run_id, account_id, ticker text, wallet text, amount numeric,
              primary key (run_id, account_id, ticker, wallet))
quote        (run_id, ticker text, price_usd numeric, chg_24h numeric, chg_7d numeric,
              source text, primary key (run_id, ticker))

-- notificações e auditoria
push_subscription (id uuid pk, user_id uuid, endpoint text unique,
                   p256dh text, auth text, created_at)
alert_rule        (id uuid pk, user_id uuid, portfolio_id uuid null,
                   kind text, params jsonb, enabled boolean)
audit_log         (id bigserial pk, user_id uuid null, action text,
                   target text, meta jsonb, at timestamptz)
```

Regras que o modelo carrega:

- **Conta é a unidade, portfólio é agrupamento.** Posição manual é uma conta `kind = 'manual'` sem credencial. O worker copia `manual_holding` para `balance` a cada run, então todo saldo tem o mesmo formato e o mesmo histórico.
- **Uma conta de corretora entra uma vez só.** `key_fingerprint` impede a mesma chave duas vezes; `unique (kind, exchange_uid)` impede a mesma conta com chaves diferentes (a Binance devolve `uid` em `/api/v3/account`; a OKX, em `/api/v5/account/config`). Pra outra pessoa ver um portfólio, usa-se `portfolio_member`, não uma segunda conta. É isso que evita contar saldo duas vezes no consolidado.
- **Não dá pra dividir uma conta de corretora entre portfólios**: a API só devolve o saldo total. Separar dentro da mesma corretora exige subconta, com chaves próprias.
- `wallet` guarda a origem fina (`spot`, `funding`, `earn_flexible`, `earn_locked`, `trading`, `savings`, `staking`, `manual`) e substitui as linhas 22 a 30 da planilha.

### Views

Todas criadas com `with (security_invoker = true)`. Sem isso, a view roda com as permissões do dono e **ignora o RLS** das tabelas.

| View | Grão | Conteúdo |
|---|---|---|
| `v_account_latest` | conta | saldos do último sync ok da conta + `stale` (último sync falhou ou é velho demais) |
| `v_position` | portfólio × ticker | colunas da seção 9 |
| `v_position_source` | portfólio × conta × wallet × ticker | "onde está" |
| `v_portfolio_summary` | portfólio | totais, variações, totais no ATH, investido, resultado, `stale` |
| `v_portfolio_history` | portfólio × run | total em US$ e R$ por run, com o último saldo bom de cada conta; materializar se ficar lento |

Carry-forward: se uma conta falha num run, os totais usam o último saldo bom dela e marcam `stale`, em vez de a carteira "despencar".

### Roles e RLS

| Role | Uso | Detalhes |
|---|---|---|
| `app_owner` | migrations, dono dos objetos | não é usado em runtime |
| `app_api` | API | sujeito a RLS (`FORCE ROW LEVEL SECURITY`); **sem SELECT na coluna `sealed_credentials`**, só INSERT/UPDATE |
| `app_worker` | worker | `BYPASSRLS`; único que lê o ciphertext |
| `app_ro` | DBeaver, debug | opcional; SELECT só nas views |

- A API abre transação e roda `select set_config('app.user_id', $1, true)`; as policies usam `current_setting('app.user_id', true)::uuid`.
- A checagem de membership fica numa função `security definer stable` (`is_member(portfolio_id, min_role)`), pra evitar recursão entre policies.
- `asset`, `quote` e `run` são globais e legíveis pelo `app_api`: dado de mercado não é privado.

## 6. Credenciais

### Fluxo de cadastro

1. O usuário escolhe a corretora; a tela mostra como criar uma chave **só leitura** (Binance: só "Enable Reading"; OKX: permissão "Read" + passphrase).
2. O navegador calcula `key_fingerprint = sha256(apiKey)` e `key_hint`, e sela `{apiKey, secret, passphrase}` com `crypto_box_seal` usando a chave pública do worker, **embutida no build** (`VITE_SEALING_PUBLIC_KEY`), não buscada em runtime.
3. A API grava a conta como `pending` (sem conseguir ler o ciphertext depois), registra no `audit_log` e faz `NOTIFY account_pending`, entregue no commit.
4. O worker abre a caixa, valida as permissões (regras abaixo), lê o `uid` e testa uma leitura de saldo:
   - tudo ok → `active`; grava `permissions`, `ip_restricted`, `exchange_uid`, `checked_at`;
   - permissão além de leitura → `rejected` com motivo, e **apaga `sealed_credentials` na hora**;
   - `uid` já cadastrado → `rejected` ("essa conta já está cadastrada") e apaga;
   - erro de rede ou da API → continua `pending`, com retry e backoff; depois de N tentativas vira `error`. Nunca ativa na dúvida.
5. A UI acompanha o status (polling curto) até sair de `pending`.

Trocar a chave (`PUT /api/accounts/:id/credentials`) segue o mesmo fluxo e exige o mesmo `exchange_uid`: chave de outra conta é recusada, pra não misturar históricos.

### Regras de permissão (negar por padrão)

- **Binance** (`sapiGetAccountApiRestrictions`): o conjunto de flags `enable*`/`permits*` com valor `true` precisa conter `enableReading` e estar contido em `{enableReading, enableFixReadOnly}`. Qualquer flag desconhecida ligada reprova, porque a Binance adiciona flags novas com o tempo.
- **OKX** (`privateGetAccountConfig`): `data[0].perm`, separado por vírgula, precisa ser exatamente `{read_only}`.
- **Revalidação a cada run**, antes de coletar. Se a permissão aumentou na corretora: `blocked`, apaga o ciphertext, audita e avisa o usuário ("crie outra chave só leitura e revogue esta").

### Chave privada do worker

- Gerada por `scripts/keys` (par X25519). A pública vai pro build da web; a privada vira um arquivo montado só no container do worker (read-only, `chmod 600`).
- Backup offline, separado do banco. Perder a chave privada não perde dinheiro nem histórico: só obriga a colar chaves novas.

### Modelo de ameaças

| Cenário | Resultado |
|---|---|
| Web ou API comprometida | chaves guardadas continuam ilegíveis; chaves coladas durante o comprometimento podem vazar, mas são só leitura |
| Dump do banco vaza | ciphertext inútil sem a chave privada |
| Worker comprometido | lê todas as chaves, que são só leitura: vaza saldo, não dinheiro |
| Usuário cola chave com poder demais | rejeitada e apagada |
| Chave ganha poder depois | bloqueada e apagada no run seguinte |
| Bug de autorização na API | o RLS no Postgres segura |

Tudo converge pra "no pior caso, alguém vê saldos". A verificação de permissão é a peça que sustenta isso.

O `audit_log` registra login, cadastro, validação, rejeição, bloqueio e remoção de conta, e mudanças de membros.

## 7. Autenticação e sessão

- Google OIDC, authorization code + PKCE, conduzido pela API (BFF) com `openid-client`; escopos `openid email profile`. O React nunca vê token.
- Só entra quem tem `email_verified` e está na `allowlist`. O primeiro login vincula `google_sub`; dali em diante a identidade é o `sub`, não o e-mail. O primeiro e-mail entra via `scripts/allow`.
- Sessão no servidor: token aleatório de 32 bytes no cookie `__Host-session` (`HttpOnly; Secure; SameSite=Lax; Path=/`); o banco guarda só o sha256.
- Mutations exigem `Origin` igual à origem do app, além do SameSite.
- Rate limit no login e no cadastro de conta.
- Tela de sessões com "sair de todos os dispositivos". O logout apaga a sessão, e o cliente limpa IndexedDB e o cache de queries.
- Web e API na mesma origem (Caddy: `/` estático, `/api` proxy): sem CORS.

## 8. Worker

Processo de longa duração com dois gatilhos: timer (padrão 15 min, configurável) e `LISTEN account_pending`. O ciclo de coleta roda sob `pg_try_advisory_lock`; se já houver um rodando, pula.

### Ciclo

1. Abre um `run`.
2. Para cada conta `active` (em paralelo, limite ~4): abre a caixa → revalida permissões → coleta saldos → grava `balance` e `account_sync`. Contas manuais: copia `manual_holding`.
3. Tickers a cotar = saldos deste run + últimos saldos bons das contas que falharam.
4. Cotações (8.2) e câmbio USDT/BRL da Binance em `run.usd_brl`.
5. ATH: tickers com `ath_checked_at` de mais de 24h → `GET https://cryptoprices.cc/{TICKER}/ATH/`. A resposta precisa ser número. Se vier menor que o guardado, mantém o guardado e loga aviso: ATH não cai, então provavelmente o símbolo resolveu pro token errado.
6. Fecha o run e avalia alertas (fase 4).

### 8.1 Saldos

| Corretora | Carteira | Chamada ccxt |
|---|---|---|
| Binance | spot | `fetchBalance()` |
| Binance | funding | `fetchBalance({ type: 'funding' })` |
| Binance | earn flexível | `sapiGetSimpleEarnFlexiblePosition` (paginado, `size` até 100; `asset`, `totalAmount`) |
| Binance | earn travado | `sapiGetSimpleEarnLockedPosition` (`asset`, `amount`) |
| OKX | trading | `fetchBalance()` |
| OKX | funding | `fetchBalance({ type: 'funding' })` |
| OKX | earn | `privateGetFinanceSavingsBalance` (`ccy`, `amt`) |
| OKX | staking | `privateGetFinanceStakingDefiOrdersActive` (`investData[].ccy`, `amt`) |

- O spot da Binance pode listar o earn flexível como `LD<ativo>`. Ignorar `LD<X>` **só se `X` estiver nas posições flexíveis**: `LDO` é ticker real.
- ccxt: `enableRateLimit` e `options.fetchMarkets.types = ['spot']` nas duas; na Binance, `adjustForTimeDifference: true`; na OKX, a passphrase vai em `password`.

### 8.2 Cotações

- Binance primeiro: `fetchTickers` para preço e 24h; ticker de janela móvel (`publicGetTicker` com `windowSize: '7d'`, até 100 símbolos por chamada) para o 7d.
- O que não estiver na Binance: OKX `fetchTickers` + `fetchOHLCV(symbol, '1d')` para o 7d.
- Stablecoins (lista configurável: USDT, USDC, FDUSD…) valem 1.
- Preço em USDT é tratado como USD. Câmbio = USDT/BRL da Binance (dólar-cripto: o valor que se obteria vendendo lá).

### 8.3 IP de saída

Se o worker tiver IP fixo, ele aparece em `GET /api/meta` e a tela de contas sugere vinculá-lo à chave na corretora.

## 9. Cálculos (paridade com a planilha)

| Planilha | Campo | Definição |
|---|---|---|
| B `AMOUNT` | `qty` | soma dos saldos do ticker no portfólio (último saldo bom de cada conta) |
| C `DOLAR PRICE` | `price_usd` | cotação em USDT; stablecoin = 1 |
| D `ATH` | `ath_usd` | `max(asset.ath_usd, price_usd)`, pra distância nunca ficar negativa |
| E `% to ATH` | `pct_below_ath` | `(1 − price_usd / ath_usd) × 100` |
| F `DOLAR AMOUNT` | `value_usd` | `qty × price_usd` |
| G `D ON ATH` | `value_at_ath_usd` | `qty × ath_usd` |
| H `R ON ATH` | `value_at_ath_brl` | `value_at_ath_usd × usd_brl` |
| I `PERCENT` | `allocation_pct` | `value_usd / Σ value_usd × 100` |
| J `REAL PRICE` | `price_brl` | `price_usd × usd_brl` |
| K `REAL AMOUNT` | `value_brl` | `value_usd × usd_brl` |
| L `DAY`, M `7` | `chg_24h`, `chg_7d` | da corretora |
| L17 | `chg_24h` do portfólio | `(Σv / Σ(v / (1 + c/100)) − 1) × 100`; é exato, a planilha usa média ponderada (diferença pequena) |
| J17, J18, K18 | `invested_brl`, `result_pct` | `portfolio.invested_brl` (manual); `(value_brl / invested_brl − 1) × 100` |

Posições abaixo de US$ 0,10 ficam ocultas (limite configurável).

## 10. API

| Método | Rota | Quem | Notas |
|---|---|---|---|
| GET | `/api/auth/google`, `/api/auth/callback` | — | OIDC com PKCE; allowlist; cria sessão |
| POST | `/api/auth/logout` | sessão | |
| GET | `/api/me` | sessão | usuário e portfólios com papel |
| GET, POST | `/api/portfolios` | sessão | quem cria vira owner |
| PATCH, DELETE | `/api/portfolios/:id` | owner | nome e investido; DELETE arquiva |
| GET | `/api/portfolios/:id/summary`, `/positions`, `/sources` | member | leem as views |
| GET | `/api/portfolios/:id/history?range=` | member | 7d, 30d, 90d, 1y ou all; reamostrado no servidor (1 ponto por dia acima de 30d) |
| GET, POST | `/api/portfolios/:id/accounts` | member, owner | POST recebe `{kind, label, sealed, fingerprint, hint}` |
| PUT | `/api/accounts/:id/credentials` | owner | troca a chave; mesma conta na corretora |
| DELETE | `/api/accounts/:id` | owner | apaga o ciphertext; o histórico fica |
| GET, PUT | `/api/accounts/:id/holdings` | member, owner | posições manuais |
| GET, POST, DELETE | `/api/portfolios/:id/members` | owner | compartilhar |
| GET, DELETE | `/api/sessions` | sessão | dispositivos; sair de todos |
| POST, DELETE | `/api/push/subscription` | sessão | fase 4 |
| GET | `/api/meta` | sessão | último run, status do worker, IP de saída |

Tudo validado com zod. Erros com mensagem pra humano ("a chave tem permissão de saque"), não código cru.

## 11. PWA

### Telas

1. **Entrar**: botão do Google; se o e-mail não estiver na allowlist, a tela diz isso com clareza.
2. **Início**: total consolidado dos portfólios em que o usuário é owner; lista de portfólios com total em R$, 24h, 7d e aviso de dado defasado.
3. **Portfólio**: cabeçalho com total R$/US$, 24h/7d, "se tudo voltar ao ATH: R$ X (N×)" e resultado sobre o investido; rosca de alocação; posições (no celular, linha compacta com ticker, valor e 24h, que expande para as demais colunas); evolução no tempo; "onde está", por conta e carteira.
4. **Contas**: status de cada conta (pendente, ativa, rejeitada com motivo, bloqueada); adicionar conta com o passo a passo da corretora; trocar chave; remover, lembrando de revogar na corretora; posições manuais.
5. **Membros**: convidar por e-mail como owner ou viewer.
6. **Ajustes**: notificações, sessões e dispositivos, sair.

A chave nunca volta pra tela: aparecem rótulo, `…a1b2`, permissões, status e último sync.

### Offline e cache

- O service worker pré-cacheia **só o app shell** e nunca cacheia `/api`.
- Dados: TanStack Query persistido em IndexedDB. Offline, a tela mostra o último dado com "atualizado em …".
- Offline, mutations ficam desabilitadas: nada de fila de escrita, muito menos de credenciais.
- O logout limpa IndexedDB e o cache de queries.

### Instalação e push

- Manifest com ícones 192/512 e maskable, `display: standalone`, `apple-touch-icon`.
- iOS: push só funciona com o app instalado na tela inicial (16.4+).
- **Risco a validar cedo:** login Google com o PWA instalado no iOS.
- Push (fase 4): VAPID; inscrição em `push_subscription`; o worker envia com `web-push`. Alertas: queda de X% em 24h, ativo a X% do ATH ou novo ATH, conta rejeitada ou bloqueada, sync falhando N vezes seguidas.

### Cabeçalhos (Caddy)

CSP estrita (`default-src 'self'`, `frame-ancestors 'none'`), `Referrer-Policy: no-referrer`, HSTS. Verificar se a build da libsodium exige `'wasm-unsafe-eval'` no `script-src`.

### Direção de UI

- O número principal é o total em R$. O elemento característico é a **distância do ATH**, por ativo (barra do preço até o ATH) e no cabeçalho.
- Variação sempre com sinal (+/−), não só cor. Números com `font-variant-numeric: tabular-nums` e formato pt-BR.

## 12. Infra

- `compose.yaml`: `postgres` (volume), `api`, `worker` (monta a chave privada), `caddy` (build da web + proxy + TLS).
- HTTPS é obrigatório: service worker e redirect do Google exigem. Duas saídas: domínio público com Caddy e Let's Encrypt, ou acesso privado via Tailscale, que fornece certificado pro domínio `*.ts.net`.
- Backup: `pg_dump` diário; chave privada do worker guardada offline, à parte.
- Variáveis: `DATABASE_URL_API`, `DATABASE_URL_WORKER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_ORIGIN`, `SEALING_PRIVATE_KEY_FILE`, `VITE_SEALING_PUBLIC_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `COLLECT_INTERVAL_MIN`.

## 13. Fases

**F0 — Fundação**
- Monorepo, compose com Postgres, migrations (tabelas, roles, RLS, views), `scripts/keys`, `scripts/allow`.
- Aceite: migra do zero; testes de RLS provam que o usuário A não vê nada do B e que `app_api` não consegue ler `sealed_credentials`.

**F1 — Worker**
- Coleta completa, validação de chaves, cotações, ATH. Contas cadastradas por script que sela com a chave pública, do mesmo jeito que o navegador fará.
- Aceite: um run preenche `balance`, `quote` e `run`; os valores batem com a planilha (tolerância pela diferença de horário); chave com trade é rejeitada e apagada; conta com erro aparece `stale` sem derrubar o total.

**F2 — API**
- Login, allowlist, sessões, CRUD, leitura das views, cadastro de conta selada com NOTIFY.
- Aceite: coleção Bruno cobrindo todas as rotas; mutation com `Origin` errado falha; e-mail fora da allowlist não entra.

**F3 — PWA**
- Telas 1 a 4 e 6, instalação, leitura offline, cadastro de conta com selagem no navegador.
- Aceite: instala no Android e no iOS; login Google funciona com o app instalado; offline mostra o último dado com horário.

**F4 — Alertas e push**
- VAPID, inscrição, regras de alerta, envio pelo worker.
- Aceite: a notificação chega com o app fechado (Android e iOS instalado).

**F5 — Depois**
- Tela de membros, reamostragem e retenção do histórico, P&L real pelo histórico de depósitos, carteiras on-chain, exportar CSV.

## 14. Testes

- RLS e views contra Postgres real, em container.
- Permissões com fixtures: só leitura passa; trade reprova; flag desconhecida reprova; erro da API mantém `pending`.
- Parsing de saldos com respostas gravadas do ccxt, incluindo o caso `LD<X>` × `LDO`.
- Cálculos: um snapshot da planilha como caso de teste de paridade.

## 15. Em aberto

- Onde roda (servidor em casa ou VPS) e como é acessado (domínio público ou Tailscale). Isso define HTTPS, redirect do Google e se dá pra usar whitelist de IP.
- Intervalo de coleta e política de retenção do histórico.
- Câmbio: USDT/BRL (padrão) ou dólar comercial.
- Preço para posições manuais de moedas fora da Binance e da OKX.
- Nome do app.
