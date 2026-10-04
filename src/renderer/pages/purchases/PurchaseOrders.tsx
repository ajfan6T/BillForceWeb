import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, ClipboardList, PackageCheck, Pencil, Printer } from 'lucide-react';
import { Alert, Badge, Button, Card, ErrorBox, KeyValues, Loading, Money, Page, PageHeader, Stat, StatGrid, Toolbar } from '../../components/ui';
import { DateInput, Field, FormGrid, SearchInput, Select, TextArea } from '../../components/forms';
import { DataTable, type Column } from '../../components/table';
import { DateRangePicker } from '../../components/report';
import { ReceiptPreview, SupplierPicker, type SupplierOption } from '../../components/pickers';
import { DocLinesEditor, blankDocLine, docLine, docLineAmount, filledLines, type DocLine, type LineSuggestion } from '../../components/docLines';
import { useDebounced, useHotkeys, useMutation, useQuery } from '../../hooks';
import { useAuth } from '../../auth';
import { useDialogs, useToast, useUnsavedWarning } from '../../feedback';
import { call, type ApiOutput } from '../../api';
import { formatINR, formatQty } from '../../../shared/money';
import { addDays, describeRange, formatDate, formatDateTime, todayISO } from '../../../shared/dates';
import { countText, useRange } from '../customers/common';

type Order = ApiOutput<'purchaseOrders.get'>;
type Row = ApiOutput<'purchaseOrders.list'>['rows'][number];
type Status = Row['status'];

