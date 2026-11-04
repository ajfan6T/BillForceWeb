import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowDownCircle, ArrowUpCircle, Handshake, Pencil, Plus, Receipt } from 'lucide-react';
import { Alert, Badge, Button, Card, EmptyState, ErrorBox, Loading, Page, PageHeader, Stat, StatGrid, Toolbar } from '../../components/ui';
import { Checkbox, DateInput, Field, FormGrid, MoneyInput, NumberInput, SegmentedControl, TextArea, TextInput } from '../../components/forms';
import { SettlementPicker } from '../../components/pickers';
import { DataTable, type Column } from '../../components/table';
import { DateRangePicker, ExportButtons, ReportView } from '../../components/report';
import { Modal } from '../../components/modal';
import { useMutation, useQuery } from '../../hooks';
import { useAuth } from '../../auth';
import { useToast } from '../../feedback';
import { useOpenLink } from '../../links';
import type { ApiOutput } from '../../api';
import { formatINR } from '../../../shared/money';
import { formatDate, todayISO } from '../../../shared/dates';
import type { SettlementMode } from '../../../shared/constants';
import { FieldGroup, useRange } from './common';
import { PaymentBalanceHint, useShortfallConfirm } from './PaymentBalance';
import './accounts.css';

type Overview = ApiOutput<'partners.list'>;
type PartnerSummary = Overview['partners'][number];
type Settle = { mode: SettlementMode; accountId: number | null };

const pct = (v: number) => `${Math.round(v * 100) / 100}%`;
const money = (v: number) => <span className="money">{formatINR(v)}</span>;

/** Accounts > Partners: every partner's money in a partnership business. */
export function PartnersPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const q = useQuery('partners.list', undefined);
  const [editing, setEditing] = useState<PartnerSummary | 'new' | null>(null);
  const o = q.data;
  const active = o?.partners.filter((p) => p.isActive) ?? [];
  const canManage = can('accounts.manage');

  const columns: Array<Column<PartnerSummary>> = [
    {
      key: 'name',
      label: 'Partner',
      render: (p) => (
        <div>
          <span className="ac-strong">{p.name}</span> {!p.isActive && <Badge>Left</Badge>}
          {p.phone && <span className="ac-sub">{p.phone}</span>}
        </div>
      ),
    },
    { key: 'sharePct', label: 'Profit share', align: 'right', width: 110, render: (p) => pct(p.sharePct) },
    { key: 'invested', label: 'Invested', type: 'money', value: (p) => p.totals.invested, width: 130 },
    { key: 'paid', label: 'Paid for business', type: 'money', value: (p) => p.totals.paidForBusiness, width: 150 },
    { key: 'withdrawn', label: 'Taken out', type: 'money', value: (p) => p.totals.withdrawn, width: 130 },
    { key: 'profit', label: 'Profit share added', type: 'money', value: (p) => p.totals.profitShare, width: 150 },
    { key: 'balance', label: 'Balance', type: 'money', value: (p) => p.totals.balance, width: 140 },
  ];

  return (
    <Page wide>
      <PageHeader
        title="Partners"
        subtitle="Each partner's money in the business: what they invested, paid from their own pocket and took out"
        actions={
          canManage && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Add partner
            </Button>
          )
        }
      />
      {q.error ? (
        <ErrorBox error={q.error} onRetry={q.reload} />
      ) : !o ? (
        <Loading />
      ) : !o.partners.length ? (
        <Card>
          <EmptyState
            icon={<Handshake size={34} />}
            title="Running the business with partners?"
            message="Add each partner with their share of the profit. BILLFORCE keeps an account for every partner: the money they invest, expenses they pay from their own pocket, what they take out, and their share of the profit when the year is closed."
            action={
              canManage && (
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
                  Add the first partner
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="stack">
          {active.length > 0 && Math.abs(o.totalShare - 100) > 0.005 && (
            <Alert tone="amber" title={`The profit shares add up to ${pct(o.totalShare)}`}>
              Make them 100% so the year's profit can be shared among the partners when the year is closed.
            </Alert>
          )}
          <StatGrid>
            <Stat label="Invested" value={money(o.totals.invested)} hint="Money the partners brought in" />
            <Stat label="Paid for the business" value={money(o.totals.paidForBusiness)} hint="Expenses paid from their own pocket" />
            <Stat label="Taken out" value={money(o.totals.withdrawn)} tone={o.totals.withdrawn ? 'amber' : undefined} hint="Withdrawals and repayments" />
            <Stat label="Owed to partners" value={money(o.totals.balance)} tone="blue" hint="Their capital in the business" />
            <Stat
              label={`Profit ${o.year.name} so far`}
              value={money(o.year.profit)}
              tone={o.year.profit < 0 ? 'red' : 'green'}
              hint="Shared at year-end closing"
            />
          </StatGrid>
          <Card padded={false} className="ac-list-card">
            <DataTable
              columns={columns}
              rows={o.partners}
              rowKey={(p) => p.id}
              onRowClick={(p) => navigate(`/accounts/partners/${p.id}`)}
              rowClassName={(p) => (p.isActive ? '' : 'cancelled')}
              footer={{
                name: `${o.partners.length} ${o.partners.length === 1 ? 'partner' : 'partners'}`,
                sharePct: pct(o.totalShare),
                invested: money(o.totals.invested),
                paid: money(o.totals.paidForBusiness),
                withdrawn: money(o.totals.withdrawn),
                profit: money(o.totals.profitShare),
                balance: money(o.totals.balance),
              }}
            />
          </Card>
          <p className="small muted mt-0">
            Balance = invested + paid for the business + share of profit − taken out: what the business owes each partner. Each partner has a capital and a
            drawings account in the chart of accounts, and the balance sheet shows each partner's capital.
          </p>
        </div>
      )}
      {editing && (
        <PartnerModal
          partner={editing === 'new' ? null : editing}
          otherShares={(o?.partners ?? []).filter((p) => p.isActive && (editing === 'new' || p.id !== editing.id)).reduce((s, p) => s + p.sharePct, 0)}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setEditing(null);
            void q.reload();
            if (editing === 'new') navigate(`/accounts/partners/${id}`);
          }}
        />
      )}
    </Page>
  );
}

