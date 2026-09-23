-- O que a última coleta fez, para o /api/meta (fase 3) e para o `make collect`
-- mostrar. Coleta que falhou não vira `run` (não há o que mostrar dela), então
-- o erro mora aqui.
alter table worker_status
  add column last_cycle_at timestamptz,
  add column last_run_id   bigint,
  add column last_error    text;
