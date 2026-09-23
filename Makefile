.DEFAULT_GOAL := menu

include ./make_cmd/colors.mk
include ./make_cmd/cli.mk

# Imagem usada para mexer em package.json/lock e gerar chaves sem node no host.
# Mesma versão dos Dockerfiles, para o lock sair igual ao que o build instala.
NODE_IMAGE = node:26-alpine
AS_ME      = --user $$(id -u):$$(id -g) -e npm_config_cache=/tmp/.npm

# Produção: VPS com nginx de borda e certbot, como os outros apps de lá.
VPS        = root@76.13.172.71
VPS_PATH   = /root/cripto
DOMAIN     = cripto.paulonavarro.com
PUBLIC_URL = https://$(DOMAIN)
TUNNEL_PORT ?= 15434

.PHONY: dev dev-detached prod prod-detached down logs ps build env keys migrate collect seal-account market-live demo demo-clear e2e shots pwa-check \
        deploy vps-shell prod-logs prod-ps prod-restart prod-collect prod-db-shell prod-db-backup \
        prod-db-tunnel prod-cert prod-cert-status prod-key \
        smoke typecheck backend-add frontend-add db-shell db-backup check-keys check-prod

# O compose interpola as variáveis de todos os perfis, inclusive o prod. O
# .env de exemplo satisfaz todos, por isso o dev cria o .env sozinho.
dev: env check-keys ## Sobe o stack de desenvolvimento (Vite + api + worker com reload)
	@echo "$(BLUE)Subindo em modo dev → http://localhost:$${CRIPTO_DEV_PORT:-5175}$(NC)"
	docker compose --profile dev up --build

dev-detached: env check-keys ## Sobe o dev em background
	docker compose --profile dev up -d --build

check-keys:
	@if [ ! -f keys/sealing.dev.pub ] || [ ! -f secrets/sealing.dev.key ]; then \
		echo "$(YELLOW)Chaves de selagem não existem — rode 'make keys'.$(NC)"; exit 1; fi

check-prod:
	@if [ ! -f .env ]; then echo "$(YELLOW).env não existe — rode 'make env' e troque as senhas.$(NC)"; exit 1; fi
	@if [ ! -f keys/sealing.prod.pub ] || [ ! -f secrets/sealing.prod.key ]; then \
		echo "$(YELLOW)Chaves de selagem de prod não existem — rode 'make keys'.$(NC)"; exit 1; fi

prod: check-prod ## Sobe o stack de produção (build + nginx)
	@echo "$(BLUE)Subindo em modo prod → http://localhost:$${CRIPTO_PORT:-8084}$(NC)"
	docker compose --profile prod up --build

prod-detached: check-prod ## Sobe o prod em background
	docker compose --profile prod up -d --build

down: ## Derruba tudo (dev e prod), mantendo os volumes
	docker compose --profile dev --profile prod down

logs: ## Acompanha os logs do stack em execução
	docker compose --profile dev --profile prod logs -f --tail 50

ps: ## Mostra o status dos containers
	docker compose --profile dev --profile prod ps -a

build: ## Rebuild das imagens de produção sem subir
	docker compose --profile prod build

env: ## Cria o .env a partir do .env.example (não sobrescreve)
	@if [ -f .env ]; then \
		echo "$(YELLOW).env já existe — nada a fazer.$(NC)"; \
	else \
		cp .env.example .env; \
		echo "$(GREEN).env criado. Em prod, troque todas as senhas.$(NC)"; \
	fi

keys: ## Gera os pares de chaves de selagem de dev e prod (nunca sobrescreve)
	docker run --rm $(AS_ME) -v $(CURDIR):/w -w /w $(NODE_IMAGE) node backend/scripts/keys.ts
	@echo "$(YELLOW)Guarde uma cópia de secrets/sealing.prod.key fora desta máquina.$(NC)"

migrate: ## Aplica migrations novas no banco de dev (a api e o worker seguem de pé)
	docker compose --profile dev up migrate

# ── Checagens (rodam dentro do container de dev) ─────────────

smoke: ## Roda todos os scripts/*-smoke.ts contra o dev de pé (para no primeiro que falhar)
	docker compose --profile tools run --rm --build tools

# ── Coleta ───────────────────────────────────────────────────

collect: ## Força uma coleta agora e mostra o log do worker
	docker compose --profile dev exec -T db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB" -qc "notify collect_now"'
	@echo "$(BLUE)Coleta pedida. Log do worker (Ctrl-C sai):$(NC)"
	docker compose --profile dev logs -f --since 5s worker

