/**
 * Purchase orders: goods ordered from a supplier. They are not in the books and
 * do not move stock; when the goods arrive, "Enter purchase bill" opens the
 * purchase form filled from the order (purchases.create with purchaseOrderId),
 * which marks the order received.
 */
import type { Ctx } from '../../context';
import { currentUserId, now } from '../../context';
import { fail } from '../../errors';
import { logActivity, recordRevision } from '../../audit';
import { nextDocNumber } from '../../numbering';
import { getSection } from '../../settings';
import { renderReceiptHtml, type ReceiptDoc } from '../../print/receipt';
import { partyBalance } from '../../accounting/ledger';
import { formatAmount, formatINR, formatQty, lineAmount } from '../../../shared/money';
import { formatDate, isValidISODate } from '../../../shared/dates';
import { roundQty } from '../../../shared/billing';
import { getSupplierRow } from '../suppliers/service';
import { assertSameFinancialYear, resolveDocDate, userName } from '../customers/common';
import { sendToReceiptPrinter } from '../sales/service';

export type PurchaseOrderStatus = 'open' | 'received' | 'cancelled';

export interface PurchaseOrderLineInput {
  itemId?: number | null;
  description: string;
  unit?: string | null;
  qty: number;
  rate: number;
}

export interface PurchaseOrderInput {
  date?: string | null;
  expectedDate?: string | null;
  supplierId: number;
  items: PurchaseOrderLineInput[];
  remarks?: string | null;
}

