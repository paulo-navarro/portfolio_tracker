-- Roles de runtime. A senha não mora aqui: o migrate aplica a do .env a cada
-- boot (syncRolePasswords).
--
--   app_api    — a API. Na fase 1 perde o SELECT em account.sealed_credentials.
--   app_worker — o worker. O único que lê as credenciais.
--
-- Role é global no cluster, por isso o `if not exists`: um banco recriado no
-- mesmo cluster não pode falhar aqui.
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_api') then
    create role app_api login;
  end if;
  if not exists (select from pg_roles where rolname = 'app_worker') then
    create role app_worker login;
  end if;
end
$$;

do $$
begin
  execute format('grant connect on database %I to app_api, app_worker', current_database());
end
$$;

grant usage on schema public to app_api, app_worker;

-- Sinal de vida do worker. Uma linha só. A api lê para o /api/meta (fase 3) e
-- o smoke confere que o worker está de pé. O worker só grava depois de
-- conferir a chave de selagem, então linha recente = worker com a chave certa.
create table worker_status (
  id         boolean     primary key default true check (id),
  started_at timestamptz not null,
  seen_at    timestamptz not null
);

grant select on worker_status to app_api;
grant select, insert, update on worker_status to app_worker;