/** One partner: totals, investments, withdrawals and the account statement. */
export function PartnerDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { can } = useAuth();
  const openLink = useOpenLink();
  const q = useQuery('partners.get', { id });
  const all = useQuery('partners.list', undefined);
  const [range, setRange] = useRange('partner.range', 'this_fy');
  const statement = useQuery('partners.statement', { id, from: range.from, to: range.to });
  const [editing, setEditing] = useState(false);
  const p = q.data;
  const reload = () => {
    void q.reload();
    void statement.reload();
    void all.reload();
  };
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!p) return <Loading />;
  const t = p.totals;
  const canManage = can('accounts.manage');
  return (
    <Page wide>
      <PageHeader
        back="/accounts/partners"
        title={
          <span className="row" style={{ gap: 10 }}>
            {p.name} <Badge tone="blue">{pct(p.sharePct)} share</Badge> {!p.isActive && <Badge>Left the business</Badge>}
          </span>
        }
        subtitle={[p.phone, p.joinedOn ? `Partner since ${formatDate(p.joinedOn)}` : null, p.email].filter(Boolean).join(' · ') || 'Partner'}
        actions={
          <>
            {p.isActive && can('expenses.manage') && (
              <Button icon={<Receipt size={16} />} onClick={() => navigate(`/accounts/expenses?partner=${p.id}`)} title={`Record an expense ${p.name} paid from their own money`}>
                Expense paid by {p.name}
              </Button>
            )}
            {canManage && (
              <Button icon={<Pencil size={15} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <ExportButtons report={statement.data} />
          </>
        }
      />
      <StatGrid>
        <Stat label="Invested" value={money(t.invested)} />
        <Stat label="Paid for the business" value={money(t.paidForBusiness)} hint="From their own money" />
        <Stat label="Taken out" value={money(t.withdrawn)} tone={t.withdrawn ? 'amber' : undefined} />
        <Stat label="Share of profit" value={money(t.profitShare)} hint="Added at year-end closing" tone={t.profitShare < 0 ? 'red' : undefined} />
        <Stat label="Balance (owed to partner)" value={money(t.balance)} tone="blue" hint={p.yearShare ? `+ ${formatINR(p.yearShare)} share of this year's profit so far` : undefined} />
      </StatGrid>
      {canManage && p.isActive && (
        <div className="ac-split-even" style={{ marginTop: 16 }}>
          <InvestCard partnerId={p.id} name={p.name} onSaved={reload} />
          <WithdrawCard partnerId={p.id} name={p.name} onSaved={reload} />
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <Card title={`${p.name}'s account`} padded={false} className="ac-list-card ac-stmt">
          <div className="ac-filters">
            <Toolbar>
              <DateRangePicker value={range} onChange={setRange} />
            </Toolbar>
          </div>
          <ReportView report={statement.data} loading={statement.loading} error={statement.error} onRetry={statement.reload} onLink={openLink} hideTitle />
        </Card>
      </div>
      {editing && (
        <PartnerModal
          partner={p}
          otherShares={(all.data?.partners ?? []).filter((x) => x.isActive && x.id !== p.id).reduce((s, x) => s + x.sharePct, 0)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </Page>
  );
}

function InvestCard({ partnerId, name, onSaved }: { partnerId: number; name: string; onSaved: () => void }) {
  const toast = useToast();
  const m = useMutation('partners.invest');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState<number | null>(null);
  const [pay, setPay] = useState<Settle>({ mode: 'cash', accountId: null });
  const [narration, setNarration] = useState('');
  const save = async () => {
    if (!amount || m.loading) return;
    try {
      const e = await m.run({ partnerId, date, amount, mode: pay.mode, accountId: pay.accountId, narration: narration.trim() || null });
      toast.success(`${name} invested ${formatINR(amount)} (${e.voucherNo})`);
      setAmount(null);
      setNarration('');
      onSaved();
    } catch {
      /* shown below */
    }
  };
  return (
    <Card
      title={
        <span className="row">
          <ArrowDownCircle size={17} className="pos" /> Record investment
        </span>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="small muted mt-0">{name} brings money into the business (cash in the till, or into the bank or UPI account).</p>
        <div className="ac-quick-pair" style={{ gridTemplateColumns: '160px minmax(0, 1fr)' }}>
          <Field label="Date" required>
            <DateInput value={date} max={todayISO()} onChange={setDate} />
          </Field>
          <Field label="Amount" required error={m.fields.amount}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        </div>
        <FieldGroup label="Received into">
          <SettlementPicker value={pay} onChange={setPay} />
        </FieldGroup>
        <Field label="Narration">
          <TextInput value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={`Capital invested by ${name}`} maxLength={500} />
        </Field>
        {m.error && <Alert tone="red">{m.error}</Alert>}
        <div className="row-between">
          <span className="small faint">Dr {pay.mode === 'cash' ? 'Cash' : 'Bank / UPI'} · Cr {name} - Capital</span>
          <Button type="submit" variant="primary" loading={m.loading} disabled={!amount}>
            Save investment
          </Button>
        </div>
      </form>
    </Card>
  );
}

function WithdrawCard({ partnerId, name, onSaved }: { partnerId: number; name: string; onSaved: () => void }) {
  const toast = useToast();
  const m = useMutation('partners.withdraw');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<'money' | 'goods'>('money');
  const [pay, setPay] = useState<Settle>({ mode: 'cash', accountId: null });
  const [narration, setNarration] = useState('');
  const confirmShortfall = useShortfallConfirm();
  const payment = kind === 'money' ? { mode: pay.mode, accountId: pay.accountId, amount, date } : null;
  const save = async () => {
    if (!amount || m.loading) return;
    const accepted = await confirmShortfall(payment);
    if (!accepted) return;
    try {
      const e = await m.run({
        partnerId,
        date,
        amount,
        goods: kind === 'goods',
        mode: kind === 'money' ? pay.mode : null,
        accountId: kind === 'money' ? pay.accountId : null,
        narration: narration.trim() || null,
      });
      toast.success(`${name} took out ${formatINR(amount)} (${e.voucherNo})`);
      for (const w of e.warnings) if (!accepted.includes(w)) toast.warning(w);
      setAmount(null);
      setNarration('');
      onSaved();
    } catch {
      /* shown below */
    }
  };
  return (
    <Card
      title={
        <span className="row">
          <ArrowUpCircle size={17} className="neg" /> Record withdrawal
        </span>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="small muted mt-0">{name} takes money or goods out of the business, or the business pays back money {name} spent.</p>
        <div className="ac-quick-pair" style={{ gridTemplateColumns: '160px minmax(0, 1fr)' }}>
          <Field label="Date" required>
            <DateInput value={date} max={todayISO()} onChange={setDate} />
          </Field>
          <Field label="Amount" required error={m.fields.amount}>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        </div>
        <FieldGroup label="What was taken">
          <SegmentedControl<'money' | 'goods'>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'money', label: 'Money' },
              { value: 'goods', label: 'Goods from the shop' },
            ]}
          />
        </FieldGroup>
        {kind === 'money' ? (
          <FieldGroup label="Taken from">
            <SettlementPicker value={pay} onChange={setPay} />
            <PaymentBalanceHint payment={payment} />
          </FieldGroup>
        ) : (
          <div className="small muted">Enter the cost price of the goods. It is taken out of Purchases so your profit is not overstated.</div>
        )}
        <Field label="Narration">
          <TextInput value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={kind === 'goods' ? `Goods taken by ${name}` : `Money taken by ${name}`} maxLength={500} />
        </Field>
        {m.error && <Alert tone="red">{m.error}</Alert>}
        <div className="row-between">
          <span className="small faint">Dr {name} - Drawings · Cr {kind === 'goods' ? 'Purchases' : pay.mode === 'cash' ? 'Cash' : 'Bank / UPI'}</span>
          <Button type="submit" variant="primary" loading={m.loading} disabled={!amount}>
            Save withdrawal
          </Button>
        </div>
      </form>
    </Card>
  );
}

function PartnerModal({
  partner,
  otherShares,
  onClose,
  onSaved,
}: {
  partner: { id: number; name: string; phone: string | null; email: string | null; address: string | null; notes: string | null; sharePct: number; joinedOn: string | null; isActive: boolean } | null;
  /** Profit shares of the other active partners. */
  otherShares: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const create = useMutation('partners.create');
  const update = useMutation('partners.update');
  const m = partner ? update : create;
  const left = Math.max(0, Math.round((100 - otherShares) * 100) / 100);
  const [name, setName] = useState(partner?.name ?? '');
  const [phone, setPhone] = useState(partner?.phone ?? '');
  const [email, setEmail] = useState(partner?.email ?? '');
  const [share, setShare] = useState<number | null>(partner ? partner.sharePct : left);
  const [joinedOn, setJoinedOn] = useState(partner?.joinedOn ?? '');
  const [address, setAddress] = useState(partner?.address ?? '');
  const [notes, setNotes] = useState(partner?.notes ?? '');
  const [active, setActive] = useState(partner?.isActive ?? true);
  const tooMuch = active && (share ?? 0) > left + 0.005;
  const save = async () => {
    if (!name.trim() || share === null || tooMuch || m.loading) return;
    const input = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      sharePct: share,
      joinedOn: joinedOn || null,
      isActive: active,
    };
    try {
      const saved = partner ? await update.run({ id: partner.id, ...input }) : await create.run(input);
      toast.success(partner ? `Saved ${saved.name}` : `Added partner ${saved.name}`);
      onSaved(saved.id);
    } catch {
      /* shown below */
    }
  };
  return (
    <Modal
      open
      title={partner ? `Edit ${partner.name}` : 'Add a partner'}
      onClose={onClose}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={m.loading} disabled={!name.trim() || share === null || tooMuch} onClick={() => void save()}>
            {partner ? 'Save' : 'Add partner'}
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <FormGrid>
          <Field label="Name" required error={m.fields.name}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
          </Field>
          <Field
            label="Share of profit (%)"
            required
            error={m.fields.sharePct ?? (tooMuch ? `At most ${pct(left)}: the other partners have ${pct(otherShares)}` : null)}
            hint={`Other partners: ${pct(otherShares)}. Shared this way at year-end closing.`}
          >
            <NumberInput value={share} decimals={2} onChange={setShare} />
          </Field>
          <Field label="Phone" error={m.fields.phone}>
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} />
          </Field>
          <Field label="Email" error={m.fields.email}>
            <TextInput value={email} type="email" onChange={(e) => setEmail(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Partner since">
            <DateInput value={joinedOn} onChange={setJoinedOn} />
          </Field>
        </FormGrid>
        <Field label="Address">
          <TextArea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Notes" hint="e.g. partnership deed date, interest on capital agreed">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        {partner && (
          <Checkbox
            checked={!active}
            onChange={(v) => setActive(!v)}
            label="This partner has left the business"
            hint="Their account and balance stay; they get no share of profit from now on."
          />
        )}
        {!partner && <p className="small muted mt-0 mb-0">A capital account and a drawings account are added for this partner in the chart of accounts.</p>}
        {m.error && <Alert tone="red">{m.error}</Alert>}
      </form>
    </Modal>
  );
}
