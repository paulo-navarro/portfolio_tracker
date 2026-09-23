# Fase 2 — Coleta ✅

O worker de verdade. As contas ainda entram por script, selando a chave exatamente
como o navegador vai fazer na fase 5.

## Tarefas

- [x] **2.1** `scripts/seal-account.ts`: sela `{apiKey, secret, passphrase}` com a chave
      pública e grava a conta como `pending`
- [x] **2.2** Validação da chave, negando por padrão:
  - Binance: as flags ligadas precisam ser só `enableReading` (e no máximo
    `enableFixReadOnly`); flag desconhecida reprova
  - OKX: `perm` tem que ser exatamente `read_only`
  - reprovou → `rejected` com o motivo, e o ciphertext é apagado na hora
  - erro de rede → continua `pending` e tenta de novo; nunca ativa na dúvida
- [x] **2.3** Mesma conta duas vezes é recusada (fingerprint da chave e uid da conta)
- [x] **2.4** Saldos Binance: spot, funding, earn flexível, earn travado. Ignorar
      `LD<X>` só se `X` estiver no earn flexível (`LDO` é ticker real)
- [x] **2.5** Saldos OKX: trading, funding, earn, staking
- [x] **2.6** Contas manuais copiadas para `balance` a cada coleta
- [x] **2.7** Cotações: Binance primeiro (preço, 24h, 7d), OKX para o que faltar
- [x] **2.8** Câmbio USDT/BRL da Binance em `run.usd_brl`
- [x] **2.9** ATH do cryptoprices.cc, uma vez por dia por ticker; se vier menor, mantém o antigo
- [x] **2.10** A cada coleta, revalida a permissão antes de ler; se aumentou, `blocked`
- [x] **2.11** Conta que falhou: copia o último saldo bom para a coleta nova, com
      `account_sync.ok = false`
- [x] **2.12** Ao fechar a coleta, apaga as outras do mesmo dia (fuso de São Paulo):
      fica a mais recente e a última de cada dia anterior
- [x] **2.13** Timer de 15 min, `LISTEN account_pending` e `pg_try_advisory_lock` para
      nunca rodar dois ciclos juntos
- [x] **2.14** `make collect`: força um ciclo agora
- [x] **2.15** Fixtures das respostas das corretoras (permissões e saldos), **escritas a partir da
      documentação**: trocar pelas gravadas quando rodar com as chaves reais

## Pronto quando

- [x] Com as chaves reais (Binance e OKX, 22/09), a coleta preenche `run`, `balance` e
  `quote`, e as quantidades batem com a planilha, somando as duas corretoras (um ativo
  dividido entre elas fecha na soma). O que a planilha não atribuía a corretora nenhuma
  fica de fora, e é caso de conta manual.
- [x] `scripts/permissions-smoke.ts`: só leitura passa; trade reprova e apaga; flag
  desconhecida reprova; erro de API mantém `pending`.
- [x] `scripts/balances-smoke.ts` cobre o caso `LD<X>` × `LDO`.
- [ ] Revogo uma chave na corretora e o total continua lá, marcado como desatualizado
  (coberto pelo `cycle-smoke.ts` com corretora falsa; falta com a chave real).
- [x] Depois de várias coletas no mesmo dia, sobra uma só para hoje.

## Como rodar com as chaves reais

```bash
make seal-account KIND=binance LABEL=Binance   # pede a chave sem eco
make seal-account KIND=okx LABEL=OKX           # pede também a passphrase
make logs                                      # validação em segundos
make collect                                   # força uma coleta
make db-shell                                  # select * from v_position;
```

A chave precisa ser **só leitura**: na Binance, só "Enable Reading"; na OKX,
só "Read". Qualquer outra permissão e ela é recusada e apagada na hora.

## O que a verificação achou

- **Testado ao vivo, sem chave:** `make market-live` com os 14 ativos da planilha.
  Os ATHs do cryptoprices.cc são exatamente os da planilha (BTC 126080, ETH 4946,05,
  HBAR 0,569229), e o 0,569229 do HBAR é o valor que a fixture da fase 1 tinha
  deduzido da planilha. OKB (só na OKX) cai no fallback certo.
- **Testado ao vivo, com chave falsa:** `seal-account` → NOTIFY → worker abre a caixa →
  Binance e OKX de verdade recusam → conta `rejected`, ciphertext apagado, em segundos.
  Exercita selagem, LISTEN, ccxt e classificação de erro de ponta a ponta.
- **Um símbolo inexistente derruba a chamada inteira da Binance** (`Invalid symbol`).
  O worker pede o 24h de todos os pares (uma chamada) e só pergunta o 7d dos que
  existem.
