/**
 * Quotations (estimates): prices offered to a customer before a sale. They are
 * not in the books and do not move stock; "Create bill" turns an open quotation
 * into a bill (sales.create with quotationId), which marks it converted.
 * Totals use the same arithmetic as bills (calcBill), so the bill made from a
 * quotation comes to the same amount.
 */
import type { Ctx } from '../../context';
import { can, currentUserId, now } from '../../context';
import { AppError, fail } from '../../errors';
import { logActivity, recordRevision } from '../../audit';
import { nextDocNumber } from '../../numbering';
import { getSection } from '../../settings';
import { renderReceiptHtml, type ReceiptDoc, type ReceiptTotal } from '../../print/receipt';
import { calcBill, roundQty } from '../../../shared/billing';
import { formatAmount, formatINR, formatQty } from '../../../shared/money';
import { formatDate, isValidISODate } from '../../../shared/dates';
import { hsnProblem, isGstRate } from '../../../shared/gst';
import { gstConfig, placeOfSupply } from '../gst/common';
import { getCustomerRow } from '../customers/service';
import { assertSameFinancialYear, resolveDocDate, userName } from '../customers/common';
import { customerSummary, sendToReceiptPrinter, type RepeatData } from '../sales/service';

export type QuotationStatus = 'open' | 'converted' | 'cancelled';

export interface QuotationLineInput {
  itemId?: number | null;
  itemName: string;
  unit?: string | null;
  qty: number;
  rate: number;
  discount?: number | null;
  discountPct?: number | null;
  gstRate?: number | null;
  hsn?: string | null;
}

export interface QuotationInput {
  date?: string | null;
  validUntil?: string | null;
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: QuotationLineInput[];
  billDiscount?: number | null;
  billDiscountPct?: number | null;
  remarks?: string | null;
}

