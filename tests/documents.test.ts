import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountBalance, call, callWithActions, fails, makeApp, register, stockQty, today, unbalancedEntries } from './helpers';

test('a quotation becomes a bill for the same amount and is marked converted', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores');
    const cust = await call(app, 'customers.create', { name: 'Anita', phone: '9820011111' }, t);
    const item = await call(app, 'items.create', { name: 'Rice 5kg', unit: 'bag', rate: 45000 }, t);
    const q = await call(
      app,
      'quotations.create',
      { customerId: cust.id, items: [{ itemId: item.id, itemName: 'Rice 5kg', qty: 3, rate: 45000 }, { itemName: 'Delivery', qty: 1, rate: 5000 }], billDiscountPct: 10, validUntil: today },
      t,
    );
    assert.equal(q.status, 'open');
    assert.equal(q.total, 126000); // (135000 + 5000) less 10%
    assert.equal(q.customerName, 'Anita');

    const edited = await call(app, 'quotations.update', { id: q.id, customerId: cust.id, items: [{ itemId: item.id, itemName: 'Rice 5kg', qty: 2, rate: 45000 }], validUntil: today }, t);
    assert.equal(edited.total, 90000);

    const printed = await callWithActions(app, 'quotations.print', { id: q.id }, t);
    assert.equal(printed.actions[0].type, 'print');
    assert.match((printed.actions[0] as { html: string }).html, /QUOTATION/);

    const data = await call(app, 'quotations.billData', { id: q.id }, t);
    assert.equal(data.lines.length, 1);
    assert.equal(data.customer.id, cust.id);
    const bill = await call(
      app,
      'sales.create',
      { date: today, customerId: cust.id, items: data.lines.map((l: any) => ({ itemId: l.itemId, itemName: l.itemName, qty: l.qty, rate: l.rate })), payments: [{ mode: 'cash', amount: 90000 }], quotationId: q.id },
      t,
    );
    assert.equal(bill.total, 90000);
    const after = await call(app, 'quotations.get', { id: q.id }, t);
    assert.equal(after.status, 'converted');
    assert.equal(after.billNo, bill.billNo);

    // A converted quotation cannot be edited, cancelled or billed again.
    assert.equal(await fails(app, 'quotations.cancel', { id: q.id, reason: 'x' }, t), 'VALIDATION');
    assert.equal(await fails(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 1, rate: 100 }], payments: [{ mode: 'cash', amount: 100 }], quotationId: q.id }, t), 'VALIDATION');
    // ... and that failed bill was not saved either (same transaction).
    assert.equal((await call(app, 'sales.list', { from: today, to: today }, t)).rows.length, 1);

    const list = await call(app, 'quotations.list', { from: today, to: today }, t);
    assert.equal(list.totals.converted, 1);
    assert.equal(unbalancedEntries(app, t), 0);
  } finally {
    close();
  }
});

test('a cashier without "change rates" cannot quote a different price', async () => {
  const { app, close } = makeApp();
  try {
    const owner = await register(app, 'Acme Stores');
    const item = await call(app, 'items.create', { name: 'Soap', unit: 'pcs', rate: 4000 }, owner);
    await call(app, 'roles.update', { role: 'cashier', permissions: ['billing.create'] }, owner);
    await call(app, 'users.create', { username: 'ravi', fullName: 'Ravi', role: 'cashier', password: 'cash1' }, owner);
    const ravi = (await call(app, 'auth.login', { businessName: 'Acme Stores', username: 'ravi', password: 'cash1' })).token;
    assert.equal(await fails(app, 'quotations.create', { items: [{ itemId: item.id, itemName: 'Soap', qty: 1, rate: 3000 }] }, ravi), 'FORBIDDEN');
    assert.equal(await fails(app, 'quotations.create', { items: [{ itemName: 'Anything', qty: 1, rate: 3000 }] }, ravi), 'FORBIDDEN');
    assert.ok(await call(app, 'quotations.create', { items: [{ itemId: item.id, itemName: 'Soap', qty: 1, rate: 4000 }] }, ravi));
  } finally {
    close();
  }
});

test('a purchase order is received as a purchase bill', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores');
    const sup = await call(app, 'suppliers.create', { name: 'Grain Traders', phone: '9800000001' }, t);
    const po = await call(app, 'purchaseOrders.create', { supplierId: sup.id, items: [{ description: 'Wheat', unit: 'kg', qty: 100, rate: 3000 }] }, t);
    assert.equal(po.total, 300000);
    assert.equal(po.status, 'open');

    const data = await call(app, 'purchaseOrders.billData', { id: po.id }, t);
    assert.equal(data.supplier.id, sup.id);
    const purchase = await call(
      app,
      'purchases.create',
      { date: today, supplierId: sup.id, items: data.lines.map((l: any) => ({ description: l.description, qty: l.qty, unit: l.unit, rate: l.rate })), purchaseOrderId: po.id },
      t,
    );
    const after = await call(app, 'purchaseOrders.get', { id: po.id }, t);
    assert.equal(after.status, 'received');
    assert.equal(after.purchaseNo, purchase.purchaseNo);
    assert.equal(await fails(app, 'purchaseOrders.update', { id: po.id, supplierId: sup.id, items: [{ description: 'Wheat', qty: 1, rate: 1 }] }, t), 'VALIDATION');
    assert.equal(accountBalance(app, t, 'AP'), -300000);
  } finally {
    close();
  }
});

