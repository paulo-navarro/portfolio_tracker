# Cripto

A planilha "Crypto Portfolio Tracker v3", sem digitar nada. Lê os saldos da
Binance e da OKX com chaves **só leitura** e mostra quanto você tem, em US$ e
R$, e quanto falta para o ATH. O plano inteiro está em [ROADMAP.md](ROADMAP.md).

```
navegador ──▶ nginx ──┬── /        PWA React
                      └── /api/*   api (Fastify) ──▶ Postgres ◀── worker ──▶ Binance, OKX
```

## Rodando

Só precisa de `docker`, `make` e `git`. Nada de node no host.

```bash
make env          # cria o .env
make keys         # gera as chaves de selagem (uma vez só)
make dev          # → http://localhost:5175
make smoke        # infra, permissões e paridade com a planilha
make typecheck
```

`make` sozinho abre o menu com todos os alvos.

Em dev só o Vite publica porta. api, worker e banco ficam na rede do compose, e
o Vite repassa `/api` para a api.

## Três processos, uma imagem

| Serviço | Role no banco | O que faz |
|---|---|---|
| `migrate` | dono | aplica `backend/migrations/*.sql`, acerta as senhas dos roles e sai |
| `api` | `app_api` | a API. Não consegue ler as credenciais das corretoras |
| `worker` | `app_worker` | coleta saldos e cotações. O único que lê as credenciais e o único que monta a chave privada |

`api` e `worker` só sobem depois que o `migrate` termina sem erro. Migration
nova em dev: `make migrate`.

O `make smoke` roda um quarto container, `smoke`, só em dev: ele conecta como
dono para montar fixture numa transação que sempre volta atrás, e como
`app_api` para conferir o que a api vê de verdade.

## Chaves de selagem

O navegador sela a chave da corretora com a chave pública do worker antes de
enviar; só o worker consegue abrir.

| Arquivo | O que é | Git |
|---|---|---|
| `keys/sealing.<env>.pub` | pública, entra no build do frontend | sim |
| `secrets/sealing.<env>.key` | privada, montada só no worker | **não** |

`make keys` nunca sobrescreve: trocar o par deixa ilegível toda chave de
corretora já cadastrada. **Guarde uma cópia de `secrets/sealing.prod.key` fora
desta máquina.** Perdê-la não perde dinheiro nem histórico, só obriga a
cadastrar as chaves de novo.

## Login

Google, com a lista de quem pode entrar em `ALLOWED_EMAILS`. Em dev,
`/api/auth/dev` entra sem Google como o usuário de dev (o mesmo do
`make seal-account`), enquanto `DEV_LOGIN=true`, que é o default do dev e nunca
vale em prod. A sessão fica no banco: "sair de todos os dispositivos" derruba
todas de verdade.

## Coleta

O worker coleta a cada 15 minutos (`COLLECT_INTERVAL_MIN`) e sempre que uma
conta é cadastrada. Enquanto as telas não existem, a conta entra por script:

```bash
make seal-account KIND=binance LABEL=Binance   # pede a chave sem eco
make collect                                   # força uma coleta e mostra o log
make market-live TICKERS="BTC ETH"             # cotação e ATH de verdade, sem chave
make demo                                      # a planilha como portfólio de demonstração
```

O `make demo` cria o portfólio "Planilha (demo)" com as posições da planilha
como contas manuais: o worker coleta ao vivo, e os 90 dias anteriores vêm dos
fechamentos diários reais da Binance. `make demo-clear` apaga.

A chave precisa ser **só leitura**. Qualquer outra permissão e ela é recusada e
apagada na hora; se ganhar permissão depois, na corretora, é bloqueada na coleta
seguinte.

## Produção

Vai para a VPS `76.13.172.71`, atrás do nginx de borda com certificado, em
**https://cripto.paulonavarro.com**. O container publica só em loopback
(`127.0.0.1:8084`).

```bash
make deploy          # push + pull + rebuild na VPS (recusa working tree sujo)
make prod-logs       # logs de lá
make prod-db-backup  # dump da produção para backups/
make prod-key        # manda a chave de selagem de produção (uma vez)
```

A primeira instalação está em [roadmap/phase_06.md](roadmap/phase_06.md). O
`.env` de produção vive só na VPS, a partir de `.env.prod.example`: o migrate
recusa senha fraca e a api recusa subir sem Google, sem `ALLOWED_EMAILS` ou com
o login de dev ligado.

## Testes

```bash
make smoke        # banco, permissões, paridade com a planilha, worker e api
make e2e          # contas pela tela, num Chrome headless (Docker)
make pwa-check    # instalação, cache e offline, contra o build de produção
make shots        # capturas de todas as telas em e2e/out/ (precisa do make demo)
```

## Dependências

```bash
make backend-add PKG=ccxt
make frontend-add PKG=@types/algo DEV=1
```

Os alvos atualizam `package.json` e o lock dentro de um container e recriam o
`node_modules` do serviço. Não use `docker compose up --build` sozinho depois de
mudar dependência: o `node_modules` é volume anônimo e o container ficaria com o
antigo.

## Banco

Postgres 18, um volume por ambiente (`cripto_cripto-db-dev`,
`cripto_cripto-db-prod`). **`docker compose down -v` apaga o histórico.**

```bash
make db-shell     # psql como dono
make db-backup    # dump para backups/
```
