const test = require("node:test");
const assert = require("node:assert/strict");
const { rulesFor, parseRules, quoteCoupon, usageOrders } = require("../coupon-rules");

test("cupons antigos mantêm 10% para camisas e isenção de taxa", () => {
  const coupon = rulesFor({ id: "old", maxUses: 1 });
  const quote = quoteCoupon(coupon, "shirt", [{ sku: "unisex_M", quantity: 2, unitPrice: 60 }], "credit_card");
  assert.equal(quote.discount, 12);
  assert.equal(quote.serviceFee, 0);
  assert.equal(quote.total, 108);
  assert.throws(() => quoteCoupon(coupon, "ticket", [], "pix"), /camisas/);
});

test("desconto limitado ao item e às unidades; outros itens mantêm preço e taxa", () => {
  const coupon = { productType: "ticket", item: "inteiro", maxUnits: 1, discountPercent: 25, waiveServiceFee: true };
  const quote = quoteCoupon(coupon, "ticket", [
    { ticketType: "inteiro", quantity: 2, unitPrice: 90 },
    { ticketType: "meia", quantity: 1, unitPrice: 45 }
  ], "pix");
  assert.equal(quote.subtotal, 225);
  assert.equal(quote.discount, 22.5);
  assert.equal(quote.serviceFee, 1.35);
  assert.equal(quote.total, 203.85);
  assert.deepEqual(quote.units.map((unit) => unit.price), [67.5, 90, 45]);
  assert.throws(() => quoteCoupon(coupon, "ticket", [{ ticketType: "social", quantity: 1, unitPrice: 55 }], "pix"), /não se aplica/);
});

test("quantidade ilimitada e opção de manter taxa", () => {
  const quote = quoteCoupon({ productType: "shirt", item: "all", maxUnits: null, discountPercent: 20, waiveServiceFee: false }, "shirt", [{ sku: "babylook_P", quantity: 3, unitPrice: 60 }], "credit_card");
  assert.equal(quote.discount, 36);
  assert.equal(quote.serviceFee, 14.4);
  assert.equal(quote.total, 158.4);
});

test("limites fixos, ilimitados e configurações inválidas", () => {
  assert.equal(parseRules({ maxUses: null }).maxUses, null);
  assert.equal(parseRules({ maxUses: "15", maxUnits: "2" }).maxUses, 15);
  for (const maxUses of [0, -1, 1.5, "abc", 100001]) assert.throws(() => parseRules({ maxUses }));
  for (const discountPercent of [0, -1, 101, "abc"]) assert.throws(() => parseRules({ discountPercent }));
});

test("vários ingressos do mesmo pedido consomem um único uso", () => {
  const rows = usageOrders([], [
    { id: "1", orderId: "order", couponId: "coupon", discount: 10, participantName: "Cliente", status: "confirmed" },
    { id: "2", orderId: "order", couponId: "coupon", discount: 5, status: "confirmed" }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].discount, 15);
  assert.equal(rows[0].buyerName, "Cliente");
});

test("resumo da tela coincide com cálculo do servidor", async () => {
  const { couponTotals } = await import("../frontend/src/coupons.js");
  const coupon = rulesFor({ productType: "ticket", item: "meia", maxUnits: 2, discountPercent: 15 });
  const items = [{ ticketType: "inteiro", quantity: 1, unitPrice: 90 }, { ticketType: "meia", quantity: 3, unitPrice: 45 }];
  const server = quoteCoupon(coupon, "ticket", items, "credit_card");
  const browser = couponTotals(coupon, items.map((item) => ({ ...item, key: item.ticketType })), "credit_card");
  for (const key of ["subtotal", "discount", "serviceFee", "total"]) assert.equal(browser[key], server[key]);
});

test("preço fixo de R$30 afeta só uma inteira, inclusive após mudança de lote", async () => {
  const { couponTotals } = await import("../frontend/src/coupons.js");
  const coupon = parseRules({ productType: "ticket", item: "inteiro", discountType: "fixed_price", fixedPrice: "30.00", maxUnits: 1, oncePerAccount: true, maxUses: null, waiveServiceFee: true });
  for (const price of [60, 90, 100]) for (const paymentMethod of ["pix", "credit_card"]) {
    const items = [{ ticketType: "inteiro", quantity: 3, unitPrice: price }, { ticketType: "meia", quantity: 1, unitPrice: price / 2 }];
    const quote = quoteCoupon(coupon, "ticket", items, paymentMethod);
    assert.deepEqual(quote.units.map((unit) => unit.price), [30, price, price, price / 2]);
    assert.equal(quote.discount, price - 30);
    assert.equal(quote.units[0].serviceFee, 0);
    assert.equal(quote.units[1].serviceFee, Number((price * (paymentMethod === "pix" ? 0.01 : 0.08)).toFixed(2)));
    const browser = couponTotals(coupon, items.map((item) => ({ ...item, key: item.ticketType })), paymentMethod);
    for (const key of ["subtotal", "discount", "serviceFee", "total"]) assert.equal(browser[key], quote[key]);
  }
  assert.throws(() => quoteCoupon(coupon, "ticket", [{ ticketType: "meia", quantity: 1, unitPrice: 45 }], "pix"), /não se aplica/);
  assert.equal(quoteCoupon(coupon, "ticket", [{ ticketType: "inteiro", quantity: 1, unitPrice: 20 }], "pix").total, 20);
  for (const fixedPrice of [0, -1, "abc", 30.001]) assert.throws(() => parseRules({ discountType: "fixed_price", fixedPrice }));
});