interface OrderRow {
  id: number;
  po_no: string;
  seq: number;
  fy_start: string;
  date: string;
  expected_date: string | null;
  supplier_id: number;
  total: number;
  remarks: string | null;
  status: PurchaseOrderStatus;
  purchase_id: number | null;
  revision: number;
  created_by: number | null;
  created_at: string;
  updated_by: number | null;
  updated_at: string | null;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface PurchaseOrderLine {
  lineNo: number;
  itemId: number | null;
  description: string;
  unit: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface PurchaseOrder {
  id: number;
  poNo: string;
  date: string;
  expectedDate: string | null;
  supplierId: number;
  supplierName: string;
  supplierPhone: string | null;
  items: PurchaseOrderLine[];
  total: number;
  remarks: string | null;
  status: PurchaseOrderStatus;
  purchaseId: number | null;
  purchaseNo: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

function getRow(ctx: Ctx, id: number): OrderRow {
  const r = ctx.db.get<OrderRow>('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (!r) throw fail.notFound('Purchase order');
  return r;
}

export function getPurchaseOrder(ctx: Ctx, id: number): PurchaseOrder {
  const r = getRow(ctx, id);
  const s = getSupplierRow(ctx, r.supplier_id);
  const items = ctx.db.all<{ line_no: number; item_id: number | null; description: string; unit: string | null; qty: number; rate: number; amount: number }>(
    'SELECT line_no, item_id, description, unit, qty, rate, amount FROM purchase_order_items WHERE po_id = ? ORDER BY line_no',
    [id],
  );
  return {
    id: r.id,
    poNo: r.po_no,
    date: r.date,
    expectedDate: r.expected_date,
    supplierId: s.id,
    supplierName: s.name,
    supplierPhone: s.phone,
    items: items.map((i) => ({ lineNo: i.line_no, itemId: i.item_id, description: i.description, unit: i.unit, qty: i.qty, rate: i.rate, amount: i.amount })),
    total: r.total,
    remarks: r.remarks,
    status: r.status,
    purchaseId: r.purchase_id,
    purchaseNo: r.purchase_id ? ctx.db.value<string | null>('SELECT purchase_no FROM purchases WHERE id = ?', [r.purchase_id], null) : null,
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
  expectedDate: string | null;
  supplier: { id: number; name: string };
  lines: Array<Omit<PurchaseOrderLine, 'lineNo'>>;
  total: number;
  remarks: string | null;
}

function prepare(ctx: Ctx, input: PurchaseOrderInput, before?: OrderRow): Prepared {
  const date = resolveDocDate(ctx, input.date, { what: 'A purchase order', unchangedDate: before?.date });
  if (before) assertSameFinancialYear(before.date, date, `Purchase order ${before.po_no}`);
  const expectedDate = input.expectedDate?.trim() || null;
  if (expectedDate && !isValidISODate(expectedDate)) throw fail.validation('Enter a valid expected date', { expectedDate: 'Enter a valid date' });
  if (expectedDate && expectedDate < date) throw fail.validation('The expected date cannot be before the order date.', { expectedDate: 'Before the order date' });
  const s = getSupplierRow(ctx, input.supplierId);
  if (!s.is_active && s.id !== before?.supplier_id) throw fail.validation(`The supplier "${s.name}" is deactivated. Re-activate the supplier first.`, { supplierId: 'Supplier is deactivated' });
  if (!input.items.length) throw fail.validation('Add at least one item to the order.', { items: 'Add an item' });
  const lines = input.items.map((l, i) => {
    const description = l.description.trim();
    if (!description) throw fail.validation(`Line ${i + 1}: enter what is ordered`, { [`items.${i}.description`]: 'Enter a description' });
    if (!(l.qty > 0)) throw fail.validation(`Quantity of "${description}" must be more than zero.`, { [`items.${i}.qty`]: 'Must be more than zero' });
    if (!Number.isInteger(l.rate) || l.rate < 0) throw fail.validation(`Enter a valid rate for "${description}".`, { [`items.${i}.rate`]: 'Invalid rate' });
    let unit = l.unit?.trim() || null;
    let itemId: number | null = null;
    if (l.itemId) {
      const item = ctx.db.get<{ id: number; unit: string }>('SELECT id, unit FROM items WHERE id = ?', [l.itemId]);
      if (!item) throw fail.validation(`Line ${i + 1}: the item was not found. Choose it again.`, { [`items.${i}.itemId`]: 'Item not found' });
      itemId = item.id;
      unit = item.unit;
    }
    const qty = roundQty(l.qty);
    return { itemId, description, unit, qty, rate: l.rate, amount: lineAmount(qty, l.rate) };
  });
  return {
    date,
    expectedDate,
    supplier: { id: s.id, name: s.name },
    lines,
    total: lines.reduce((sum, l) => sum + l.amount, 0),
    remarks: input.remarks?.trim() || null,
  };
}

function writeLines(ctx: Ctx, id: number, p: Prepared): void {
  ctx.db.run('DELETE FROM purchase_order_items WHERE po_id = ?', [id]);
  p.lines.forEach((l, i) =>
    ctx.db.insert('purchase_order_items', { po_id: id, line_no: i + 1, item_id: l.itemId, description: l.description, unit: l.unit, qty: l.qty, rate: l.rate, amount: l.amount }),
  );
}

export function createPurchaseOrder(ctx: Ctx, input: PurchaseOrderInput): PurchaseOrder {
  const p = prepare(ctx, input);
  const num = nextDocNumber(ctx, 'purchase_order', p.date);
  const id = ctx.db.insert('purchase_orders', {
    po_no: num.number,
    seq: num.seq,
    fy_start: num.fyStart,
    date: p.date,
    expected_date: p.expectedDate,
    supplier_id: p.supplier.id,
    total: p.total,
    remarks: p.remarks,
    created_by: currentUserId(ctx),
    created_at: now(ctx),
  });
  writeLines(ctx, id, p);
  const saved = getPurchaseOrder(ctx, id);
  recordRevision(ctx, 'purchase_order', id, 'created', saved);
  logActivity(ctx, 'purchase_order.create', `Made purchase order ${num.number} of ${formatINR(p.total)} to ${p.supplier.name}`, {
    entityType: 'purchase_order',
    entityId: id,
    details: { total: p.total, supplierId: p.supplier.id },
  });
  return saved;
}

function assertOpen(r: OrderRow, what: string): void {
  if (r.status === 'cancelled') throw fail.validation(`Purchase order ${r.po_no} is cancelled and cannot be ${what}.`);
  if (r.status === 'received') throw fail.validation(`Purchase order ${r.po_no} has already been received and cannot be ${what}.`);
}

export function updatePurchaseOrder(ctx: Ctx, id: number, input: PurchaseOrderInput): PurchaseOrder {
  const before = getRow(ctx, id);
  assertOpen(before, 'edited');
  const p = prepare(ctx, input, before);
  ctx.db.update('purchase_orders', id, {
    date: p.date,
    expected_date: p.expectedDate,
    supplier_id: p.supplier.id,
    total: p.total,
    remarks: p.remarks,
    revision: before.revision + 1,
    updated_by: currentUserId(ctx),
    updated_at: now(ctx),
  });
  writeLines(ctx, id, p);
  const saved = getPurchaseOrder(ctx, id);
  recordRevision(ctx, 'purchase_order', id, 'edited', saved);
  logActivity(
    ctx,
    'purchase_order.update',
    `Edited purchase order ${before.po_no}${before.total !== p.total ? `: total ${formatINR(before.total)} → ${formatINR(p.total)}` : ''}`,
    { entityType: 'purchase_order', entityId: id },
  );
  return saved;
}

export function cancelPurchaseOrder(ctx: Ctx, id: number, reason: string): PurchaseOrder {
  const r = getRow(ctx, id);
  assertOpen(r, 'cancelled');
  const why = reason.trim();
  if (!why) throw fail.validation('Enter the reason for cancelling', { reason: 'Enter a reason' });
  ctx.db.update('purchase_orders', id, { status: 'cancelled', revision: r.revision + 1, cancelled_by: currentUserId(ctx), cancelled_at: now(ctx), cancel_reason: why });
  const saved = getPurchaseOrder(ctx, id);
  recordRevision(ctx, 'purchase_order', id, 'cancelled', saved, why);
  logActivity(ctx, 'purchase_order.cancel', `Cancelled purchase order ${r.po_no}: ${why}`, { entityType: 'purchase_order', entityId: id, details: { reason: why } });
  return saved;
}

/** The goods arrived and were entered as a purchase (called in the same transaction as purchases.create). */
export function markPurchaseOrderReceived(ctx: Ctx, id: number, purchaseId: number, purchaseNo: string): void {
  const r = getRow(ctx, id);
  assertOpen(r, 'received again');
  ctx.db.update('purchase_orders', id, { status: 'received', purchase_id: purchaseId, revision: r.revision + 1, updated_by: currentUserId(ctx), updated_at: now(ctx) });
  recordRevision(ctx, 'purchase_order', id, 'edited', getPurchaseOrder(ctx, id), `Received as purchase ${purchaseNo}`);
  logActivity(ctx, 'purchase_order.receive', `Received purchase order ${r.po_no} as purchase ${purchaseNo}`, { entityType: 'purchase_order', entityId: id, details: { purchaseId } });
}

/** What the purchase form needs to enter the bill for an open order (/purchases/new?po=<id>). */
export function purchaseOrderBillData(ctx: Ctx, id: number) {
  const r = getRow(ctx, id);
  assertOpen(r, 'received');
  const o = getPurchaseOrder(ctx, id);
  const s = getSupplierRow(ctx, o.supplierId);
  return {
    purchaseOrderId: o.id,
    poNo: o.poNo,
    supplier: {
      id: s.id,
      name: s.name,
      phone: s.phone,
      payable: -partyBalance(ctx, 'supplier', s.id, { account: 'AP' }),
      gstin: s.gstin,
      stateCode: s.state_code,
    },
    lines: o.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, rate: i.rate, itemId: i.itemId })),
    remarks: `Against purchase order ${o.poNo}`,
  };
}

/* ------------------------------ List ------------------------------ */

export function listPurchaseOrders(ctx: Ctx, q: { from: string; to: string; q?: string | null; status?: PurchaseOrderStatus | null; supplierId?: number | null }) {
  const where = ['o.date BETWEEN :from AND :to'];
  const params: Record<string, unknown> = { from: q.from, to: q.to };
  if (q.status) {
    where.push('o.status = :status');
    params.status = q.status;
  }
  if (q.supplierId) {
    where.push('o.supplier_id = :sid');
    params.sid = q.supplierId;
  }
  if (q.q?.trim()) {
    where.push('(o.po_no LIKE :like OR s.name LIKE :like)');
    params.like = `%${q.q.trim()}%`;
  }
  const rows = ctx.db.all<{ id: number; po_no: string; date: string; expected_date: string | null; supplier_name: string; total: number; status: PurchaseOrderStatus; purchase_no: string | null }>(
    `SELECT o.id, o.po_no, o.date, o.expected_date, s.name AS supplier_name, o.total, o.status, p.purchase_no
       FROM purchase_orders o JOIN suppliers s ON s.id = o.supplier_id LEFT JOIN purchases p ON p.id = o.purchase_id
      WHERE ${where.join(' AND ')} ORDER BY o.date DESC, o.id DESC LIMIT 2000`,
    params,
  );
  const list = rows.map((r) => ({
    id: r.id,
    poNo: r.po_no,
    date: r.date,
    expectedDate: r.expected_date,
    supplierName: r.supplier_name,
    total: r.total,
    status: r.status,
    purchaseNo: r.purchase_no,
  }));
  const open = list.filter((r) => r.status === 'open');
  return { rows: list, totals: { count: list.length, open: open.length, openValue: open.reduce((s, r) => s + r.total, 0) } };
}

/* ------------------------------ Printing ------------------------------ */

export function purchaseOrderHtml(ctx: Ctx, id: number): { html: string; paperWidth: 80 | 58 } {
  const o = getPurchaseOrder(ctx, id);
  const receipt = getSection(ctx, 'receipt');
  const meta: Array<[string, string]> = [
    ['Order no', o.poNo],
    ['Date', formatDate(o.date)],
  ];
  if (o.expectedDate) meta.push(['Deliver by', formatDate(o.expectedDate)]);
  const doc: ReceiptDoc = {
    title: 'PURCHASE ORDER',
    cancelled: o.status === 'cancelled',
    meta,
    party: { label: 'Supplier', name: o.supplierName, phone: o.supplierPhone },
    items: o.items.map((i) => ({ name: i.description, qty: `${formatQty(i.qty)}${i.unit ? ` ${i.unit}` : ''}`, rate: formatAmount(i.rate), amount: formatAmount(i.amount) })),
    totals: [{ label: 'TOTAL', value: formatINR(o.total), bold: true, big: true }],
    lines: o.remarks ? [o.remarks] : undefined,
    signature: 'Authorised signatory',
  };
  return { html: renderReceiptHtml(doc, getSection(ctx, 'business'), receipt), paperWidth: receipt.paperWidth };
}

export async function printPurchaseOrder(ctx: Ctx, id: number): Promise<{ printed: boolean; message: string }> {
  const r = getRow(ctx, id);
  const res = await sendToReceiptPrinter(ctx, purchaseOrderHtml(ctx, id).html, true);
  return { printed: res.printed, message: res.printed ? `Purchase order ${r.po_no} sent to the printer` : res.message || 'Printing was cancelled.' };
}
