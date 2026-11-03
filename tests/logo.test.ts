import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, fails, makeApp, register, today } from './helpers';
import { isLogoDataUrl } from '../src/shared/settings';

/** A 1 x 1 PNG image. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
/** The start of a JPEG file (enough for the check of what kind of image it is). */
const JPG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1]).toString('base64')}`;

test('only PNG, JPG and WebP data URLs are accepted as a logo', () => {
  assert.equal(isLogoDataUrl(PNG), true);
  assert.equal(isLogoDataUrl(JPG), true);
  assert.equal(isLogoDataUrl(''), false);
  assert.equal(isLogoDataUrl('https://example.com/logo.png'), false);
  assert.equal(isLogoDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), false);
  // Says PNG but is not one.
  assert.equal(isLogoDataUrl(`data:image/png;base64,${Buffer.from('<script>alert(1)</script>').toString('base64')}`), false);
  assert.equal(isLogoDataUrl(`${PNG}" onerror="alert(1)`), false);
  assert.equal(isLogoDataUrl(`data:image/png;base64,${'A'.repeat(500_000)}`), false);
});

test('the business logo is saved in settings and printed at the top of bills', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Logo Stores');
    const bill = await call(app, 'sales.create', { date: today, items: [{ itemName: 'Tea', qty: 1, rate: 1000 }], payments: [{ mode: 'cash', amount: 1000 }] }, t);
    const before = await call<{ html: string }>(app, 'sales.receiptHtml', { id: bill.id }, t);
    assert.ok(!before.html.includes('<img'), 'no logo before one is added');

    const saved = await call(app, 'settings.update', { section: 'business', values: { logo: PNG } }, t);
    assert.deepEqual(saved.changed, ['logo']);
    assert.equal((await call(app, 'settings.get', undefined, t)).business.logo, PNG);

    // Printed above the business name, on bills and on the sample bill in Settings.
    const { html } = await call<{ html: string }>(app, 'sales.receiptHtml', { id: bill.id }, t);
    assert.ok(html.includes(`<div class="logo"><img src="${PNG}" alt=""></div>`));
    assert.ok(html.indexOf('class="logo"') < html.indexOf('class="biz"'));
    assert.ok((await call<{ html: string }>(app, 'settings.receiptPreview', {}, t)).html.includes(PNG));

    // The activity log says what happened without keeping the image.
    const ctx = app.ctx(t);
    const log = ctx.db.get<{ summary: string; details: string }>("SELECT summary, details FROM activity_log WHERE action = 'settings.update' ORDER BY id DESC LIMIT 1");
    assert.match(log!.summary, /logo added/);
    assert.ok(!log!.details.includes('base64'));
    assert.match(log!.details, /PNG image, 1 KB/);

    // Removing the logo takes it off the bill.
    await call(app, 'settings.update', { section: 'business', values: { logo: '' } }, t);
    assert.ok(!(await call<{ html: string }>(app, 'sales.receiptHtml', { id: bill.id }, t)).html.includes('<img'));
  } finally {
    close();
  }
});

test('a logo that is not a PNG, JPG or WebP image is refused', async () => {
  const { app, close } = makeApp();
  try {
    const t = await register(app, 'Logo Stores');
    for (const logo of ['data:image/svg+xml;base64,PHN2Zy8+', 'javascript:alert(1)', `data:image/png;base64,${Buffer.from('not an image').toString('base64')}`]) {
      const r = await app.invoke('settings.update', { section: 'business', values: { logo } }, t);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.error.code, 'VALIDATION');
        assert.ok(r.error.fields?.logo);
      }
    }
    assert.equal(await fails(app, 'settings.update', { section: 'business', values: { logo: `data:image/png;base64,${'A'.repeat(500_000)}` } }, t), 'VALIDATION');
    assert.equal((await call(app, 'settings.get', undefined, t)).business.logo, '');

    // The live preview shows a new (unsaved) logo, and ignores a wrong one.
    await call(app, 'settings.update', { section: 'business', values: { logo: PNG } }, t);
    assert.ok((await call<{ html: string }>(app, 'settings.receiptPreview', { business: { logo: JPG } }, t)).html.includes(JPG));
    const wrong = await call<{ html: string }>(app, 'settings.receiptPreview', { business: { logo: 'javascript:alert(1)' } }, t);
    assert.ok(wrong.html.includes(PNG) && !wrong.html.includes('javascript:'));
  } finally {
    close();
  }
});
