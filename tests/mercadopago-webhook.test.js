const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");

process.env.NODE_ENV = "test";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST_ACCESS_TOKEN_NOT_SECRET";
const server = require("../server");
const {
  applyMercadoPagoPayment,
  createMercadoPagoCardPayment,
  summarizeShirtOrders,
  trySendPurchasedShirtEmail,
  sendMercadoPagoShirtEmail,
  createSalesReportWorkbook,
  createUsersWorkbook,
  db,
  extractMercadoPagoPaymentId,
  mercadoPagoRequest,
  isExpiredPendingTicket,
  isTicketPaid,
  undoManualPayment
} = server.testHelpers;

test("desfaz baixa manual e restaura o estado anterior do pagamento", async () => {
  const ticket = {
    id: "manual-undo",
    status: "confirmed",
    mercadoPagoStatus: "manual",
    mercadoPagoStatusDetail: null,
    confirmedAt: "2026-09-17T20:00:00.000Z",
    paidAt: "2026-09-17T20:00:00.000Z",
    emailSentAt: "2026-09-17T20:01:00.000Z",
    manualConfirmedBy: "admin-1",
    manualConfirmedByName: "Admin",
    manualPreviousStatus: "pending",
    manualPreviousMercadoPagoStatus: "rejected",
    manualPreviousMercadoPagoStatusDetail: "cc_rejected_high_risk"
  };
  const tickets = [ticket];

  await undoManualPayment(ticket, memoryStorage(tickets));

  assert.equal(ticket.status, "pending");
  assert.equal(ticket.mercadoPagoStatus, "rejected");
  assert.equal(ticket.mercadoPagoStatusDetail, "cc_rejected_high_risk");
  assert.equal(ticket.confirmedAt, null);
  assert.equal(ticket.paidAt, null);
  assert.equal(ticket.emailSentAt, null);
  assert.equal(ticket.manualConfirmedBy, null);
  assert.equal(isTicketPaid(ticket), false);
});

test("planilha separa usuários com e sem ingressos em duas abas", async () => {
  const workbook = createUsersWorkbook([
    { name: "Bruna", whatsapp: "83999999999", email: "bruna@example.com", acquiredTicketCount: 0 },
    { name: "Álvaro", whatsapp: "83888888888", email: "alvaro@example.com", acquiredTicketCount: 2 }
  ]);
  const buffer = await workbook.xlsx.writeBuffer();
  assert.ok(buffer.length > 0);
  assert.deepEqual(workbook.worksheets.map((worksheet) => worksheet.name), ["Com ingressos", "Sem ingressos"]);
  assert.equal(workbook.getWorksheet("Com ingressos").getRow(2).getCell(1).value, "Álvaro");
  assert.equal(workbook.getWorksheet("Com ingressos").getRow(2).getCell(4).value, 2);
  assert.equal(workbook.getWorksheet("Sem ingressos").getRow(2).getCell(1).value, "Bruna");
  assert.equal(workbook.getWorksheet("Sem ingressos").columnCount, 3);
});

test("relatório de vendas separa categorias por lote e soma o total arrecadado", async () => {
  const paidTicket = (ticketType, saleLot, price) => ({ ticketType, saleLot, price, status: "confirmed", mercadoPagoStatus: "approved" });
  const workbook = createSalesReportWorkbook([
    paidTicket("inteiro", "relampago", 60),
    paidTicket("meia", "relampago", 30),
    paidTicket("meia", "relampago", 30),
    paidTicket("social", "relampago", 40),
    paidTicket("social", "lote2", 50),
    { ticketType: "inteiro", saleLot: "lote2", price: 80, status: "pending", mercadoPagoStatus: "refunded" }
  ]);
  const worksheet = workbook.getWorksheet("Ingressos por lote");
  const buffer = await workbook.xlsx.writeBuffer();

  assert.ok(buffer.length > 0);
  assert.deepEqual(worksheet.getRow(5).values.slice(1, 6), ["Lote Relâmpago", 1, 2, 1, 4]);
  assert.deepEqual(worksheet.getRow(5).values.slice(9, 13), [60, 60, 40, 160]);
  assert.deepEqual(worksheet.getRow(6).values.slice(1, 6), ["1º Lote", 0, 0, 1, 1]);
  assert.equal(worksheet.getRow(10).getCell(12).value, 210);
  assert.equal(worksheet.getRow(11).getCell(2).value, 1);
});

