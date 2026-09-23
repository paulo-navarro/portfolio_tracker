# Fase 1 — Banco e cálculos ✅

O schema inteiro e as views que fazem as contas da planilha. Sem corretora ainda:
os dados entram por fixture.

## Tarefas

- [x] **1.1** `002_init.sql`: `app_user`, `session`, `portfolio`, `portfolio_member`,
      `account`, `manual_holding`, `asset`, `run`, `account_sync`, `balance`, `quote`
- [x] **1.2** Tudo que é quantidade, preço ou valor é `numeric` sem `(p, s)`
- [x] **1.3** `003_grants.sql`: `app_api` sem SELECT em `account.sealed_credentials`
      (só INSERT/UPDATE); `app_worker` lê tudo
- [x] **1.4** `004_views.sql`:
  - `v_account_latest`: saldos da coleta mais recente, com `stale` quando a conta falhou
  - `v_position`: uma linha por ticker do portfólio, com as colunas da planilha
  - `v_position_source`: onde está (conta × carteira)
  - `v_portfolio_summary`: totais, 24h, 7d, no ATH, investido, resultado
  - `v_portfolio_history`: total por dia (um retrato por dia)
- [x] **1.5** Fixture com a planilha de 21/09 (seção abaixo): os 14 ativos, o
      investido e a divisão por corretora (`backend/fixtures/planilha-2026-09-21.json`)
- [x] **1.6** `scripts/parity-smoke.ts`: carrega a fixture e compara com a planilha
- [x] **1.7** `scripts/grants-smoke.ts`: `app_api` leva `permission denied` ao ler
      `sealed_credentials`

## Colunas

| Planilha | Campo | Conta |
|---|---|---|
| AMOUNT | `qty` | soma do ticker no portfólio |
| DOLAR PRICE | `priceUsd` | cotação em USDT; stablecoin = 1 |
| ATH | `athUsd` | `max(ATH guardado, preço)` |
| % to ATH | `pctBelowAth` | `(1 − preço / ATH) × 100` |
| DOLAR AMOUNT | `valueUsd` | `qty × preço` |
| D ON ATH | `valueAtAthUsd` | `qty × ATH` |
| R ON ATH | `valueAtAthBrl` | `valueAtAthUsd × câmbio` |
| PERCENT | `allocationPct` | `valueUsd / total × 100` |
| REAL PRICE / AMOUNT | `priceBrl`, `valueBrl` | `× câmbio` |
| DAY / 7 | `chg24h`, `chg7d` | da corretora |
| L17 | 24h do portfólio | `(Σv / Σ(v / (1 + c/100)) − 1) × 100` (a planilha faz média ponderada; difere um pouco) |
| J17 / K18 | investido, resultado | `(valueBrl / investido − 1) × 100` |

Posição abaixo de US$ 0,10 fica oculta, mas **na api** (fase 3), não na view: a
alocação conta todas as posições, como a planilha.

**M17 era a média da variação de 7 dias**, e estava quebrada: APT e SUI
davam erro na coluna M, e a média saía errada. No app ela virou o 7d do portfólio, no
cabeçalho, calculado como o L17: variação do valor total, não média simples. A média
simples daria o mesmo peso a uma posição de US$ 0,21 e a uma de US$ 900.

## A planilha de exemplo

Uma planilha no formato da "Crypto Portfolio Tracker v3", que é o caso de teste de
paridade (`backend/fixtures/planilha-2026-09-21.json`). **Preços e ATHs são dado
público de mercado de 21/09/2026; as quantidades e o investido são fictícios.**