test('goods returned to a supplier reduce what you owe, the input tax credit and stock', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores');
    await call(app, 'settings.update', { section: 'gst', values: { registration: 'regular', gstin: '27AAPFU0939F1ZV' } }, t);
    await call(app, 'settings.update', { section: 'stock', values: { enabled: true } }, t);
    const sup = await call(app, 'suppliers.create', { name: 'Oil Mills', gstin: '27AAACR5055K1Z7' }, t);
    const item = await call(app, 'items.create', { name: 'Sunflower Oil 1L', unit: 'pcs', rate: 15000, trackStock: true }, t);
    const purchase = await call(
      app,
      'purchases.create',
      { date: today, supplierId: sup.id, items: [{ description: 'Sunflower Oil 1L', itemId: item.id, qty: 10, rate: 10000, gstRate: 5 }], gstInclusive: false, itc: true },
      t,
    );
    assert.equal(purchase.total, 105000);
    assert.equal(accountBalance(app, t, 'GST_IN_CGST') + accountBalance(app, t, 'GST_IN_SGST'), 5000);

    const returnable = await call(app, 'purchaseReturns.returnable', { purchaseId: purchase.id }, t);
    assert.equal(returnable.lines[0].returnableQty, 10);

    const ret = await call(app, 'purchaseReturns.create', { purchaseId: purchase.id, items: [{ lineNo: 1, qty: 4 }], settlement: 'adjust' }, t);
    assert.equal(ret.total, 42000);
    assert.equal(ret.value, 40000);
    assert.equal(ret.cgst + ret.sgst, 2000);
    assert.equal(accountBalance(app, t, 'AP'), -63000);
    assert.equal(accountBalance(app, t, 'GST_IN_CGST') + accountBalance(app, t, 'GST_IN_SGST'), 3000);
    assert.equal(accountBalance(app, t, 'PURCHASES'), 60000);
    assert.equal(stockQty(app, t, item.id), 6);

    // At most what is left can be returned; the rest settles the line exactly.
    assert.equal(await fails(app, 'purchaseReturns.create', { purchaseId: purchase.id, items: [{ lineNo: 1, qty: 7 }], settlement: 'adjust' }, t), 'VALIDATION');
    const rest = await call(app, 'purchaseReturns.create', { purchaseId: purchase.id, items: [{ lineNo: 1, qty: 6 }], settlement: 'cash' }, t);
    assert.equal(rest.total, 63000);
    assert.equal(accountBalance(app, t, 'GST_IN_CGST') + accountBalance(app, t, 'GST_IN_SGST'), 0);

    // A purchase with returns cannot be edited or cancelled until the returns are cancelled.
    assert.equal(await fails(app, 'purchases.cancel', { id: purchase.id, reason: 'wrong' }, t), 'VALIDATION');
    await call(app, 'purchaseReturns.cancel', { id: rest.id, reason: 'entered by mistake' }, t);
    await call(app, 'purchaseReturns.cancel', { id: ret.id, reason: 'entered by mistake' }, t);
    assert.equal(accountBalance(app, t, 'AP'), -105000);
    await call(app, 'purchases.cancel', { id: purchase.id, reason: 'wrong' }, t);
    assert.equal(stockQty(app, t, item.id), 0);

    const detail = await call(app, 'purchaseReturns.get', { id: ret.id }, t);
    assert.equal(detail.status, 'cancelled');
    const summary = await call(app, 'gst.summary', { from: today, to: today }, t);
    assert.ok(summary.rows.length);
    assert.equal(unbalancedEntries(app, t), 0);
  } finally {
    close();
  }
});

test('a return against a cash purchase must be refunded, not adjusted', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores', 'secret1', { openingCash: 100000 });
    const purchase = await call(app, 'purchases.create', { date: today, supplierName: 'Market', items: [{ description: 'Tomatoes', qty: 10, rate: 2000 }], discount: 2000, payments: [{ mode: 'cash', amount: 18000 }] }, t);
    assert.equal(await fails(app, 'purchaseReturns.create', { purchaseId: purchase.id, items: [{ lineNo: 1, qty: 5 }], settlement: 'adjust' }, t), 'VALIDATION');
    const ret = await call(app, 'purchaseReturns.create', { purchaseId: purchase.id, items: [{ lineNo: 1, qty: 5 }], settlement: 'cash' }, t);
    // Half the goods after their share of the discount.
    assert.equal(ret.total, 9000);
    assert.equal(accountBalance(app, t, 'CASH'), 100000 - 18000 + 9000);
    assert.equal(unbalancedEntries(app, t), 0);
  } finally {
    close();
  }
});

test('items, customers and suppliers used only on quotations or orders are kept, not broken', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Acme Stores');
    const cust = await call(app, 'customers.create', { name: 'Anita' }, t);
    const sup = await call(app, 'suppliers.create', { name: 'Grain Traders' }, t);
    const item = await call(app, 'items.create', { name: 'Rice', unit: 'kg', rate: 6000 }, t);
    await call(app, 'quotations.create', { customerId: cust.id, items: [{ itemId: item.id, itemName: 'Rice', qty: 1, rate: 6000 }] }, t);
    await call(app, 'purchaseOrders.create', { supplierId: sup.id, items: [{ itemId: item.id, description: 'Rice', qty: 1, rate: 5000 }] }, t);
    assert.equal((await call(app, 'items.remove', { id: item.id }, t)).deleted, false, 'the item is deactivated instead');
    assert.equal(await fails(app, 'customers.remove', { id: cust.id }, t), 'CONFLICT');
    assert.equal(await fails(app, 'suppliers.remove', { id: sup.id }, t), 'CONFLICT');
  } finally {
    close();
  }
});
