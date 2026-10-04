import { useRef } from 'react';
import { X } from 'lucide-react';
import { Combobox, MoneyInput, NumberInput, TextInput } from './forms';
import { IconButton } from './ui';
import { formatINR, lineAmount, percentOf } from '../../shared/money';

/** One line of a quotation or purchase order being edited. */
export interface DocLine {
  key: number;
  itemId: number | null;
  name: string;
  unit: string;
  qty: number | null;
  /** Paise. */
  rate: number | null;
  /** Quotations: line discount in percent. */
  discountPct?: number | null;
  /** Quotations with GST: the item's rate (null = the usual rate). */
  gstRate?: number | null;
}

/** A suggestion for the item box: an item from the list or something bought before. */
export interface LineSuggestion {
  itemId: number | null;
  name: string;
  unit: string | null;
  rate: number;
  gstRate?: number | null;
  hint?: string;
}

let nextKey = 1;
export const blankDocLine = (): DocLine => ({ key: nextKey++, itemId: null, name: '', unit: '', qty: null, rate: null, discountPct: null, gstRate: null });
export const docLine = (l: Omit<DocLine, 'key'>): DocLine => ({ ...l, key: nextKey++ });

/** Lines with something typed in them (the blank line at the end is left out). */
export const filledLines = (lines: DocLine[]) => lines.filter((l) => l.name.trim());

/** qty x rate less the line discount. */
export function docLineAmount(l: DocLine): number {
  const gross = lineAmount(l.qty ?? 0, l.rate ?? 0);
  return gross - (l.discountPct ? percentOf(gross, Math.min(l.discountPct, 100)) : 0);
}

/**
 * Editable lines: item (type to search), quantity, unit, rate, optional discount %.
 * A blank line is always kept at the end for the next item.
 */
export function DocLinesEditor({
  lines,
  onChange,
  search,
  withDiscount,
  itemsOnly,
  errors,
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  search: (q: string) => Promise<LineSuggestion[]>;
  withDiscount?: boolean;
  /** Only items from the list (the unit comes from the item). */
  itemsOnly?: boolean;
  errors?: Record<string, string>;
}) {
  const qtyRefs = useRef(new Map<number, HTMLInputElement | null>());
  const update = (key: number, patch: Partial<DocLine>) => {
    let next = lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
    if (next[next.length - 1]?.name.trim()) next = [...next, blankDocLine()];
    onChange(next);
  };
  const remove = (key: number) => {
    const next = lines.filter((l) => l.key !== key);
    onChange(next.length ? next : [blankDocLine()]);
  };
  return (
    <div className="table-wrap">
      <table className="table compact">
        <thead>
          <tr>
            <th style={{ width: 36 }}>#</th>
            <th>Item</th>
            <th className="num" style={{ width: 110 }}>
              Qty
            </th>
            <th style={{ width: 90 }}>Unit</th>
            <th className="num" style={{ width: 140 }}>
              Rate
            </th>
            {withDiscount && (
              <th className="num" style={{ width: 90 }}>
                Disc %
              </th>
            )}
            <th className="num" style={{ width: 130 }}>
              Amount
            </th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const err = (f: string) => errors?.[`items.${i}.${f}`];
            const blank = !l.name.trim();
            return (
              <tr key={l.key}>
                <td className="muted">{i + 1}</td>
                <td>
                  <Combobox<LineSuggestion>
                    value={l.name}
                    aria-label={`Item on line ${i + 1}`}
                    placeholder={i === lines.length - 1 ? 'Type to add an item…' : ''}
                    onInputChange={(text) => update(l.key, { name: text, ...(l.itemId ? { itemId: null } : {}) })}
                    loadOptions={search}
                    getKey={(s) => `${s.itemId ?? 'x'}:${s.name}`}
                    renderOption={(s) => (
                      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                        <span>{s.name}</span>
                        <span className="muted small">
                          {formatINR(s.rate)}
                          {s.unit ? ` / ${s.unit}` : ''}
                          {s.hint ? ` · ${s.hint}` : ''}
                        </span>
                      </div>
                    )}
                    onSelect={(s) => {
                      update(l.key, { itemId: s.itemId, name: s.name, unit: s.unit ?? l.unit, rate: s.rate || l.rate, gstRate: s.gstRate ?? null, qty: l.qty ?? 1 });
                      setTimeout(() => qtyRefs.current.get(l.key)?.focus(), 0);
                    }}
                  />
                  {(err('itemName') || err('description') || (itemsOnly && !blank && !l.itemId)) && (
                    <div className="field-error">{err('itemName') || err('description') || 'Choose an item from the list'}</div>
                  )}
                </td>
                <td>
                  <NumberInput ref={(el) => void qtyRefs.current.set(l.key, el)} value={l.qty} onChange={(v) => update(l.key, { qty: v })} aria-label="Quantity" disabled={blank} />
                  {err('qty') && <div className="field-error">{err('qty')}</div>}
                </td>
                <td>
                  <TextInput value={l.unit} maxLength={20} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Unit" disabled={blank || !!l.itemId} />
                </td>
                <td>
                  <MoneyInput value={l.rate} onChange={(v) => update(l.key, { rate: v })} aria-label="Rate" disabled={blank} />
                  {err('rate') && <div className="field-error">{err('rate')}</div>}
                </td>
                {withDiscount && (
                  <td>
                    <NumberInput value={l.discountPct ?? null} decimals={2} onChange={(v) => update(l.key, { discountPct: v === null ? null : Math.min(v, 100) })} aria-label="Discount %" disabled={blank} />
                  </td>
                )}
                <td className="num">{blank ? '' : formatINR(docLineAmount(l))}</td>
                <td>{!blank && <IconButton label="Remove line" icon={<X size={15} />} onClick={() => remove(l.key)} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