- **7d na OKX com velas de 1 hora:** a 169ª é de exatamente 7 dias atrás. Com velas
  diárias o erro chegaria a um dia.
- **O ATH do cryptoprices.cc vem com expoente para moeda barata** (PEPE:
  `2.803e-05`). Aceito; o Postgres lê notação científica.
- **Respostas cruas, não o formato unificado do ccxt:** o earn só existe no cru, e
  misturar os dois arriscaria nomes de moeda diferentes para o mesmo ativo.
- **Soma exata no Postgres:** free + locked, duas ordens de staking do mesmo ativo,
  tudo vira linhas separadas e o `on conflict` soma em `numeric`.
- **Conta que já coletou e hoje não coleta** (bloqueada, trocando de chave) entra com
  o último saldo, desatualizada. O total não despenca numa troca de chave.
- **Só o essencial derruba a coleta:** o 24h da Binance e o USDT/BRL. Sem o 7d, a
  coluna fica vazia; sem a OKX, o que não está na Binance fica sem cotação.
- **Cinco NOTIFY seguidos viram duas coletas**, nunca sobrepostas (advisory lock +
  "roda de novo no fim").
- **Banco fora do ar não derruba o worker:** a coleta que não consegue conexão só loga,
  e o LISTEN reconecta sozinho. Conferido parando o container do banco.
- **`STABLECOINS` vazio usa a lista padrão.** O compose passa a variável vazia quando
  ela não está no `.env`; com `??` a lista ficaria vazia e o USDT sem cotação.
- **Erro da corretora vira frase:** o motivo mostrado é o `msg` da resposta
  ("Invalid Api-Key ID."), não o JSON cru.
- **Primeira chave real (Binance, 22/09):** ativa em ~4 s. A conta tinha tudo no earn
  flexível, então o spot listava os recibos `LD<X>`, e nenhum entrou no total: a regra
  do `LD<X>` funcionando em dado real. O parser leu a resposta real sem ajuste nenhum,
  então as fixtures (escritas a partir da documentação) estavam no formato certo.

## Investido calculado (22/09)

Pedido depois da fase 5: em vez de só digitar o investido, calcular pelos depósitos
em reais. Aparece **ao lado** do informado, nunca no lugar dele.

- **A conta é o fluxo líquido de reais:** depósitos (PIX, TED) menos saques para o
  banco, em BRL. Transferência de cripto entre corretoras não entra, e é por isso que
  não precisa ser casada: dinheiro mudando de corretora não é dinheiro novo.
- **Binance, `GET /sapi/v1/fiat/orders`**, só pedido `Successful`. Na entrada vale o
  `indicatedAmount` (o que foi enviado); na saída, o `amount` (o que chegou no banco).
  Tabela `fiat_flow`, chave conta + número do pedido: repetir a busca não duplica.
- **Conferido numa conta real:** dezenas de PIX desde 2021, nenhum saque, e o total
  calculado ficou perto do valor informado à mão (a diferença virou uma conta a fazer,
  que é justamente para isso que ele serve).
- **Essa rota custa 90.000 da cota de 180.000 por minuto da conta**, e o ccxt espaça
  cada chamada em ~30 s. Janelas de 5 anos (conferido que funcionam), então a primeira
  busca são 4 chamadas (~2 min) e a diária, 2. Roda **fora do lock da coleta**, em
  segundo plano: a coleta de 15 em 15 minutos não espera por ela.
- **Primeira busca desde jul/2017** (a Binance abriu aí). A janela de 5 anos sozinha
  teria perdido R$ 3.951 de maio a setembro de 2021.
- **Depois, uma vez por dia, só os últimos 7 dias:** pega pedido que terminou depois.
- **OKX entrou no mesmo dia, com a chave real:** `fiat/deposit-order-history` e
  `fiat/withdrawal-order-history`, paginando por `after`, só `completed`. A entrada vale
  `amt`; a saída, `amt − fee`. Somar as duas corretoras mudou o total: a planilha
  parecia contar só os depósitos de uma delas.
- **O P2P fica de fora** (a rota recusou uma janela de 5 anos, e os depósitos são todos
  por PIX).
- **Repetir a busca inteira não duplica:** refazendo a da Binance desde 2017, "0 new".
- **A OKX confirmou as transferências entre corretoras** (um depósito e dois saques de
  USDT/USDC na Arbitrum). São exatamente o que o fluxo de reais ignora de propósito.
- **O erro de rede do ccxt trazia a URL assinada** (timestamp e signature). Não revela a
  secret, mas foi cortada das mensagens de erro, que vão para o log e para o banco.
- **O worker não desligava direito:** a conexão do LISTEN segurava o processo até o
  `SIGTERM` virar `SIGKILL`. Agora fecha tudo e sai em até 2 s.
