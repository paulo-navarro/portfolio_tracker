-- Reais que entraram e saíram das corretoras (PIX, TED), para o investido
-- calculado: tudo que entrou menos o que voltou para o banco. Transferência de
-- cripto entre corretoras não entra (não é dinheiro novo) e não precisa ser casada.
--
-- Só pedido concluído vira linha. `external_id` é o número do pedido na
-- corretora: deixa a busca repetir a mesma janela sem duplicar, e nunca vai
-- para a tela.
create table fiat_flow (
  account_id  uuid        not null references account,
  external_id text        not null,
  direction   text        not null check (direction in ('in', 'out')),
  currency    text        not null check (currency ~ '^[A-Z]{3}$'),
  amount      numeric     not null check (amount >= 0),   -- entrada: o que foi enviado; saída: o que chegou no banco
  fee         numeric     not null default 0 check (fee >= 0),
  method      text,
  at          timestamptz not null,
  primary key (account_id, external_id)
);

create index fiat_flow_account_at_idx on fiat_flow (account_id, at);

-- Quando o histórico da conta foi buscado pela última vez. Null: nunca, e a
-- próxima busca vai desde o começo.
alter table account add column fiat_synced_at timestamptz;

grant select on fiat_flow to app_api;
grant select, insert on fiat_flow to app_worker;
grant select (fiat_synced_at) on account to app_api;

-- Investido calculado por portfólio: só BRL, só contas não removidas.
create view v_portfolio_invested as
  select a.portfolio_id,
         sum(f.amount) filter (where f.direction = 'in')
           - coalesce(sum(f.amount) filter (where f.direction = 'out'), 0) as invested_calc_brl,
         count(*) filter (where f.direction = 'in')                          as deposits,
         count(*) filter (where f.direction = 'out')                         as withdrawals,
         min(f.at)                                                           as first_at,
         max(f.at)                                                           as last_at,
         min(a.fiat_synced_at)                                               as synced_at
    from fiat_flow f
    join account a on a.id = f.account_id
   where f.currency = 'BRL' and a.removed_at is null
   group by a.portfolio_id;

grant select on v_portfolio_invested to app_api, app_worker;
