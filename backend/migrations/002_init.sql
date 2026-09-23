-- Schema inteiro. Fatos aqui, valores nas views (004_views.sql).
--
-- Quantidade, preço, câmbio e variação são `numeric` sem (p, s): quantidade de
-- meme coin passa de 10^12 e preço de meme coin tem mais de 8 casas (BUG-001 do
-- GoldenGibbon foi Numeric(20, 8) estourando com PEPE).

-- ── Identidade ──────────────────────────────────────

create table app_user (
  id            uuid        primary key default uuidv7(),
  google_sub    text        not null unique,   -- a identidade é o sub, não o e-mail
  email         text        not null,
  name          text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table session (
  token_hash   bytea       primary key,         -- sha256 do token do cookie
  user_id      uuid        not null references app_user on delete cascade,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  user_agent   text
);

create index session_user_idx on session (user_id);

-- ── Portfólios ──────────────────────────────────────

create table portfolio (
  id           uuid        primary key default uuidv7(),
  name         text        not null check (length(trim(name)) between 1 and 60),
  invested_brl numeric     check (invested_brl >= 0),   -- J17 da planilha, digitado
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create table portfolio_member (
  portfolio_id uuid not null references portfolio on delete cascade,
  user_id      uuid not null references app_user on delete cascade,
  role         text not null check (role in ('owner', 'viewer')),
  primary key (portfolio_id, user_id)
);

create index portfolio_member_user_idx on portfolio_member (user_id);

-- ── Contas ──────────────────────────────────────────
-- Conta é a unidade; portfólio é o agrupamento. Remover conta não apaga a linha:
-- o ciphertext some e `removed_at` é preenchido, porque os saldos antigos
-- (histórico) continuam apontando para ela.

create table account (
  id                 uuid        primary key default uuidv7(),
  portfolio_id       uuid        not null references portfolio,
  kind               text        not null check (kind in ('binance', 'okx', 'manual')),
  label              text        not null check (length(trim(label)) between 1 and 40),
  status             text        not null default 'pending'
                                 check (status in ('pending', 'active', 'rejected', 'blocked', 'error')),
  status_reason      text,

  -- crypto_box_seal({apiKey, secret, passphrase}) com a chave pública do worker.
  -- app_api grava, mas não lê (003_grants.sql).
  sealed_credentials bytea,
  key_hint           text,          -- últimos 4 caracteres da api key
  key_fingerprint    bytea,         -- sha256(api key), calculado no navegador
  exchange_uid       text,          -- uid da conta na corretora
  permissions        jsonb,         -- resposta crua da última checagem
  ip_restricted      boolean,
  attempts           int         not null default 0,   -- tentativas em pending
  checked_at         timestamptz,

  created_by         uuid        not null references app_user,
  created_at         timestamptz not null default now(),
  removed_at         timestamptz,

  -- Conta manual não tem credencial nenhuma.
  check (kind <> 'manual' or (sealed_credentials is null and key_fingerprint is null and exchange_uid is null)),
  -- Conta removida não guarda credencial.
  check (removed_at is null or sealed_credentials is null)
);

-- A mesma conta de corretora entra uma vez só, senão o consolidado conta em
-- dobro. Parcial: uma conta removida pode ser cadastrada de novo.
create unique index account_fingerprint_uq on account (key_fingerprint)
  where key_fingerprint is not null and removed_at is null;
create unique index account_exchange_uid_uq on account (kind, exchange_uid)
  where exchange_uid is not null and removed_at is null;
create index account_portfolio_idx on account (portfolio_id);

-- Posição fora de corretora. O worker copia para `balance` a cada coleta.
create table manual_holding (
  id         uuid        primary key default uuidv7(),
  account_id uuid        not null references account on delete cascade,
  ticker     text        not null check (ticker ~ '^[A-Z0-9]{1,20}$'),
  amount     numeric     not null check (amount >= 0),
  note       text,
  updated_at timestamptz not null default now(),
  unique (account_id, ticker)
);

-- ── Mercado (global, não é de ninguém) ──────────────

create table asset (
  ticker         text        primary key check (ticker ~ '^[A-Z0-9]{1,20}$'),
  ath_usd        numeric     check (ath_usd > 0),
  ath_checked_at timestamptz
);

-- ── Coletas ─────────────────────────────────────────
-- Cada coleta é completa: conta que falhou entra com uma cópia do último saldo
-- bom e `account_sync.ok = false`. O banco guarda só a coleta mais recente e a
-- última de cada dia; o worker apaga as outras (fase 2). O cascade é o que
-- deixa esse delete ser uma linha só.

create table run (
  id          bigint      primary key generated always as identity,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text        not null default 'running' check (status in ('running', 'ok', 'failed')),
  usd_brl     numeric     check (usd_brl > 0),
  check (status <> 'ok' or (finished_at is not null and usd_brl is not null))
);

create table account_sync (
  run_id     bigint not null references run on delete cascade,
  account_id uuid   not null references account,
  ok         boolean not null,
  error      text,
  primary key (run_id, account_id)
);

create table balance (
  run_id     bigint  not null,
  account_id uuid    not null,
  ticker     text    not null check (ticker ~ '^[A-Z0-9]{1,20}$'),
  wallet     text    not null check (wallet in ('spot', 'funding', 'earn_flexible', 'earn_locked',
                                                'trading', 'savings', 'staking', 'manual')),
  amount     numeric not null check (amount >= 0),
  primary key (run_id, account_id, ticker, wallet),
  -- Todo saldo pertence a uma conta que o run conhece (ok ou copiada).
  foreign key (run_id, account_id) references account_sync on delete cascade
);

-- Stablecoin entra aqui com price_usd = 1, gravado pelo worker: a view não
-- precisa saber o que é stablecoin.
create table quote (
  run_id    bigint  not null references run on delete cascade,
  ticker    text    not null check (ticker ~ '^[A-Z0-9]{1,20}$'),
  price_usd numeric not null check (price_usd >= 0),
  chg_24h   numeric,          -- em %, da corretora; null se ela não mandou
  chg_7d    numeric,
  source    text    not null check (source in ('binance', 'okx', 'stable')),
  primary key (run_id, ticker)
);
