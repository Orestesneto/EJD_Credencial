export function couponTotals(coupon, items, paymentMethod) {
  let remaining = coupon?.maxUnits ?? Infinity;
  let subtotal = 0, discount = 0, serviceFee = 0, appliedUnits = 0;
  const feeRate = paymentMethod === "credit_card" ? 0.08 : 0.01;
  for (const item of items) for (let index = 0; index < item.quantity; index++) {
    const eligible = coupon && remaining > 0 && (coupon.item === "all" || coupon.item === item.key);
    if (eligible) { remaining--; appliedUnits++; }
    subtotal += item.unitPrice;
    discount += eligible ? Number((coupon.discountType === "fixed_price"
      ? Math.max(0, item.unitPrice - coupon.fixedPrice)
      : item.unitPrice * coupon.discountPercent / 100).toFixed(2)) : 0;
    serviceFee += eligible && coupon.waiveServiceFee ? 0 : Number((item.unitPrice * feeRate).toFixed(2));
  }
  const round = (value) => Number(value.toFixed(2));
  return { subtotal: round(subtotal), discount: round(discount), serviceFee: round(serviceFee), total: round(subtotal - discount + serviceFee), appliedUnits };
}

export function couponBenefit(coupon) {
  return coupon.discountType === "fixed_price"
    ? `Preço por unidade: ${Number(coupon.fixedPrice).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
    : `${coupon.discountPercent}% de desconto`;
}
