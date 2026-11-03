import { DEFAULT_PREFIXES, type PaymentMode, type SequenceKey } from './constants';
import type { GstRegistration } from './gst';

export interface BusinessSettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  /** UPI ID (VPA) such as shopname@okbank, used for the payment QR on receipts. */
  upiId: string;
  /** Payee name shown in UPI apps; defaults to business name. */
  upiName: string;
  /** Business logo printed at the top of bills and receipts: a PNG / JPEG / WebP data URL ('' = no logo). */
  logo: string;
}

/** Largest logo the app keeps (the length of its data URL, about 300 KB). */
export const LOGO_MAX_CHARS = 400_000;
/** A chosen logo is scaled down to fit in this many pixels (sharp on 203 and 300 dpi receipt printers). */
export const LOGO_MAX_WIDTH_PX = 600;
export const LOGO_MAX_HEIGHT_PX = 300;

const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** First bytes of each image kind a logo may be (checked so a renamed file of another kind is refused). */
const LOGO_MAGIC: Record<string, (b: string) => boolean> = {
  png: (b) => b.startsWith('\x89PNG\r\n\x1a\n'),
  jpeg: (b) => b.startsWith('\xff\xd8\xff'),
  webp: (b) => b.startsWith('RIFF') && b.slice(8, 12) === 'WEBP',
};

/** Is this a logo the app can store and print (a PNG, JPEG or WebP image as a base64 data URL, not too large)? */
export function isLogoDataUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > LOGO_MAX_CHARS) return false;
  const m = LOGO_DATA_URL_RE.exec(v);
  if (!m) return false;
  const start = v.indexOf(',') + 1;
  try {
    return LOGO_MAGIC[m[1]](atob(v.slice(start, start + 16)));
  } catch {
    return false;
  }
}

export interface ReceiptSettings {
  /** Extra lines printed under the business details (e.g. tagline, timings). */
  header: string;
  /** Lines printed at the end of the receipt (e.g. "Thank you! Visit again"). */
  footer: string;
  paperWidth: 80 | 58;
  fontSize: 'small' | 'normal' | 'large';
  /** Windows printer name. Empty = ask every time (system print dialog). */
  printerName: string;
  copies: number;
  /** Print the receipt automatically when a bill is saved. */
  autoPrint: boolean;
  showCustomer: boolean;
  showCashier: boolean;
  showAmountInWords: boolean;
  /** When to print a UPI QR code for the bill amount. */
  upiQr: 'never' | 'unpaid' | 'always';
  /** Label reprinted receipts as "DUPLICATE". */
  markDuplicate: boolean;
}

export interface BillingSettings {
  /** Round bill totals to the nearest rupee. */
  roundOff: boolean;
  defaultPaymentMode: PaymentMode;
  prefixes: Record<SequenceKey, string>;
  /** Warn when a customer's balance would exceed their credit limit. */
  enforceCreditLimit: boolean;
}

export interface AccountSettings {
  /** First date for which transactions can be entered; opening balances are dated this day. */
  booksStartDate: string;
  /** Default account used for "Cash" payments. */
  cashAccountId: number | null;
  /** Default account used for "UPI" payments. */
  upiAccountId: number | null;
  /** Default account used for "Bank" payments. */
  bankAccountId: number | null;
}

/** How often an automatic backup is kept (only after the data has changed). */
export const BACKUP_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export type BackupFrequency = (typeof BACKUP_FREQUENCIES)[number];

export const BACKUP_FREQUENCY_LABELS: Record<BackupFrequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
};

/** Days between automatic backups. */
export const BACKUP_FREQUENCY_DAYS: Record<BackupFrequency, number> = { daily: 1, weekly: 7, monthly: 30 };

export interface BackupSettings {
  autoBackup: boolean;
  frequency: BackupFrequency;
  /** Number of automatic backups to keep. */
  keepCount: number;
  /** Windows app only: the folder chosen for backups (null = Documents/Billforce Backups/<business>). */
  folder: string | null;
  lastAutoBackupAt: string | null;
  lastBackupAt: string | null;
  lastBackupPath: string | null;
}

export interface SecuritySettings {
  /** Lock the screen after this many idle minutes. 0 = never. */
  autoLockMinutes: number;
}

export interface GstSettings {
  /** Unregistered businesses bill exactly as before: no GST anywhere. */
  registration: GstRegistration;
  /** The business's GSTIN; its first two digits are the state of the business. */
  gstin: string;
  /** Item rates include GST (tax is taken out of the price) instead of being added on top. */
  ratesIncludeGst: boolean;
  /** GST rate (percent) for new items and one-time lines. */
  defaultRate: number;
  /** Composition scheme: tax rate on turnover (percent). */
  compositionRate: number;
}

export interface StockSettings {
  /** Track stock: bills take goods out, purchases and returns bring them in (off = as before, no stock screens). */
  enabled: boolean;
}

export interface MenuSettings {
  /** Restaurant menu: dishes with recipes; with stock on, selling a dish takes its ingredients out of stock. */
  enabled: boolean;
}

export interface AppSettings {
  business: BusinessSettings;
  gst: GstSettings;
  stock: StockSettings;
  menu: MenuSettings;
  receipt: ReceiptSettings;
  billing: BillingSettings;
  accounts: AccountSettings;
  backup: BackupSettings;
  security: SecuritySettings;
}

export type SettingsSection = keyof AppSettings;

export function defaultSettings(today: string): AppSettings {
  return {
    business: { name: '', address: '', phone: '', email: '', upiId: '', upiName: '', logo: '' },
    gst: { registration: 'unregistered', gstin: '', ratesIncludeGst: true, defaultRate: 18, compositionRate: 1 },
    stock: { enabled: false },
    menu: { enabled: false },
    receipt: {
      header: '',
      footer: 'Thank you! Visit again.',
      paperWidth: 80,
      fontSize: 'normal',
      printerName: '',
      copies: 1,
      autoPrint: true,
      showCustomer: true,
      showCashier: true,
      showAmountInWords: false,
      upiQr: 'never',
      markDuplicate: true,
    },
    billing: {
      roundOff: true,
      defaultPaymentMode: 'cash',
      prefixes: { ...DEFAULT_PREFIXES },
      enforceCreditLimit: false,
    },
    accounts: { booksStartDate: today, cashAccountId: null, upiAccountId: null, bankAccountId: null },
    backup: { autoBackup: true, frequency: 'daily', keepCount: 30, folder: null, lastAutoBackupAt: null, lastBackupAt: null, lastBackupPath: null },
    security: { autoLockMinutes: 0 },
  };
}
