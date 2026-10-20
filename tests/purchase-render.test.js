const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const frontendRequire = createRequire(path.resolve(__dirname, "../frontend/package.json"));
const React = frontendRequire("react");
const { renderToStaticMarkup } = frontendRequire("react-dom/server");
const { transformSync } = frontendRequire("esbuild");

function loadPurchases({ react = React, globals = {} } = {}) {
  const couponModule = { exports: {} };
  const couponCode = fs.readFileSync(path.resolve(__dirname, "../frontend/src/coupons.js"), "utf8");
  vm.runInNewContext(transformSync(couponCode, { format: "cjs" }).code, { module: couponModule, exports: couponModule.exports });
  const module = { exports: {} };
  const source = fs.readFileSync(path.resolve(__dirname, "../frontend/src/main.jsx"), "utf8") + "\nexport { BuyShirt, BuyTicket, CardPaymentModal, CardPaymentResultModal, PixModal, groupShirtOrdersByUser };";
  const requireForRender = (name) => {
    if (name === "react") return react;
    if (name === "./styles.css") return {};
    if (name === "./coupons.js") return couponModule.exports;
    if (name === "react-dom/client") return { createRoot: () => ({ render() {} }) };
    if (name === "html5-qrcode") return {};
    return frontendRequire(name);
  };
  vm.runInNewContext(transformSync(source, { loader: "jsx", format: "cjs" }).code, {
    module, exports: module.exports, require: requireForRender,
    document: { getElementById: () => ({}) },
    ...globals
  });
  return module.exports;
}

test("modal de resultado diferencia aprovação, recusa com motivo e análise", () => {
  const { CardPaymentResultModal } = loadPurchases();
  const render = (payment) => renderToStaticMarkup(React.createElement(CardPaymentResultModal, { payment, onClose() {} }));
  const approved = render({ status: "approved", id: "123" });
  assert.ok(approved.includes("Pagamento aprovado"));
  assert.ok(approved.includes("pedido de camisa está confirmado"));
  const rejected = render({ status: "rejected", statusDetail: "cc_rejected_high_risk" });
  assert.ok(rejected.includes("Pagamento não aprovado"));
  assert.ok(rejected.includes("Recusado por risco"));
  assert.ok(rejected.includes("análise de segurança"));
  assert.ok(render({ status: "rejected" }).includes("não informou um motivo específico"));
  const pending = render({ status: "in_process", statusDetail: "pending_review_manual" });
  assert.ok(pending.includes("Pagamento em processamento"));
  assert.ok(!pending.includes("pedido de camisa está confirmado"));
  const pix = render({ status: "cancelled", statusDetail: "expired", paymentMethod: "pix" });
  assert.ok(pix.includes("Prazo de pagamento expirado"));
  assert.ok(!pix.includes("dados do cartão"));
});

test("Pix aguarda confirmação e detecta somente o pagamento correspondente", async () => {
  for (const status of ["pending", "approved", "rejected", "cancelled"]) {
    let result;
    let scheduled = 0;
    const { PixModal } = loadPurchases({
      react: { ...React, useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useEffect: (effect) => effect() },
      globals: {
        localStorage: { getItem: () => "test-token" },
        fetch: async () => ({ ok: true, json: async () => ({ shirtOrders: [
          { paymentId: "other", mercadoPagoStatus: "approved" },
          { paymentId: "pix-test", mercadoPagoStatus: status, mercadoPagoStatusDetail: "expired" }
        ] }) }),
        setTimeout: () => { scheduled++; return 1; }, clearTimeout() {}
      }
    });
    PixModal({ pix: { id: "pix-test", qrCode: "code" }, onClose() {}, onResult: (payment) => { result = payment; } });
    await new Promise((resolve) => setImmediate(resolve));
    if (status === "pending") {
      assert.equal(result, undefined);
      assert.equal(scheduled, 1);
    } else {
      assert.equal(result.status, status);
      assert.equal(result.id, "pix-test");
      assert.equal(scheduled, 0);
    }
  }
});

