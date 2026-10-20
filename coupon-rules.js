function rulesFor(coupon) {
  return { productType: "shirt", item: "all", maxUnits: null, maxUses: null,
    oncePerAccount: false, discountPercent: 10, discountType: "percentage", fixedPrice: null, waiveServiceFee: true, ...coupon };
}

function parseRules(body) {
  const rules = rulesFor(body);
  if (!["ticket", "shirt"].includes(rules.productType)) throw new Error("Selecione ingressos ou camisas.");
  for (const key of ["maxUnits", "maxUses"]) {
    rules[key] = rules[key] === null || rules[key] === "" ? null : Number(rules[key]);
    if (rules[key] !== null && (!Number.isInteger(rules[key]) || rules[key] < 1 || rules[key] > 100000)) throw new Error("Os limites devem ser inteiros entre 1 e 100.000 ou ilimitados.");
  }
  rules.discountPercent = Number(rules.discountPercent);
  if (!["percentage", "fixed_price"].includes(rules.discountType)) throw new Error("Selecione um tipo de desconto válido.");
  if (rules.discountType === "percentage" && (!Number.isFinite(rules.discountPercent) || rules.discountPercent <= 0 || rules.discountPercent > 100)) throw new Error("Informe um desconto maior que 0 e até 100%.");
  if (rules.discountType === "fixed_price") {
    rules.fixedPrice = Number(rules.fixedPrice);
    if (!Number.isFinite(rules.fixedPrice) || rules.fixedPrice <= 0 || rules.fixedPrice > 100000 || Math.abs(rules.fixedPrice * 100 - Math.round(rules.fixedPrice * 100)) > 0.000001) throw new Error("Informe um preço fixo positivo com até duas casas decimais.");
    rules.discountPercent = 0;
  } else rules.fixedPrice = null;
  if (typeof rules.oncePerAccount !== "boolean" || typeof rules.waiveServiceFee !== "boolean") throw new Error("Configuração de cupom inválida.");
  return Object.fromEntries(["productType", "item", "maxUnits", "maxUses", "oncePerAccount", "discountPercent", "discountType", "fixedPrice", "waiveServiceFee"].map((key) => [key, rules[key]]));
}

function usageOrders(shirts, tickets) {
  const orders = new Map();
  for (const row of [...shirts, ...tickets]) {
    if (!row.couponId && !row.couponCode) continue;
    const key = row.orderId || row.id;
    const existing = orders.get(key);
    if (existing) {
      existing.discount = Number(((existing.discount || 0) + (row.discount || 0)).toFixed(2));
      if (row.status === "confirmed" || row.mercadoPagoStatus === "approved") existing.status = "confirmed";
    } else orders.set(key, { ...row, buyerName: row.buyerName || row.participantName, buyerEmail: row.buyerEmail || row.participantEmail });
  }
  return [...orders.values()];
}

function quoteCoupon(coupon, productType, items, paymentMethod) {
  const rules = coupon ? rulesFor(coupon) : null;
  if (rules && rules.productType !== productType) throw new Error(`Este cupom é válido apenas para ${rules.productType === "ticket" ? "ingressos" : "camisas"}.`);
  let remaining = rules?.maxUnits ?? Infinity;
  let appliedUnits = 0;
  const feeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
  const units = [];
  for (const item of items) {
    for (let index = 0; index < item.quantity; index++) {
      const eligible = rules && remaining > 0 && (rules.item === "all" || rules.item === (item.sku || item.ticketType));
      if (eligible) { remaining--; appliedUnits++; }
      const discount = eligible ? Number((rules.discountType === "fixed_price"
        ? Math.max(0, item.unitPrice - rules.fixedPrice)
        : item.unitPrice * rules.discountPercent / 100).toFixed(2)) : 0;
      units.push({ item: item.sku || item.ticketType, originalPrice: item.unitPrice, discount,
        price: Number((item.unitPrice - discount).toFixed(2)),
        serviceFee: eligible && rules.waiveServiceFee ? 0 : Number((item.unitPrice * feeRate).toFixed(2)) });
    }
  }
  if (rules && !appliedUnits) throw new Error("O cupom não se aplica aos itens selecionados.");
  const sum = (key) => Number(units.reduce((total, unit) => total + unit[key], 0).toFixed(2));
  const subtotal = sum("originalPrice"), discount = sum("discount"), serviceFee = sum("serviceFee");
  return { subtotal, discount, serviceFee, total: Number((subtotal - discount + serviceFee).toFixed(2)), units };
}

module.exports = { rulesFor, parseRules, usageOrders, quoteCoupon };
