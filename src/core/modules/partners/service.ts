/**
 * Partners of a partnership business. Every partner has a capital account and a drawings account of
 * their own (group "Capital Account" / "Drawings"), so the balance sheet shows each partner's capital:
 *
 *   Investment             Dr cash / bank / UPI         Cr partner's capital
 *   Paid for the business  Dr expense head              Cr partner's capital    (Expenses: "a partner paid")
 *   Withdrawal             Dr partner's drawings        Cr cash / bank / UPI    (or Purchases for goods)
 *   Year-end closing       the profit or loss is shared among the partners' capital accounts by their
 *                          profit-sharing ratio, and each partner's drawings move into their own capital
 *
 * A partner's balance (capital less drawings) is what the business owes that partner.
 */
import type { Ctx } from '../../context';
import { now, today } from '../../context';
import { fail } from '../../errors';
import { logActivity } from '../../audit';
import { entrySourceLink } from '../../accounting/links';
import { createAccount } from '../accounting/chart';
import { addCapital, recordDrawings } from '../accounting/vouchers';
import { voucherLabel } from '../accounting/common';
import type { SavedEntry } from '../accounting/journals';
import { profitLossFigures } from '../reports/profitLoss';
import { describeRange, fyOf } from '../../../shared/dates';
import { PAYMENT_MODE_LABELS, type SettlementMode, type VoucherType } from '../../../shared/constants';
import type { ReportData, ReportRow } from '../../../shared/report';

interface PartnerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  share_pct: number;
  capital_account_id: number;
  drawings_account_id: number;
  joined_on: string | null;
  is_active: number;
  created_at: string;
  updated_at: string | null;
}

export interface PartnerTotals {
  /** Capital brought in (investments and opening balances). */
  invested: number;
  /** Expenses the partner paid from their own money. */
  paidForBusiness: number;
  /** Money (or goods) taken out. */
  withdrawn: number;
  /** Share of profit (negative: loss) added at year-end closing. */
  profitShare: number;
  /** Other entries on the partner's accounts (journal entries). */
  other: number;
  /** Capital less drawings: what the business owes the partner. */
  balance: number;
}

export interface Partner {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  sharePct: number;
  joinedOn: string | null;
  isActive: boolean;
  capitalAccountId: number;
  drawingsAccountId: number;
  totals: PartnerTotals;
  /** Share of this financial year's profit so far (not in the balance until the year is closed). */
  yearShare: number;
}

export interface PartnerInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  sharePct: number;
  joinedOn?: string | null;
  isActive?: boolean;
}

const clean = (v: string | null | undefined) => v?.trim() || null;
const pct = (v: number) => `${Math.round(v * 100) / 100}%`;

function partnerRow(ctx: Ctx, id: number): PartnerRow {
  const p = ctx.db.get<PartnerRow>('SELECT * FROM partners WHERE id = ?', [id]);
  if (!p) throw fail.notFound('Partner');
  return p;
}

function totalsOf(ctx: Ctx, p: PartnerRow): PartnerTotals {
  const lines = ctx.db.all<{ account_id: number; voucher_type: VoucherType; net: number }>(
    `SELECT l.account_id, e.voucher_type, SUM(l.credit - l.debit) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.is_void = 0 AND l.account_id IN (?, ?)
      GROUP BY l.account_id, e.voucher_type`,
    [p.capital_account_id, p.drawings_account_id],
  );
  const t: PartnerTotals = { invested: 0, paidForBusiness: 0, withdrawn: 0, profitShare: 0, other: 0, balance: 0 };
  for (const l of lines) {
    t.balance += l.net;
    if (l.voucher_type === 'closing') t.profitShare += l.net;
    else if (l.account_id === p.drawings_account_id) t.withdrawn -= l.net;
    else if (l.voucher_type === 'capital' || l.voucher_type === 'opening') t.invested += l.net;
    else if (l.voucher_type === 'expense') t.paidForBusiness += l.net;
    else t.other += l.net;
  }
  return t;
}

