# EJD - Credenciamento

Sistema web de credenciamento para o evento **Encontrão 25 Anos**, em Campina Grande - PB.

Aplicação preparada para publicação na Hostinger ou Vercel. Configure `APP_URL` com o domínio utilizado no ambiente.

## Funcionalidades

- Cadastro e login de participantes por e-mail e data de nascimento.
- Compra de ingressos com Pix ou cartão de crédito via Mercado Pago.
- Geração de QR Code para ingressos pagos.
- Painel de check-in com validação por QR Code, código ou telefone.
- Painel administrativo com usuários, ingressos, presença e baixa manual.
- Webhook do Mercado Pago para confirmação automática de pagamentos.
- Exibição do status real do Mercado Pago, incluindo aprovado, pendente, rejeitado, cancelado, estornado, contestação e mediação.
- Compra de camisas Unissex, Babylook e Infantil, com tabela de medidas e até 20 unidades por pedido.
- Área **Minhas camisas**, com itens, status do pagamento e download do comprovante do pedido.
- Gestão de cupons: criação, ativação, alteração do código, limite e consulta de utilizações.
- Histórico de pagamentos ao clicar no nome do participante nos ingressos ou pedidos de camisas.
- Resumo das quantidades de camisas pagas por modelo e tamanho.
- Exportação Excel de usuários com e sem ingressos e relatório de vendas por categoria e lote.
- Exportação Excel de camisas com **somente pedidos pagos**, em duas abas: pedidos e quantidades pagas.
- Opção de desfazer a baixa manual de ingressos antes do check-in.

## Tecnologias

- React com JavaScript
- HTML e CSS sem framework
- Backend Node.js com módulo `http` nativo
- MySQL com `mysql2`, Neon/Postgres com `@neondatabase/serverless` ou Supabase
- Fallback local em arquivos JSON quando nenhum banco estiver configurado
- QR Code com `qrcode`
- Leitura de QR Code no navegador com `html5-qrcode`
- Deploy na Vercel via `vercel.json`
- Publicação na Hostinger com backend Node.js e frontend pré-compilado
- Planilhas Excel com `exceljs`

## Rodar Localmente

Requisito declarado no projeto: Node.js 18 ou superior.

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

Esse comando inicia o servidor Node, sem recompilar automaticamente o frontend. Após alterar a interface, execute `npm run build` novamente.

