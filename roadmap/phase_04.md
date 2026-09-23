# Fase 4 — Telas ✅

A planilha, só que bonita e no celular. Só leitura nesta fase.

## Direção

- O número grande é o **total em R$**.
- O que identifica o app é a **distância do ATH**: uma barra por ativo, do preço
  atual até o ATH, e no topo "se tudo voltar ao ATH: R$ X (N×)".
- Variação sempre com sinal (+2,4% / −5,1%), não só cor.
- Números com `tabular-nums` e formato brasileiro. Tema escuro e claro.

```
┌─────────────────────────────────────┐
│ Principal               há 4 min ⟳  │
│ R$ 17.286,33                        │
│ US$ 3.385,56   +5,26% 24h           │
│ Se tudo voltar ao ATH: R$ 69 mil 4,0×│
│ Investido R$ 12.000 · +44,05%       │
├─────────────────────────────────────┤
│              ◯ alocação             │
├─────────────────────────────────────┤
│ ETH   R$ 7.282,35   +4,91%          │
│ █████████░░░░░░░░  −44,6% do ATH    │
│ LINK  R$ 2.083,18   +4,44%          │
│ ███████░░░░░░░░░░  −75,7% do ATH    │
│ …  (toca para ver qtd, preço, 7d)   │
├─────────────────────────────────────┤
│ evolução   7d · 30d · 90d · 1a      │
│ onde está  Binance spot · OKX earn  │
└─────────────────────────────────────┘
```

## Da planilha para a tela

A referência é a planilha de 21/09/2026, transcrita na [fase 1](phase_01.md#a-planilha-de-21092026).

| Na planilha | Na tela |
|---|---|
| Linhas 2–15, uma por ativo, 13 colunas | **Celular:** linha compacta (ticker, R$, 24h, barra do ATH) que expande para o resto. **Computador:** a tabela inteira, com as mesmas 13 colunas na mesma ordem, ordenável |
| Coluna C em verde (preço digitado ou puxado) | Nada para digitar: tudo vem da coleta, com "atualizado há N min" no topo |
| L e M pintadas de verde ou vermelho | Cor **e** sinal: `+4,91%`, `−3,88%` |
| M12/M13 com erro (`yJzVAvre9W`) no 7d de APT e SUI | 7d vem da corretora; se faltar, mostra `—` e nunca um erro |
| Linha 17: totais (US$, no ATH, R$, 24h) | Cabeçalho do portfólio |
| J17/J18/K18: investido e resultado | "Investido R$ 12.000 · +44,05%" no cabeçalho |
| Pizza de alocação com rótulos puxados para fora | Rosca com a legenda ao lado (ou embaixo, no celular); abaixo de 2% vira "outros" |
| Linhas 22–30: BTC/HBAR/USDT/BNB com "Binance"/"OKX" à mão | "Onde está": por conta e carteira, preenchido pela coleta |
| Não existe | Barra do preço até o ATH, por ativo, e evolução no tempo |

## Tarefas

- [x] **4.1** Base: tokens de cor, tipografia, tema escuro/claro, formatação pt-BR
- [x] **4.2** Roteamento sem lib: `/`, `/p/:id`, `/p/:id/contas`, `/ajustes`
- [x] **4.3** TanStack Query com refetch alinhado à coleta
- [x] **4.4** Tela Entrar: botão do Google; e-mail fora da lista recebe uma frase clara
- [x] **4.5** Início: total dos meus portfólios e a lista deles (R$, 24h, 7d, aviso de desatualizado)
- [x] **4.6** Portfólio, cabeçalho: total, 24h/7d, no ATH, resultado sobre o investido
- [x] **4.7** Portfólio, posições no celular: linha compacta com barra do ATH, toca e expande
- [x] **4.8** Portfólio, posições no computador: a tabela da planilha, 13 colunas, ordenável
- [x] **4.9** Rosca de alocação (Recharts)
- [x] **4.10** Evolução no tempo (Recharts), 7d · 30d · 90d · 1a · tudo
- [x] **4.11** Onde está: por conta e carteira
- [x] **4.12** Contas (só leitura): status, `…a1b2`, última coleta
- [x] **4.13** Ajustes: sessões, sair de todos, sair. O valor investido é editado no cabeçalho
      do portfólio, onde ele aparece (é de cada portfólio, não da conta)

## Pronto quando

Abro no celular pela rede de casa e vejo o que a planilha mostra, com os mesmos
números, sem nada quebrado em 360 px.

## Para ver

```bash
make demo        # a planilha como portfólio "Planilha (demo)", com 90 dias de histórico real
```

Entre em http://localhost:5175 com "Entrar como dev". O demo usa contas manuais:
o worker coleta ao vivo (preço, 24h, 7d, ATH de agora), e os dias anteriores saem
dos fechamentos diários reais da Binance. `make demo-clear` apaga.

## O que a verificação achou

- **Conferido no Chrome headless**, desktop (1400px) e celular (390px, 2×), claro e
  escuro: nenhuma tela transborda na horizontal, sem erro de console, e a página não
  fica ocupada (timer de 20 ms dispara em 20 ms, com o cursor sobre o gráfico).
- **O Chrome de verdade "travava" porque a janela estava escondida:** aba em segundo
  plano não desenha quadro e atrasa timer, e as capturas expiravam. Não era a página.
- **`ResponsiveContainer` do Recharts dentro de CSS grid realimenta a largura** (o
  item do grid tem `min-width: auto`). A rosca ficou com tamanho fixo; o gráfico de
  evolução ganhou `min-width: 0` e `overflow: hidden`, e as colunas do grid, `minmax(0, …)`.
- **Captura com `fullPage` pega o gráfico no meio do redesenho** (ela redimensiona a
  janela). As capturas usam a janela na altura da página.
- **A tabela da planilha cabe inteira a 1400px** com as 13 colunas: fonte de 13px,
  colunas mais justas e conteúdo até 1240px.
- **Rosca com 5 fatias mais "outros"**, cores da paleta de referência do dataviz,
  validadas no claro e no escuro contra as superfícies do app. No claro, três cores
  ficam abaixo de 3:1 contra o fundo; por isso a legenda tem sempre o nome e o %.
- **Eixo Y sem "R$"**: quebrava a linha, e o cartão já diz que é em reais. Datas do
  eixo X como "22 ago".
- **O `make demo` mostrou que o `cycle-smoke` não era isolado:** assumia `asset` vazia e
  coletava as contas que já existissem. Dentro da transação que volta atrás, ele agora
  apaga os ATHs e remove as contas de antes.