/** Profit of the current financial year so far (0 once it is closed). */
function currentYearProfit(ctx: Ctx): { name: string; profit: number } {
  const fy = fyOf(today(ctx));
  const closed = ctx.db.value<number>('SELECT is_closed FROM financial_years WHERE start_date = ?', [fy.start], 0);
  return { name: fy.name, profit: closed ? 0 : profitLossFigures(ctx, fy.start, today(ctx)).netProfit };
}

function toPartner(ctx: Ctx, p: PartnerRow, yearProfit: number, totalShare: number): Partner {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    address: p.address,
    notes: p.notes,
    sharePct: p.share_pct,
    joinedOn: p.joined_on,
    isActive: !!p.is_active,
    capitalAccountId: p.capital_account_id,
    drawingsAccountId: p.drawings_account_id,
    totals: totalsOf(ctx, p),
    yearShare: p.is_active && totalShare > 0 ? Math.round((yearProfit * p.share_pct) / totalShare) : 0,
  };
}

function activeShareTotal(ctx: Ctx, exceptId?: number): number {
  return ctx.db.value<number>('SELECT COALESCE(SUM(share_pct), 0) FROM partners WHERE is_active = 1 AND id <> ?', [exceptId ?? 0], 0);
}

export interface PartnersOverview {
  partners: Partner[];
  /** Profit shares of the active partners added up (should be 100). */
  totalShare: number;
  year: { name: string; profit: number };
  totals: PartnerTotals;
}

export function listPartners(ctx: Ctx): PartnersOverview {
  const rows = ctx.db.all<PartnerRow>('SELECT * FROM partners ORDER BY is_active DESC, name COLLATE NOCASE');
  const totalShare = rows.filter((r) => r.is_active).reduce((s, r) => s + r.share_pct, 0);
  const year = rows.length ? currentYearProfit(ctx) : { name: fyOf(today(ctx)).name, profit: 0 };
  const partners = rows.map((r) => toPartner(ctx, r, year.profit, totalShare));
  const totals: PartnerTotals = { invested: 0, paidForBusiness: 0, withdrawn: 0, profitShare: 0, other: 0, balance: 0 };
  for (const p of partners) for (const k of Object.keys(totals) as Array<keyof PartnerTotals>) totals[k] += p.totals[k];
  return { partners, totalShare, year, totals };
}

/** Partners to choose from in a form (e.g. who paid an expense). */
export function partnerOptions(ctx: Ctx): Array<{ id: number; name: string; isActive: boolean }> {
  return ctx.db
    .all<{ id: number; name: string; is_active: number }>('SELECT id, name, is_active FROM partners ORDER BY is_active DESC, name COLLATE NOCASE')
    .map((r) => ({ id: r.id, name: r.name, isActive: !!r.is_active }));
}

export function getPartner(ctx: Ctx, id: number): Partner & { capitalAccountName: string; drawingsAccountName: string } {
  const p = partnerRow(ctx, id);
  const year = currentYearProfit(ctx);
  const name = (accountId: number) => ctx.db.value<string>('SELECT name FROM accounts WHERE id = ?', [accountId], '');
  return {
    ...toPartner(ctx, p, year.profit, activeShareTotal(ctx)),
    capitalAccountName: name(p.capital_account_id),
    drawingsAccountName: name(p.drawings_account_id),
  };
}

function checkInput(ctx: Ctx, input: PartnerInput, id?: number): { name: string; share: number } {
  const name = input.name.trim();
  if (!name) throw fail.validation("Enter the partner's name", { name: "Enter the partner's name" });
  const same = ctx.db.value<number>('SELECT id FROM partners WHERE LOWER(name) = LOWER(?) AND id <> ?', [name, id ?? 0], 0);
  if (same) throw fail.validation(`There is already a partner called ${name}.`, { name: 'Already a partner' });
  const share = Math.round(input.sharePct * 100) / 100;
  if (!(share >= 0 && share <= 100)) throw fail.validation('The profit share must be between 0% and 100%', { sharePct: 'Between 0 and 100' });
  if (input.isActive !== false) {
    const others = activeShareTotal(ctx, id);
    if (others + share > 100.005) {
      const left = Math.max(0, Math.round((100 - others) * 100) / 100);
      throw fail.validation(`The partners' profit shares would add up to ${pct(others + share)}. At most ${pct(left)} is left for this partner.`, {
        sharePct: `At most ${pct(left)}`,
      });
    }
  }
  return { name, share };
}

