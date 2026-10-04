import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, Printer, Undo2 } from 'lucide-react';
import { Alert, Badge, Button, Card, ErrorBox, KeyValues, Loading, Money, Page, PageHeader, Stat, StatGrid, Toolbar } from '../../components/ui';
import { Checkbox, DateInput, Field, FormGrid, NumberInput, SearchInput, SegmentedControl, TextArea, TextInput } from '../../components/forms';
import { DataTable, type Column } from '../../components/table';
import { DateRangePicker } from '../../components/report';
import { ReceiptPreview } from '../../components/pickers';
import { useDebounced, useHotkeys, useMutation, useQuery } from '../../hooks';
import { useAuth } from '../../auth';
import { useDialogs, useToast, useUnsavedWarning } from '../../feedback';
import { call, type ApiOutput } from '../../api';
import { formatINR, formatQty } from '../../../shared/money';
import { describeRange, formatDate, formatDateTime, todayISO } from '../../../shared/dates';
import { CancelledBadge, PostingTable, countText, useRange } from '../customers/common';

type Row = ApiOutput<'purchaseReturns.list'>['rows'][number];
type Settlement = Row['settlement'];

const SETTLEMENT_LABEL: Record<Settlement, string> = {
  adjust: 'Less to pay',
  cash: 'Cash refund',
  upi: 'UPI refund',
  bank: 'Bank refund',
};

/* ------------------------------ List ------------------------------ */

export function PurchaseReturnsListPage() {
  const navigate = useNavigate();
  const [range, setRange] = useRange('purchaseReturns.range', 'this_month');
  const [q, setQ] = useState('');
  const [showCancelled, setShowCancelled] = useState(true);
  const dq = useDebounced(q, 200);
  const list = useQuery('purchaseReturns.list', { from: range.from, to: range.to, q: dq || null, status: showCancelled ? null : 'active' });
  const t = list.data?.totals;

  const columns: Array<Column<Row>> = [
    { key: 'date', label: 'Date', type: 'date', width: 110 },
    { key: 'returnNo', label: 'Debit note', render: (r) => <span className="bold">{r.returnNo}</span> },
    { key: 'supplierName', label: 'Supplier', render: (r) => r.supplierName ?? <span className="faint">Cash purchase</span> },
    { key: 'purchaseNo', label: 'Purchase bill' },
    { key: 'settlement', label: 'Settled by', render: (r) => (r.status === 'cancelled' ? <CancelledBadge /> : <Badge>{SETTLEMENT_LABEL[r.settlement]}</Badge>) },
    { key: 'total', label: 'Amount', type: 'money' },
  ];

  return (
    <Page>
      <PageHeader title="Purchase returns" subtitle="Goods sent back to suppliers (debit notes). Start a return from the purchase bill: open it and choose “Return goods”." />
      <StatGrid>
        <Stat label="Returned" value={formatINR(t?.total ?? 0)} hint={`${countText(t?.count ?? 0, 'debit note')} · ${describeRange(range)}`} />
      </StatGrid>
      <Card padded={false} className="list-card">
        <div className="tab-toolbar">
          <Toolbar>
            <DateRangePicker value={range} onChange={setRange} />
            <SearchInput value={q} onChange={setQ} placeholder="Debit note, supplier, purchase no…" />
            <Checkbox checked={showCancelled} onChange={setShowCancelled} label="Show cancelled" />
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
            onRowClick={(r) => navigate(`/purchases/returns/${r.id}`)}
            rowClassName={(r) => (r.status === 'cancelled' ? 'cancelled' : '')}
            empty={dq ? 'No returns match your search' : `No goods returned between ${describeRange(range)}`}
          />
        )}
      </Card>
    </Page>
  );
}

/* ------------------------------ New return (from a purchase) ------------------------------ */

