# Fase 6 — PWA e produção ⏳ falta instalar na VPS

Instalado no celular e no ar. Deploy igual ao do tarot.

## Tarefas

- [x] **6.1** Ícones 192/512/maskable, `apple-touch-icon`, manifest `standalone`
- [x] **6.2** Service worker guarda só o app, **nunca** `/api`
- [x] **6.3** Última resposta salva no IndexedDB; offline mostra "atualizado em …"
- [x] **6.4** Offline, botões de alterar ficam desabilitados
- [x] **6.5** Sair apaga o IndexedDB e o cache
- [x] **6.6** Cabeçalhos: CSP estrita, `frame-ancestors 'none'`, `no-referrer`
      (conferir se a libsodium precisa de `'wasm-unsafe-eval'`)
- [x] **6.7** `deploy/cripto.paulonavarro.com.conf` + certbot no subdomínio. O HSTS fica no
      nginx do container, não no de borda (o certbot reescreve o de lá)
- [x] **6.8** `.env.prod.example`; o migrate recusa senha fraca e o `assertApiConfig`
      recusa prod sem Google, sem `ALLOWED_EMAILS` ou com login de dev
- [ ] **6.9** Endereço de retorno de produção cadastrado no Google — **com você**:
      `https://cripto.paulonavarro.com/api/auth/google/callback`
- [x] **6.10** `make deploy`, `prod-logs`, `prod-db-shell`, `prod-db-backup`,
      `prod-db-tunnel` do tarot
- [ ] **6.11** Backup da chave privada de prod guardado fora da VPS (`make prod-key` a manda;
      a cópia de segurança é com você)

## Pronto quando

- [ ] **Login Google funciona com o app instalado no iPhone.** É o maior risco. Só dá
      para testar com o app no ar em https.
- [x] Instala e abre offline: `make pwa-check` confere o manifest, os ícones, o service
      worker, que `/api` não é cacheado, e que offline a tela abre avisando.
- [ ] `make deploy` publica a partir do working tree limpo (falta a primeira instalação).

## Primeira instalação (na VPS)

```bash
ssh root@76.13.172.71
git clone git@github.com:paulo-navarro/portfolio_tracker.git /root/cripto
cd /root/cripto && cp .env.prod.example .env && $EDITOR .env    # senhas e Google

# a chave de selagem de produção, da máquina de dev:
make prod-key

# nginx de borda + certificado
cp deploy/cripto.paulonavarro.com.conf /etc/nginx/sites-available/cripto.paulonavarro.com
ln -s /etc/nginx/sites-available/cripto.paulonavarro.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d cripto.paulonavarro.com          # ou `make prod-cert`

docker compose --profile prod up -d --build
```

Depois: vincular as chaves das corretoras ao IP `76.13.172.71` (a tela mostra o IP).

## O que a verificação achou

- **A libsodium precisa mesmo de `'wasm-unsafe-eval'`** na CSP, como a spec suspeitava.
  Sem isso o cadastro de conta quebra com "Refused to compile or instantiate WebAssembly
  module". Conferido rodando o `make e2e` contra o build de produção servido pelo nginx
  com a CSP de verdade: antes falhava, depois passa. É o mínimo — permite WebAssembly,
  não permite `eval` de JavaScript.
- **`/api` nunca entra no cache do service worker**, e o `make pwa-check` falha se entrar:
  saldo velho servido como novo seria pior que não abrir.
- **Offline precisa do `/api/me` guardado.** Sem ele a tela não sabia que havia alguém
  logado e ficava em "carregando". Quem tem a palavra final continua sendo o servidor:
  um 401 derruba a sessão na hora, e sair apaga o IndexedDB.
- **Escrita offline é barrada no `api.ts`**, não só nos botões: nada de fila de escrita,
  muito menos de credencial.
- **Os gráficos saíram do pacote principal:** 679 KB viraram 304 KB no principal e 384 KB
  num pedaço que só a tela de portfólio carrega. Com gzip no nginx, o principal desce
  para 110 KB.
- **`sw.js` não pode ser cacheado** (`no-store`): é ele que traz a versão nova.
- **Armadilha do bind mount:** `rm -rf` numa pasta montada num container faz o container
  continuar vendo a pasta antiga (o inode some, o mount fica). Só acontece no teste; a
  imagem de produção copia o build para dentro.
- **`prefers-color-scheme` no headless é claro**, então as capturas testam os dois temas.