function memoryStorage(rows) {
  return {
    async all() {
      return rows;
    },
    async save(_table, ticket) {
      const index = rows.findIndex((item) => item.id === ticket.id);
      if (index >= 0) rows[index] = { ...ticket };
    }
  };
}

function requestServer(path, options = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: body ? JSON.parse(body) : {} }));
    });
    request.on("error", reject);
    if (options.body) request.write(JSON.stringify(options.body));
    request.end();
  });
}

test("extrai payment_id dos formatos atuais e legados do Mercado Pago", () => {
  const cases = [
    [{ data: { id: "123" } }, "https://example.com/webhook/mercadopago", "123"],
    [{ payment_id: 456 }, "https://example.com/webhook/mercadopago", "456"],
    [{ id: "789" }, "https://example.com/webhook/mercadopago?topic=payment", "789"],
    [{}, "https://example.com/webhook/mercadopago?data.id=321", "321"],
    [{ resource: "https://api.mercadopago.com/v1/payments/654" }, "https://example.com/webhook/mercadopago", "654"]
  ];
  for (const [body, address, expected] of cases) {
    assert.equal(extractMercadoPagoPaymentId(body, new URL(address)), expected);
  }
  assert.equal(extractMercadoPagoPaymentId({ id: "../../secret" }, new URL("https://example.com/webhook/mercadopago")), "");
});

test("approved confirma todos os tickets encontrados por paymentId e external_reference", async () => {
  const tickets = [
    { id: "t1", orderId: "order-1", paymentId: "900", status: "pending", mercadoPagoStatus: "pending", createdAt: "2026-09-01T00:00:00.000Z" },
    { id: "t2", orderId: "order-1", paymentId: null, status: "pending", mercadoPagoStatus: "pending", createdAt: "2026-09-01T00:00:00.000Z" },
    { id: "other", orderId: "order-2", paymentId: "901", status: "pending", mercadoPagoStatus: "pending" }
  ];
  const result = await applyMercadoPagoPayment({
    id: 900,
    external_reference: "order-1",
    status: "approved",
    status_detail: "accredited",
    date_approved: "2026-09-02T10:00:00.000Z"
  }, { storage: memoryStorage(tickets), sendEmail: false });

  assert.equal(result.updatedCount, 2);
  assert.equal(result.newlyApprovedCount, 2);
  for (const ticket of tickets.slice(0, 2)) {
    assert.equal(ticket.status, "confirmed");
    assert.equal(ticket.mercadoPagoStatus, "approved");
    assert.equal(ticket.mercadoPagoStatusDetail, "accredited");
    assert.equal(ticket.paidAt, "2026-09-02T10:00:00.000Z");
    assert.equal(isTicketPaid(ticket), true);
  }
  assert.equal(tickets[2].status, "pending");

  const duplicateResult = await applyMercadoPagoPayment({
    id: 900,
    external_reference: "order-1",
    status: "approved",
    status_detail: "accredited",
    date_approved: "2026-09-02T10:00:00.000Z"
  }, { storage: memoryStorage(tickets), sendEmail: false });
  assert.equal(duplicateResult.newlyApprovedCount, 0);
  assert.equal(tickets.length, 3);
});

test("status não aprovado não confirma e não desfaz confirmação manual", async () => {
  const tickets = [
    { id: "pending", orderId: "order-3", paymentId: "902", status: "pending", mercadoPagoStatus: "pending" },
    { id: "manual", orderId: "order-3", paymentId: "902", status: "confirmed", mercadoPagoStatus: "manual", paidAt: "2026-09-01T12:00:00.000Z" }
  ];
  await applyMercadoPagoPayment({
    id: 902,
    external_reference: "order-3",
    status: "rejected",
    status_detail: "cc_rejected_high_risk"
  }, { storage: memoryStorage(tickets), sendEmail: false });

  assert.equal(tickets[0].status, "pending");
  assert.equal(tickets[0].mercadoPagoStatus, "rejected");
  assert.equal(isTicketPaid(tickets[0]), false);
  assert.equal(tickets[1].status, "confirmed");
  assert.equal(tickets[1].mercadoPagoStatus, "manual");
  assert.equal(isTicketPaid(tickets[1]), true);
});

