# EJD — Credenciamento

Sistema de inscrições, venda de ingressos e camisas e credenciamento do **Encontrão 25 Anos**, em Campina Grande–PB. Integra pagamentos pelo Mercado Pago, confirmação por e-mail e administração do evento.

## Funcionalidades

### Participantes

- Cadastro e acesso com e-mail e data de nascimento.
- Compra de ingressos inteiros, meia-entrada e sociais, conforme o lote ativo.
- Pagamento por Pix ou cartão, com autenticação bancária 3DS quando solicitada.
- Ingressos pagos com QR Code e envio por e-mail.
- Compra de até 20 camisas por pedido: Unissex, Babylook e Infantil, com tabela de medidas.
- Área **Minhas camisas**, com itens, status e comprovante do pedido.
- Modal de resultado do cartão para camisas, com motivo de recusa quando informado pelo Mercado Pago.
- Consulta automática do Pix das camisas enquanto o QR Code estiver aberto, com modal ao identificar aprovação ou pagamento não concluído.
- E-mail de confirmação das camisas após aprovação: modelo, tamanho, quantidade, valor e identificação do pedido.

### Administração e check-in

- Configuração de preços, lotes, abertura e fechamento das vendas.
- Gestão de usuários e permissões; perfis `usuarios`, `checkin` e `admin`.
- Validação de ingresso por QR Code, código ou telefone.
- Baixa manual de ingressos e reversão antes do check-in.
- Histórico de tentativas de pagamento ao clicar no nome do comprador.
- Camisas agrupadas por usuário: prioriza um pedido confirmado; sem confirmação, mostra o pedido e o status mais recentes. Todas as tentativas permanecem no histórico.
- Resumo de camisas pagas, líquido estimado e pedidos pagos com e sem cupom.
- Exportação Excel de usuários, vendas de ingressos e camisas pagas.

## Tecnologias e estrutura

React 18 e Vite no frontend; Node.js com `http` nativo no backend. Persistência em MySQL, Neon/PostgreSQL, Supabase ou JSON local. Integrações com Mercado Pago e SMTP; planilhas com ExcelJS e QR Codes com `qrcode` e `html5-qrcode`.

```text
frontend/src/main.jsx      Interface e fluxos de compra e administração
frontend/src/styles.css   Estilos da aplicação
frontend/src/coupons.js    Cálculo de cupons na interface
server.js                 API, pagamentos, persistência e e-mails
coupon-rules.js           Regras e cálculos de cupons no backend
assets/fonts/             Fontes usadas na geração de ingressos
tests/                    Testes de regras, compras, pagamentos e relatórios
versão para celular/      Aplicativo Android com Capacitor
```

## Executar localmente

O projeto declara suporte a **Node.js 18 ou superior**, com npm.

```bash
npm ci
npm run build
npm start
```

O build da raiz instala as dependências do frontend e gera `frontend/dist/`. Acesse `http://localhost:3000`, salvo alteração de `PORT`.

Use [.env.example](.env.example) como referência para criar seu `.env`. O servidor **não carrega esse arquivo automaticamente**. Exporte as variáveis no terminal ou, em uma versão do Node compatível com `--env-file`, execute:

```bash
node --env-file=.env server.js
```

`npm run dev` inicia o backend sem recompilação automática da interface. Após alterar o frontend, execute `npm run build` novamente.

## Variáveis de ambiente

Configure as variáveis no terminal ou no painel da hospedagem. Não publique credenciais no Git.

| Grupo | Variáveis | Uso |
| --- | --- | --- |
| Aplicação | `APP_URL`, `PORT` | URL pública e porta; padrão `3000` |
| Administração | `ADMIN_EMAIL`, `ADMIN_BIRTH_DATE` | Administrador inicial |
| Mercado Pago | `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY` | API de pagamentos e formulário de cartão |
| Timeout | `MERCADO_PAGO_TIMEOUT_MS` | Padrão `12000` ms; limitado entre `5000` e `30000` ms |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | E-mails de ingressos e camisas |
| MySQL | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Persistência MySQL; porta padrão `3306` |
| Neon/PostgreSQL | `NEON_DATABASE_URL` ou `DATABASE_URL` | Conexão PostgreSQL via Neon |
| Supabase | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistência via Supabase |
| Migração | `MIGRATE_NEON_TO_MYSQL` | Migração inicial opcional; padrão `0` |

Em produção, defina `APP_URL` com HTTPS, sem caminho e sem barra final, por exemplo `https://seu-dominio.com.br`.

### Banco de dados

A prioridade de seleção é:

1. MySQL, com host, banco, usuário e senha preenchidos.
2. Neon, com `NEON_DATABASE_URL` ou `DATABASE_URL` preenchida.
3. Supabase, com URL e chave preenchidas.
4. Arquivos JSON em `data/`, para uso local com persistência em disco.

