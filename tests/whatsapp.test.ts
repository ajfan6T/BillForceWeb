import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, fails, makeApp, register, today } from './helpers';
import { formatWhatsappNumber, whatsappLink, whatsappNumber } from '../src/shared/whatsapp';
import { formatDate } from '../src/shared/dates';

test('phone numbers are turned into WhatsApp numbers', () => {
  // Indian mobiles, however they are typed.
  for (const p of ['9820011111', '98200 11111', '098200-11111', '+91 98200 11111', '919820011111', '0091 9820011111', '(+91) 98200-11111']) {
    assert.equal(whatsappNumber(p), '919820011111', p);
  }
  // Other countries need + and the country code.
  assert.equal(whatsappNumber('+971 50 123 4567'), '971501234567');
  assert.equal(whatsappNumber('+1 (415) 555-0100'), '14155550100');
  // Not a mobile number WhatsApp can use.
  for (const p of ['', '   ', null, undefined, '12345', '022 2345 6789', '5820011111', '98200111112', '+91 12345 67890', '971501234567']) {
    assert.equal(whatsappNumber(p), null, String(p));
  }
  assert.equal(formatWhatsappNumber('919820011111'), '+91 98200 11111');
  assert.equal(formatWhatsappNumber('971501234567'), '+971501234567');
  assert.equal(whatsappLink('919820011111', 'Bill 1\nTotal: ₹10'), 'https://wa.me/919820011111?text=Bill%201%0ATotal%3A%20%E2%82%B910');
});

test('a bill is sent on WhatsApp to the number saved with it, or to the number given', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Diet Factory');
    const sale = (extra: Record<string, unknown>) =>
      call(app, 'sales.create', { date: today, items: [{ itemName: 'Protein Shake', qty: 2, rate: 15000 }], payments: [{ mode: 'cash', amount: 30000 }], ...extra }, t);

    // A walk-in with a phone on the bill: not asked again.
    const walkIn = await sale({ customerName: 'Anita', customerPhone: '98200 11111' });
    const r = await call(app, 'sales.whatsapp', { id: walkIn.id }, t);
    assert.equal(r.number, '919820011111');
    assert.equal(r.display, '+91 98200 11111');
    assert.ok(r.link.startsWith('https://wa.me/919820011111?text='));
    assert.equal(r.message, `Hello Anita,\nThank you for shopping at Diet Factory.\n\nBill ${walkIn.billNo} dated ${formatDate(walkIn.date)}\nTotal: ₹300.00`);
    assert.equal(decodeURIComponent(r.link.split('?text=')[1]), r.message);
    assert.equal(r.fileName, `Bill-${walkIn.billNo.replace(/[^A-Za-z0-9]+/g, '-')}.jpg`);
    assert.ok(r.html.includes(walkIn.billNo) && r.html.includes('Protein Shake'));
    assert.equal(r.paperWidth, 80);

    // A saved customer: their phone is used.
    const cust = await call(app, 'customers.create', { name: 'Ravi', phone: '+91 99000 22222' }, t);
    const credit = await call(app, 'sales.create', { date: today, customerId: cust.id, items: [{ itemName: 'Oats', qty: 1, rate: 50000 }], payments: [{ mode: 'cash', amount: 20000 }] }, t);
    const rc = await call(app, 'sales.whatsapp', { id: credit.id }, t);
    assert.equal(rc.number, '919900022222');
    assert.match(rc.message, /^Hello Ravi,/);
    assert.match(rc.message, /Balance to pay: ₹300\.00$/);

    // No phone on the bill: the number must be given.
    const noPhone = await sale({});
    const missing = await app.invoke('sales.whatsapp', { id: noPhone.id }, t);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.error.code, 'VALIDATION');
      assert.match(missing.error.message, /has no customer mobile number/);
      assert.ok(missing.error.fields?.phone);
    }
    assert.equal(await fails(app, 'sales.whatsapp', { id: noPhone.id, phone: '12345' }, t), 'VALIDATION');
    const given = await call(app, 'sales.whatsapp', { id: noPhone.id, phone: '87654 32109' }, t);
    assert.equal(given.number, '918765432109');
    assert.match(given.message, /^Hello,\n/);

    // Logged, without changing the bill.
    const ctx = app.ctx(t);
    const log = ctx.db.get<{ summary: string; entity_id: number }>("SELECT summary, entity_id FROM activity_log WHERE action = 'bill.whatsapp' ORDER BY id DESC LIMIT 1");
    assert.equal(log!.summary, `Opened WhatsApp to send bill ${noPhone.billNo} (₹300.00) to +91 87654 32109`);
    assert.equal(log!.entity_id, noPhone.id);
    assert.equal((await call(app, 'sales.get', { id: noPhone.id }, t)).customerPhone, null);

    // A cancelled bill is not sent.
    await call(app, 'sales.cancel', { id: walkIn.id, reason: 'Wrong bill' }, t);
    assert.equal(await fails(app, 'sales.whatsapp', { id: walkIn.id }, t), 'VALIDATION');
  } finally {
    close();
  }
});