| Ticker | Amount | $ price | ATH | % to ATH | $ amount | $ on ATH | R$ on ATH | % | R$ price | R$ amount | Day | 7 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| BTC | 0.00210000 | 85.906,00 | 126.080,00 | 31.86 | 180,40 | 264,77 | 1.351,88 | 5.33 | 438.627,45 | 921,12 | 6.1% | 8.56% |
| ETH | 0.52000000 | 2.742,81 | 4.946,05 | 44.55 | 1.426,26 | 2.571,95 | 13.132,10 | 42.13 | 14.004,51 | 7.282,35 | 4.91% | 8.46% |
| NEAR | 12.5 | 3,93 | 20,44 | 80.77 | 49,12 | 255,50 | 1.304,56 | 1.45 | 20,07 | 250,83 | 0.96% | 57.36% |
| HBAR | 4200 | 0,09 | 0,57 | 84.05 | 381,44 | 2.390,76 | 12.207,00 | 11.27 | 0,46 | 1.947,62 | 6.21% | 16.31% |
| INJ | 9.4 | 7,88 | 52,62 | 85.02 | 74,07 | 494,63 | 2.525,52 | 2.19 | 40,23 | 378,20 | 0.25% | 22.6% |
| LINK | 31.8 | 12,83 | 52,70 | 75.65 | 407,99 | 1.675,86 | 8.556,77 | 12.05 | 65,51 | 2.083,18 | 4.44% | 10.71% |
| SOL | 1.75 | 117,08 | 293,31 | 60.08 | 204,89 | 513,29 | 2.620,82 | 6.05 | 597,80 | 1.046,15 | 7.66% | 13.61% |
| ONDO | 260 | 0,44 | 2,14 | 79.53 | 113,87 | 556,40 | 2.840,92 | 3.36 | 2,24 | 581,40 | 5.75% | 22.6% |
| USDT | 18.42 | 1,00 | 1,32 | 24.24 | 18,42 | 24,31 | 124,15 | 0.54 | 5,11 | 94,05 | 0.0% | 0.0% |
| BNB | 0.0125 | 796,18 | 1.369,99 | 41.88 | 9,95 | 17,12 | 87,44 | 0.29 | 4.065,22 | 50,82 | 4.28% | 10.09% |
| APT | 85.5 | 0,75 | 19,92 | 96.23 | 64,20 | 1.703,16 | 8.696,16 | 1.90 | 3,83 | 327,78 | 3.29% | *erro* |
| SUI | 240 | 1,00 | 5,35 | 81.33 | 239,68 | 1.284,00 | 6.555,98 | 7.08 | 5,10 | 1.223,78 | 14.98% | *erro* |
| ENA | 900 | 0,21 | 1,52 | 86.28 | 187,69 | 1.368,00 | 6.984,88 | 5.54 | 1,06 | 958,34 | -3.88% | 45.99% |
| LDO | 64 | 0,43 | 7,30 | 94.10 | 27,56 | 467,20 | 2.385,48 | 0.81 | 2,20 | 140,73 | 4.88% | 16.52% |

Totais (linhas 17–18): $ amount **3,385.56**, $ on ATH **13,586.96**, R$ on ATH
**69,373.65**, investido **R$ 12,000.00** (J17), R$ amount **17,286.33**,
24h **5.26** (média ponderada, como a planilha faz), M17 (a média do 7d, que na planilha
quebrava com APT e SUI), resultado **+44.05%**.

Onde está (linhas 22–30): a fixture divide BTC, HBAR, USDT e BNB entre Binance, OKX e
uma conta manual; a soma bate com a coluna B.

Para montar a fixture:
- **Câmbio ≈ 5.1059** (R$ price ÷ $ price).
- **A planilha mostra 2 casas**, então a comparação aceita ±0,01 em cada coluna. Os
  valores esperados saem de aritmética decimal exata.

## Pronto quando

`make smoke` passa: a view reproduz a planilha (BTC a 31,86% do ATH, ETH com
42.13% da carteira, total US$ 3,385.56, R$ 17,286.33, resultado
+44.05%) e a API não consegue ler credencial.

## O que a verificação achou

- **As views batem com a planilha em ±0,01**, nas 13 colunas dos 14 ativos e nos
  totais. Para isso a fixture usa, de cada ativo, o número menos arredondado que a
  planilha mostra: o preço exibido, ou $ amount ÷ amount, ou R$ amount ÷ (amount ×
  câmbio), o que tiver o menor erro relativo. O HBAR, por exemplo, aparece a $0,09,
  mas o preço que fecha a conta é $0,0908. (A fixture atual é fictícia nas
  quantidades; preço e ATH continuam sendo os de mercado.)
- **O 24h da planilha (L17) é média ponderada:** 5.26%. A fórmula exata dá 5.14%. A
  view usa a exata; o smoke confere as duas, para a diferença não parecer bug.
- **A soma das linhas 22–30 pode ter mais casas que a coluna B**, que arredonda: a
  comparação de quantidade aceita 1e-6.
- **`numeric` sem teto:** 10¹⁵ PEPE × US$ 0,000012345678901 sai exato até a última
  casa (conferido com `Decimal` do Python).
- **Um desenho de view só:** `v_run_position` calcula cada posição em cada coleta. As
  posições e o resumo são o recorte da coleta mais recente, e o histórico é a soma de
  cada coleta. O smoke confere que o último ponto do gráfico é igual ao número grande.
- **O dia do histórico é o de São Paulo:** uma coleta às 23h45 cai no mesmo dia, mesmo
  já sendo o dia seguinte em UTC.
- **Os smokes rodam num container `smoke` próprio** (`make smoke`), com a URL do dono
  e a do `app_api`. A fixture entra numa transação que sempre volta atrás, e o smoke
  troca para o role que quer testar com `set local role`. O banco de dev fica vazio
  depois, passe ou falhe.
- **A api não consegue `select *` nem `returning *` em `account`** por causa da coluna
  que ela não lê. É o efeito desejado, mas o código da fase 3 precisa listar as
  colunas.
- **A conta removida não some:** `removed_at` preenchido, ciphertext apagado, e os
  saldos antigos continuam apontando para ela. Os índices únicos (fingerprint e uid da
  corretora) ignoram as removidas, para dar para cadastrar a mesma conta de novo.
