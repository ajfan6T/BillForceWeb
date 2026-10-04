import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, FilePlus2, Pencil, Printer, Receipt } from 'lucide-react';
import { Alert, Badge, Button, Card, ErrorBox, KeyValues, Loading, Money, Page, PageHeader, Stat, StatGrid, Toolbar } from '../../components/ui';
import { DateInput, Field, FormGrid, NumberInput, SearchInput, Select, TextArea, TextInput } from '../../components/forms';
import { DataTable, type Column } from '../../components/table';
import { DateRangePicker } from '../../components/report';
import { CustomerPicker, ReceiptPreview, type CustomerOption } from '../../components/pickers';
import { DocLinesEditor, blankDocLine, docLine, filledLines, type DocLine, type LineSuggestion } from '../../components/docLines';
import { useDebounced, useHotkeys, useMutation, useQuery } from '../../hooks';
import { useAuth, useFeatures } from '../../auth';
import { useDialogs, useToast, useUnsavedWarning } from '../../feedback';
import { call, type ApiOutput } from '../../api';
import { formatINR, formatQty } from '../../../shared/money';
import { addDays, describeRange, formatDate, formatDateTime, todayISO } from '../../../shared/dates';
import { calcBill } from '../../../shared/billing';
import { countText, useRange } from '../customers/common';

type Quotation = ApiOutput<'quotations.get'>;
type Row = ApiOutput<'quotations.list'>['rows'][number];
type Status = Row['status'];