test("Pix pendente antigo deixa de expirar quando é aprovado", async () => {
  const ticket = {
    id: "old-pix",
    orderId: "order-4",
    paymentId: "903",
    status: "pending",
    mercadoPagoStatus: "pending",
    createdAt: "2020-01-01T00:00:00.000Z"
  };
  assert.equal(isExpiredPendingTicket(ticket), true);
  await applyMercadoPagoPayment({ id: 903, external_reference: "order-4", status: "approved" }, {
    storage: memoryStorage([ticket]),
    sendEmail: false
  });
  assert.equal(isExpiredPendingTicket(ticket), false);
  assert.equal(ticket.status, "confirmed");
});

test("nenhum status não aprovado libera ingresso", async () => {
  const statuses = ["pending", "in_process", "authorized", "rejected", "cancelled", "refunded", "charged_back", "in_mediation"];
  for (const [index, status] of statuses.entries()) {
    const ticket = { id: `status-${index}`, paymentId: String(1000 + index), status: "pending", mercadoPagoStatus: "pending" };
    await applyMercadoPagoPayment({ id: 1000 + index, status }, {
      storage: memoryStorage([ticket]),
      sendEmail: false
    });
    assert.equal(ticket.status, "pending", status);
    assert.equal(ticket.mercadoPagoStatus, status, status);
    assert.equal(isTicketPaid(ticket), false, status);
  }
});

test("repetição de approved não solicita um segundo envio de e-mail", async () => {
  const tickets = [{ id: "mail", orderId: "order-mail", paymentId: "2000", status: "pending", mercadoPagoStatus: "pending" }];
  const storage = memoryStorage(tickets);
  let emailCalls = 0;
  const emailSender = async (approvedTickets) => {
    emailCalls += 1;
    for (const ticket of approvedTickets) {
      ticket.emailSentAt = "2026-09-02T12:00:00.000Z";
      await storage.save("tickets", ticket);
    }
    return { sent: true };
  };
  const payment = { id: 2000, external_reference: "order-mail", status: "approved", date_approved: "2026-09-02T11:00:00.000Z" };

  await applyMercadoPagoPayment(payment, { storage, emailSender });
  await applyMercadoPagoPayment(payment, { storage, emailSender });

  assert.equal(emailCalls, 1);
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].status, "confirmed");
});

