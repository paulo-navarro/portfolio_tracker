# Fase 3 — Login e API ✅

Entrar com o Google e ler os portfólios. Fluxo do Google copiado do tarot.

## Tarefas

- [x] **3.1** Login Google do tarot, mais PKCE; só entra e-mail verificado e em `ALLOWED_EMAILS`
- [x] **3.2** Sessão no banco: token aleatório no cookie, banco guarda só o hash.
      Diferente do tarot porque aqui precisa de "sair de todos os dispositivos"
- [x] **3.3** `DEV_LOGIN` para dev, igual ao tarot; recusado em prod. Entra como o usuário
      `dev:local`, o mesmo que o `make seal-account` usa, para ver as contas cadastradas por script
- [x] **3.4** Toda rota de portfólio confere se o usuário é membro
- [x] **3.5** Mutation exige `Origin` certo; rate limit no login e no cadastro de conta
- [x] **3.6** Rotas:
  - `GET /api/me`
  - `GET POST /api/portfolios`, `PATCH DELETE /api/portfolios/:id`
  - `GET /api/portfolios/:id/summary`, `/positions`, `/sources`, `/history?range=` (um ponto por dia)
  - `GET POST /api/portfolios/:id/accounts`, `PUT /api/accounts/:id/credentials`,
    `DELETE /api/accounts/:id`
  - `GET PUT /api/accounts/:id/holdings`
  - `GET DELETE /api/sessions`
  - `GET /api/meta` (última coleta, worker vivo, IP da VPS)
- [x] **3.7** Cadastro de conta faz `NOTIFY account_pending`: o worker valida na hora
- [x] **3.8** Posição abaixo de `HIDE_BELOW_USD` (US$ 0,10) fica fora de `/positions`
- [x] **3.9** Erro com frase para gente ("essa chave pode sacar"), não código

## Pronto quando

`scripts/api-smoke.ts` passa por todas as rotas: um usuário não vê portfólio de outro,
`Origin` errado dá 403, e sair de todos derruba a sessão do outro "aparelho".

Falta só o login com o Google de verdade, que precisa de um OAuth client (ver
`.env.example`). Até lá, em dev, o botão "entrar como dev" faz as vezes.

## O que a verificação achou

- **O smoke achou dois bugs na api:** a lista de portfólios dava 500 (`portfolio_id`
  ambíguo no join) e `chg_24h`/`chg_7d` saíam sem virar camelCase (a conversão só
  pegava letra depois do `_`, e ali vem dígito).
- **`unpriced` saía como texto** (`count(*)` é bigint, e o `pg` devolve bigint como
  string). Agora é número.
- **Origin contra Host em dev:** o proxy do Vite deixou de reescrever o Host
  (`changeOrigin` desligado). Assim a mesma checagem vale em `localhost` e pelo IP da
  LAN, no celular. Em prod o Origin tem que ser exatamente `CLIENT_ORIGIN`. Conferido
  passando pelo Vite: mesma origem 201, outra origem 403.
- **Rate limit por usuário, não por IP:** o limite roda no `preHandler`, depois da
  sessão. Cadastro de conta conta por usuário (senão o smoke, rodado algumas vezes na
  mesma hora, batia no limite); login, sem sessão, conta por IP. Conferido: a 21ª
  tentativa de login no mesmo minuto dá 429.
- **Portfólio de outra pessoa é 404, não 403:** não dá para descobrir que um id
  existe. Viewer tentando escrever é 403, porque ele sabe que o portfólio existe.
- **E-mail tirado do `ALLOWED_EMAILS` derruba a sessão** na requisição seguinte, e a
  linha some do banco.
- **O smoke da api segura o lock da coleta do começo ao fim.** Gravar posição manual
  pede uma coleta (`NOTIFY collect_now`), e o worker de verdade coletava as contas do
  smoke no meio do teste, deixando uma coleta vazia para trás.
- **Os tipos do Fastify não aceitam `trustProxy: número`**, e o erro aparecia como
  sobrecarga de HTTP/2. Virou uma função com a mesma semântica.
- **Portfólio arquivado continua sendo coletado.** Some das listas, mas as contas
  seguem com histórico. Se incomodar, o worker passa a pular portfólio arquivado.
