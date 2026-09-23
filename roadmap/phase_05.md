# Fase 5 — Contas pela tela ✅

Adicionar corretora sem terminal. A chave sai do navegador já selada.

## Tarefas

- [x] **5.1** Passo a passo por corretora (em texto, com o link da página de API de cada uma):
      Binance, só "Enable Reading"; OKX, "Read" + passphrase
- [x] **5.2** Mostrar o IP da VPS para colar na restrição de IP da chave
- [x] **5.3** `lib/seal.ts`: libsodium com a chave pública embutida no build;
      fingerprint (sha256, `@noble/hashes`) e os 4 últimos caracteres calculados no navegador
- [x] **5.4** Depois de enviar, acompanha o status até sair de `pendente`
- [x] **5.5** Motivo na tela quando rejeita ("essa chave pode negociar; crie outra só leitura")
- [x] **5.6** Trocar chave (tem que ser da mesma conta na corretora)
- [x] **5.7** Remover conta, lembrando de revogar a chave lá
- [x] **5.8** Posições manuais: adicionar, editar, remover
- [x] **5.9** Criar, renomear e arquivar portfólio

## Pronto quando

- [x] Chave só leitura cadastrada pela tela vira `ativa` e o saldo aparece: a chave
      real da Binance (22/09) ficou ativa em ~4 s e entrou na coleta seguinte.
- [x] Chave com trade vira `rejeitada`, com o motivo, e o ciphertext some do banco
      (worker: `permissions-smoke`; a tela mostra o motivo, conferido no `make e2e`).
- [x] A mesma conta com outra chave é recusada (`permissions-smoke`).

## O que a verificação achou

- **`make e2e`**, num Chrome headless na rede do compose: cadastra uma chave falsa da
  Binance pelo formulário, e a Binance de verdade recusa ("Invalid Api-Key ID."). Só
  dá para ela recusar se o worker abriu o que o navegador selou: selagem e abertura
  batem. Depois troca a chave, cria uma conta manual com "0,5" e "1.234,5", confere o
  total, remove a conta pela confirmação da tela, e falha se alguma requisição levar
  a chave em claro ou se houver erro de console.
- **O dump inteiro do banco não tem nenhum pedaço das chaves de teste.** Só o selado
  (apagado ao recusar), o sha256 e os 4 últimos caracteres.
- **A libsodium padrão não tem sha256**, só a "sumo", bem maior. O fingerprint vem do
  `@noble/hashes`, e um teste confere que ele é igual ao do `node:crypto` (o do
  `make seal-account`): a trava de chave duplicada vale pelos dois caminhos. O WebCrypto
  não serve porque não existe fora de contexto seguro (o celular pela LAN).
- **A libsodium vai num pedaço separado** do build (433 KB, 153 KB comprimido),
  carregado só quando um formulário de chave abre.
- **O bundle principal tem 679 KB** (202 KB comprimido), quase todo do Recharts. Na fase
  6 dá para carregar os gráficos sob demanda.
- **Nada de `window.confirm`:** remover conta e arquivar portfólio confirmam num painel
  na própria tela, e a remoção lembra de revogar a chave na corretora.
- **Chave recusada pela corretora explica o que conferir** ("confira se copiou a
  chave e a secret inteiras e se a chave não foi apagada lá").
- **Na CSP de prod, a libsodium do navegador provavelmente precisa de
  `'wasm-unsafe-eval'`.** Fica para conferir na fase 6, com o build de prod.