test("fluxo HTTP pending → webhook approved → /api/me confirmado", async (t) => {
  const originalFetch = global.fetch;
  const originalDb = { all: db.all, save: db.save, removeWhere: db.removeWhere };
  const requested = [];
  const sessionToken = "test-session-token";
  const tables = {
    users: [{ id: "user-http", name: "Cliente Teste", email: "cliente@example.com", role: "usuarios" }],
    settings: [{ id: "event", registrationOpen: true, ticketSalesClosed: false }],
    sessions: [{
      id: "session-http",
      userId: "user-http",
      tokenHash: crypto.createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: "2099-01-01T00:00:00.000Z"
    }],
    tickets: [{
      id: "ticket-http",
      orderId: "order-http",
      userId: "user-http",
      participantName: "Cliente Teste",
      participantEmail: "cliente@example.com",
      code: "PX123",
      paymentId: "987654321",
      paymentMethod: "pix",
      status: "pending",
      mercadoPagoStatus: "pending",
      mercadoPagoStatusDetail: "pending_waiting_transfer",
      createdAt: "2026-09-02T10:00:00.000Z"
    }]
  };
  db.all = async (table) => tables[table].map((row) => ({ ...row }));
  db.save = async (table, record) => {
    const index = tables[table].findIndex((row) => row.id === record.id);
    if (index >= 0) tables[table][index] = { ...record };
    else tables[table].push({ ...record });
    return record;
  };
  db.removeWhere = async () => {};
  global.fetch = async (url, options) => {
    requested.push({ url: String(url), authorization: options?.headers?.Authorization });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: 987654321,
          external_reference: "order-http",
          status: "approved",
          status_detail: "accredited",
          date_approved: "2026-09-02T11:00:00.000Z"
        };
      }
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
    db.all = originalDb.all;
    db.save = originalDb.save;
    db.removeWhere = originalDb.removeWhere;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const post = await requestServer("/webhook/mercadopago", {
    method: "POST",
    body: { action: "payment.updated", type: "payment", data: { id: "987654321" } }
  });
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, { ok: true });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].url, "https://api.mercadopago.com/v1/payments/987654321");
  assert.equal(requested[0].authorization, "Bearer TEST_ACCESS_TOKEN_NOT_SECRET");
  assert.equal(tables.tickets[0].status, "confirmed");
  assert.equal(tables.tickets[0].mercadoPagoStatus, "approved");
  assert.equal(tables.tickets[0].mercadoPagoStatusDetail, "accredited");
  assert.equal(tables.tickets[0].paidAt, "2026-09-02T11:00:00.000Z");

  const me = await requestServer("/api/me", {
    headers: { Authorization: `Bearer ${sessionToken}` }
  });
  assert.equal(me.status, 200);
  assert.equal(me.body.tickets.length, 1);
  assert.equal(me.body.tickets[0].status, "confirmed");
  assert.equal(me.body.tickets[0].mercadoPagoStatus, "approved");
  assert.match(me.body.tickets[0].qrCode, /^data:image\/png;base64,/);
  assert.equal(requested.length, 1, "/api/me não deve reconsultar pagamento que já está aprovado");

  const get = await requestServer("/webhook/mercadopago");
  assert.equal(get.status, 405);
  assert.equal(requested.length, 1);
});

test("API temporariamente indisponível faz retry e JSON inválido gera erro", async (t) => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return { ok: false, status: 429, async text() { return JSON.stringify({ message: "rate limited" }); } };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify({ id: 1, status: "pending" }); } };
  };
  t.after(() => { global.fetch = originalFetch; });

  const recovered = await mercadoPagoRequest("https://api.mercadopago.com/test", {}, { retries: 1 });
  assert.equal(recovered.status, "pending");
  assert.equal(attempts, 2);

  global.fetch = async () => ({ ok: true, status: 200, async text() { return "not-json"; } });
  await assert.rejects(
    mercadoPagoRequest("https://api.mercadopago.com/test", {}, { retries: 0 }),
    /resposta inválida/
  );
});