function StatusBadge({ status }: { status: Status }) {
  if (status === 'received') return <Badge tone="green">Received</Badge>;
  if (status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  return <Badge tone="blue">Open</Badge>;
}

/* ------------------------------ List ------------------------------ */

export function PurchaseOrdersListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [range, setRange] = useRange('purchaseOrders.range', 'this_month');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const dq = useDebounced(q, 200);
  const list = useQuery('purchaseOrders.list', { from: range.from, to: range.to, q: dq || null, status: status || null });
  const t = list.data?.totals;
  useHotkeys({ 'alt+n': () => can('purchases.manage') && navigate('/purchases/orders/new') });

  const columns: Array<Column<Row>> = [
    { key: 'date', label: 'Date', type: 'date', width: 110 },
    { key: 'poNo', label: 'Order no', render: (r) => <span className="bold">{r.poNo}</span> },
    { key: 'supplierName', label: 'Supplier' },
    { key: 'expectedDate', label: 'Expected', type: 'date', width: 110 },
    { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'purchaseNo', label: 'Purchase bill', render: (r) => r.purchaseNo ?? '' },
    { key: 'total', label: 'Amount', type: 'money' },
  ];

  return (
    <Page>
      <PageHeader
        title="Purchase orders"
        subtitle="Goods ordered from suppliers. Enter the purchase bill from the order when the goods arrive."
        actions={
          can('purchases.manage') && (
            <Button variant="primary" icon={<ClipboardList size={16} />} kbd="Alt+N" onClick={() => navigate('/purchases/orders/new')}>
              New order
            </Button>
          )
        }
      />
      <StatGrid>
        <Stat label="Orders" value={t?.count ?? 0} hint={describeRange(range)} />
        <Stat label="Waiting for goods" value={formatINR(t?.openValue ?? 0)} hint={countText(t?.open ?? 0, 'open order')} tone={t?.open ? 'amber' : undefined} />
      </StatGrid>
      <Card padded={false} className="list-card">
        <div className="tab-toolbar">
          <Toolbar>
            <DateRangePicker value={range} onChange={setRange} />
            <SearchInput value={q} onChange={setQ} placeholder="Order no, supplier…" />
            <Select<Status | ''>
              value={status}
              onChange={setStatus}
              aria-label="Status"
              style={{ width: 140 }}
              options={[
                { value: '', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'received', label: 'Received' },
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
            onRowClick={(r) => navigate(`/purchases/orders/${r.id}`)}
            rowClassName={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
            empty={dq || status ? 'No orders match your filters' : `No purchase orders between ${describeRange(range)}`}
          />
        )}
      </Card>
    </Page>
  );
}

/* ------------------------------ New / edit ------------------------------ */

interface FormState {
  date: string;
  expectedDate: string;
  supplier: SupplierOption | null;
  lines: DocLine[];
  remarks: string;
}

export function PurchaseOrderFormPage() {
  const id = Number(useParams().id) || null;
  const existing = useQuery('purchaseOrders.get', id ? { id } : null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    if (!id) {
      const date = todayISO();
      setInitial({ date, expectedDate: addDays(date, 7), supplier: null, lines: [blankDocLine()], remarks: '' });
      return;
    }
    const o = existing.data;
    if (!o) return;
    call('suppliers.get', { id: o.supplierId })
      .then((s) =>
        setInitial({
          date: o.date,
          expectedDate: o.expectedDate ?? '',
          supplier: { id: s.id, name: s.name, phone: s.phone, payable: s.payable, gstin: s.gstin, stateCode: s.stateCode },
          lines: [...o.items.map((i) => docLine({ itemId: i.itemId, name: i.description, unit: i.unit ?? '', qty: i.qty, rate: i.rate })), blankDocLine()],
          remarks: o.remarks ?? '',
        }),
      )
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, [id, existing.data, initial]);

  const error = existing.error ?? loadError;
  if (error) {
    return (
      <Page>
        <PageHeader title="Purchase order" back="/purchases/orders" />
        <ErrorBox error={error} />
      </Page>
    );
  }
  if (!initial) return <Loading />;
  if (existing.data && existing.data.status !== 'open') {
    return (
      <Page>
        <PageHeader title={`Purchase order ${existing.data.poNo}`} back={`/purchases/orders/${existing.data.id}`} />
        <Alert tone="amber">Only open orders can be edited.</Alert>
      </Page>
    );
  }
  return <OrderEditor initial={initial} existing={existing.data ?? null} />;
}

function OrderEditor({ initial, existing }: { initial: FormState; existing: Order | null }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [s, setS] = useState<FormState>(initial);
  const [dirty, setDirty] = useState(false);
  const create = useMutation('purchaseOrders.create');
  const update = useMutation('purchaseOrders.update');
  const m = existing ? update : create;
  useUnsavedWarning(dirty);
  const patch = (p: Partial<FormState>) => {
    setS((x) => ({ ...x, ...p }));
    setDirty(true);
  };
  const filled = filledLines(s.lines);
  const total = filled.reduce((sum, l) => sum + docLineAmount(l), 0);
  const problem = !s.supplier ? 'Choose the supplier' : !filled.length ? 'Add at least one item' : filled.some((l) => !l.qty) ? 'Enter the quantity of every item' : null;

  const search = async (q: string): Promise<LineSuggestion[]> => {
    const found = await call('purchases.descriptions', { q, supplierId: s.supplier?.id ?? null, limit: 12 });
    return found.map((d) => ({ itemId: d.itemId, name: d.description, unit: d.unit, rate: d.rate, hint: d.lastDate ? `last bought ${formatDate(d.lastDate)}` : undefined }));
  };

  const save = async () => {
    if (problem || m.loading) {
      if (problem) toast.warning(problem);
      return;
    }
    const input = {
      date: s.date,
      expectedDate: s.expectedDate || null,
      supplierId: s.supplier!.id,
      items: filled.map((l) => ({ itemId: l.itemId, description: l.name.trim(), unit: l.unit.trim() || null, qty: l.qty!, rate: l.rate ?? 0 })),
      remarks: s.remarks.trim() || null,
    };
    try {
      const saved = existing ? await update.run({ id: existing.id, ...input }) : await create.run(input);
      setDirty(false);
      toast.success(`${existing ? 'Updated' : 'Saved'} purchase order ${saved.poNo} · ${formatINR(saved.total)}`);
      navigate(`/purchases/orders/${saved.id}`);
    } catch {
      /* shown below */
    }
  };
  useHotkeys({ 'ctrl+s': () => void save(), F9: () => void save() });

  return (
    <Page wide>
      <PageHeader title={existing ? `Edit purchase order ${existing.poNo}` : 'New purchase order'} back={existing ? `/purchases/orders/${existing.id}` : '/purchases/orders'} />
      <div className="stack">
        <Card>
          <FormGrid cols={3}>
            <Field label="Supplier" required error={m.fields.supplierId}>
              <SupplierPicker value={s.supplier} onChange={(v) => patch({ supplier: v })} autoFocus={!existing} />
            </Field>
            <Field label="Order date">
              <DateInput value={s.date} onChange={(v) => patch({ date: v })} max={todayISO()} />
            </Field>
            <Field label="Expected delivery" error={m.fields.expectedDate}>
              <DateInput value={s.expectedDate} onChange={(v) => patch({ expectedDate: v })} min={s.date} />
            </Field>
          </FormGrid>
        </Card>
        <Card title="Items">
          <DocLinesEditor lines={s.lines} onChange={(lines) => patch({ lines })} search={search} errors={m.fields} />
          <div className="row mt-1" style={{ justifyContent: 'flex-end' }}>
            <span className="bold">Total {formatINR(total)}</span>
          </div>
        </Card>
        <Card>
          <Field label="Remarks / terms">
            <TextArea rows={2} value={s.remarks} maxLength={500} onChange={(e) => patch({ remarks: e.target.value })} placeholder="e.g. Deliver to the back gate" />
          </Field>
        </Card>
        {m.error && <Alert tone="red">{m.error}</Alert>}
        <div className="row">
          <Button variant="primary" loading={m.loading} disabled={!!problem} kbd="Ctrl+S" onClick={() => void save()}>
            {existing ? 'Save changes' : 'Save order'}
          </Button>
          <Button variant="ghost" onClick={() => navigate(existing ? `/purchases/orders/${existing.id}` : '/purchases/orders')}>
            Cancel
          </Button>
          {problem && <span className="muted small">{problem}</span>}
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------ Detail ------------------------------ */

export function PurchaseOrderDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const dialogs = useDialogs();
  const valid = Number.isInteger(id) && id > 0;
  const q = useQuery('purchaseOrders.get', valid ? { id } : null);
  const preview = useQuery('purchaseOrders.html', valid ? { id } : null);
  const [printing, setPrinting] = useState(false);
  const d = q.data;

  const print = async () => {
    if (!d) return;
    setPrinting(true);
    try {
      const res = await call('purchaseOrders.print', { id: d.id });
      if (!res.printed) toast.warning(res.message);
    } catch (e) {
      toast.error(e);
    } finally {
      setPrinting(false);
    }
  };
  useHotkeys({ 'ctrl+p': () => void print() }, [d?.id]);

  if (!valid) return <Page><ErrorBox error="This order link is not valid." /></Page>;
  if (q.error) return <Page><PageHeader title="Purchase order" back="/purchases/orders" /><ErrorBox error={q.error} onRetry={q.reload} /></Page>;
  if (!d) return <Loading />;

  const open = d.status === 'open';
  const cancel = async () => {
    const reason = await dialogs.prompt({ title: `Cancel order ${d.poNo}?`, label: 'Reason', placeholder: 'e.g. supplier cannot deliver', required: true, confirmText: 'Cancel order', danger: true });
    if (!reason) return;
    try {
      await call('purchaseOrders.cancel', { id: d.id, reason });
      toast.success(`Order ${d.poNo} cancelled`);
      void q.reload();
      void preview.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Page>
      <PageHeader
        back="/purchases/orders"
        title={
          <span className="row">
            Purchase order {d.poNo} <StatusBadge status={d.status} />
          </span>
        }
        subtitle={
          <>
            {formatDate(d.date)} · to <Link to={`/suppliers/${d.supplierId}`}>{d.supplierName}</Link>
          </>
        }
        actions={
          <>
            <Button icon={<Printer size={16} />} kbd="Ctrl+P" loading={printing} onClick={print}>
              Print
            </Button>
            {open && can('purchases.manage') && (
              <>
                <Button variant="primary" icon={<PackageCheck size={16} />} onClick={() => navigate(`/purchases/new?po=${d.id}`)}>
                  Goods received: enter bill
                </Button>
                <Button icon={<Pencil size={16} />} onClick={() => navigate(`/purchases/orders/${d.id}/edit`)}>
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
      {d.status === 'received' && d.purchaseId && (
        <Alert tone="green">
          Received as purchase bill <Link to={`/purchases/${d.purchaseId}`}>{d.purchaseNo}</Link>.
        </Alert>
      )}
      {d.status === 'cancelled' && (
        <Alert tone="red" title={`Cancelled on ${formatDateTime(d.cancelledAt)}`}>
          Reason: {d.cancelReason}
        </Alert>
      )}
      <div className="detail-grid">
        <div className="stack">
          <Card title="Details">
            <KeyValues
              columns={3}
              items={[
                ['Supplier', <Link to={`/suppliers/${d.supplierId}`}>{d.supplierName}</Link>],
                ['Phone', d.supplierPhone],
                ['Order date', formatDate(d.date)],
                ['Expected', d.expectedDate ? formatDate(d.expectedDate) : null],
                ['Total', <Money value={d.total} className="bold" />],
                ['Remarks', d.remarks],
                ['Made by', `${d.createdBy ?? '—'} · ${formatDateTime(d.createdAt)}`],
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
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.lineNo}>
                      <td>{i.description}</td>
                      <td className="num">
                        {formatQty(i.qty)} {i.unit}
                      </td>
                      <td className="num">{formatINR(i.rate)}</td>
                      <td className="num">{formatINR(i.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="bold">
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
