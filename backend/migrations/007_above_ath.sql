-- Preço acima do ATH guardado: "novo ATH".
--
-- A distância até o ATH nunca fica negativa (o ATH exibido é o maior entre o
-- guardado e o preço), mas aí a tela só sabia dizer "no ATH". Agora sabe
-- quanto o preço passou do topo anterior, até o cryptoprices.cc alcançar.
create or replace view v_run_position as
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
           ast.ath_usd                        as ath_stored,
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
         stale,
         -- Quanto o preço passou do topo anterior. Null quando está abaixo
         -- dele, ou quando ainda não sabemos o ATH do ativo.
         case
           when ath_stored is not null and price_usd > ath_stored then (price_usd / ath_stored - 1) * 100
         end                                        as pct_above_ath
    from priced;
