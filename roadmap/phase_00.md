# Fase 0 — Esqueleto ✅

Tudo de pé, nada de negócio ainda. Copiado do `shouldWe` o que deu, subindo as
versões (tabela *Versões* do [ROADMAP](../ROADMAP.md)).

## Tarefas

- [x] **0.1** `git init`, `.gitignore` (`.env`, `secrets/`, `backups/`), `make_cmd/` copiado
- [x] **0.2** `docker-compose.yml` com perfis `dev` e `prod`: `db`, `migrate`, `api`, `worker`, `frontend`
- [x] **0.3** Dockerfiles multi-stage (`dev` / `builder` / `prod`) em `node:26-alpine`;
      `postgres:18-alpine` com o volume em `/var/lib/postgresql`; `nginx:1.31-alpine`
- [x] **0.4** TypeScript 7: backend ESM com `module`/`moduleResolution: nodenext`,
      frontend com `bundler`; `make typecheck` roda o `tsc --noEmit` dos dois
- [x] **0.5** Backend: Fastify com `/api/health` (200 só se o `select 1` passar)
- [x] **0.6** Worker: mesmo pacote, `src/worker/main.ts`; confere a chave de selagem e
      grava um sinal de vida por minuto em `worker_status`
- [x] **0.7** Frontend: Vite com proxy de `/api`, uma página que mostra se api e banco estão no ar
- [x] **0.8** Runner de migration do tarot, num serviço `migrate` que roda uma vez;
      `api` e `worker` só sobem depois dele terminar
- [x] **0.9** Dois roles no banco, `app_api` e `app_worker`, com a senha vinda do `.env`
      (o runner faz `ALTER ROLE` no fim; senha nunca vai para arquivo `.sql`)
- [x] **0.10** `make keys`: gera o par de selagem de dev e de prod (pública em `keys/`,
      privada em `secrets/`)
- [x] **0.11** Makefile com menu: `dev`, `prod`, `down`, `logs`, `ps`, `env`, `keys`,
      `migrate`, `db-shell`, `db-backup`, `smoke`, `typecheck`, `backend-add`, `frontend-add`

## Pronto quando

Numa máquina só com Docker, `make env && make keys && make dev` sobe em
`localhost:5175`, a página abre, e `scripts/infra-smoke.ts` confirma o health e que
cada role conecta.

## O que a verificação achou

- **O TypeScript 7 não carrega mais `@types/*` sozinho.** Sem `"types": ["node"]` no
  tsconfig, `process` não existe. Os dois tsconfig listam os tipos explicitamente.
- **O Node 26 roda `.ts` direto**, sem tsx. O `make keys` usa isso: `node:26-alpine`
  puro, sem `npm install`, e X25519 do `node:crypto` é o mesmo formato de chave da
  libsodium. O backend importa com extensão `.ts` e o `tsc` troca por `.js` no build
  (`rewriteRelativeImportExtensions`).
- **O nome do projeto no compose vinha da pasta**, e o volume saía como
  `portfolio_tracker_3_cripto-db-dev`. Agora `name: cripto` fixa rede e volumes.
  Corrigido antes de ter dado.
- **Postgres 18 com o volume em `/var/lib/postgresql`:** `down` + `up` mantém o banco
  (o migrate diz `nothing to migrate`).
- **Prod testado com `make prod` local:** o migrate recusa senha de dev (do dono e dos
  roles) e nada sobe; com senha forte sobe tudo, a api fica `healthy`, o nginx manda a
  CSP e o build traz a chave pública de **prod**, não a de dev.
- A chave pública entra no build pelo `additional_contexts` do compose, porque o
  contexto do frontend não enxerga `keys/`.
- A imagem de prod roda como `node` (uid 1000). Na VPS, a chave privada precisa ser
  legível por ele (`chown 1000:1000`); o worker diz isso no erro se não for. Fica
  para a fase 6.
- **Banco fora de alcance não derruba o worker.** Com a senha do `app_worker` trocada
  por engano no meio do teste, o sinal de vida falhou uma vez e voltou sozinho no
  minuto seguinte, sem reiniciar o container.
- **Cuidado com `APP_*_PASSWORD` exportado no shell:** o compose prefere o shell ao
  `.env`, e um `make migrate` assim troca as senhas dos roles de dev. `make migrate`
  de novo, sem o export, conserta.