Use [.env.example](.env.example) como referência. O servidor **não carrega `.env` automaticamente**: configure as variáveis no terminal ou painel da hospedagem. Em versões do Node com suporte a `--env-file`, também é possível executar `node --env-file=.env server.js`.

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
MYSQL_HOST=
MYSQL_PORT=3306
MYSQL_DATABASE=
MYSQL_USER=
MYSQL_PASSWORD=
MIGRATE_NEON_TO_MYSQL=0
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_PUBLIC_KEY=
MERCADO_PAGO_TIMEOUT_MS=12000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
ADMIN_EMAIL=
ADMIN_BIRTH_DATE=
APP_URL=http://localhost:3000
PORT=3000
```

Para enviar automaticamente os ingressos por e-mail após a confirmação do pagamento, configure `SMTP_USER` e `SMTP_PASS`. Para uma conta Gmail pessoal, use uma senha de app do Google em `SMTP_PASS`, nunca a senha normal da conta.

Prioridade de banco:

1. MySQL, se host, banco, usuário e senha estiverem configurados
2. `NEON_DATABASE_URL` ou `DATABASE_URL`
3. Supabase, se `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` estiverem configurados
4. Arquivos locais em `data/`

## Mercado Pago

Configure `MERCADO_PAGO_ACCESS_TOKEN` para habilitar pagamentos e `MERCADO_PAGO_PUBLIC_KEY` para o formulário de cartão no navegador.

As chamadas ao Mercado Pago usam timeout controlado de 12 segundos. Esse valor pode ser ajustado entre 5 e 30 segundos com `MERCADO_PAGO_TIMEOUT_MS`.

O sistema usa:

- Pix: criação direta em `/v1/payments`
- Cartão de crédito: criação direta em `/v1/payments`, com formulário do SDK no navegador e autenticação 3DS quando solicitada pelo banco
- Webhook: `/webhook/mercadopago`

Em produção, configure a URL pública:

```bash
APP_URL=https://ejd-credenciamento.vercel.app
```

O webhook aceita notificações Webhooks e IPN (`data.id`, `payment_id`, `id`, query string ou URL em `resource`), consulta o pagamento diretamente na API do Mercado Pago e somente então atualiza os ingressos. A mesma notificação pode ser reenviada sem criar ingressos ou repetir um e-mail já registrado.

O checkout envia um `checkoutRequestId` estável. Duplo clique é bloqueado e os pagamentos usam `X-Idempotency-Key`. No fluxo de ingressos, um retry recupera a cobrança existente, inclusive o QR Code Pix. Para camisas, um pedido já registrado com o mesmo identificador retorna conflito e orienta a consultar o pagamento.

Configure o webhook no domínio utilizado na hospedagem:

```text
https://SEU-DOMINIO/webhook/mercadopago
```

Se o domínio de produção mudar, atualize `APP_URL` no ambiente. Não inclua caminho nem barra final; a aplicação acrescenta `/webhook/mercadopago` automaticamente.

Regras principais:

- `approved`: conta como pago e libera QR Code/check-in.
- `manual`: conta como pago quando confirmado manualmente pelo admin.
- `pending`, `in_process`, `authorized`: ficam aguardando.
- `rejected`, `cancelled`, `refunded`, `charged_back`, `in_mediation`: não contam como pago.
- O endpoint `/api/me` reconcilia pagamentos ainda pendentes com a API, servindo como recuperação caso uma entrega do webhook falhe.

## Publicar Na Vercel

O repositório inclui `vercel.json` com build e roteamento. Vincule o checkout ao projeto Vercel e configure as variáveis no painel; o diretório `.vercel` é local e não é versionado. Use um banco externo para persistência.

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

Configure `ADMIN_EMAIL` e `ADMIN_BIRTH_DATE` somente nas variáveis de ambiente do deploy. O backend usa esses valores para criar ou migrar o usuário administrativo inicial, mas o acesso de produção deve ser tratado como credencial sensível e compartilhado apenas pelos responsáveis do evento.

## Banco De Dados

O backend cria as tabelas automaticamente no MySQL e no Neon/Postgres. No Supabase, execute o esquema SQL.

Com MySQL e Neon configurados, `MIGRATE_NEON_TO_MYSQL=1` habilita a migração inicial de **usuários, ingressos e configurações**, registrada em `migration_meta`. Essa rotina não copia pedidos de camisas, cupons ou sessões. O valor padrão é `0`.

Se preferir criar manualmente, execute:

- `neon-schema.sql` no SQL Editor do Neon
- `supabase-schema.sql` no SQL Editor do Supabase

Tabelas usadas:

- `users`
- `tickets`
- `shirt_orders`
- `coupons`
- `settings`
- `sessions`

## Rotas Úteis

- `GET /health`: status da aplicação e storage ativo
- `GET /api/config`: configurações públicas
- `POST /api/register`: cadastro
- `POST /api/login`: login
- `GET /api/me`: perfil, ingressos e pedidos de camisas do usuário
- `POST /api/tickets/checkout`: compra de ingressos
- `POST /api/shirts/checkout`: compra de camisas
- `POST /api/coupons/validate`: validação de cupom
- `POST /api/checkin/validate`: validação de check-in
- `GET /api/admin/summary`: resumo administrativo
- `PUT /api/admin/settings`: configurações do evento
- `GET /api/admin/users`: usuários
- `GET /api/admin/users/export`: Excel de usuários
- `GET /api/admin/sales-report/export`: Excel de vendas de ingressos
- `GET /api/admin/shirt-orders`: pedidos e resumo de camisas
- `GET /api/admin/shirt-orders/export`: Excel de camisas pagas
- `GET /api/admin/coupons` e `POST /api/admin/coupons`: consulta e criação de cupons
- `PUT /api/admin/coupons/:id/status`, `/limit` e `/code`: ativação, limite e código do cupom
- `POST /api/admin/tickets/:id/confirm`: baixa manual
- `POST /api/admin/tickets/:id/undo-manual`: desfazer baixa manual
- `POST /webhook/mercadopago`: webhook de pagamentos

## Observações

- Ingressos pendentes expiram visualmente após 1 hora quando ainda estão aguardando pagamento.
- Ingressos com estorno, contestação, rejeição ou cancelamento continuam visíveis no admin, mas não contam como pagos.
- O check-in só é permitido para ingressos efetivamente pagos.

## Camisas e Cupons

- Cupom válido: desconto de **10%** sobre o subtotal, sem taxa de serviço, em Pix ou cartão.
- Sem cupom: taxa de **1% no Pix** ou **8% no cartão**.
- Cartão: até **2 parcelas** para camisas; ingressos permitem até **3 parcelas**.
- A utilização de cupons considera pedidos confirmados e pedidos aguardando pagamento.
- Preço e fechamento das vendas são configurados na área administrativa.
- A interface informa o prazo de pedidos até **15 de outubro**. Esse aviso é um texto da tela, não um agendamento automático de fechamento.

No painel **Pedidos de Camisas**, clique no nome para consultar o histórico de pagamentos daquele usuário. O botão **Baixar Excel**, à direita do título, exporta apenas pedidos pagos:

| Aba | Conteúdo |
| --- | --- |
| Pedidos de camisas | Nome do usuário, modelo e tamanho, cupom, quantidade e status do pagamento |
| Quantidades pagas | Quantidade por modelo e tamanho e total geral, usando o mesmo cálculo da tela |

Pedidos com modelos ou tamanhos diferentes ocupam mais de uma linha na primeira aba. As rotas administrativas exigem perfil `admin`.

## Testes

Para os testes de pagamentos, webhook e relatórios de ingressos:

```bash
npm test
```

Para executar também os testes do Excel de camisas:

```bash
node --test tests/mercadopago-webhook.test.js tests/shirt-export.test.js
```

Os testes do Excel verificam a leitura do arquivo gerado, os cupons, a exclusão de pedidos não pagos e os totais por modelo e tamanho. Valide a compilação da interface com `npm run build`.

## Publicar Na Hostinger

### A partir do código-fonte

Configure as variáveis no painel, instale as dependências com `npm ci`, use `npm run build` como comando de build e `npm start` como inicialização. O arquivo de entrada é `server.js`.

### Pacote pré-compilado

Os pacotes locais `hostinger-deploy-*.zip` incluem `frontend/dist/`, backend, recursos e dependências declaradas. Neles:

- Instalação: `npm ci --omit=dev`.
- Build: `npm run build`, que executa `verify-deploy.js` para conferir os arquivos já compilados.
- Inicialização: `npm start` ou entrada `server.js`.

O `package.json` desses pacotes difere do código-fonte: não é necessário recompilar o frontend na hospedagem. Preserve as variáveis e os dados existentes no deploy. Pastas `deploy-hostinger-*` e ZIPs são artefatos locais ignorados pelo Git.

Após publicar, consulte `GET /health`; o campo `storage` informa o armazenamento ativo. Confira também login, webhook, pedidos de camisas e download do Excel na área administrativa.
