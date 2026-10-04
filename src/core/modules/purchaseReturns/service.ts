/**
 * Purchase returns (debit notes): goods sent back to the supplier against a
 * purchase bill. Each returned line gives back its share of what the line cost
 * (after its share of the bill discount); freight / other charges and rounding
 * stay with the purchase. Posting (voucher "purchase_return"):
 *   Dr Sundry Creditors (supplier)   when adjusted against what you owe, or
 *   Dr cash / UPI / bank account     when the supplier refunds the money
 *   Cr the purchase's account        value of the goods (without input tax claimed)
 *   Cr Input CGST / SGST / IGST      input tax credit given back (only if it was claimed)
 * Stock tracked on the purchase goes out again (at the average cost).
 * A return cannot be edited: cancel it and enter it again.
 */
import type { Ctx } from '../../context';
import { currentUserId, now } from '../../context';
import { fail } from '../../errors';
import { logActivity, recordRevision } from '../../audit';
import { nextDocNumber } from '../../numbering';
import { getSection } from '../../settings';
import { paymentAccountId, postEntry, voidEntry, type EntryLineInput } from '../../accounting/ledger';
import { renderReceiptHtml, type ReceiptDoc, type ReceiptTotal } from '../../print/receipt';
import { formatAmount, formatINR, formatQty } from '../../../shared/money';
import { formatDate } from '../../../shared/dates';
import { roundQty, shareDiscount } from '../../../shared/billing';
import type { SettlementMode } from '../../../shared/constants';
import { assertCancelKeepsClosedAccounts } from '../accounting/common';
import { postingLines, resolveDocDate, userName, type PostingLine } from '../customers/common';
import { removeDocumentMoves, writeDocumentMoves } from '../stock/service';
import { stockEnabled } from '../stock/valuation';
import { sendToReceiptPrinter } from '../sales/service';

export type ReturnSettlement = 'adjust' | SettlementMode;

export interface PurchaseReturnInput {
  purchaseId: number;
  date?: string | null;
  /** Lines of the purchase (by line number) and the quantity sent back. */
  items: Array<{ lineNo: number; qty: number }>;
  /** 'adjust': less to pay the supplier; cash / upi / bank: the supplier refunded the money. */
  settlement: ReturnSettlement;
  accountId?: number | null;
  reference?: string | null;
  remarks?: string | null;
}

interface PurchaseRow {
  id: number;
  purchase_no: string;
  date: string;
  status: string;
  supplier_id: number | null;
  supplier_name: string | null;
  expense_account_id: number;
  discount: number;
  gst_mode: string | null;
  itc: number;
  stock_tracked: number;
}

interface PurchaseLineRow {
  line_no: number;
  description: string;
  unit: string | null;
  qty: number;
  amount: number;
  item_id: number | null;
  taxable: number | null;
  cgst: number;
  sgst: number;
  igst: number;
}