# Pede a chave sem eco e passa por variável de ambiente: não fica no histórico
# do shell nem na linha de comando de processo nenhum.
seal-account: ## Cadastra uma conta de corretora no dev (KIND=binance|okx LABEL=nome)
	@if [ "$(KIND)" != binance ] && [ "$(KIND)" != okx ]; then \
		echo "$(YELLOW)uso: make seal-account KIND=binance|okx [LABEL=nome]$(NC)"; exit 1; fi
	@read -p "API key: " APIKEY; \
	stty -echo; printf "Secret: "; read SECRET; echo; \
	if [ "$(KIND)" = okx ]; then printf "Passphrase: "; read PASSPHRASE; echo; fi; \
	stty echo; \
	export APIKEY SECRET PASSPHRASE; \
	docker compose --profile tools run --rm -e APIKEY -e SECRET -e PASSPHRASE \
		-e KIND=$(KIND) -e LABEL="$(or $(LABEL),$(KIND))" tools npx tsx scripts/seal-account.ts

demo: ## Coloca a planilha como portfólio de demonstração no dev (com 90 dias de histórico real)
	docker compose --profile tools run --rm tools npx tsx scripts/demo.ts

demo-clear: ## Apaga o portfólio de demonstração
	docker compose --profile tools run --rm tools npx tsx scripts/demo.ts --clear

# ── Navegador (Chrome headless num container, na rede do compose) ─────────

PUPPETEER_IMAGE = zenika/alpine-chrome:with-puppeteer

e2e: ## Contas pela tela, de ponta a ponta, num Chrome headless (precisa do dev de pé)
	@status=0; docker run --rm --network cripto_default -v $(CURDIR)/e2e:/usr/src/app/e2e:ro \
		-v $(CURDIR)/e2e/out:/out $(PUPPETEER_IMAGE) node e2e/accounts.js || status=$$?; \
	docker compose --profile dev exec -T db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB" -q' < e2e/cleanup.sql; \
	exit $$status