for (const currentSaleLot of ["lote2", "diaD"]) test(`checkout ${currentSaleLot} calcula categorias e reutiliza o Pix`, async (t) => {
  const originalFetch = global.fetch;
  const originalDb = { all: db.all, save: db.save, removeWhere: db.removeWhere };
  const sessionToken = "checkout-session-token";
  const tables = {
    users: [{ id: "checkout-user", name: "Cliente Pix", email: "pix@example.com", whatsapp: "83999999999", role: "usuarios" }],
    settings: [{ id: "event", registrationOpen: true, ticketSalesClosed: false, ticketPrice: 30, socialTicketPrice: 20, currentSaleLot }],
    sessions: [{
      id: "checkout-session",
      userId: "checkout-user",
      tokenHash: crypto.createHash("sha256").update(sessionToken).digest("hex"),
      expiresAt: "2099-01-01T00:00:00.000Z"
    }],
    tickets: []
  };
  db.all = async (table) => tables[table].map((row) => ({ ...row }));
  db.save = async (table, record) => {
    const index = tables[table].findIndex((row) => row.id === record.id);
    if (index >= 0) tables[table][index] = { ...record };
    else tables[table].push({ ...record });
    return record;
  };
  db.removeWhere = async () => {};
  let createCalls = 0;
  let createdPayment;
  global.fetch = async (url, options = {}) => {
    if (options.method === "POST") {
      createCalls += 1;
      const requestBody = JSON.parse(options.body);
      await new Promise((resolve) => setTimeout(resolve, 75));
      createdPayment = {
        id: 3000,
        status: "pending",
        status_detail: "pending_waiting_transfer",
        external_reference: requestBody.external_reference,
        date_of_expiration: "2099-01-01T00:00:00.000Z",
        point_of_interaction: { transaction_data: { qr_code: "PIX-CODE", qr_code_base64: "BASE64", ticket_url: "https://example.com/pix" } }
      };
      return { ok: true, status: 201, async text() { return JSON.stringify(createdPayment); } };
    }
    return { ok: true, status: 200, async text() { return JSON.stringify(createdPayment); } };
  };
  t.after(() => {
    global.fetch = originalFetch;
    db.all = originalDb.all;
    db.save = originalDb.save;
    db.removeWhere = originalDb.removeWhere;
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const checkoutBody = {
    items: { inteiro: 1, meia: 1, social: 1 },
    paymentMethod: "pix",
    checkoutRequestId: "checkout-request-12345678"
  };
  const requestOptions = {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
    body: checkoutBody
  };
  const simultaneous = await Promise.all([
    requestServer("/api/tickets/checkout", requestOptions),
    requestServer("/api/tickets/checkout", requestOptions)
  ]);
  assert.deepEqual(simultaneous.map((result) => result.status).sort(), [201, 409]);
  assert.equal(createCalls, 1);
  assert.deepEqual(tables.tickets.map((ticket) => ticket.price), currentSaleLot === "diaD" ? [30, 30, 30] : [30, 15, 20]);
  assert.ok(tables.tickets.every((ticket) => ticket.saleLot === currentSaleLot));
  const checkout = simultaneous.find((result) => result.status === 201);
  assert.equal(checkout.body.subtotal, currentSaleLot === "diaD" ? 90 : 65);
  assert.equal(checkout.body.total, currentSaleLot === "diaD" ? 90.9 : 65.65);
  const report = createSalesReportWorkbook(tables.tickets.map((ticket) => ({ ...ticket, status: "confirmed", mercadoPagoStatus: "approved" })));
  if (currentSaleLot === "diaD") assert.deepEqual(report.getWorksheet("Ingressos por lote").getRow(9).values.slice(1, 13), ["Dia D", 1, 1, 1, 3, 30, 30, 30, 30, 30, 30, 90]);
  assert.equal(tables.tickets.length, 3);
  assert.equal(tables.tickets[0].paymentId, "3000");
  assert.equal(tables.tickets[0].mercadoPagoStatus, "pending");
  assert.equal(tables.tickets[0].pixQrCode, "PIX-CODE");
  assert.equal(tables.tickets[0].pixQrCodeBase64, "BASE64");
  assert.equal(tables.tickets[0].pixTicketUrl, "https://example.com/pix");

  const retry = await requestServer("/api/tickets/checkout", requestOptions);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.pix.id, "3000");
  assert.equal(retry.body.pix.qrCode, "PIX-CODE");
  assert.equal(createCalls, 1);
  assert.equal(tables.tickets.length, 3);
});

test("email de camisas exige aprovação e evita duplicação concorrente", async () => {
  let saved;
  const messages = [];
  const order = { id: "shirt-email", orderId: "shr_email", paymentId: "999", productType: "shirt", buyerName: "Maria <Teste>", buyerEmail: "maria@example.com", paymentMethod: "pix", total: 45,
    items: [{ model: "Babylook", size: "M", quantity: 1 }], status: "pending", mercadoPagoStatus: "pending" };
  const storage = {
    async all() { return [JSON.parse(JSON.stringify(saved || order))]; },
    async save(table, record) { assert.equal(table, "shirt_orders"); saved = JSON.parse(JSON.stringify(record)); }
  };
  const transport = { async sendMail(message) { messages.push(message); return { messageId: "mail-1" }; } };
  for (const status of ["pending", "rejected", "cancelled", "refunded", "charged_back"]) {
    await trySendPurchasedShirtEmail({ ...order, mercadoPagoStatus: status }, { storage, transport });
  }
  assert.equal(messages.length, 0);
  order.mercadoPagoStatus = "approved";
  await Promise.all([
    sendMercadoPagoShirtEmail("999", { storage, transport }),
    sendMercadoPagoShirtEmail("999", { storage, transport })
  ]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].to, "maria@example.com");
  assert.ok(messages[0].text.includes("1× Babylook — M"));
  assert.ok(messages[0].text.includes("45,00"));
  assert.ok(messages[0].text.includes("shr_email"));
  assert.ok(messages[0].html.includes("Maria &lt;Teste&gt;"));
  assert.ok(saved.emailSentAt);
});