function StatusBadge({ status, expired }: { status: Status; expired?: boolean }) {
  if (status === 'converted') return <Badge tone="green">Billed</Badge>;
  if (status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  return expired ? <Badge tone="amber">Expired</Badge> : <Badge tone="blue">Open</Badge>;
}

/* ------------------------------ List ------------------------------ */

export function QuotationsListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [range, setRange] = useRange('quotations.range', 'this_month');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const dq = useDebounced(q, 200);
  const list = useQuery('quotations.list', { from: range.from, to: range.to, q: dq || null, status: status || null });
  const t = list.data?.totals;
  useHotkeys({ 'alt+n': () => can('billing.create') && navigate('/sales/quotations/new') });

  const columns: Array<Column<Row>> = [
    { key: 'date', label: 'Date', type: 'date', width: 110 },
    { key: 'quoteNo', label: 'Quotation no', render: (r) => <span className="bold">{r.quoteNo}</span> },
    { key: 'customerName', label: 'Customer', render: (r) => r.customerName ?? <span className="faint">—</span> },
    { key: 'validUntil', label: 'Valid until', type: 'date', width: 110 },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} expired={r.expired} /> },
    { key: 'billNo', label: 'Bill', render: (r) => r.billNo ?? '' },
    { key: 'total', label: 'Amount', type: 'money' },
  ];

  return (
    <Page>
      <PageHeader
        title="Quotations"
        subtitle="Prices offered to customers. Turn one into a bill when the customer agrees."
        actions={
          can('billing.create') && (
            <Button variant="primary" icon={<FilePlus2 size={16} />} kbd="Alt+N" onClick={() => navigate('/sales/quotations/new')}>
              New quotation
            </Button>
          )
        }
      />
      <StatGrid>
        <Stat label="Quotations" value={t?.count ?? 0} hint={describeRange(range)} />
        <Stat label="Open" value={formatINR(t?.openValue ?? 0)} hint={countText(t?.open ?? 0, 'quotation')} />
        <Stat label="Made into bills" value={formatINR(t?.convertedValue ?? 0)} hint={countText(t?.converted ?? 0, 'quotation')} tone="green" />
      </StatGrid>
      <Card padded={false} className="list-card">
        <div className="tab-toolbar">
          <Toolbar>
            <DateRangePicker value={range} onChange={setRange} />
            <SearchInput value={q} onChange={setQ} placeholder="Quotation no, customer, phone…" />
            <Select<Status | ''>
              value={status}
              onChange={setStatus}
              aria-label="Status"
              style={{ width: 140 }}
              options={[
                { value: '', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'converted', label: 'Billed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
          </Toolbar>
        </div>
        {list.error ? (
          <div className="card-body">
            <ErrorBox error={list.error} onRetry={list.reload} />
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={list.data?.rows}
            loading={list.loading}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/sales/quotations/${r.id}`)}
            rowClassName={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
            empty={dq || status ? 'No quotations match your filters' : `No quotations between ${describeRange(range)}`}
          />
        )}
      </Card>
    </Page>
  );
}

/* ------------------------------ New / edit ------------------------------ */

interface FormState {
  date: string;
  validUntil: string;
  customer: CustomerOption | null;
  customerName: string;
  customerPhone: string;
  lines: DocLine[];
  billDiscountPct: number | null;
  remarks: string;
}

async function searchItems(q: string): Promise<LineSuggestion[]> {
  const items = await call('items.search', { q, limit: 12 });
  return items.map((i) => ({ itemId: i.id, name: i.name, unit: i.unit, rate: i.rate, gstRate: i.gstRate, hint: i.stock !== null ? `${formatQty(i.stock)} in stock` : undefined }));
}

export function QuotationFormPage() {
  const id = Number(useParams().id) || null;
  const existing = useQuery('quotations.get', id ? { id } : null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    if (!id) {
      const date = todayISO();
      setInitial({ date, validUntil: addDays(date, 15), customer: null, customerName: '', customerPhone: '', lines: [blankDocLine()], billDiscountPct: null, remarks: '' });
      return;
    }
    const q = existing.data;
    if (!q) return;
    const lines = [
      ...q.items.map((i) => docLine({ itemId: i.itemId, name: i.itemName, unit: i.unit ?? '', qty: i.qty, rate: i.rate, discountPct: i.discountPct ?? (i.discount ? Math.round((i.discount / Math.max(1, i.qty * i.rate)) * 10000) / 100 : null), gstRate: i.gstRate })),
      blankDocLine(),
    ];
    const base = { date: q.date, validUntil: q.validUntil ?? '', customerName: q.customerId ? '' : (q.customerName ?? ''), customerPhone: q.customerId ? '' : (q.customerPhone ?? ''), lines, billDiscountPct: q.billDiscountPct, remarks: q.remarks ?? '' };
    if (q.customerId) {
      call('sales.customer', { id: q.customerId })
        .then((c) => setInitial({ ...base, customer: c }))
        .catch((e) => setLoadError(String(e?.message ?? e)));
    } else setInitial({ ...base, customer: null });
  }, [id, existing.data, initial]);

  const error = existing.error ?? loadError;
  if (error) {
    return (
      <Page>
        <PageHeader title="Quotation" back="/sales/quotations" />
        <ErrorBox error={error} />
      </Page>
    );
  }
  if (!initial) return <Loading />;
  if (existing.data && existing.data.status !== 'open') {
    return (
      <Page>
        <PageHeader title={`Quotation ${existing.data.quoteNo}`} back={`/sales/quotations/${existing.data.id}`} />
        <Alert tone="amber">Only open quotations can be edited.</Alert>
      </Page>
    );
  }
  return <QuotationEditor initial={initial} existing={existing.data ?? null} />;
}

function QuotationEditor({ initial, existing }: { initial: FormState; existing: Quotation | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const features = useFeatures();
  const [s, setS] = useState<FormState>(initial);
  const [dirty, setDirty] = useState(false);
  const create = useMutation('quotations.create');
  const update = useMutation('quotations.update');
  const m = existing ? update : create;
  useUnsavedWarning(dirty);
  const patch = (p: Partial<FormState>) => {
    setS((x) => ({ ...x, ...p }));
    setDirty(true);
  };

  const filled = filledLines(s.lines);
  const calc = useMemo(
    () =>
      calcBill({
        lines: filled.map((l) => ({ qty: l.qty ?? 0, rate: l.rate ?? 0, discountPct: l.discountPct, gstRate: l.gstRate ?? features.gstDefaultRate })),
        billDiscountPct: s.billDiscountPct,
        roundOff: true,
        gst: features.gst === 'regular' ? { inclusive: features.gstInclusive, interState: false } : null,
      }),
    [filled, s.billDiscountPct, features],
  );
  const problem = !filled.length ? 'Add at least one item' : filled.some((l) => !l.qty) ? 'Enter the quantity of every item' : null;

  const save = async () => {
    if (problem || m.loading) {
      if (problem) toast.warning(problem);
      return;
    }
    const input = {
      date: s.date,
      validUntil: s.validUntil || null,
      customerId: s.customer?.id ?? null,
      customerName: s.customer ? null : s.customerName.trim() || null,
      customerPhone: s.customer ? null : s.customerPhone.trim() || null,
      items: filled.map((l) => ({ itemId: l.itemId, itemName: l.name.trim(), unit: l.unit.trim() || null, qty: l.qty!, rate: l.rate ?? 0, discountPct: l.discountPct || null, gstRate: l.itemId ? null : l.gstRate })),
      billDiscountPct: s.billDiscountPct || null,
      remarks: s.remarks.trim() || null,
    };
    try {
      const saved = existing ? await update.run({ id: existing.id, ...input }) : await create.run(input);
      setDirty(false);
      toast.success(`${existing ? 'Updated' : 'Saved'} quotation ${saved.quoteNo} · ${formatINR(saved.total)}`);
      navigate(`/sales/quotations/${saved.id}`);
    } catch {
      /* shown below */
    }
  };
  useHotkeys({ 'ctrl+s': () => void save(), F9: () => void save() });

  return (
    <Page wide>
      <PageHeader title={existing ? `Edit quotation ${existing.quoteNo}` : 'New quotation'} back={existing ? `/sales/quotations/${existing.id}` : '/sales/quotations'} />
      <div className="stack">
        <Card>
          <FormGrid cols={4}>
            <Field label="Date">
              <DateInput value={s.date} onChange={(v) => patch({ date: v })} max={todayISO()} />
            </Field>
            <Field label="Valid until" error={m.fields.validUntil}>
              <DateInput value={s.validUntil} onChange={(v) => patch({ validUntil: v })} min={s.date} />
            </Field>
          </FormGrid>
          <FormGrid>
            <Field label="Customer" hint="Choose a saved customer, or type a name below for someone new">
              <CustomerPicker value={s.customer} onChange={(c) => patch({ customer: c })} showBalance={false} />
            </Field>
            {!s.customer && (
              <FormGrid>
                <Field label="Name">
                  <TextInput value={s.customerName} maxLength={120} onChange={(e) => patch({ customerName: e.target.value })} />
                </Field>
                <Field label="Phone" error={m.fields.customerPhone}>
                  <TextInput value={s.customerPhone} maxLength={20} inputMode="tel" onChange={(e) => patch({ customerPhone: e.target.value })} />
                </Field>
              </FormGrid>
            )}
          </FormGrid>
        </Card>
        <Card title="Items">
          <DocLinesEditor lines={s.lines} onChange={(lines) => patch({ lines })} search={searchItems} withDiscount errors={m.fields} />
        </Card>
        <div className="detail-grid">
          <Card>
            <FormGrid>
              <Field label="Discount on the whole quotation (%)" error={m.fields.billDiscount}>
                <NumberInput value={s.billDiscountPct} decimals={2} onChange={(v) => patch({ billDiscountPct: v === null ? null : Math.min(v, 100) })} />
              </Field>
            </FormGrid>
            <Field label="Remarks / terms">
              <TextArea rows={3} value={s.remarks} maxLength={500} onChange={(e) => patch({ remarks: e.target.value })} placeholder="e.g. Prices include delivery. Valid for 15 days." />
            </Field>
          </Card>
          <Card title="Total">
            <KeyValues
              columns={1}
              items={[
                ['Items', formatINR(calc.subtotal)],
                calc.itemDiscount + calc.billDiscount ? ['Discount', `-${formatINR(calc.itemDiscount + calc.billDiscount)}`] : null,
                calc.gst ? ['GST', formatINR(calc.gst.tax)] : null,
                calc.roundOff ? ['Round off', formatINR(calc.roundOff)] : null,
                ['Total', <span className="bold">{formatINR(calc.total)}</span>],
              ]}
            />
            <p className="faint small mb-0">The saved quotation uses your billing settings (GST, rounding); the bill made from it comes to the same amount.</p>
          </Card>
        </div>
        {m.error && <Alert tone="red">{m.error}</Alert>}
        <div className="row">
          <Button variant="primary" loading={m.loading} disabled={!!problem} kbd="Ctrl+S" onClick={() => void save()}>
            {existing ? 'Save changes' : 'Save quotation'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(existing ? `/sales/quotations/${existing.id}` : '/sales/quotations')}>
            Cancel
          </Button>
          {problem && filled.length > 0 && <span className="muted small">{problem}</span>}
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------ Detail ------------------------------ */

export function QuotationDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const dialogs = useDialogs();
  const valid = Number.isInteger(id) && id > 0;
  const q = useQuery('quotations.get', valid ? { id } : null);
  const preview = useQuery('quotations.receiptHtml', valid ? { id } : null);
  const [printing, setPrinting] = useState(false);
  const d = q.data;

  const print = async () => {
    if (!d) return;
    setPrinting(true);
    try {
      const res = await call('quotations.print', { id: d.id });
      if (!res.printed) toast.warning(res.message);
    } catch (e) {
      toast.error(e);
    } finally {
      setPrinting(false);
    }
  };
  useHotkeys({ 'ctrl+p': () => void print() }, [d?.id]);

  if (!valid) return <Page><ErrorBox error="This quotation link is not valid." /></Page>;
  if (q.error) return <Page><PageHeader title="Quotation" back="/sales/quotations" /><ErrorBox error={q.error} onRetry={q.reload} /></Page>;
  if (!d) return <Loading />;

  const open = d.status === 'open';
  const cancel = async () => {
    const reason = await dialogs.prompt({ title: `Cancel quotation ${d.quoteNo}?`, label: 'Reason', placeholder: 'e.g. customer did not agree', required: true, confirmText: 'Cancel quotation', danger: true });
    if (!reason) return;
    try {
      await call('quotations.cancel', { id: d.id, reason });
      toast.success(`Quotation ${d.quoteNo} cancelled`);
      void q.reload();
      void preview.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Page>
      <PageHeader
        back="/sales/quotations"
        title={
          <span className="row">
            Quotation {d.quoteNo} <StatusBadge status={d.status} expired={d.expired} />
          </span>
        }
        subtitle={`${formatDate(d.date)}${d.customerName ? ` · ${d.customerName}` : ''}`}
        actions={
          <>
            <Button icon={<Printer size={16} />} kbd="Ctrl+P" loading={printing} onClick={print}>
              Print
            </Button>
            {open && can('billing.create') && (
              <>
                <Button variant="primary" icon={<Receipt size={16} />} onClick={() => navigate(`/billing/new?quote=${d.id}`)}>
                  Create bill
                </Button>
                <Button icon={<Pencil size={16} />} onClick={() => navigate(`/sales/quotations/${d.id}/edit`)}>
                  Edit
                </Button>
                <Button variant="ghost" icon={<Ban size={16} />} onClick={cancel}>
                  Cancel
                </Button>
              </>
            )}
          </>
        }
      />
      {d.status === 'converted' && d.billId && (
        <Alert tone="green">
          Made into bill <Link to={`/sales/bills/${d.billId}`}>{d.billNo}</Link>.
        </Alert>
      )}
      {d.status === 'cancelled' && (
        <Alert tone="red" title={`Cancelled on ${formatDateTime(d.cancelledAt)}`}>
          Reason: {d.cancelReason}
        </Alert>
      )}
      {d.expired && <Alert tone="amber">This quotation was valid until {formatDate(d.validUntil)}. Check the prices before making the bill.</Alert>}
      <div className="detail-grid">
        <div className="stack">
          <Card title="Details">
            <KeyValues
              columns={3}
              items={[
                ['Customer', d.customerId ? <Link to={`/customers/${d.customerId}`}>{d.customerName}</Link> : d.customerName],
                ['Phone', d.customerPhone],
                ['Date', formatDate(d.date)],
                ['Valid until', d.validUntil ? formatDate(d.validUntil) : null],
                ['Total', <Money value={d.total} className="bold" />],
                ['Remarks', d.remarks],
                ['Made by', `${d.createdBy ?? '—'} · ${formatDateTime(d.createdAt)}`],
                d.updatedAt ? ['Last changed', formatDateTime(d.updatedAt)] : null,
              ]}
            />
          </Card>
          <Card title="Items" padded={false}>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Rate</th>
                    <th className="num">Discount</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.lineNo}>
                      <td>{i.itemName}</td>
                      <td className="num">
                        {formatQty(i.qty)} {i.unit}
                      </td>
                      <td className="num">{formatINR(i.rate)}</td>
                      <td className="num">{i.discount ? formatINR(i.discount) : ''}</td>
                      <td className="num">{formatINR(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  {d.billDiscount > 0 && (
                    <tr>
                      <td colSpan={4}>Discount on the whole quotation{d.billDiscountPct ? ` (${d.billDiscountPct}%)` : ''}</td>
                      <td className="num">-{formatINR(d.billDiscount)}</td>
                    </tr>
                  )}
                  {d.tax > 0 && (
                    <tr>
                      <td colSpan={4}>GST</td>
                      <td className="num">{formatINR(d.tax)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={4} className="bold">
                      Total
                    </td>
                    <td className="num bold">{formatINR(d.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Printout">
          <ReceiptPreview html={preview.data?.html} widthMm={preview.data?.paperWidth} height={520} />
        </Card>
      </div>
    </Page>
  );
}