interface QuotationRow {
  id: number;
  quote_no: string;
  seq: number;
  fy_start: string;
  date: string;
  valid_until: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number;
  item_discount: number;
  bill_discount: number;
  bill_discount_pct: number | null;
  tax: number;
  round_off: number;
  total: number;
  remarks: string | null;
  status: QuotationStatus;
  bill_id: number | null;
  revision: number;
  created_by: number | null;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

interface QuotationItemRow {
  line_no: number;
  item_id: number | null;
  item_name: string;
  unit: string | null;
  qty: number;
  rate: number;
  discount: number;
  discount_pct: number | null;
  gst_rate: number | null;
  hsn: string | null;
  amount: number;
}

export interface QuotationLine {
  lineNo: number;
  itemId: number | null;
  itemName: string;
  unit: string | null;
  qty: number;
  rate: number;
  discount: number;
  discountPct: number | null;
  gstRate: number | null;
  hsn: string | null;
  amount: number;
}

export interface Quotation {
  id: number;
  quoteNo: string;
  date: string;
  validUntil: string | null;
  /** Open and past its "valid until" date. */
  expired: boolean;
  customerId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  items: QuotationLine[];
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  billDiscountPct: number | null;
  tax: number;
  roundOff: number;
  total: number;
  remarks: string | null;
  status: QuotationStatus;
  billId: number | null;
  billNo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

function getRow(ctx: Ctx, id: number): QuotationRow {
  const r = ctx.db.get<QuotationRow>('SELECT * FROM quotations WHERE id = ?', [id]);
  if (!r) throw fail.notFound('Quotation');
  return r;
}

function today(ctx: Ctx): string {
  return now(ctx).slice(0, 10);
}

export function getQuotation(ctx: Ctx, id: number): Quotation {
  const r = getRow(ctx, id);
  const items = ctx.db.all<QuotationItemRow>('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY line_no', [id]);
  return {
    id: r.id,
    quoteNo: r.quote_no,
    date: r.date,
    validUntil: r.valid_until,
    expired: r.status === 'open' && !!r.valid_until && r.valid_until < today(ctx),
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    items: items.map((i) => ({
      lineNo: i.line_no,
      itemId: i.item_id,
      itemName: i.item_name,
      unit: i.unit,
      qty: i.qty,
      rate: i.rate,
      discount: i.discount,
      discountPct: i.discount_pct,
      gstRate: i.gst_rate,
      hsn: i.hsn,
      amount: i.amount,
    })),
    subtotal: r.subtotal,
    itemDiscount: r.item_discount,
    billDiscount: r.bill_discount,
    billDiscountPct: r.bill_discount_pct,
    tax: r.tax,
    roundOff: r.round_off,
    total: r.total,
    remarks: r.remarks,
    status: r.status,
    billId: r.bill_id,
    billNo: r.bill_id ? ctx.db.value<string | null>('SELECT bill_no FROM bills WHERE id = ?', [r.bill_id], null) : null,
    createdBy: userName(ctx, r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

/* ------------------------------ Saving ------------------------------ */

interface Prepared {
  date: string;
  validUntil: string | null;
  customer: { id: number; name: string; phone: string | null } | null;
  customerName: string | null;
  customerPhone: string | null;
  lines: Array<Omit<QuotationLine, 'lineNo'>>;
  subtotal: number;
  itemDiscount: number;
  billDiscount: number;
  billDiscountPct: number | null;
  tax: number;
  roundOff: number;
  total: number;
  remarks: string | null;
}

const clean = (s: string | null | undefined) => s?.trim() || null;

function prepare(ctx: Ctx, input: QuotationInput, before?: QuotationRow): Prepared {
  const date = resolveDocDate(ctx, input.date, { what: 'A quotation', unchangedDate: before?.date });
  if (before) assertSameFinancialYear(before.date, date, `Quotation ${before.quote_no}`);
  const validUntil = clean(input.validUntil);
  if (validUntil && !isValidISODate(validUntil)) throw fail.validation('Enter a valid "valid until" date', { validUntil: 'Enter a valid date' });
  if (validUntil && validUntil < date) throw fail.validation('"Valid until" cannot be before the quotation date.', { validUntil: 'Before the quotation date' });

  let customer: { id: number; name: string; phone: string | null; gstin: string | null; state_code: string | null } | null = null;
  if (input.customerId) {
    const c = getCustomerRow(ctx, input.customerId);
    if (!c.is_active && c.id !== before?.customer_id) throw fail.validation(`The customer "${c.name}" is deactivated.`, { customerId: 'Customer is deactivated' });
    customer = { id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, state_code: c.state_code };
  }

  if (!input.items.length) throw fail.validation('Add at least one item to the quotation.', { items: 'Add an item' });
  const canDiscount = can(ctx, 'billing.discount');
  const canRate = can(ctx, 'billing.rate');
  const cfg = gstConfig(ctx);
  const charged = cfg.mode === 'regular';
  const lines = input.items.map((l, i) => {
    const name = l.itemName.trim();
    if (!name) throw fail.validation(`Enter the item name on line ${i + 1}.`, { [`items.${i}.itemName`]: 'Enter the item name' });
    if (!(l.qty > 0)) throw fail.validation(`Quantity of "${name}" must be more than zero.`, { [`items.${i}.qty`]: 'Must be more than zero' });
    if (!Number.isInteger(l.rate) || l.rate < 0) throw fail.validation(`Enter a valid rate for "${name}".`, { [`items.${i}.rate`]: 'Invalid rate' });
    if (!canDiscount && (l.discount || l.discountPct)) {
      throw new AppError('FORBIDDEN', 'You are not allowed to give discounts. Ask the owner for permission.', { [`items.${i}.discount`]: 'Discounts need permission' });
    }
    let unit = clean(l.unit);
    let gstRate: number | null = null;
    let hsn: string | null = null;
    let itemId: number | null = null;
    if (l.itemId) {
      const item = ctx.db.get<{ id: number; unit: string; rate: number; gst_rate: number | null; hsn: string | null }>('SELECT id, unit, rate, gst_rate, hsn FROM items WHERE id = ?', [l.itemId]);
      if (!item) throw fail.validation(`Item "${name}" was not found. Remove the line and add it again.`, { [`items.${i}.itemId`]: 'Item not found' });
      if (!canRate && item.rate > 0 && l.rate !== item.rate) {
        throw new AppError('FORBIDDEN', `You are not allowed to change the rate of "${name}" (list rate ${formatINR(item.rate)}).`, { [`items.${i}.rate`]: 'Rate changes need permission' });
      }
      itemId = item.id;
      unit = unit ?? item.unit;
      if (charged) {
        gstRate = item.gst_rate ?? cfg.defaultRate;
        hsn = item.hsn;
      }
    } else {
      if (!canRate) {
        throw new AppError('FORBIDDEN', `"${name}" is not in the item list. Choose the item from the list - your role cannot set prices.`, { [`items.${i}.itemName`]: 'Choose an item from the list' });
      }
      if (charged) {
        if (l.gstRate !== undefined && l.gstRate !== null && !isGstRate(l.gstRate)) throw fail.validation(`Choose a GST rate from the list for "${name}".`, { [`items.${i}.gstRate`]: 'Choose a GST rate' });
        gstRate = l.gstRate ?? cfg.defaultRate;
        hsn = clean(l.hsn);
        const problem = hsnProblem(hsn);
        if (problem) throw fail.validation(`"${name}": ${problem}.`, { [`items.${i}.hsn`]: problem });
      }
    }
    return { itemId, itemName: name, unit, qty: roundQty(l.qty), rate: l.rate, discount: l.discount ?? null, discountPct: l.discountPct ?? null, gstRate, hsn };
  });
  if (!canDiscount && (input.billDiscount || input.billDiscountPct)) {
    throw new AppError('FORBIDDEN', 'You are not allowed to give discounts. Ask the owner for permission.', { billDiscount: 'Discounts need permission' });
  }

  const pos = charged ? placeOfSupply(cfg, customer) : null;
  const calc = calcBill({
    lines: lines.map((l) => ({ qty: l.qty, rate: l.rate, discount: l.discount, discountPct: l.discountPct, gstRate: l.gstRate })),
    billDiscount: input.billDiscount,
    billDiscountPct: input.billDiscountPct,
    roundOff: getSection(ctx, 'billing').roundOff,
    gst: charged ? { inclusive: cfg.inclusive, interState: !!pos && !!cfg.stateCode && pos !== cfg.stateCode } : null,
  });
  const problem = calc.problems[0];
  if (problem) {
    const key = problem.line === null ? 'billDiscount' : `items.${problem.line}.discount`;
    throw fail.validation(problem.line === null ? problem.message : `"${lines[problem.line].itemName}": ${problem.message}`, { [key]: problem.message });
  }

  return {
    date,
    validUntil,
    customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
    customerName: customer ? customer.name : clean(input.customerName),
    customerPhone: customer ? customer.phone : clean(input.customerPhone),
    lines: lines.map((l, i) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      unit: l.unit,
      qty: l.qty,
      rate: l.rate,
      discount: calc.lines[i].discount,
      discountPct: calc.lines[i].discountPct,
      gstRate: l.gstRate,
      hsn: l.hsn,
      amount: calc.lines[i].amount,
    })),
    subtotal: calc.subtotal,
    itemDiscount: calc.itemDiscount,
    billDiscount: calc.billDiscount,
    billDiscountPct: calc.billDiscountPct,
    tax: calc.gst?.tax ?? 0,
    roundOff: calc.roundOff,
    total: calc.total,
    remarks: clean(input.remarks),
  };
}

function columns(p: Prepared) {
  return {
    date: p.date,
    valid_until: p.validUntil,
    customer_id: p.customer?.id ?? null,
    customer_name: p.customerName,
    customer_phone: p.customerPhone,
    subtotal: p.subtotal,
    item_discount: p.itemDiscount,
    bill_discount: p.billDiscount,
    bill_discount_pct: p.billDiscountPct,
    tax: p.tax,
    round_off: p.roundOff,
    total: p.total,
    remarks: p.remarks,
  };
}

function writeLines(ctx: Ctx, id: number, p: Prepared): void {
  ctx.db.run('DELETE FROM quotation_items WHERE quotation_id = ?', [id]);
  p.lines.forEach((l, i) =>
    ctx.db.insert('quotation_items', {
      quotation_id: id,
      line_no: i + 1,
      item_id: l.itemId,
      item_name: l.itemName,
      unit: l.unit,
      qty: l.qty,
      rate: l.rate,
      discount: l.discount,
      discount_pct: l.discountPct,
      gst_rate: l.gstRate,
      hsn: l.hsn,
      amount: l.amount,
    }),
  );
}

export function createQuotation(ctx: Ctx, input: QuotationInput): Quotation {
  const p = prepare(ctx, input);
  const num = nextDocNumber(ctx, 'quotation', p.date);
  const id = ctx.db.insert('quotations', {
    quote_no: num.number,
    seq: num.seq,
    fy_start: num.fyStart,
    ...columns(p),
    created_by: currentUserId(ctx),
    created_at: now(ctx),
  });
  writeLines(ctx, id, p);
  const saved = getQuotation(ctx, id);
  recordRevision(ctx, 'quotation', id, 'created', saved);
  logActivity(ctx, 'quotation.create', `Made quotation ${num.number} of ${formatINR(p.total)}${p.customerName ? ` for ${p.customerName}` : ''}`, {
    entityType: 'quotation',
    entityId: id,
    details: { total: p.total },
  });
  return saved;
}

function assertOpen(r: QuotationRow, what: string): void {
  if (r.status === 'cancelled') throw fail.validation(`Quotation ${r.quote_no} is cancelled and cannot be ${what}.`);
  if (r.status === 'converted') throw fail.validation(`Quotation ${r.quote_no} has already been made into a bill and cannot be ${what}.`);
}

export function updateQuotation(ctx: Ctx, id: number, input: QuotationInput): Quotation {
  const before = getRow(ctx, id);
  assertOpen(before, 'edited');
  const p = prepare(ctx, input, before);
  ctx.db.update('quotations', id, { ...columns(p), revision: before.revision + 1, updated_by: currentUserId(ctx), updated_at: now(ctx) });
  writeLines(ctx, id, p);
  const saved = getQuotation(ctx, id);
  recordRevision(ctx, 'quotation', id, 'edited', saved);
  logActivity(
    ctx,
    'quotation.update',
    `Edited quotation ${before.quote_no}${before.total !== p.total ? `: total ${formatINR(before.total)} → ${formatINR(p.total)}` : ''}`,
    { entityType: 'quotation', entityId: id },
  );
  return saved;
}

export function cancelQuotation(ctx: Ctx, id: number, reason: string): Quotation {
  const r = getRow(ctx, id);
  assertOpen(r, 'cancelled');
  const why = reason.trim();
  if (!why) throw fail.validation('Enter the reason for cancelling', { reason: 'Enter a reason' });
  ctx.db.update('quotations', id, {
    status: 'cancelled',
    revision: r.revision + 1,
    cancelled_by: currentUserId(ctx),
    cancelled_at: now(ctx),
    cancel_reason: why,
  });
  const saved = getQuotation(ctx, id);
  recordRevision(ctx, 'quotation', id, 'cancelled', saved, why);
  logActivity(ctx, 'quotation.cancel', `Cancelled quotation ${r.quote_no}: ${why}`, { entityType: 'quotation', entityId: id, details: { reason: why } });
  return saved;
}

/** A bill was made from the quotation (called in the same transaction as sales.create). */
export function markQuotationConverted(ctx: Ctx, id: number, billId: number, billNo: string): void {
  const r = getRow(ctx, id);
  assertOpen(r, 'made into a bill again');
  ctx.db.update('quotations', id, { status: 'converted', bill_id: billId, revision: r.revision + 1, updated_by: currentUserId(ctx), updated_at: now(ctx) });
  recordRevision(ctx, 'quotation', id, 'edited', getQuotation(ctx, id), `Made into bill ${billNo}`);
  logActivity(ctx, 'quotation.convert', `Made quotation ${r.quote_no} into bill ${billNo}`, { entityType: 'quotation', entityId: id, details: { billId } });
}

/** The lines of an open quotation for the billing screen (same shape as "repeat bill"). */
export function quotationBillData(ctx: Ctx, id: number): RepeatData & { quotationId: number } {
  const q = getQuotation(ctx, id);
  if (q.status !== 'open') assertOpen(getRow(ctx, id), 'made into a bill');
  let rateChanges = 0;
  const lines = q.items.map((i) => {
    const item = i.itemId ? ctx.db.get<{ rate: number; gst_rate: number | null; hsn: string | null; is_active: number }>('SELECT rate, gst_rate, hsn, is_active FROM items WHERE id = ?', [i.itemId]) : undefined;
    if (item && item.rate !== i.rate) rateChanges++;
    return {
      itemId: item ? i.itemId : null,
      itemName: i.itemName,
      unit: i.unit,
      qty: i.qty,
      rate: i.rate,
      defaultRate: item ? item.rate : null,
      discount: i.discountPct ? null : i.discount || null,
      discountPct: i.discountPct,
      gstRate: item ? item.gst_rate : i.gstRate,
      hsn: item ? item.hsn : i.hsn,
    };
  });
  const customer = q.customerId ? customerSummary(ctx, q.customerId) : null;
  return {
    quotationId: q.id,
    sourceBillId: q.id,
    sourceBillNo: q.quoteNo,
    lines,
    customer: customer && customer.isActive ? customer : null,
    customerName: q.customerId ? null : q.customerName,
    customerPhone: q.customerId ? null : q.customerPhone,
    billDiscount: q.billDiscountPct ? null : q.billDiscount || null,
    billDiscountPct: q.billDiscountPct,
    rateChanges,
  };
}

/* ------------------------------ List ------------------------------ */

export interface QuotationListRow {
  id: number;
  quoteNo: string;
  date: string;
  validUntil: string | null;
  expired: boolean;
  customerName: string | null;
  total: number;
  status: QuotationStatus;
  billNo: string | null;
}

export function listQuotations(ctx: Ctx, q: { from: string; to: string; q?: string | null; status?: QuotationStatus | null }) {
  const where = ['q.date BETWEEN :from AND :to'];
  const params: Record<string, unknown> = { from: q.from, to: q.to };
  if (q.status) {
    where.push('q.status = :status');
    params.status = q.status;
  }
  if (q.q?.trim()) {
    where.push('(q.quote_no LIKE :like OR q.customer_name LIKE :like OR q.customer_phone LIKE :like)');
    params.like = `%${q.q.trim()}%`;
  }
  const rows = ctx.db.all<QuotationRow & { bill_no: string | null }>(
    `SELECT q.*, b.bill_no FROM quotations q LEFT JOIN bills b ON b.id = q.bill_id WHERE ${where.join(' AND ')} ORDER BY q.date DESC, q.id DESC LIMIT 2000`,
    params,
  );
  const t = today(ctx);
  const list: QuotationListRow[] = rows.map((r) => ({
    id: r.id,
    quoteNo: r.quote_no,
    date: r.date,
    validUntil: r.valid_until,
    expired: r.status === 'open' && !!r.valid_until && r.valid_until < t,
    customerName: r.customer_name,
    total: r.total,
    status: r.status,
    billNo: r.bill_no,
  }));
  const open = list.filter((r) => r.status === 'open');
  const converted = list.filter((r) => r.status === 'converted');
  return {
    rows: list,
    totals: {
      count: list.length,
      open: open.length,
      openValue: open.reduce((s, r) => s + r.total, 0),
      converted: converted.length,
      convertedValue: converted.reduce((s, r) => s + r.total, 0),
    },
  };
}

/* ------------------------------ Printing ------------------------------ */

export function quotationReceiptHtml(ctx: Ctx, id: number): { html: string; paperWidth: 80 | 58 } {
  const q = getQuotation(ctx, id);
  const business = getSection(ctx, 'business');
  const receipt = getSection(ctx, 'receipt');
  const totals: ReceiptTotal[] = [{ label: 'Subtotal', value: formatAmount(q.subtotal) }];
  const discount = q.itemDiscount + q.billDiscount;
  if (discount) totals.push({ label: 'Discount', value: `-${formatAmount(discount)}` });
  if (q.tax) totals.push({ label: 'GST', value: formatAmount(q.tax) });
  if (q.roundOff) totals.push({ label: 'Round off', value: formatAmount(q.roundOff) });
  totals.push({ label: 'TOTAL', value: formatINR(q.total), bold: true, big: true });
  const meta: Array<[string, string]> = [
    ['Quotation no', q.quoteNo],
    ['Date', formatDate(q.date)],
  ];
  if (q.validUntil) meta.push(['Valid until', formatDate(q.validUntil)]);
  const doc: ReceiptDoc = {
    title: 'QUOTATION',
    cancelled: q.status === 'cancelled',
    meta,
    party: q.customerName ? { label: 'Customer', name: q.customerName, phone: q.customerPhone } : undefined,
    items: q.items.map((i) => ({
      name: i.itemName,
      qty: `${formatQty(i.qty)}${i.unit ? ` ${i.unit}` : ''}`,
      rate: formatAmount(i.rate),
      amount: formatAmount(i.amount),
      note: i.discount ? `Less discount${i.discountPct ? ` ${i.discountPct}%` : ''}: -${formatAmount(i.discount)}` : undefined,
    })),
    totals,
    lines: [...(q.remarks ? [q.remarks] : []), 'This is a quotation, not a bill.'],
  };
  return { html: renderReceiptHtml(doc, business, receipt), paperWidth: receipt.paperWidth };
}

export async function printQuotation(ctx: Ctx, id: number): Promise<{ printed: boolean; message: string }> {
  const q = getRow(ctx, id);
  const { html } = quotationReceiptHtml(ctx, id);
  const res = await sendToReceiptPrinter(ctx, html, true);
  return { printed: res.printed, message: res.printed ? `Quotation ${q.quote_no} sent to the printer` : res.message || 'Printing was cancelled.' };
}
