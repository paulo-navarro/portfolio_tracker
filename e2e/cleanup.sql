-- O que o `make e2e` criou: portfólio "E2E" e as contas dele.
delete from manual_holding where account_id in (select a.id from account a join portfolio p on p.id = a.portfolio_id where p.name = 'E2E');
delete from account_sync where account_id in (select a.id from account a join portfolio p on p.id = a.portfolio_id where p.name = 'E2E');
delete from account where portfolio_id in (select id from portfolio where name = 'E2E');
delete from portfolio where name = 'E2E';
-- Coleta que só tinha contas do teste ficou vazia.
delete from run where id not in (select run_id from account_sync);
-- As sessões que o teste abriu entrando como dev.
delete from session where user_id = (select id from app_user where google_sub = 'dev:local');
