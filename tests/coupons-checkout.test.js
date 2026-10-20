const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
process.env.NODE_ENV = "test";
process.env.MERCADO_PAGO_ACCESS_TOKEN = "TEST_ACCESS_TOKEN_NOT_SECRET";
const server = require("../server");
const { db } = server.testHelpers;

test("configuração, escopo, conta única, limites e concorrência dos cupons via HTTP", async (t) => {
  const originalDb = { ...db }, originalFetch = global.fetch;
  const tables = {
    settings: [{ id: "event", ticketPrice: 90, socialTicketPrice: 55, shirtPrice: 60, currentSaleLot: "lote3" }],
    users: ["admin", "a", "b"].map((id) => ({ id, name: id, email: `${id}@example.com`, role: id === "admin" ? "admin" : "usuarios" })),
    sessions: ["admin", "a", "b"].map((id) => ({ id, userId: id, tokenHash: crypto.createHash("sha256").update(id).digest("hex"), expiresAt: "2099-01-01T00:00:00Z" })),
    coupons: [], tickets: [], shirt_orders: []
  };
  db.all = async (table) => structuredClone(tables[table] || []);
  db.save = async (table, row) => {
    const index = tables[table].findIndex((item) => item.id === row.id);
    if (index >= 0) tables[table][index] = structuredClone(row);
    else tables[table].push(structuredClone(row));
    return row;
  };
  db.removeWhere = async () => {};
  const payments = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    payments.push(body);
    await new Promise((resolve) => setTimeout(resolve, 40));
    return { ok: true, status: 201, async text() { return JSON.stringify({ id: payments.length, external_reference: body.external_reference, status: "pending", point_of_interaction: { transaction_data: { qr_code: "PIX" } } }); } };
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { Object.assign(db, originalDb); global.fetch = originalFetch; await new Promise((resolve) => server.close(resolve)); });
  const request = (path, body, user = "a", method = "POST") => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method, headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" } }, (res) => {
      let text = ""; res.on("data", (chunk) => text += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on("error", reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const rules = { code: "TICKET25", productType: "ticket", item: "inteiro", discountPercent: 25, maxUses: null, maxUnits: 1, oncePerAccount: true, waiveServiceFee: true };
  assert.equal((await request("/api/admin/coupons", rules)).status, 403);
  const created = await request("/api/admin/coupons", rules, "admin");
  assert.equal(created.status, 201);
  assert.equal(created.body.coupon.maxUses, null);
  const couponId = created.body.coupon.id;
  assert.equal((await request("/api/coupons/validate", { code: rules.code, productType: "shirt" })).status, 400);
  const checkout = { items: { inteiro: 2, meia: 1 }, paymentMethod: "pix", couponCode: rules.code, checkoutRequestId: "coupon-order-0001" };
  const order = await request("/api/tickets/checkout", checkout);
  assert.equal(order.status, 201);
  assert.equal(order.body.total, 203.85);
  assert.equal(payments[0].transaction_amount, 203.85);
  assert.equal(tables.tickets.reduce((sum, row) => sum + row.price + row.serviceFee, 0), 203.85);
  assert.equal((await request("/api/coupons/validate", { code: rules.code, productType: "ticket" })).status, 400);
  assert.equal((await request("/api/tickets/checkout", { ...checkout, checkoutRequestId: "coupon-order-0002" })).status, 400);
  assert.equal((await request("/api/tickets/checkout", { ...checkout, couponCode: [rules.code], checkoutRequestId: "coupon-order-0003" }, "b")).status, 400);
  const listed = await request("/api/admin/coupons", null, "admin", "GET");
  assert.equal(listed.body.coupons[0].usageCount, 1);
  assert.equal(listed.body.coupons[0].usages[0].discount, 22.5);
  // Rejected payments release availability and the account's use.
  tables.tickets.forEach((row) => { row.status = "pending"; row.mercadoPagoStatus = "rejected"; });
  assert.equal((await request("/api/coupons/validate", { code: rules.code, productType: "ticket" })).status, 200);
  assert.equal((await request(`/api/admin/coupons/${couponId}/rules`, { ...rules, maxUses: 1 }, "admin", "PUT")).status, 200);
  const simultaneous = await Promise.all([
    request("/api/tickets/checkout", { ...checkout, checkoutRequestId: "coupon-order-0004" }),
    request("/api/tickets/checkout", { ...checkout, checkoutRequestId: "coupon-order-0005" }, "b")
  ]);
  assert.deepEqual(simultaneous.map((result) => result.status).sort(), [201, 400]);
  assert.equal(payments.length, 2);
  assert.equal((await request("/api/coupons/validate", { code: rules.code, productType: "ticket" }, "b")).status, 400);
  const shirt = await request("/api/admin/coupons", { ...rules, code: "SHIRT20", productType: "shirt", item: "unisex_M", discountPercent: 20, maxUses: null }, "admin");
  assert.equal(shirt.status, 201);
  const shirtOrder = await request("/api/shirts/checkout", { items: { unisex_M: 2, babylook_P: 1 }, couponCode: "SHIRT20", checkoutRequestId: "shirt-coupon-0001" });
  assert.equal(shirtOrder.status, 201);
  assert.equal(shirtOrder.body.discount, 12);
  assert.equal(shirtOrder.body.serviceFee, 1.2);
  assert.equal(shirtOrder.body.total, 169.2);
  assert.equal((await request("/api/shirts/checkout", { items: { babylook_P: 1 }, couponCode: "SHIRT20", checkoutRequestId: "shirt-coupon-0002" }, "b")).status, 400);
  const free = await request("/api/admin/coupons", { ...rules, code: "GRATIS", item: "all", discountPercent: 100, maxUnits: null }, "admin");
  assert.equal(free.status, 201);
  const paymentCount = payments.length;
  const freeOrder = await request("/api/tickets/checkout", { items: { inteiro: 1 }, couponCode: "GRATIS", checkoutRequestId: "free-coupon-0001", paymentMethod: "credit_card" });
  assert.equal(freeOrder.status, 201);
  assert.equal(freeOrder.body.total, 0);
  assert.equal(freeOrder.body.tickets[0].status, "confirmed");
  assert.equal(freeOrder.body.tickets[0].paymentProvider, "coupon");
  assert.equal(payments.length, paymentCount);
  const fixedRules = { ...rules, code: "REDEDAMAS", discountType: "fixed_price", fixedPrice: 30, discountPercent: 0, maxUses: null };
  const fixedCoupon = await request("/api/admin/coupons", fixedRules, "admin");
  assert.equal(fixedCoupon.status, 201);
  assert.equal(fixedCoupon.body.coupon.fixedPrice, 30);
  const fixedCheckout = { items: { inteiro: 3, meia: 1 }, couponCode: "REDEDAMAS", checkoutRequestId: "fixed-price-0001", paymentMethod: "credit_card", cardPayment: { token: "test", paymentMethodId: "master", installments: 1, payer: { identification: { type: "CPF", number: "12345678900" } } } };
  const fixedOrder = await request("/api/tickets/checkout", fixedCheckout);
  assert.equal(fixedOrder.status, 201);
  assert.deepEqual(fixedOrder.body.tickets.map((row) => row.price), [30, 90, 90, 45]);
  assert.equal(fixedOrder.body.discount, 60);
  assert.equal(fixedOrder.body.serviceFee, 18);
  assert.equal(fixedOrder.body.total, 273);
  assert.equal(payments.at(-1).transaction_amount, 273);
  assert.equal((await request("/api/tickets/checkout", { ...fixedCheckout, checkoutRequestId: "fixed-price-0002" })).status, 400);
  assert.equal((await request("/api/tickets/checkout", { ...fixedCheckout, checkoutRequestId: "fixed-price-0003" }, "b")).status, 201);
});