/** Add a partner, with a capital account and a drawings account of their own. */
export function createPartner(ctx: Ctx, input: PartnerInput): Partner {
  const { name, share } = checkInput(ctx, input);
  const capital = createAccount(ctx, { name: `${name} - Capital`, groupCode: 'capital', description: `Capital of partner ${name}` });
  const drawings = createAccount(ctx, { name: `${name} - Drawings`, groupCode: 'drawings', description: `Drawings of partner ${name}` });
  const id = ctx.db.insert('partners', {
    name,
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
    notes: clean(input.notes),
    share_pct: share,
    capital_account_id: capital.id,
    drawings_account_id: drawings.id,
    joined_on: input.joinedOn || null,
    is_active: input.isActive === false ? 0 : 1,
    created_at: now(ctx),
  });
  logActivity(ctx, 'partner.create', `Added partner ${name} with a ${pct(share)} share of profit`, { entityType: 'partner', entityId: id, details: { ...input, sharePct: share } });
  return getPartner(ctx, id);
}

export function updatePartner(ctx: Ctx, id: number, input: PartnerInput): Partner {
  const before = partnerRow(ctx, id);
  const { name, share } = checkInput(ctx, input, id);
  if (name !== before.name) {
    // The partner's accounts follow the name.
    for (const [accountId, kind] of [
      [before.capital_account_id, 'Capital'],
      [before.drawings_account_id, 'Drawings'],
    ] as const) {
      const accountName = `${name} - ${kind}`;
      if (ctx.db.value<number>('SELECT id FROM accounts WHERE LOWER(name) = LOWER(?) AND id <> ?', [accountName, accountId], 0)) {
        throw fail.validation(`There is already an account called "${accountName}". Choose another name.`, { name: 'Name already used' });
      }
      ctx.db.run('UPDATE accounts SET name = ?, description = ?, updated_at = ? WHERE id = ?', [accountName, `${kind} of partner ${name}`, now(ctx), accountId]);
    }
  }
  const isActive = input.isActive === false ? 0 : 1;
  ctx.db.update('partners', id, {
    name,
    phone: clean(input.phone),
    email: clean(input.email),
    address: clean(input.address),
    notes: clean(input.notes),
    share_pct: share,
    joined_on: input.joinedOn || null,
    is_active: isActive,
    updated_at: now(ctx),
  });
  const changes: string[] = [];
  if (name !== before.name) changes.push(`name ${before.name} → ${name}`);
  if (share !== before.share_pct) changes.push(`share ${pct(before.share_pct)} → ${pct(share)}`);
  if (isActive !== before.is_active) changes.push(isActive ? 'active again' : 'no longer active');
  logActivity(ctx, 'partner.update', `Edited partner ${name}${changes.length ? `: ${changes.join(', ')}` : ''}`, { entityType: 'partner', entityId: id });
  return getPartner(ctx, id);
}

function activePartner(ctx: Ctx, id: number): PartnerRow {
  const p = partnerRow(ctx, id);
  if (!p.is_active) throw fail.validation(`${p.name} is no longer an active partner.`);
  return p;
}

/** Money a partner brings into the business: Dr cash / bank, Cr the partner's capital. */
export function recordInvestment(
  ctx: Ctx,
  input: { partnerId: number; date?: string | null; amount: number; mode: SettlementMode; accountId?: number | null; narration?: string | null },
): SavedEntry {
  const p = activePartner(ctx, input.partnerId);
  return addCapital(ctx, {
    date: input.date,
    amount: input.amount,
    mode: input.mode,
    accountId: input.accountId,
    capitalAccountId: p.capital_account_id,
    narration: input.narration?.trim() || `Capital invested by ${p.name} (${PAYMENT_MODE_LABELS[input.mode]})`,
  });
}

