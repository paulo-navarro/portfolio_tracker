# Portfolio_tracker_3 — roadmap

A planilha "Crypto Portfolio Tracker v3", sem digitar nada. Um PWA que lê os saldos
da Binance e da OKX com chaves **só leitura**, pega preço, 24h e 7d das próprias
corretoras e o ATH do cryptoprices.cc, e mostra o que a planilha mostra: quanto
tenho, em US$ e R$, quanto falta pro ATH e quanto vale se tudo voltar lá.

**Escala assumida:** eu, na VPS, com espaço para convidar alguém depois. Duas
corretoras, dezenas de ativos, uma coleta a cada 15 minutos. Nada aqui é
dimensionado para mais que isso, e isso é decisão, não omissão.

O rascunho completo (modelo de ameaças, chamadas do ccxt, paridade com a planilha)
está em [Cripto_port_SPEC.md](Cripto_port_SPEC.md). Onde os dois discordam, vale
este arquivo.

---

## Fases

Cada fase termina em algo que roda e não depende de fase posterior.

| # | Fase | Termina quando |
|---|---|---|
| 0 ✅ | [Esqueleto](roadmap/phase_00.md) | `make dev` sobe tudo numa máquina só com Docker |
| 1 ✅ | [Banco e cálculos](roadmap/phase_01.md) | as views reproduzem a planilha a partir de uma fixture |
| 2 ✅ | [Coleta](roadmap/phase_02.md) | `make collect` lê minhas contas reais e o total bate com a planilha |
| 3 ✅ | [Login e API](roadmap/phase_03.md) | entro com o Google e a API devolve os meus portfólios |
| 4 ✅ | [Telas](roadmap/phase_04.md) | abro no celular e vejo a planilha, só que bonita |
| 5 ✅ | [Contas pela tela](roadmap/phase_05.md) | cadastro uma chave pela tela e ela vira `ativa` |
| 6 ⏳ | [PWA e produção](roadmap/phase_06.md) | instalado no celular, no ar em https |
| 7 | [Alertas](roadmap/phase_07.md) | o celular avisa, com o app fechado, quando algo cai ou bate ATH |
| — | [Depois](roadmap/later.md) | ideias sem data |

---

## Stack

Mesmo molde do `tarot` e do `shouldWe`, os apps TS que já rodam na VPS. Do
`GoldenGibbon`, que já fala com a Binance de lá, vem o que ele já resolveu para
dado financeiro. Projeto novo começa na versão mais nova de tudo.

```
frontend  React + Vite, CSS na mão                    (tarot, shouldWe)
          TanStack Query + Recharts                   (GoldenGibbon)
          vite-plugin-pwa
backend   Fastify + TypeScript, pg, SQL na mão        (tarot, shouldWe)
          migrate, api e worker: mesma imagem, três comandos
exchange  ccxt
cripto    libsodium (crypto_box_seal)
alerta    web push (VAPID)
db        Postgres
infra     Docker Compose, nginx, make com menu        (tarot, shouldWe)
```

```
navegador ──▶ nginx ──┬── /        PWA React
                      └── /api/*   api (Fastify) ──▶ Postgres ◀── worker ──▶ Binance, OKX,
                                                                              cryptoprices.cc
```

### Versões

Conferidas no npm e no Docker Hub em 21/09/2026.

| Peça | Versão | tarot / shouldWe | Nota |
|---|---|---|---|
| Node | **26** (`node:26-alpine`) | 22 | Vira LTS em outubro de 2026, antes da fase 6 ir ao ar |
| TypeScript | **7.0** | 5.9 | O compilador nativo. O shouldWe travou na 5.9 porque a 7 removeu `moduleResolution: node`; projeto novo já nasce com `nodenext` (backend) e `bundler` (frontend) |
| Postgres | **18** (`postgres:18-alpine`) | 16 | O 19 ainda está em beta. **O volume muda de lugar**: monta em `/var/lib/postgresql`, não em `.../data`. Traz `uuidv7()` nativo |
| nginx | **1.31** (`nginx:1.31-alpine`) | — | |
| Fastify | 5.12 | 5.12 | `@fastify/cookie` 11, `@fastify/rate-limit` 11 |
| pg | 8.23 | 8.23 | |
| tsx | 4.23 | 4.23 | |
| React | 19.3 | 19.3 | |
| Vite | 8.3 | 8.3 | `@vitejs/plugin-react` 6 |
| vite-plugin-pwa | 1.3 | — | aceita Vite 8 |
| TanStack Query | 5.103 | — | com `react-query-persist-client` |
| Recharts | 3.10 | — | |
| ccxt | 4.5.82 | — | **versão exata, sem `^`**: sai versão quase todo dia e a API das corretoras muda junto. Só atualiza de propósito, com as fixtures da fase 2 passando |
| libsodium-wrappers | 0.8.4 | — | |
| web-push | 3.6.7 | — | sem release desde 2024, mas é estável; a spec do web push também não mudou |