As tabelas são `users`, `tickets`, `shirt_orders`, `coupons`, `settings` e `sessions`. Os registros nos bancos são armazenados no campo JSON `data`, com identificador e data de atualização.

O backend cria as tabelas no MySQL e no Neon. Consulte [neon-schema.sql](neon-schema.sql) e [supabase-schema.sql](supabase-schema.sql) para os esquemas SQL, incluindo a configuração manual do Supabase.

Com Neon e MySQL configurados, `MIGRATE_NEON_TO_MYSQL=1` copia inicialmente **usuários, ingressos e configurações**, com registro em `migration_meta`. Essa rotina não transfere pedidos de camisas, cupons ou sessões.

### E-mails

Ingressos e camisas usam a mesma configuração SMTP. Os padrões são `SMTP_HOST=smtp.gmail.com` e `SMTP_PORT=465`; preencha `SMTP_USER` e `SMTP_PASS` para habilitar o envio.

Ingressos são enviados após confirmação. Camisas recebem confirmação quando o status do pagamento é `approved`. O sistema registra `emailSentAt` e o identificador da mensagem para não repetir envios já registrados. Falhas são registradas e podem ser tentadas novamente em atualizações posteriores, inclusive na consulta a `/api/me`.

O webhook processa a aprovação mesmo com o navegador fechado. O envio depende da disponibilidade e da configuração do SMTP.

## Pagamentos

Pix e cartão usam a API `/v1/payments` do Mercado Pago. O cartão é tokenizado pelo SDK no navegador; o fluxo envia dados do titular e Device ID e suporta desafio 3DS.

| Produto | Parcelamento no cartão |
| --- | --- |
| Ingressos | Até 3 parcelas |
| Camisas | Até 12 parcelas com juros, conforme as opções retornadas pelo Mercado Pago |

O checkout bloqueia duplo clique e envia `checkoutRequestId` e chave de idempotência. Para ingressos, uma repetição pode recuperar a cobrança existente. Para camisas, um pedido já salvo com o mesmo identificador retorna conflito e orienta a conferir o pagamento.

### Confirmação e status

Configure as notificações de pagamento para:

```text
https://seu-dominio.com.br/webhook/mercadopago
```

O backend consulta o pagamento diretamente no Mercado Pago antes de atualizar ingressos e camisas. `/api/me` também reconcilia pagamentos pendentes.

- `approved`: pagamento aprovado e pedido confirmado.
- `pending`, `in_process` e `authorized`: aguardando conclusão.
- Rejeições, cancelamentos, estornos e contestações não aprovam o pedido.
- Ingressos confirmados manualmente pela administração podem ser usados no check-in.

Gerar um QR Code Pix não significa que a compra foi paga. A confirmação automática no modal de camisas depende de manter o QR Code aberto; a atualização pelo webhook ocorre independentemente dessa tela.

### Taxa de serviço e líquido das camisas

São cálculos diferentes:

| Cálculo | Pix | Cartão de crédito |
| --- | --- | --- |
| Taxa de serviço adicionada à compra, quando não isenta por cupom | 1% | 8% |
| Taxa descontada no resumo líquido estimado das camisas | 1% | 5% |

O **valor líquido estimado** considera apenas pedidos pagos e desconta a taxa de cada pagamento, arredondada em centavos. Por exemplo: R$ 45,00 no cartão resulta em R$ 42,75 líquidos estimados.

Esse indicador usa os percentuais definidos no código: **não consulta o saldo disponível nem as taxas efetivamente cobradas na conta Mercado Pago**. Os contadores **Com desconto** e **Sem cupom** também consideram somente pedidos pagos.

## Cupons e lotes

Os cupons aceitam produto de destino (ingressos ou camisas), item específico ou todos os itens, desconto percentual ou preço fixo por unidade, limite de unidades por compra, disponibilidade fixa ou ilimitada, uso único por conta e isenção opcional da taxa nas unidades elegíveis.

- Cada compra aceita um cupom. Um pedido com vários ingressos consome um uso.
- Pagamentos confirmados e pendentes reservam a utilização; recusas e cancelamentos deixam de contar.
- Cupons antigos preservam o desconto de 10% para camisas e a isenção da taxa.
- Preço fixo nunca aumenta um preço normal menor. Unidades não elegíveis mantêm preço e taxa normais.
- O atalho `REDEDAMAS` preenche ingresso inteiro a R$ 30,00, uma unidade por compra, uso único por conta, disponibilidade ilimitada e isenção da taxa nessa unidade. É necessário cadastrar ou salvar o cupom no painel.
- No lote **Dia D**, inteira, meia e social usam o preço configurado para o lote.

As compras com o mesmo cupom são serializadas por trava MySQL. No armazenamento local, a trava vale por processo Node; Neon/Supabase com múltiplas instâncias precisam de uma estratégia de trava distribuída.

## Exportações

