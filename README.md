# EJD - Credenciamento

Sistema web de credenciamento para o evento **Encontrão 25 Anos**, em Campina Grande - PB.

Produção: https://ejd-credenciamento.vercel.app

## Funcionalidades

- Cadastro e login de participantes por CPF, WhatsApp e data de nascimento.
- Compra de ingressos com Pix ou cartão de crédito via Mercado Pago.
- Geração de QR Code para ingressos pagos.
- Painel de check-in com validação por QR Code, código ou telefone.
- Painel administrativo com usuários, ingressos, presença e baixa manual.
- Webhook do Mercado Pago para confirmação automática de pagamentos.
- Exibição do status real do Mercado Pago, incluindo aprovado, pendente, rejeitado, cancelado, estornado, contestação e mediação.

## Tecnologias

- React com JavaScript
- HTML e CSS sem framework
- Backend Node.js com módulo `http` nativo
- Neon/Postgres em produção com `@neondatabase/serverless`
- Supabase como fallback se `DATABASE_URL`/`NEON_DATABASE_URL` não estiver configurado
- Fallback local em arquivos JSON quando nenhum banco estiver configurado
- QR Code com `qrcode`
- Leitura de QR Code no navegador com `html5-qrcode`
- Deploy na Vercel via `vercel.json`

## Rodar Localmente

```bash
npm install
cd frontend
npm install
cd ..
npm run build
npm start
```

Acesse:

```text
http://localhost:3000
```

Para desenvolvimento simples do backend, também é possível usar:

```bash
npm run dev
```

## Versao Android

A pasta `versão para celular/` contem um app Android criado com Capacitor. Ele abre o deploy de producao do sistema dentro de um aplicativo nativo.

Para gerar um APK debug:

```bash
cd "versão para celular"
npm install
npm run sync
npm run build:android
```

O APK fica em:

```text
versão para celular/android/app/build/outputs/apk/debug/app-debug.apk
```

## Variáveis De Ambiente

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
DATABASE_URL=
NEON_DATABASE_URL=
MERCADO_PAGO_ACCESS_TOKEN=
ADMIN_CPF=
ADMIN_BIRTH_DATE=
APP_URL=http://localhost:3000
PORT=3000
```

Prioridade de banco:

1. `NEON_DATABASE_URL` ou `DATABASE_URL`
2. Supabase, se `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estiverem configurados
3. Arquivos locais em `data/`

## Mercado Pago

Configure `MERCADO_PAGO_ACCESS_TOKEN` para habilitar pagamentos.

O sistema usa:

- Pix: criação direta em `/v1/payments`
- Cartão de crédito: preferência de checkout em `/checkout/preferences`
- Webhook: `/webhook/mercadopago`

Em produção, configure a URL pública:

```bash
APP_URL=https://ejd-credenciamento.vercel.app
```

O webhook atualiza `mercadoPagoStatus` e `mercadoPagoStatusDetail` nos ingressos.

Regras principais:

- `approved`: conta como pago e libera QR Code/check-in.
- `manual`: conta como pago quando confirmado manualmente pelo admin.
- `pending`, `in_process`, `authorized`: ficam aguardando.
- `rejected`, `cancelled`, `refunded`, `charged_back`, `in_mediation`: não contam como pago.

## Publicar Na Vercel

O projeto já está vinculado à Vercel pelo diretório `.vercel`.

Para publicar em produção:

```bash
npx vercel --prod --yes
```

Variáveis recomendadas na Vercel:

```bash
NEON_DATABASE_URL=
MERCADO_PAGO_ACCESS_TOKEN=
APP_URL=https://ejd-credenciamento.vercel.app
```

Após o deploy, valide:

```bash
curl https://ejd-credenciamento.vercel.app/health
```

Resposta esperada:

```json
{"ok":true,"storage":"neon"}
```

## Área Exclusiva

As credenciais administrativas de produção não devem ser publicadas no repositório.

Configure `ADMIN_CPF` e `ADMIN_BIRTH_DATE` somente nas variáveis de ambiente do deploy. O backend usa esses valores para criar ou migrar o usuário administrativo inicial, mas o acesso de produção deve ser tratado como credencial sensível e compartilhado apenas pelos responsáveis do evento.

## Banco De Dados

O backend cria as tabelas automaticamente ao iniciar com Neon/Postgres.

Se preferir criar manualmente, execute:

- `neon-schema.sql` no SQL Editor do Neon
- `supabase-schema.sql` no SQL Editor do Supabase

Tabelas usadas:

- `users`
- `tickets`
- `settings`
- `sessions`

## Rotas Úteis

- `GET /health`: status da aplicação e storage ativo
- `GET /api/config`: configurações públicas
- `POST /api/register`: cadastro
- `POST /api/login`: login
- `GET /api/me`: perfil e ingressos do usuário
- `POST /api/tickets/checkout`: compra de ingressos
- `POST /api/checkin/validate`: validação de check-in
- `GET /api/admin/summary`: resumo administrativo
- `PUT /api/admin/settings`: configurações do evento
- `GET /api/admin/users`: usuários
- `POST /webhook/mercadopago`: webhook de pagamentos

## Observações

- Ingressos pendentes expiram visualmente após 1 hora quando ainda estão aguardando pagamento.
- Ingressos com estorno, contestação, rejeição ou cancelamento continuam visíveis no admin, mas não contam como pagos.
- O check-in só é permitido para ingressos efetivamente pagos.
