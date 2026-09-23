-- Valores. Tudo que a planilha calculava sai daqui, a partir dos fatos do
-- 002_init.sql. Mudar uma regra é mudar uma view: o histórico inteiro recalcula
-- sem migrar dado.
--
-- Uma conta só, em dois recortes. `v_run_position` calcula cada posição em
-- cada coleta. As posições e o resumo são o recorte da coleta mais recente;
-- o histórico é a soma de cada coleta. O gráfico e o número grande não têm
-- como discordar.
--
-- As views rodam com o dono delas, e é o dono que confere os grants das
-- tabelas. Nenhuma expõe sealed_credentials; quem limita o que a api vê de
-- cada portfólio é a própria api (fase 3), filtrando por membro.

-- A coleta que vale agora: a mais recente que terminou bem.
create view v_latest_run as
  select id, finished_at, usd_brl
    from run
   where status = 'ok'
   order by id desc
   limit 1;

-- Portfólio × coleta × ticker. As colunas B a M da planilha.
create view v_run_position as
  with held as (
    select r.id                   as run_id,
           r.finished_at,
           r.usd_brl,
           a.portfolio_id,
           b.ticker,
           sum(b.amount)          as qty,
           bool_or(not s.ok)      as stale
      from run r
      join balance b      on b.run_id = r.id
      join account_sync s on s.run_id = b.run_id and s.account_id = b.account_id
      join account a      on a.id = b.account_id
     where r.status = 'ok'
     group by r.id, a.portfolio_id, b.ticker
  ),
  priced as (
    select h.*,
           q.price_usd,
           -- ATH nunca abaixo do preço: a distância não fica negativa.
           greatest(ast.ath_usd, q.price_usd) as ath_usd,
           q.chg_24h,
           q.chg_7d
      from held h
      left join quote q  on q.run_id = h.run_id and q.ticker = h.ticker
      left join asset ast on ast.ticker = h.ticker
  )
  select run_id,
         finished_at,
         portfolio_id,
         ticker,
         qty,                                                          -- B  AMOUNT
         price_usd,                                                    -- C  DOLAR PRICE
         ath_usd,                                                      -- D  ATH
         (1 - price_usd / nullif(ath_usd, 0)) * 100 as pct_below_ath,  -- E  % to ATH
         qty * price_usd                            as value_usd,      -- F  DOLAR AMOUNT
         qty * ath_usd                              as value_at_ath_usd, -- G  D ON ATH
         qty * ath_usd * usd_brl                    as value_at_ath_brl, -- H  R ON ATH
         qty * price_usd
           / nullif(sum(qty * price_usd) over (partition by portfolio_id, run_id), 0)
           * 100                                    as allocation_pct, -- I  PERCENT
         price_usd * usd_brl                        as price_brl,      -- J  REAL PRICE
         qty * price_usd * usd_brl                  as value_brl,      -- K  REAL AMOUNT
         chg_24h,                                                      -- L  DAY
         chg_7d,                                                       -- M  7
         usd_brl,
         stale
    from priced;

-- Portfólio × coleta: os totais (linha 17 da planilha).
create view v_run_portfolio as
  select run_id,
         finished_at,
         portfolio_id,
         usd_brl,
         sum(value_usd)        as value_usd,
         sum(value_brl)        as value_brl,
         sum(value_at_ath_usd) as value_at_ath_usd,
         sum(value_at_ath_brl) as value_at_ath_brl,
         -- Variação exata do portfólio: valor de agora sobre o valor de antes.
         -- A planilha (L17) faz média ponderada pelo valor, que dá um pouco
         -- diferente. Só entra quem tem a variação.
         (sum(value_usd) filter (where chg_24h is not null)
            / nullif(sum(value_usd / (1 + chg_24h / 100)) filter (where chg_24h is not null), 0)
            - 1) * 100         as chg_24h,
         (sum(value_usd) filter (where chg_7d is not null)
            / nullif(sum(value_usd / (1 + chg_7d / 100)) filter (where chg_7d is not null), 0)
            - 1) * 100         as chg_7d,
         count(*) filter (where price_usd is null) as unpriced,
         bool_or(stale)        as stale
    from v_run_position
   group by run_id, finished_at, portfolio_id, usd_brl;

-- ── O que a api lê ──────────────────────────────────

-- Posições da coleta mais recente.
create view v_position as
  select p.*
    from v_run_position p
    join v_latest_run l on l.id = p.run_id;

-- Onde está: portfólio × conta × carteira × ticker, na coleta mais recente.
-- Substitui as linhas 22 a 30 da planilha.
create view v_position_source as
  select l.id                              as run_id,
         a.portfolio_id,
         a.id                              as account_id,
         a.kind,
         a.label,
         b.wallet,
         b.ticker,
         b.amount,
         b.amount * q.price_usd            as value_usd,
         b.amount * q.price_usd * l.usd_brl as value_brl,
         not s.ok                          as stale
    from v_latest_run l
    join balance b      on b.run_id = l.id
    join account_sync s on s.run_id = b.run_id and s.account_id = b.account_id
    join account a      on a.id = b.account_id
    left join quote q   on q.run_id = b.run_id and q.ticker = b.ticker;

-- Um portfólio por linha, com os totais da coleta mais recente. Portfólio sem
-- coleta nenhuma aparece com os valores nulos.
create view v_portfolio_summary as
  select p.id                                            as portfolio_id,
         p.name,
         p.invested_brl,                                                   -- J17
         p.archived_at,
         t.run_id,
         t.finished_at                                   as as_of,
         t.usd_brl,
         t.value_usd,                                                      -- F17
         t.value_brl,                                                      -- K17
         t.value_at_ath_usd,                                               -- G17
         t.value_at_ath_brl,                                               -- H17
         t.value_at_ath_usd / nullif(t.value_usd, 0)     as ath_multiple,  -- "se tudo voltar ao ATH: N×"
         t.chg_24h,                                                        -- L17 (exato)
         t.chg_7d,
         (t.value_brl / nullif(p.invested_brl, 0) - 1) * 100 as result_pct, -- K18
         coalesce(t.unpriced, 0)                         as unpriced,
         coalesce(t.stale, false)                        as stale
    from portfolio p
    left join (select v.*
                 from v_run_portfolio v
                 join v_latest_run l on l.id = v.run_id) t on t.portfolio_id = p.id;

-- Um ponto por dia (fuso de São Paulo): a última coleta de cada dia. O worker
-- já apaga as outras, mas o distinct garante um ponto por dia mesmo assim.
create view v_portfolio_history as
  select distinct on (portfolio_id, day)
         portfolio_id,
         (finished_at at time zone 'America/Sao_Paulo')::date as day,
         run_id,
         finished_at,
         value_usd,
         value_brl
    from v_run_portfolio
   order by portfolio_id, day, run_id desc;

grant select on v_latest_run, v_run_position, v_run_portfolio, v_position, v_position_source,
                v_portfolio_summary, v_portfolio_history
  to app_api, app_worker;
