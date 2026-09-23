# Fase 7 — Alertas

O worker avisa por web push, que chega mesmo com o app fechado. Mandar alerta nunca
lança erro: push fora do ar não atrasa nem derruba uma coleta.

## Tarefas

- [ ] **7.1** `make vapid`: gera as chaves VAPID de dev e de prod
- [ ] **7.2** Service worker trata o `push` e abre o portfólio certo no clique
- [ ] **7.3** "Ativar notificações" em Ajustes; a inscrição vai para `push_subscription`
- [ ] **7.4** `alert_rule` por usuário, com liga/desliga
- [ ] **7.5** Alertas:
  - portfólio caiu X% em 24h
  - ativo chegou a X% do ATH, ou bateu ATH novo
  - conta rejeitada ou bloqueada
  - coleta falhando N vezes seguidas
- [ ] **7.6** Sem repetir: o mesmo alerta só volta depois que a condição some
- [ ] **7.7** Inscrição que o navegador recusa (410) é apagada

## Pronto quando

Com o app fechado, o celular avisa quando uma conta é bloqueada e quando um ativo bate
ATH (forçado por fixture), no Android e no iPhone.

No iPhone, o push só funciona com o app instalado na tela inicial (iOS 16.4+).