export function PurchaseReturnNewPage() {
  const purchaseId = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const valid = Number.isInteger(purchaseId) && purchaseId > 0;
  const info = useQuery('purchaseReturns.returnable', valid ? { purchaseId } : null);
  const create = useMutation('purchaseReturns.create');
  const [qty, setQty] = useState<Record<number, number | null>>({});
  const [date, setDate] = useState(todayISO());
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const dirty = Object.values(qty).some((v) => v);
  useUnsavedWarning(dirty && !create.loading);

  if (!valid) return <Page><ErrorBox error="This purchase link is not valid." /></Page>;
  if (info.error) return <Page><PageHeader title="Return goods" back={`/purchases/${purchaseId}`} /><ErrorBox error={info.error} onRetry={info.reload} /></Page>;
  const d = info.data;
  if (!d) return <Loading />;

  const mode: Settlement = settlement ?? (d.canAdjust ? 'adjust' : 'cash');
  const chosen = d.lines.filter((l) => (qty[l.lineNo] ?? 0) > 0);
  const estimate = chosen.reduce((s, l) => s + Math.round(l.unitValue * (qty[l.lineNo] ?? 0)), 0);
  const tooMuch = d.lines.find((l) => (qty[l.lineNo] ?? 0) > l.returnableQty + 1e-9);
  const problem = d.status !== 'active' ? 'This purchase is cancelled' : !chosen.length ? 'Enter the quantity returned' : tooMuch ? `At most ${formatQty(tooMuch.returnableQty)} of ${tooMuch.description} can be returned` : null;

  const save = async () => {
    if (problem || create.loading) return;
    try {
      const saved = await create.run({
        purchaseId: d.purchaseId,
        date,
        items: chosen.map((l) => ({ lineNo: l.lineNo, qty: qty[l.lineNo]! })),
        settlement: mode,
        reference: reference.trim() || null,
        remarks: remarks.trim() || null,
      });
      toast.success(`Debit note ${saved.returnNo} saved · ${formatINR(saved.total)}`);
      navigate(`/purchases/returns/${saved.id}`, { replace: true });
    } catch {
      /* shown below */
    }
  };

  return (
    <Page>
      <PageHeader title={`Return goods · purchase ${d.purchaseNo}`} subtitle={`${formatDate(d.date)}${d.supplierName ? ` · ${d.supplierName}` : ''}`} back={`/purchases/${d.purchaseId}`} />
      <div className="stack">
        <Card title="What is going back" padded={false}>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Bought</th>
                  <th className="num">Returned before</th>
                  <th className="num" style={{ width: 140 }}>
                    Return now
                  </th>
                  <th className="num">Value (about)</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.lineNo}>
                    <td>{l.description}</td>
                    <td className="num">
                      {formatQty(l.qty)} {l.unit}
                    </td>
                    <td className="num">{l.returnedQty ? formatQty(l.returnedQty) : ''}</td>
                    <td>
                      {l.returnableQty > 0 ? (
                        <NumberInput value={qty[l.lineNo] ?? null} onChange={(v) => setQty((x) => ({ ...x, [l.lineNo]: v }))} aria-label={`Quantity of ${l.description} returned`} placeholder={`max ${formatQty(l.returnableQty)}`} />
                      ) : (
                        <span className="faint">all returned</span>
                      )}
                    </td>
                    <td className="num">{qty[l.lineNo] ? formatINR(Math.round(l.unitValue * (qty[l.lineNo] ?? 0))) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <FormGrid>
            <Field label="Date">
              <DateInput value={date} onChange={setDate} min={d.date} max={todayISO()} />
            </Field>
            <Field label="How it is settled" hint={mode === 'adjust' ? 'You will owe the supplier this much less' : 'The supplier gave the money back'}>
              <SegmentedControl<Settlement>
                value={mode}
                onChange={setSettlement}
                options={[...(d.canAdjust ? [{ value: 'adjust' as const, label: 'Less to pay' }] : []), { value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'bank', label: 'Bank' }]}
              />
            </Field>
            {mode !== 'adjust' && mode !== 'cash' && (
              <Field label={mode === 'upi' ? 'UPI transaction ID' : 'Cheque / UTR number'}>
                <TextInput value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
              </Field>
            )}
          </FormGrid>
          <Field label="Remarks">
            <TextArea rows={2} value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. damaged in transit" />
          </Field>
        </Card>
        {create.error && <Alert tone="red">{create.error}</Alert>}
        <div className="row">
          <Button variant="primary" icon={<Undo2 size={16} />} loading={create.loading} disabled={!!problem} onClick={() => void save()}>
            Save return{estimate ? ` · about ${formatINR(estimate)}` : ''}
          </Button>
          <Button variant="ghost" onClick={() => navigate(`/purchases/${d.purchaseId}`)}>
            Cancel
          </Button>
          {problem && chosen.length > 0 && <span className="muted small">{problem}</span>}
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------ Detail ------------------------------ */

export function PurchaseReturnDetailPage() {
  const id = Number(useParams().id);
  const { can } = useAuth();
  const toast = useToast();
  const dialogs = useDialogs();
  const valid = Number.isInteger(id) && id > 0;
  const q = useQuery('purchaseReturns.get', valid ? { id } : null);
  const preview = useQuery('purchaseReturns.html', valid ? { id } : null);
  const [printing, setPrinting] = useState(false);
  const d = q.data;

  const print = async () => {
    if (!d) return;
    setPrinting(true);
    try {
      const res = await call('purchaseReturns.print', { id: d.id });
      if (!res.printed) toast.warning(res.message);
    } catch (e) {
      toast.error(e);
    } finally {
      setPrinting(false);
    }
  };
  useHotkeys({ 'ctrl+p': () => void print() }, [d?.id]);

  if (!valid) return <Page><ErrorBox error="This link is not valid." /></Page>;
  if (q.error) return <Page><PageHeader title="Purchase return" back="/purchases/returns" /><ErrorBox error={q.error} onRetry={q.reload} /></Page>;
  if (!d) return <Loading />;

  const active = d.status === 'active';
  const cancel = async () => {
    const reason = await dialogs.prompt({
      title: `Cancel debit note ${d.returnNo}?`,
      message: 'The goods count as yours again and the amount is taken back out of the accounts.',
      label: 'Reason',
      required: true,
      confirmText: 'Cancel return',
      danger: true,
    });
    if (!reason) return;
    try {
      await call('purchaseReturns.cancel', { id: d.id, reason });
      toast.success(`Debit note ${d.returnNo} cancelled`);
      void q.reload();
      void preview.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  const tax = d.cgst + d.sgst + d.igst;
  return (
    <Page>
      <PageHeader
        back="/purchases/returns"
        title={
          <span className="row">
            Debit note {d.returnNo}
            {!active && <CancelledBadge />}
          </span>
        }
        subtitle={
          <>
            {formatDate(d.date)} · against purchase <Link to={`/purchases/${d.purchaseId}`}>{d.purchaseNo}</Link>
          </>
        }
        actions={
          <>
            <Button icon={<Printer size={16} />} kbd="Ctrl+P" loading={printing} onClick={print}>
              Print
            </Button>
            {active && can('purchases.manage') && (
              <Button variant="ghost" icon={<Ban size={16} />} onClick={cancel}>
                Cancel return
              </Button>
            )}
          </>
        }
      />
      {!active && (
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
                ['Supplier', d.supplierId ? <Link to={`/suppliers/${d.supplierId}`}>{d.supplierName}</Link> : (d.supplierName ?? 'Cash purchase')],
                ['Purchase bill', <Link to={`/purchases/${d.purchaseId}`}>{d.purchaseNo}</Link>],
                ['Date', formatDate(d.date)],
                ['Settled by', SETTLEMENT_LABEL[d.settlement]],
                ['Refund account', d.accountName],
                ['Reference', d.reference],
                ['Value of goods', <Money value={d.value} />],
                tax ? ['Input tax given back', <Money value={tax} />] : null,
                ['Total', <Money value={d.total} className="bold" />],
                ['Remarks', d.remarks],
                ['Entered by', `${d.createdBy ?? '—'} · ${formatDateTime(d.createdAt)}`],
              ]}
            />
          </Card>
          <Card title="Goods returned" padded={false}>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Qty</th>
                    <th className="num">Value</th>
                    <th className="num">GST</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.lineNo}>
                      <td>{i.description}</td>
                      <td className="num">
                        {formatQty(i.qty)} {i.unit}
                      </td>
                      <td className="num">{formatINR(i.value)}</td>
                      <td className="num">{i.cgst + i.sgst + i.igst ? formatINR(i.cgst + i.sgst + i.igst) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="How this is recorded in your accounts">
            <PostingTable lines={d.posting} voided={!active} />
          </Card>
        </div>
        <Card title="Debit note">
          <ReceiptPreview html={preview.data?.html} widthMm={preview.data?.paperWidth} height={480} />
        </Card>
      </div>
    </Page>
  );
}
