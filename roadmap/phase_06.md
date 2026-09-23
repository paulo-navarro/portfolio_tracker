# Fase 6 — PWA e produção

Instalado no celular e no ar. Deploy igual ao do tarot.

## Tarefas

- [ ] **6.1** Ícones 192/512/maskable, `apple-touch-icon`, manifest `standalone`
- [ ] **6.2** Service worker guarda só o app, **nunca** `/api`
- [ ] **6.3** Última resposta salva no IndexedDB; offline mostra "atualizado em …"
- [ ] **6.4** Offline, botões de alterar ficam desabilitados
- [ ] **6.5** Sair apaga o IndexedDB e o cache
- [ ] **6.6** Cabeçalhos: CSP estrita, `frame-ancestors 'none'`, `no-referrer`
      (conferir se a libsodium precisa de `'wasm-unsafe-eval'`)
- [ ] **6.7** `deploy/edge-nginx.conf` + certbot no subdomínio, HSTS
- [ ] **6.8** `.env.prod.example`; `assertConfig` recusa segredo fraco e `DEV_LOGIN`
- [ ] **6.9** Endereço de retorno de produção cadastrado no Google
- [ ] **6.10** `make deploy`, `prod-logs`, `prod-db-shell`, `prod-db-backup`,
      `prod-db-tunnel` do tarot
- [ ] **6.11** Backup da chave privada de prod guardado fora da VPS

## Pronto quando

- **Login Google funciona com o app instalado no iPhone.** É o maior risco; testar
  primeiro.
- Instala no Android e no iOS; em modo avião mostra o último dado com a hora.
- `make deploy` publica a partir do working tree limpo.