Backend em ESM (`"type": "module"`), não em CommonJS como o shouldWe.

- Nada roda no host além de `docker`, `make` e `git`. `make` sozinho abre o menu.
- Um compose, perfis `dev` e `prod`, containers `cripto-*`.
- Portas: dev em `5175` (tarot 5173, shouldWe 5174), prod em `127.0.0.1:8084`
  atrás do nginx de borda da VPS.
- Migrations `.sql` numeradas, runner do tarot. Cada fase fecha com um smoke script
  em `backend/scripts/`, rodando com `make smoke`.

---

## Decisões

As que moldam o resto. O porquê completo está no rascunho.

**No pior caso, alguém vê saldo, nunca mexe no dinheiro.**
- Chave com qualquer permissão além de leitura é **recusada e apagada**. A permissão é
  conferida de novo a cada coleta; se aumentou na corretora, a conta é bloqueada.
- O navegador **sela** a chave com a chave pública do worker antes de enviar. A API
  grava o ciphertext, mas o role do banco dela não tem permissão de ler essa coluna.
  Só o worker abre, e só o container dele tem a chave privada.
- O worker sai sempre pelo IP da VPS; a tela sugere vincular a chave a esse IP.
- É uma chave nova, só leitura, **nunca a do GoldenGibbon**, que pode negociar.

**O banco guarda fatos; as views calculam valores.** Quantidade, preço e câmbio vão
para tabelas; valor em R$, distância do ATH e alocação saem de views. Mudar uma
regra recalcula o histórico inteiro sem migrar dado.

**O gráfico e o número grande saem da mesma conta.** Lição da 9.11 do GoldenGibbon,
onde o total certo era calculado e jogado fora e o gráfico somava fatias erradas. Aqui
não há tabela de snapshot: o histórico é a mesma view aplicada a cada coleta.

**`numeric` sem precisão fixa.** O BUG-001 do GoldenGibbon foi `Numeric(20, 8)`
estourando com PEPE. Quantidade, preço e valor são `numeric` puro, e chegam ao
navegador como string, sem passar por float.

**Um retrato por dia, não um por coleta.** A coleta roda a cada 15 minutos para o
número da tela estar fresco, mas o banco só guarda a coleta mais recente e a última
de cada dia (fuso de São Paulo). Ao fechar uma coleta, as outras do mesmo dia são
apagadas. Dá uns 365 retratos por ano, e o gráfico de evolução é diário.

**Cada coleta é completa.** Conta que falha entra com uma cópia do último saldo bom,
marcada como desatualizada. Assim o total não despenca, e dá para apagar qualquer
coleta antiga sem perder o "último saldo bom" de alguém.

**Câmbio é USDT/BRL da Binance**, o dólar-cripto. Stablecoin vale 1.

**ATH nunca cai.** Se o cryptoprices.cc devolver menos que o guardado, fica o
guardado: provavelmente o símbolo apontou para o token errado.

---

## Modelo

```
app_user ── session
    │
portfolio ── account (binance | okx | manual) ── manual_holding
                 │
run ── balance (conta × ticker × carteira)
    └─ quote   (ticker: preço, 24h, 7d)          asset (ticker: ATH)
```

- **Conta é a unidade, portfólio é o agrupamento.** A mesma conta de corretora não
  entra duas vezes (fingerprint da chave e uid da conta), senão o total conta dobrado.
- **Posição manual é uma conta `manual`.** A cada coleta vira `balance` como as
  outras, então tem o mesmo histórico.
- `balance.wallet` guarda de onde veio (spot, funding, earn, staking, manual). É o que
  substitui as linhas 22 a 30 da planilha.

---

## Em aberto

- **Nome do app e subdomínio.** Por enquanto `cripto.paulonavarro.com`. Precisa ser
  domínio: o Google não aceita IP como endereço de retorno do login.
- **Preço de posição manual** de moeda que não está nem na Binance nem na OKX.
