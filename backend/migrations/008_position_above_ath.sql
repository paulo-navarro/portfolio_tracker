-- O `select p.*` de v_position foi expandido em colunas quando ela foi criada,
-- então ela não enxergava a coluna nova de v_run_position (007). Recriada para
-- pegar a lista de novo. (Vale para toda view feita com `*`.)
create or replace view v_position as
  select p.*
    from v_run_position p
    join v_latest_run l on l.id = p.run_id;
