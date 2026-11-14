import { useCallback } from 'react';
import { BROWSER_EDITION, DESKTOP, call } from '../../api';
import { useDialogs, useToast } from '../../feedback';
import { downloadInBrowser } from '../../browserActions';
import { copyPicture, receiptPictures } from '../../receiptImage';
import { whatsappNumberProblem } from '../../../shared/whatsapp';
import { Alert, Badge, Button, LinkButton, type Tone } from '../../components/ui';
import { billPaymentLabel, type BillPaymentMode } from '../../../shared/billing';
import { PAYMENT_MODE_LABELS, type PaymentMode } from '../../../shared/constants';
import { formatQty, parseMoney } from '../../../shared/money';
import './sales.css';

const MODE_TONE: Record<BillPaymentMode, Tone> = { cash: 'green', upi: 'purple', bank: 'blue', credit: 'amber', split: 'neutral' };

/** How a bill was paid; pass the credit part so a part-credit bill reads "Part paid", not "Split". */
export function ModeBadge({ mode, credit = 0 }: { mode: BillPaymentMode; credit?: number }) {
  const partPaid = mode === 'split' && credit > 0;
  return <Badge tone={partPaid ? 'amber' : MODE_TONE[mode]}>{billPaymentLabel(mode, credit)}</Badge>;
}

export function RefundBadge({ mode }: { mode: PaymentMode }) {
  return mode === 'credit' ? <Badge tone="amber">Adjusted in account</Badge> : <Badge tone={MODE_TONE[mode]}>{PAYMENT_MODE_LABELS[mode]} refund</Badge>;
}

export function StatusBadge({ status }: { status: 'active' | 'cancelled' }) {
  return status === 'cancelled' ? <Badge tone="red">Cancelled</Badge> : <Badge tone="green">Active</Badge>;
}