test("falha no email da camisa permite nova tentativa sem desfazer aprovação", async () => {
  const order = { id: "shirt-retry", paymentId: "998", buyerEmail: "cliente@example.com", mercadoPagoStatus: "approved", status: "confirmed", paymentMethod: "credit_card", total: 50, items: [] };
  const storage = { async save() {} };
  const failed = await trySendPurchasedShirtEmail(order, { storage, transport: { async sendMail() { throw new Error("SMTP indisponivel"); } } });
  assert.equal(failed.sent, false);
  assert.equal(order.emailSentAt, undefined);
  assert.equal(order.emailLastError, "SMTP indisponivel");
  assert.equal(order.status, "confirmed");
  const result = await trySendPurchasedShirtEmail(order, { storage, transport: { async sendMail() { return { messageId: "retry-ok" }; } } });
  assert.equal(result.sent, true);
  assert.equal(order.emailLastError, null);
  assert.ok(order.emailSentAt);
});

test("resumo das camisas desconta taxas por pagamento e arredonda em centavos", () => {
  const { summary } = summarizeShirtOrders([
    { status: "confirmed", paymentMethod: "pix", total: 50.5 },
    { status: "pending", mercadoPagoStatus: "approved", paymentMethod: "credit_card", total: 45 },
    { status: "confirmed", paymentProvider: "coupon", paymentMethod: "pix", total: 0 },
    ...["pending", "rejected", "refunded", "cancelled", "charged_back"].map((mercadoPagoStatus) => ({
      status: "pending", mercadoPagoStatus, paymentMethod: "credit_card", total: 100
    }))
  ]);
  assert.equal(summary.receivedTotal, 95.5);
  assert.equal(summary.paymentFeesTotal, 2.76);
  assert.equal(summary.estimatedNetTotal, 92.74);
  assert.equal(summarizeShirtOrders([]).summary.estimatedNetTotal, 0);
});

test("resumo de cupons das camisas contabiliza somente pedidos pagos", () => {
  const orders = [
    { status: "confirmed", couponCode: "TRILHOSAMBIENTES" },
    { status: "pending", mercadoPagoStatus: "approved", couponCode: "TRILHOSAMBIENTES" },
    { status: "confirmed", couponCode: null },
    ...["pending", "rejected", "cancelled", "refunded", "charged_back"].flatMap((mercadoPagoStatus) => [
      { status: "pending", mercadoPagoStatus, couponCode: "TRILHOSAMBIENTES" },
      { status: "pending", mercadoPagoStatus, couponCode: null }
    ])
  ];
  const { summary } = summarizeShirtOrders(orders);
  assert.equal(summary.withCoupon, 2);
  assert.equal(summary.withoutCoupon, 1);
  assert.equal(summary.withCoupon + summary.withoutCoupon, summary.confirmedOrders);
  assert.equal(summary.totalOrders, 13);
  assert.equal(summarizeShirtOrders([]).summary.withCoupon, 0);
  assert.equal(summarizeShirtOrders([]).summary.withoutCoupon, 0);
});

test("camisas aceitam 12 parcelas e preservam os limites dos ingressos", async (t) => {
  const originalFetch = global.fetch;
  const payments = [];
  global.fetch = async (_url, options) => {
    payments.push(JSON.parse(options.body));
    return { ok: true, status: 201, async text() { return JSON.stringify({ id: 4001, status: "approved" }); } };
  };
  t.after(() => { global.fetch = originalFetch; });
  const user = { name: "Cliente", email: "cliente@example.com" };
  const card = {
    token: "card-token-test", paymentMethodId: "master", installments: 12,
    payer: { identification: { type: "CPF", number: "12345678900" } }
  };
  await createMercadoPagoCardPayment(user, "shirt-12", 60, card, [], "shirt");
  assert.equal(payments[0].installments, 12);
  assert.equal(payments[0].transaction_amount, 60);
  await assert.rejects(createMercadoPagoCardPayment(user, "shirt-13", 60, { ...card, installments: 13 }, [], "shirt"), /12x/);
  await assert.rejects(createMercadoPagoCardPayment(user, "ticket-4", 60, { ...card, installments: 4 }, [], "ticket"), /3x/);
  await createMercadoPagoCardPayment(user, "ticket-3", 60, { ...card, installments: 3 }, [], "ticket");
  assert.equal(payments[1].installments, 3);
  assert.equal(payments.length, 2);
});