/** Money (or goods) a partner takes out, or money the business pays back to a partner: Dr the partner's drawings. */
export function recordWithdrawal(
  ctx: Ctx,
  input: { partnerId: number; date?: string | null; amount: number; mode?: SettlementMode | null; accountId?: number | null; goods?: boolean; narration?: string | null },
): SavedEntry {
  const p = partnerRow(ctx, input.partnerId);
  return recordDrawings(ctx, {
    date: input.date,
    amount: input.amount,
    mode: input.mode,
    accountId: input.accountId,
    goods: input.goods,
    drawingsAccountId: p.drawings_account_id,
    narration:
      input.narration?.trim() ||
      (input.goods ? `Goods taken by ${p.name}` : `Money taken by ${p.name}${input.mode ? ` (${PAYMENT_MODE_LABELS[input.mode]})` : ''}`),
  });
}

const KIND_LABELS: Record<string, string> = {
  capital: 'Investment',
  opening: 'Opening balance',
  expense: 'Paid for the business',
  drawings: 'Withdrawal',
  closing: 'Year-end closing',
};

/** Everything on a partner's capital and drawings accounts in a period, with a running balance. */
export function partnerStatement(ctx: Ctx, id: number, range: { from: string; to: string }): ReportData {
  const p = partnerRow(ctx, id);
  const ids = [p.capital_account_id, p.drawings_account_id];
  const opening = ctx.db.value<number>(
    `SELECT COALESCE(SUM(l.credit - l.debit), 0) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.is_void = 0 AND e.date < ? AND l.account_id IN (?, ?)`,
    [range.from, ...ids],
    0,
  );
  const entries = ctx.db.all<{
    entry_id: number;
    date: string;
    voucher_type: VoucherType;
    voucher_no: string | null;
    narration: string | null;
    source_type: string | null;
    source_id: number | null;
    net: number;
  }>(
    `SELECT l.entry_id, e.date, e.voucher_type, e.voucher_no, e.narration, e.source_type, e.source_id, SUM(l.credit - l.debit) AS net
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.is_void = 0 AND e.date >= ? AND e.date <= ? AND l.account_id IN (?, ?)
      GROUP BY l.entry_id HAVING net <> 0
      ORDER BY e.date, e.id`,
    [range.from, range.to, ...ids],
  );
  const rows: ReportRow[] = [{ cells: { date: range.from, kind: null, particulars: 'Opening balance', no: null, added: null, withdrawn: null, balance: opening }, style: 'group' }];
  let running = opening;
  let added = 0;
  let taken = 0;
  for (const e of entries) {
    running += e.net;
    if (e.net > 0) added += e.net;
    else taken -= e.net;
    rows.push({
      cells: {
        date: e.date,
        kind: KIND_LABELS[e.voucher_type] ?? voucherLabel(e.voucher_type),
        particulars: e.narration ?? voucherLabel(e.voucher_type),
        no: e.voucher_no,
        added: e.net > 0 ? e.net : null,
        withdrawn: e.net < 0 ? -e.net : null,
        balance: running,
      },
      link: entrySourceLink(ctx, { id: e.entry_id, source_type: e.source_type, source_id: e.source_id }),
    });
  }
  rows.push({ cells: { date: range.to, kind: null, particulars: 'Closing balance', no: null, added, withdrawn: taken, balance: running }, style: 'total' });
  return {
    title: `Partner account: ${p.name}`,
    subtitle: describeRange(range),
    columns: [
      { key: 'date', label: 'Date', type: 'date', width: 11 },
      { key: 'kind', label: 'Type', width: 18 },
      { key: 'particulars', label: 'Particulars', width: 40 },
      { key: 'no', label: 'Voucher no', width: 15, nowrap: true },
      { key: 'added', label: 'Added', type: 'money', width: 14 },
      { key: 'withdrawn', label: 'Taken out', type: 'money', width: 14 },
      { key: 'balance', label: 'Balance', type: 'money', width: 15 },
    ],
    rows,
    summary: [
      { label: 'Opening', value: opening, type: 'money' },
      { label: 'Added', value: added, type: 'money' },
      { label: 'Taken out', value: taken, type: 'money' },
      { label: 'Closing', value: running, type: 'money' },
    ],
    notes: [
      `Added: money invested, expenses ${p.name} paid for the business and the share of profit. Taken out: withdrawals and the share of a loss.`,
      `The balance is what the business owes ${p.name}. This year's profit is shared at year-end closing (${pct(p.share_pct)} share).`,
    ],
  };
}