/** A page that could not be opened (not found, not allowed, ...). */
export function LoadError({ title, error, back, backLabel = 'Back', onRetry }: { title: string; error: string; back: string; backLabel?: string; onRetry?: () => void }) {
  return (
    <Alert tone="amber" title={title}>
      {error}
      <div className="row mt-1">
        <LinkButton to={back} size="sm">
          {backLabel}
        </LinkButton>
        {onRetry && (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </Alert>
  );
}

export function qtyUnit(qty: number, unit: string | null | undefined): string {
  return `${formatQty(qty)}${unit ? ` ${unit}` : ''}`;
}

/** Print a bill or a return on the receipt printer with a toast for the result. */
export function usePrintDoc() {
  const toast = useToast();
  return useCallback(
    /** quiet: only tell the user when printing did not work. */
    async (kind: 'bill' | 'return', id: number, opts: { quiet?: boolean } = {}): Promise<boolean> => {
      try {
        const r = kind === 'bill' ? await call('sales.print', { id }) : await call('returns.print', { id });
        if (r.printed) {
          if (!opts.quiet) toast.success(r.message);
        } else toast.warning(r.message);
        return r.printed;
      } catch (e) {
        toast.error(e);
        return false;
      }
    },
    [toast],
  );
}

/** Phones and tablets: a picture on the clipboard cannot be pasted into the WhatsApp app, so it is saved instead. */
const MOBILE = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Online billing (the server reached over https, e.g. billit.billforce.in): bills sent on WhatsApp
 * carry a link the customer opens to see the bill. A shop's own network address is no use to them.
 */
const PUBLIC_BASE =
  !DESKTOP && !BROWSER_EDITION && typeof location !== 'undefined' && location.protocol === 'https:' ? location.origin : null;

/**
 * Send a bill on WhatsApp. A wa.me link can open the customer's chat with a message typed in, but
 * it cannot carry a file. Online, the message has a link to the bill. Otherwise the bill is made
 * into a JPG picture, put on the clipboard (on a computer; saved to Downloads on a phone or when
 * the clipboard is not allowed) and the chat is opened, where Ctrl+V and Send send it.
 */
export function useWhatsappBill() {
  const toast = useToast();
  const dialogs = useDialogs();

  /** Ask for the customer's WhatsApp number (null when cancelled). */
  const askNumber = useCallback(
    (opts: { customerName?: string | null; phone?: string | null } = {}) =>
      dialogs.prompt({
        title: 'Send the bill on WhatsApp',
        message: opts.phone?.trim()
          ? `"${opts.phone.trim()}" is not a mobile number WhatsApp can use.`
          : opts.customerName
            ? `${opts.customerName} has no mobile number on this bill.`
            : 'This bill has no customer mobile number.',
        label: "Customer's WhatsApp number",
        placeholder: '98xxxxxxxx',
        defaultValue: opts.phone?.trim() ?? '',
        required: true,
        inputMode: 'tel',
        hint: '10-digit mobile number. For a number outside India, start with + and the country code.',
        validate: (v) => (v ? whatsappNumberProblem(v) : null),
        confirmText: 'Open WhatsApp',
      }),
    [dialogs],
  );

  /** Open the chat with the customer (phone, else the phone saved with the bill) with the bill ready to send. */
  const send = useCallback(
    async (billId: number, phone?: string | null): Promise<boolean> => {
      let res;
      try {
        res = await call('sales.whatsapp', { id: billId, phone: phone ?? null, publicBase: PUBLIC_BASE });
      } catch (e) {
        toast.error(e);
        return false;
      }
      const link = res.link;
      const open = () => {
        const win = window.open(link, '_blank');
        if (win) win.opener = null;
        // The Windows app opens links in the browser (window.open gives nothing back there).
        return DESKTOP || !!win;
      };
      const openAgain = { label: 'Open WhatsApp', onClick: () => void open() };

      // Online billing: the message itself links to the bill, so nothing has to be attached.
      if (res.billUrl) {
        const opened = open();
        if (opened) toast.success(`WhatsApp chat with ${res.display} opened. The message has a link to the bill: press Send.`);
        else toast.info(`The bill for ${res.display} is ready: press “Open WhatsApp”, then Send. The message has a link to the bill.`, openAgain);
        return true;
      }

      let pictures: { jpg: Blob; png: Blob } | null = null;
      try {
        pictures = await receiptPictures(res.html, res.paperWidth);
      } catch {
        pictures = null;
      }
      const fileName = res.fileName;
      const saveJpg = () => {
        if (!pictures) return;
        const url = URL.createObjectURL(pictures.jpg);
        downloadInBrowser(url, fileName);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      };
      // Copy before opening the chat: the clipboard takes a picture only while this window has the focus.
      const copied = pictures && !MOBILE ? await copyPicture(pictures.png) : false;
      if (pictures && !copied) saveJpg();
      // WhatsApp only types the message in: say how to add the picture before the chat takes the screen.
      if (copied) {
        const go = await dialogs.confirm({
          title: 'Paste the bill picture in the chat',
          message: (
            <ol className="wa-steps">
              <li>WhatsApp opens the chat with {res.display}, with the message typed in.</li>
              <li>
                Click in the message box and press <kbd>Ctrl</kbd> + <kbd>V</kbd>: the bill picture appears, with the message as its caption.
              </li>
              <li>Press Send.</li>
            </ol>
          ),
          confirmText: 'Open WhatsApp',
          cancelText: 'Not now',
        });
        if (!go) return true;
      }
      const opened = open();
      const chat = opened ? `WhatsApp chat with ${res.display} opened.` : `The bill for ${res.display} is ready: press “Open WhatsApp”.`;
      if (copied) {
        toast.success(`${chat} The bill picture is copied: click in the message box, press Ctrl+V, then Send.`, opened ? { label: 'Save JPG', onClick: saveJpg } : openAgain);
      } else if (pictures) {
        toast.success(`${chat} The bill picture (${fileName}) is saved in your downloads: attach it in the chat and send.`, opened ? undefined : openAgain);
      } else {
        const note = `${chat} This browser could not make a picture of the bill, so only the message is typed in. Print the bill and choose “Save as PDF” to send it.`;
        if (opened) toast.warning(note);
        else toast.info(note, openAgain);
      }
      return true;
    },
    [toast, dialogs],
  );

  return { askNumber, send };
}

/** Line discount typed as "10%" (percentage) or "25" (rupees). */
export interface DiscountValue {
  discount: number | null;
  discountPct: number | null;
  valid: boolean;
}

export function parseDiscountText(text: string): DiscountValue {
  const t = text.trim();
  if (!t) return { discount: null, discountPct: null, valid: true };
  if (t.endsWith('%')) {
    const n = Number(t.slice(0, -1).trim());
    if (!Number.isFinite(n) || n < 0 || n > 100) return { discount: null, discountPct: null, valid: false };
    return { discount: null, discountPct: n || null, valid: true };
  }
  const p = parseMoney(t);
  if (p === null || p < 0) return { discount: null, discountPct: null, valid: false };
  return { discount: p || null, discountPct: null, valid: true };
}

export function discountToText(discount: number | null | undefined, discountPct: number | null | undefined): string {
  if (discountPct) return `${formatQty(discountPct)}%`;
  if (discount) return String(discount / 100);
  return '';
}

/**
 * Quick entry in the item search box: "2*sugar", "2 x sugar", "1.5x rice".
 * Returns the quantity (default 1) and the text to search for.
 */
export function parseQuickEntry(text: string): { qty: number; name: string; hasQty: boolean } {
  const m = /^\s*(\d+(?:\.\d{1,3})?)\s*[*xX×]\s*(\D.*)$/.exec(text);
  if (m) {
    const qty = Number(m[1]);
    if (qty > 0) return { qty, name: m[2].trim(), hasQty: true };
  }
  return { qty: 1, name: text.trim(), hasQty: false };
}
