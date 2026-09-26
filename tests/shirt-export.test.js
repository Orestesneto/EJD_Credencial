const test = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const { createShirtOrdersWorkbook, summarizeShirtOrders } = require('../server').testHelpers;

test('Excel inclui somente pedidos pagos nas duas abas e preserva cupons', async () => {
  const orders = [
    { buyerName: 'Ana', couponCode: 'EJD', status: 'confirmed', items: [{ model: 'Babylook', size: 'M', quantity: 2 }, { model: 'Unissex', size: 'G', quantity: 1 }] },
    { buyerName: 'Bia', mercadoPagoStatus: 'approved', items: [{ model: 'Babylook', size: 'M', quantity: 3 }] },
    { buyerName: 'Caio', status: 'pending', items: [{ model: 'Unissex', size: 'G', quantity: 10 }] },
    { buyerName: 'Davi', mercadoPagoStatus: 'refunded', items: [{ model: 'Babylook', size: 'M', quantity: 4 }] }
  ];
  const workbook = createShirtOrdersWorkbook(orders);
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new (require('exceljs').Workbook)();
  await loaded.xlsx.load(buffer);
  assert.equal(loaded.worksheets.length, 2);
  const details = loaded.getWorksheet('Pedidos de camisas');
  assert.equal(details.rowCount, 4);
  assert.deepEqual(details.getColumn(1).values.slice(2), ['Ana', 'Ana', 'Bia']);
  assert.deepEqual(details.getColumn(5).values.slice(2), ['Confirmado', 'Confirmado', 'Confirmado']);
  assert.equal(details.getCell('A2').value, 'Ana');
  assert.equal(details.getCell('B2').value, 'Babylook — M');
  assert.equal(details.getCell('C2').value, 'EJD');
  assert.equal(details.getCell('C4').value, 'Sem cupom');
  const totals = loaded.getWorksheet('Quantidades pagas');
  assert.equal(totals.getCell('C2').value, 5);
  assert.equal(totals.getCell('C3').value, 1);
  assert.equal(totals.getCell('C4').value, summarizeShirtOrders(orders).summary.paidShirts);
});

test('Excel sem pedidos contém cabeçalhos e total zero', () => {
  const workbook = createShirtOrdersWorkbook([]);
  assert.equal(workbook.worksheets[0].rowCount, 1);
  assert.equal(workbook.worksheets[1].getCell('C2').value, 0);
});