test("camisas com cupom enviam itens que somam o valor cobrado", async (t) => {
  const originalFetch = global.fetch;
  const payments = [];
  global.fetch = async (_url, options) => {
    payments.push(JSON.parse(options.body));
    return { ok: true, status: 201, async text() { return JSON.stringify({ id: 4002, status: "rejected", status_detail: "cc_rejected_high_risk" }); } };
  };
  t.after(() => { global.fetch = originalFetch; });
  const user = { name: "Cliente", email: "cliente@example.com" };
  const card = {
    token: "card-token-test", paymentMethodId: "master", installments: 12,
    payer: { identification: { type: "CPF", number: "12345678900" } }
  };
  const result = await createMercadoPagoCardPayment(user, "shirt-coupon", 45, card,
    [{ sku: "babylook_m", model: "Babylook", size: "M", quantity: 1, unitPrice: 50 }], "shirt");
  assert.equal(payments[0].additional_info.items[0].unit_price, 45);
  assert.equal(result.status, "rejected");
  assert.equal(result.status_detail, "cc_rejected_high_risk");

  await createMercadoPagoCardPayment(user, "shirt-rounding", 100, card, [
    { sku: "babylook_m", model: "Babylook", size: "M", quantity: 2, unitPrice: 50 },
    { sku: "unissex_g", model: "Unissex", size: "G", quantity: 1, unitPrice: 50 }
  ], "shirt");
  const items = payments[1].additional_info.items;
  assert.equal(items.reduce((sum, item) => sum + item.quantity * Math.round(item.unit_price * 100), 0), 10000);
  assert.equal(items.reduce((sum, item) => sum + item.quantity, 0), 3);
  for (const installments of [0, -1, 1.5, "2abc", undefined]) {
    await assert.rejects(createMercadoPagoCardPayment(user, "shirt-invalid", 45, { ...card, installments }, [], "shirt"), /parcelamento válida/);
  }
  assert.equal(payments.length, 2);
});

test("cartão envia Device ID, titular e ativa 3DS opcional", async (t) => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (_url, options) => {
    captured = { headers: options.headers, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify({ id: 4000, status: "pending", status_detail: "pending_challenge" });
      }
    };
  };
  t.after(() => { global.fetch = originalFetch; });

  await createMercadoPagoCardPayment(
    { name: "Nome do Cadastro", email: "cadastro@example.com", whatsapp: "83999999999", createdAt: "2026-01-01T00:00:00.000Z" },
    "order-card-3ds",
    75.6,
    {
      token: "card-token-test",
      deviceId: "device-session-test",
      cardholderName: "Titular do Cartão",
      issuerId: "123",
      paymentMethodId: "master",
      installments: 2,
      payer: { email: "titular@example.com", identification: { type: "CPF", number: "12345678900" } }
    },
    [{ ticketType: "meia", quantity: 1, unitPrice: 37.8 }, { ticketType: "social", quantity: 1, unitPrice: 37.8 }]
  );

  assert.equal(captured.headers["X-meli-session-id"], "device-session-test");
  assert.equal(captured.body.three_d_secure_mode, "optional");
  assert.equal(captured.body.capture, true);
  assert.equal(captured.body.binary_mode, false);
  assert.equal(captured.body.payer.first_name, "Titular");
  assert.equal(captured.body.payer.last_name, "do Cartão");
  assert.equal(captured.body.external_reference, "order-card-3ds");
  assert.equal(captured.body.additional_info.items.length, 2);
});