interface ReturnRow {
  id: number;
  return_no: string;
  date: string;
  purchase_id: number;
  supplier_id: number | null;
  supplier_name: string | null;
  value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  settlement: ReturnSettlement;
  account_id: number | null;
  reference: string | null;
  remarks: string | null;
  status: 'active' | 'cancelled';
  stock_tracked: number;
  journal_entry_id: number | null;
  revision: number;
  created_by: number | null;
  created_at: string;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

/** What one purchase line is worth when fully returned: its cost, and the input tax claimed on it. */
interface LineWorth {
  line: PurchaseLineRow;
  value: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Already returned (active returns). */
  returned: { qty: number; value: number; cgst: number; sgst: number; igst: number };
}

function purchaseRow(ctx: Ctx, id: number): PurchaseRow {
  const p = ctx.db.get<PurchaseRow>(
    'SELECT id, purchase_no, date, status, supplier_id, supplier_name, expense_account_id, discount, gst_mode, itc, stock_tracked FROM purchases WHERE id = ?',
    [id],
  );
  if (!p) throw fail.notFound('Purchase bill');
  return p;
}

function lineWorths(ctx: Ctx, p: PurchaseRow): LineWorth[] {
  const lines = ctx.db.all<PurchaseLineRow>(
    'SELECT line_no, description, unit, qty, amount, item_id, taxable, cgst, sgst, igst FROM purchase_items WHERE purchase_id = ? ORDER BY line_no',
    [p.id],
  );
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const shares = shareDiscount(
    lines.map((l) => l.amount),
    Math.min(p.discount, subtotal),
  );
  const returned = new Map(
    ctx.db
      .all<{ purchase_line_no: number; qty: number; value: number; cgst: number; sgst: number; igst: number }>(
        `SELECT ri.purchase_line_no, SUM(ri.qty) AS qty, SUM(ri.value) AS value, SUM(ri.cgst) AS cgst, SUM(ri.sgst) AS sgst, SUM(ri.igst) AS igst
           FROM purchase_return_items ri JOIN purchase_returns r ON r.id = ri.return_id
          WHERE r.purchase_id = ? AND r.status = 'active' GROUP BY ri.purchase_line_no`,
        [p.id],
      )
      .map((r) => [r.purchase_line_no, r]),
  );
  const withGst = p.gst_mode === 'regular';
  const claimed = withGst && !!p.itc;
  return lines.map((line, i) => {
    const tax = line.cgst + line.sgst + line.igst;
    const value = withGst && line.taxable !== null ? line.taxable + (claimed ? 0 : tax) : line.amount - shares[i];
    const r = returned.get(line.line_no);
    return {
      line,
      value,
      cgst: claimed ? line.cgst : 0,
      sgst: claimed ? line.sgst : 0,
      igst: claimed ? line.igst : 0,
      returned: { qty: roundQty(r?.qty ?? 0), value: r?.value ?? 0, cgst: r?.cgst ?? 0, sgst: r?.sgst ?? 0, igst: r?.igst ?? 0 },
    };
  });
}

/* ------------------------------ What can be returned ------------------------------ */

export interface ReturnableLine {
  lineNo: number;
  description: string;
  unit: string | null;
  itemId: number | null;
  qty: number;
  returnedQty: number;
  returnableQty: number;
  /** Value per unit including input tax given back (for the on-screen estimate). */
  unitValue: number;
}

export function purchaseReturnable(ctx: Ctx, purchaseId: number) {
  const p = purchaseRow(ctx, purchaseId);
  const lines: ReturnableLine[] = lineWorths(ctx, p).map((w) => ({
    lineNo: w.line.line_no,
    description: w.line.description,
    unit: w.line.unit,
    itemId: w.line.item_id,
    qty: w.line.qty,
    returnedQty: w.returned.qty,
    returnableQty: roundQty(w.line.qty - w.returned.qty),
    unitValue: w.line.qty ? (w.value + w.cgst + w.sgst + w.igst) / w.line.qty : 0,
  }));
  return {
    purchaseId: p.id,
    purchaseNo: p.purchase_no,
    date: p.date,
    status: p.status,
    supplierId: p.supplier_id,
    supplierName: p.supplier_name,
    /** Goods can be adjusted against the supplier's account only when the purchase has a supplier. */
    canAdjust: !!p.supplier_id,
    lines,
  };
}

/* ------------------------------ Create / cancel ------------------------------ */

export interface PurchaseReturnItem {
  lineNo: number;
  purchaseLineNo: number;
  itemId: number | null;
  description: string;
  unit: string | null;
  qty: number;
  value: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface PurchaseReturn {
  id: number;
  returnNo: string;
  date: string;
  purchaseId: number;
  purchaseNo: string;
  supplierId: number | null;
  supplierName: string | null;
  items: PurchaseReturnItem[];
  value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  settlement: ReturnSettlement;
  accountName: string | null;
  reference: string | null;
  remarks: string | null;
  status: 'active' | 'cancelled';
  createdBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  posting: PostingLine[];
}

function returnRow(ctx: Ctx, id: number): ReturnRow {
  const r = ctx.db.get<ReturnRow>('SELECT * FROM purchase_returns WHERE id = ?', [id]);
  if (!r) throw fail.notFound('Purchase return');
  return r;
}

export function getPurchaseReturn(ctx: Ctx, id: number): PurchaseReturn {
  const r = returnRow(ctx, id);
  const items = ctx.db.all<{ line_no: number; purchase_line_no: number; item_id: number | null; description: string; unit: string | null; qty: number; value: number; cgst: number; sgst: number; igst: number }>(
    'SELECT line_no, purchase_line_no, item_id, description, unit, qty, value, cgst, sgst, igst FROM purchase_return_items WHERE return_id = ? ORDER BY line_no',
    [id],
  );
  return {
    id: r.id,
    returnNo: r.return_no,
    date: r.date,
    purchaseId: r.purchase_id,
    purchaseNo: ctx.db.value<string>('SELECT purchase_no FROM purchases WHERE id = ?', [r.purchase_id], ''),
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    items: items.map((i) => ({
      lineNo: i.line_no,
      purchaseLineNo: i.purchase_line_no,
      itemId: i.item_id,
      description: i.description,
      unit: i.unit,
      qty: i.qty,
      value: i.value,
      cgst: i.cgst,
      sgst: i.sgst,
      igst: i.igst,
    })),
    value: r.value,
    cgst: r.cgst,
    sgst: r.sgst,
    igst: r.igst,
    total: r.total,
    settlement: r.settlement,
    accountName: r.account_id ? ctx.db.value<string | null>('SELECT name FROM accounts WHERE id = ?', [r.account_id], null) : null,
    reference: r.reference,
    remarks: r.remarks,
    status: r.status,
    createdBy: userName(ctx, r.created_by),
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    posting: postingLines(ctx, r.journal_entry_id),
  };
}

const share = (amount: number, part: number, whole: number) => (whole ? Math.round((amount * part) / whole) : 0);

export function createPurchaseReturn(ctx: Ctx, input: PurchaseReturnInput): PurchaseReturn {
  const p = purchaseRow(ctx, input.purchaseId);
  if (p.status !== 'active') throw fail.validation(`Purchase ${p.purchase_no} is cancelled; nothing can be returned against it.`);
  const date = resolveDocDate(ctx, input.date, { what: 'A purchase return' });
  if (date < p.date) throw fail.validation(`A return cannot be dated before the purchase (${formatDate(p.date)}).`, { date: 'Before the purchase date' });
  if (input.settlement === 'adjust' && !p.supplier_id) {
    throw fail.validation('This purchase has no supplier account. Record the money the supplier refunded (cash, UPI or bank).', { settlement: 'Choose how the money came back' });
  }

  const worths = new Map(lineWorths(ctx, p).map((w) => [w.line.line_no, w]));
  const wanted = input.items.filter((i) => i.qty > 0);
  if (!wanted.length) throw fail.validation('Enter the quantity returned on at least one line.', { items: 'Enter a quantity' });
  const seen = new Set<number>();
  const items = wanted.map((it, i) => {
    const w = worths.get(it.lineNo);
    if (!w) throw fail.validation(`Line ${it.lineNo} is not on purchase ${p.purchase_no}.`, { [`items.${i}.lineNo`]: 'Not on the purchase' });
    if (seen.has(it.lineNo)) throw fail.validation(`"${w.line.description}" is listed twice.`, { [`items.${i}.lineNo`]: 'Listed twice' });
    seen.add(it.lineNo);
    const qty = roundQty(it.qty);
    const left = roundQty(w.line.qty - w.returned.qty);
    if (qty > left) {
      throw fail.validation(`Only ${formatQty(left)}${w.line.unit ? ` ${w.line.unit}` : ''} of "${w.line.description}" can still be returned.`, { [`items.${i}.qty`]: `At most ${formatQty(left)}` });
    }
    // The return that takes back the rest of a line gives back exactly what is left of its value.
    const rest = qty === left;
    const part = (whole: number, done: number) => (rest ? whole - done : share(whole, qty, w.line.qty));
    return {
      purchaseLineNo: it.lineNo,
      itemId: w.line.item_id,
      description: w.line.description,
      unit: w.line.unit,
      qty,
      value: part(w.value, w.returned.value),
      cgst: part(w.cgst, w.returned.cgst),
      sgst: part(w.sgst, w.returned.sgst),
      igst: part(w.igst, w.returned.igst),
    };
  });
  const sum = (k: 'value' | 'cgst' | 'sgst' | 'igst') => items.reduce((s, i) => s + i[k], 0);
  const value = sum('value');
  const cgst = sum('cgst');
  const sgst = sum('sgst');
  const igst = sum('igst');
  const total = value + cgst + sgst + igst;
  if (total <= 0) throw fail.validation('The goods returned have no value on the purchase, so there is nothing to record.');

  const refundAccountId = input.settlement === 'adjust' ? null : paymentAccountId(ctx, input.settlement, input.accountId);
  const num = nextDocNumber(ctx, 'debit_note', date);
  const tracked = !!p.stock_tracked && stockEnabled(ctx);
  const id = ctx.db.insert('purchase_returns', {
    return_no: num.number,
    seq: num.seq,
    fy_start: num.fyStart,
    date,
    purchase_id: p.id,
    supplier_id: p.supplier_id,
    supplier_name: p.supplier_name,
    value,
    cgst,
    sgst,
    igst,
    total,
    settlement: input.settlement,
    account_id: refundAccountId,
    reference: input.reference?.trim() || null,
    remarks: input.remarks?.trim() || null,
    stock_tracked: tracked ? 1 : 0,
    created_by: currentUserId(ctx),
    created_at: now(ctx),
  });
  items.forEach((it, i) =>
    ctx.db.insert('purchase_return_items', {
      return_id: id,
      line_no: i + 1,
      purchase_line_no: it.purchaseLineNo,
      item_id: it.itemId,
      description: it.description,
      unit: it.unit,
      qty: it.qty,
      value: it.value,
      cgst: it.cgst,
      sgst: it.sgst,
      igst: it.igst,
    }),
  );
  if (tracked) {
    writeDocumentMoves(
      ctx,
      'purchase_return',
      id,
      date,
      items.flatMap((it, i) => (it.itemId ? [{ itemId: it.itemId, qty: -it.qty, kind: 'purchase' as const, line: i + 1, note: 'Returned to supplier' }] : [])),
    );
  }

  const lines: EntryLineInput[] = [
    input.settlement === 'adjust'
      ? { account: 'AP', debit: total, partyType: 'supplier', partyId: p.supplier_id! }
      : { account: refundAccountId!, debit: total, memo: input.reference?.trim() || null },
  ];
  if (value) lines.push({ account: p.expense_account_id, credit: value });
  if (cgst) lines.push({ account: 'GST_IN_CGST', credit: cgst });
  if (sgst) lines.push({ account: 'GST_IN_SGST', credit: sgst });
  if (igst) lines.push({ account: 'GST_IN_IGST', credit: igst });
  const who = p.supplier_name ?? 'the supplier';
  const entryId = postEntry(ctx, {
    date,
    voucherType: 'purchase_return',
    voucherNo: num.number,
    sourceType: 'purchase_return',
    sourceId: id,
    narration: `Goods returned to ${who} against purchase ${p.purchase_no}`,
    lines,
  });
  ctx.db.update('purchase_returns', id, { journal_entry_id: entryId });

  const saved = getPurchaseReturn(ctx, id);
  recordRevision(ctx, 'purchase_return', id, 'created', saved);
  logActivity(
    ctx,
    'purchase_return.create',
    `Returned goods worth ${formatINR(total)} to ${who} (purchase ${p.purchase_no})${input.settlement === 'adjust' ? ', adjusted in their account' : ', money refunded'}`,
    { entityType: 'purchase_return', entityId: id, details: { purchaseId: p.id, total } },
  );
  return saved;
}

export function cancelPurchaseReturn(ctx: Ctx, id: number, reason: string): PurchaseReturn {
  const r = returnRow(ctx, id);
  if (r.status === 'cancelled') throw fail.validation('This purchase return is already cancelled.');
  const why = reason.trim();
  if (!why) throw fail.validation('Enter the reason for cancelling', { reason: 'Enter a reason' });
  assertCancelKeepsClosedAccounts(ctx, r.journal_entry_id, 'this purchase return');
  if (r.journal_entry_id) voidEntry(ctx, r.journal_entry_id, `Purchase return ${r.return_no} cancelled: ${why}`);
  if (r.stock_tracked) removeDocumentMoves(ctx, 'purchase_return', id);
  ctx.db.update('purchase_returns', id, { status: 'cancelled', revision: r.revision + 1, cancelled_by: currentUserId(ctx), cancelled_at: now(ctx), cancel_reason: why });
  const saved = getPurchaseReturn(ctx, id);
  recordRevision(ctx, 'purchase_return', id, 'cancelled', saved, why);
  logActivity(ctx, 'purchase_return.cancel', `Cancelled purchase return ${r.return_no} of ${formatINR(r.total)}: ${why}`, {
    entityType: 'purchase_return',
    entityId: id,
    details: { reason: why },
  });
  return saved;
}

/** Active returns against a purchase (a purchase with returns cannot be edited or cancelled). */
export function activeReturnsOf(ctx: Ctx, purchaseId: number): Array<{ id: number; returnNo: string; date: string; total: number }> {
  return ctx.db
    .all<{ id: number; return_no: string; date: string; total: number }>(
      "SELECT id, return_no, date, total FROM purchase_returns WHERE purchase_id = ? AND status = 'active' ORDER BY date, id",
      [purchaseId],
    )
    .map((r) => ({ id: r.id, returnNo: r.return_no, date: r.date, total: r.total }));
}

/* ------------------------------ List ------------------------------ */

export function listPurchaseReturns(ctx: Ctx, q: { from: string; to: string; q?: string | null; status?: 'active' | 'cancelled' | null; supplierId?: number | null }) {
  const where = ['r.date BETWEEN :from AND :to'];
  const params: Record<string, unknown> = { from: q.from, to: q.to };
  if (q.status) {
    where.push('r.status = :status');
    params.status = q.status;
  }
  if (q.supplierId) {
    where.push('r.supplier_id = :sid');
    params.sid = q.supplierId;
  }
  if (q.q?.trim()) {
    where.push('(r.return_no LIKE :like OR r.supplier_name LIKE :like OR p.purchase_no LIKE :like)');
    params.like = `%${q.q.trim()}%`;
  }
  const rows = ctx.db.all<{ id: number; return_no: string; date: string; purchase_id: number; purchase_no: string; supplier_name: string | null; total: number; settlement: ReturnSettlement; status: 'active' | 'cancelled' }>(
    `SELECT r.id, r.return_no, r.date, r.purchase_id, p.purchase_no, r.supplier_name, r.total, r.settlement, r.status
       FROM purchase_returns r JOIN purchases p ON p.id = r.purchase_id
      WHERE ${where.join(' AND ')} ORDER BY r.date DESC, r.id DESC LIMIT 2000`,
    params,
  );
  const list = rows.map((r) => ({
    id: r.id,
    returnNo: r.return_no,
    date: r.date,
    purchaseId: r.purchase_id,
    purchaseNo: r.purchase_no,
    supplierName: r.supplier_name,
    total: r.total,
    settlement: r.settlement,
    status: r.status,
  }));
  const active = list.filter((r) => r.status === 'active');
  return { rows: list, totals: { count: active.length, total: active.reduce((s, r) => s + r.total, 0), cancelled: list.length - active.length } };
}

/* ------------------------------ Printing ------------------------------ */

const SETTLEMENT_TEXT: Record<ReturnSettlement, string> = {
  adjust: 'Adjusted against amount payable',
  cash: 'Refund received in cash',
  upi: 'Refund received by UPI',
  bank: 'Refund received in bank',
};

export function purchaseReturnHtml(ctx: Ctx, id: number): { html: string; paperWidth: 80 | 58 } {
  const r = getPurchaseReturn(ctx, id);
  const receipt = getSection(ctx, 'receipt');
  const totals: ReceiptTotal[] = [];
  const tax = r.cgst + r.sgst + r.igst;
  if (tax) {
    totals.push({ label: 'Value', value: formatAmount(r.value) });
    if (r.cgst) totals.push({ label: 'CGST', value: formatAmount(r.cgst) });
    if (r.sgst) totals.push({ label: 'SGST', value: formatAmount(r.sgst) });
    if (r.igst) totals.push({ label: 'IGST', value: formatAmount(r.igst) });
  }
  totals.push({ label: 'TOTAL', value: formatINR(r.total), bold: true, big: true });
  const doc: ReceiptDoc = {
    title: 'DEBIT NOTE',
    cancelled: r.status === 'cancelled',
    meta: [
      ['Debit note no', r.returnNo],
      ['Date', formatDate(r.date)],
      ['Against purchase', r.purchaseNo],
    ],
    party: r.supplierName ? { label: 'Supplier', name: r.supplierName } : undefined,
    items: r.items.map((i) => ({ name: i.description, qty: `${formatQty(i.qty)}${i.unit ? ` ${i.unit}` : ''}`, amount: formatAmount(i.value + i.cgst + i.sgst + i.igst) })),
    totals,
    lines: [SETTLEMENT_TEXT[r.settlement], ...(r.remarks ? [r.remarks] : [])],
    signature: 'Authorised signatory',
  };
  return { html: renderReceiptHtml(doc, getSection(ctx, 'business'), receipt), paperWidth: receipt.paperWidth };
}

export async function printPurchaseReturn(ctx: Ctx, id: number): Promise<{ printed: boolean; message: string }> {
  const r = returnRow(ctx, id);
  const res = await sendToReceiptPrinter(ctx, purchaseReturnHtml(ctx, id).html, true);
  return { printed: res.printed, message: res.printed ? `Debit note ${r.return_no} sent to the printer` : res.message || 'Printing was cancelled.' };
}