pwa-check: ## Instalação, cache e offline, contra o build de produção (BASE=http://cripto-prodtest)
	docker run --rm --network cripto_default -e BASE=$(or $(BASE),http://cripto-prodtest) \
		-v $(CURDIR)/e2e:/usr/src/app/e2e:ro $(PUPPETEER_IMAGE) node e2e/pwa.js

shots: ## Capturas de todas as telas em e2e/out/ (SCHEME=light|dark; precisa do make demo)
	docker run --rm --network cripto_default -e SCHEME=$(or $(SCHEME),dark) -v $(CURDIR)/e2e:/usr/src/app/e2e:ro \
		-v $(CURDIR)/e2e/out:/out $(PUPPETEER_IMAGE) node e2e/shots.js

market-live: ## Consulta de verdade Binance, OKX e cryptoprices.cc (TICKERS="BTC ETH")
	docker compose --profile tools run --rm -e TICKERS="$(or $(TICKERS),BTC ETH HBAR LDO USDT)" tools npx tsx scripts/market-live.ts

typecheck: ## tsc no backend e no frontend
	docker compose --profile dev exec api npx tsc --noEmit
	docker compose --profile dev exec frontend npx tsc --noEmit

# ── Dependências ─────────────────────────────────────────────
# O node_modules do container é volume anônimo: o --build sozinho reaproveita o
# antigo, então a imagem teria o pacote novo e o container não. Daí o
# --renew-anon-volumes. api, worker e migrate dividem o mesmo package.json.

backend-add: ## Adiciona pacote ao backend (PKG=nome, DEV=1 para devDependency)
	@if [ -z "$(PKG)" ]; then echo "$(YELLOW)uso: make backend-add PKG=nome [DEV=1]$(NC)"; exit 1; fi
	docker run --rm $(AS_ME) -v $(CURDIR)/backend:/app -w /app $(NODE_IMAGE) \
		npm install --package-lock-only $(if $(DEV),--save-dev) $(PKG)
	docker compose --profile dev up -d --build --renew-anon-volumes migrate api worker

frontend-add: ## Adiciona pacote ao frontend (PKG=nome, DEV=1 para devDependency)
	@if [ -z "$(PKG)" ]; then echo "$(YELLOW)uso: make frontend-add PKG=nome [DEV=1]$(NC)"; exit 1; fi
	docker run --rm $(AS_ME) -v $(CURDIR)/frontend:/app -w /app $(NODE_IMAGE) \
		npm install --package-lock-only $(if $(DEV),--save-dev) $(PKG)
	docker compose --profile dev up -d --build --renew-anon-volumes frontend

# ── Banco ────────────────────────────────────────────────────

db-shell: ## psql no banco de desenvolvimento (como dono)
	docker compose --profile dev exec db sh -c 'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'

db-backup: ## Dump do banco de dev para backups/
	@mkdir -p backups
	@f=backups/cripto-dev-$$(date +%Y%m%d-%H%M).sql.gz; \
	docker compose --profile dev exec -T db sh -c 'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"' | gzip > $$f; \
	echo "$(GREEN)$$f  ($$(du -h $$f | cut -f1))$(NC)"

# ── Produção (VPS) ───────────────────────────────────────────

deploy: ## Publica em https://cripto.paulonavarro.com (push + pull + rebuild na VPS)
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "$(YELLOW)Working tree sujo — commite antes de publicar:$(NC)"; git status --short; exit 1; fi
	@echo "$(BLUE)Enviando para o GitHub...$(NC)"
	git push origin main
	@echo "$(BLUE)Rebuild na VPS...$(NC)"
	ssh $(VPS) 'cd $(VPS_PATH) && git pull origin main && docker compose --profile prod up -d --build'
	@echo "$(GREEN)No ar: $(PUBLIC_URL)$(NC)"

vps-shell: ## Shell na VPS, já na pasta do projeto
	ssh -t $(VPS) 'cd $(VPS_PATH) && exec bash -l'

prod-logs: ## Acompanha os logs de produção na VPS
	ssh $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod logs -f --tail 50'

prod-ps: ## Status dos containers de produção na VPS
	ssh $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod ps'

prod-restart: ## Reinicia o stack de produção na VPS (sem rebuild)
	ssh $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod restart'

prod-collect: ## Força uma coleta na produção
	ssh $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod exec -T db-prod sh -c '"'"'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB" -qc "notify collect_now"'"'"''

prod-db-shell: ## psql no banco de produção, na VPS
	ssh -t $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod exec db-prod sh -c '"'"'psql -U "$$POSTGRES_USER" "$$POSTGRES_DB"'"'"''

prod-db-backup: ## Traz um dump da produção para backups/ (rode antes de mexer no banco)
	@mkdir -p backups
	@f=backups/cripto-prod-$$(date +%Y%m%d-%H%M).sql.gz; \
	ssh $(VPS) 'cd $(VPS_PATH) && docker compose --profile prod exec -T db-prod sh -c '"'"'pg_dump -U "$$POSTGRES_USER" "$$POSTGRES_DB"'"'"'' | gzip > $$f; \
	if [ ! -s $$f ]; then echo "$(YELLOW)dump veio vazio — nada foi salvo$(NC)"; rm -f $$f; exit 1; fi; \
	echo "$(GREEN)$$f  ($$(du -h $$f | cut -f1))$(NC)"

# O db-prod não publica porta nem na VPS: o cliente gráfico entra por um túnel
# ssh. O IP do container muda a cada deploy, então é perguntado na hora.
prod-db-tunnel: ## Túnel ssh até o banco de produção em 127.0.0.1:$(TUNNEL_PORT) (Ctrl-C fecha)
	@ip=$$(ssh $(VPS) "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' cripto-db-prod"); \
	echo "$(BLUE)127.0.0.1:$(TUNNEL_PORT) → $$ip:5432 (usuário e senha do .env da VPS)$(NC)"; \
	ssh -N -L $(TUNNEL_PORT):$$ip:5432 $(VPS)

prod-cert: ## Emite o certificado do domínio na VPS (primeira instalação)
	ssh $(VPS) 'mkdir -p /var/www/certbot && certbot --nginx -d $(DOMAIN) --non-interactive --agree-tos --register-unsafely-without-email --keep-until-expiring'

prod-cert-status: ## Validade do certificado e teste de renovação
	ssh $(VPS) 'certbot certificates --cert-name $(DOMAIN) && certbot renew --cert-name $(DOMAIN) --dry-run'

prod-key: ## Manda a chave privada de selagem de produção para a VPS (uma vez)
	@if [ ! -f secrets/sealing.prod.key ]; then echo "$(YELLOW)secrets/sealing.prod.key não existe — rode 'make keys'.$(NC)"; exit 1; fi
	scp secrets/sealing.prod.key $(VPS):$(VPS_PATH)/secrets/sealing.prod.key
	ssh $(VPS) 'chmod 600 $(VPS_PATH)/secrets/sealing.prod.key && chown 1000:1000 $(VPS_PATH)/secrets/sealing.prod.key'
	@echo "$(GREEN)Chave no lugar. Guarde uma cópia fora daqui e da VPS.$(NC)"
