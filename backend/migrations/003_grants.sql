-- Quem pode o quê. Tabela nova numa migration futura precisa do seu grant:
-- sem ele, api e worker levam `permission denied`, que é o default certo.

-- ── app_api ─────────────────────────────────────────
-- A API. Grava a credencial selada, mas não consegue lê-la: a coluna
-- sealed_credentials fica fora do SELECT. Consequência para o código:
-- `select *` e `returning *` em account falham; liste as colunas.

grant select, insert, update on app_user to app_api;
grant select, insert, update, delete on session to app_api;
grant select, insert, update on portfolio to app_api;
grant select, insert, update, delete on portfolio_member to app_api;
grant select, insert, update, delete on manual_holding to app_api;

grant select (id, portfolio_id, kind, label, status, status_reason, key_hint, key_fingerprint,
              exchange_uid, permissions, ip_restricted, attempts, checked_at,
              created_by, created_at, removed_at)
  on account to app_api;
grant insert on account to app_api;
-- Trocar a chave (volta para pending), renomear, remover (apaga o ciphertext).
-- status, permissions, exchange_uid e checked_at são do worker.
grant update (label, status, status_reason, sealed_credentials, key_hint, key_fingerprint,
              attempts, removed_at)
  on account to app_api;

-- Dado de mercado e coletas: a API só lê.
grant select on asset, run, account_sync, balance, quote to app_api;

-- ── app_worker ──────────────────────────────────────
-- O worker. O único que lê sealed_credentials. Não mexe em usuário nem sessão.

grant select on app_user, portfolio, portfolio_member, manual_holding to app_worker;
grant select, update on account to app_worker;
grant select, insert, update on asset to app_worker;
grant select, insert, update, delete on run, account_sync, balance, quote to app_worker;