As rotas de exportação exigem perfil administrativo.

| Relatório | Conteúdo |
| --- | --- |
| Usuários | Abas com e sem ingressos |
| Vendas de ingressos | Categorias, lotes, quantidades e valores |
| Camisas pagas | Aba de pedidos e aba de quantidades por modelo e tamanho |

O agrupamento visual das camisas por usuário não apaga pedidos. O Excel inclui cada pedido pago e pode ocupar várias linhas quando há modelos ou tamanhos diferentes.

## Deploy na Hostinger

### Código-fonte do repositório

- Instalação: `npm ci`.
- Build: `npm run build`.
- Inicialização: `npm start`.
- Arquivo de entrada: `server.js`.

O build do código-fonte compila o frontend na hospedagem.

### ZIP pré-compilado

Os arquivos locais `hostinger-deploy-*.zip` incluem backend, frontend compilado, recursos, dependências declaradas e verificador de integridade. Não incluem `.env`, `data/` ou `node_modules/`.

- Instalação: `npm install`, executado automaticamente pela Hostinger, ou `npm ci --omit=dev`.
- Build: `npm run build`, que executa `verify-deploy.js`.
- Inicialização: `npm start`; entrada `server.js`.

O `package.json` do pacote difere do código-fonte: o frontend já está compilado. Nos pacotes a partir do v55, o verificador aceita a regravação do lockfile pelo npm, valida as dependências declaradas e confere os arquivos da aplicação.

Preserve as variáveis de ambiente e os dados existentes ao atualizar. As pastas `deploy-hostinger-*` e os ZIPs são artefatos locais ignorados pelo Git.

### Verificação após publicar

Consulte `GET /health`. A resposta informa disponibilidade, versão e armazenamento ativo:

```json
{"ok":true,"version":"identificador-do-pacote","storage":"mysql"}
```

No deploy direto do código-fonte, sem `deploy-version.json`, a versão é `development`. Confira também login, compras, confirmação pelo webhook, e-mails, histórico, check-in e exportações.

## Deploy na Vercel

O arquivo [vercel.json](vercel.json) define build e roteamento. Configure as variáveis de ambiente no projeto, use banco externo e atualize `APP_URL` e o webhook para o domínio publicado.

Com a CLI configurada para o projeto correto:

```bash
npx vercel --prod
```

O armazenamento JSON local não deve ser usado como persistência na Vercel. O diretório `.vercel/` é local e não é versionado.

## Testes

Instale as dependências da raiz e do frontend antes dos testes de renderização:

```bash
npm ci
npm --prefix frontend ci
npm test
```

A suíte padrão cobre cupons, checkout, pagamentos, webhook, relatórios, cálculo líquido, agrupamento de pedidos, modais e e-mails de confirmação. Os testes de envio usam transporte simulado.

Para verificar adicionalmente a exportação de camisas:

```bash
node --test tests/shirt-export.test.js
```

Para validar a compilação da interface:

```bash
npm --prefix frontend run build
```

## API principal

| Método e rota | Finalidade |
| --- | --- |
| `GET /health` | Versão e armazenamento ativo |
| `GET /api/config` | Configurações públicas |
| `POST /api/register`, `POST /api/login` | Cadastro e autenticação |
| `GET /api/me` | Perfil, ingressos e camisas do usuário autenticado |
| `POST /api/tickets/checkout` | Compra de ingressos |
| `POST /api/shirts/checkout` | Compra de camisas |
| `POST /api/coupons/validate` | Validação de cupom |
| `POST /api/checkin/validate` | Validação e registro do check-in |
| `GET /api/admin/summary` | Resumo administrativo |
| `PUT /api/admin/settings` | Configurações do evento |
| `GET /api/admin/users`, `GET /api/admin/users/export` | Usuários e Excel |
| `GET /api/admin/sales-report/export` | Excel de vendas de ingressos |
| `GET /api/admin/shirt-orders`, `GET /api/admin/shirt-orders/export` | Pedidos de camisas e Excel de pagos |
| `GET /api/admin/coupons`, `POST /api/admin/coupons` | Consulta e cadastro de cupons |
| `PUT /api/admin/coupons/:id/rules` | Edição das regras de cupom |
| `PUT /api/admin/coupons/:id/status`, `/limit`, `/code` | Ativação, limite e código |
| `POST /api/admin/tickets/:id/confirm`, `/undo-manual` | Baixa manual e reversão |
| `POST /webhook/mercadopago` | Notificações de pagamento |

## Aplicativo Android

A pasta `versão para celular/` contém o aplicativo Capacitor que abre o sistema publicado. Para gerar um APK de depuração no Windows, com JDK e Android SDK configurados:

```bash
cd "versão para celular"
npm install
npm run sync
npm run build:android
```

Saída: `versão para celular/android/app/build/outputs/apk/debug/app-debug.apk`.