test("camisas agrupam por usuario, priorizam confirmado e preservam tentativas", () => {
  const { groupShirtOrdersByUser } = loadPurchases();
  const orders = [
    { id: "paid", userId: "a", status: "confirmed", total: 45, createdAt: "2026-10-15T10:00:00Z" },
    { id: "rejected", userId: "a", mercadoPagoStatus: "rejected", total: 50, createdAt: "2026-10-16T10:00:00Z" },
    { id: "old", userId: "b", mercadoPagoStatus: "pending", createdAt: "2026-10-14T10:00:00Z" },
    { id: "latest", userId: "b", mercadoPagoStatus: "rejected", createdAt: "2026-10-16T12:00:00Z" },
    { id: "approved", userId: "c", mercadoPagoStatus: "approved", createdAt: "2026-10-13T10:00:00Z" }
  ];
  const grouped = groupShirtOrdersByUser(orders);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].id, "latest");
  assert.equal(grouped[0].mercadoPagoStatus, "rejected");
  assert.equal(grouped[1].id, "paid");
  assert.equal(grouped[1].total, 45);
  assert.equal(grouped[1].isConfirmed, true);
  assert.equal(grouped[1].paymentHistory.length, 2);
  assert.equal(grouped[2].isConfirmed, true);
  assert.equal(orders[0].id, "paid");
  assert.equal(groupShirtOrdersByUser([]).length, 0);
  assert.equal(groupShirtOrdersByUser([
    { id: "one", buyerEmail: " USER@example.com " },
    { id: "two", buyerEmail: "user@example.com" },
    { id: "three" }, { id: "four" }
  ]).length, 3);
});

test("cartão envia o nome digitado mesmo quando o SDK não retorna cardholderName", async () => {
  let callbacks;
  let submitted;
  const { CardPaymentModal } = loadPurchases({
    react: { ...React, useRef: (current) => ({ current }), useState: (value) => [value, () => {}], useEffect: (effect) => effect() },
    globals: {
      window: {
        MP_DEVICE_SESSION_ID: "device-test",
        MercadoPago: function () {
          this.cardForm = (config) => {
            callbacks = config.callbacks;
            return { getCardFormData: () => ({ token: "token-test", installments: "12", paymentMethodId: "master", cardholderEmail: "titular@example.com", identificationType: "CPF", identificationNumber: "12345678900" }) };
          };
        }
      },
      document: { getElementById: (id) => id === "card-payment__cardholderName" ? { value: "  Maria do Cartão  " } : null }
    }
  });
  CardPaymentModal({ publicKey: "public-test", total: 45, maxInstallments: 12, onSubmit: async (data) => { submitted = data; } });
  await callbacks.onSubmit({ preventDefault() {} });
  assert.equal(submitted.cardholderName, "Maria do Cartão");
  assert.equal(submitted.deviceId, "device-test");
  assert.equal(submitted.installments, 12);
});

test("abrir a compra de camisas renderiza formulário e resumo sem erro", () => {
  const { BuyShirt } = loadPurchases();
  const html = renderToStaticMarkup(React.createElement(BuyShirt, { refresh: async () => {} }));
  for (const text of ["Comprar camisa", "Modelo e tamanho", "Nenhuma camisa adicionada.", "Taxa de serviço", "Cupom de desconto", "Pagar"]) assert.ok(html.includes(text), text);
  assert.ok(!html.includes("NaN"));
});

test("abrir a compra de ingressos também renderiza sem erro", () => {
  const { BuyTicket } = loadPurchases();
  const html = renderToStaticMarkup(React.createElement(BuyTicket, { refresh: async () => {} }));
  assert.ok(html.includes("Comprar ingressos"));
  assert.ok(html.includes("Cupom de desconto"));
});
