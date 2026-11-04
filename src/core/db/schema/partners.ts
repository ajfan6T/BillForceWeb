/**
 * Partners of a partnership business (database version 8). Each partner has a capital account and a
 * drawings account of their own in the chart of accounts, so the balance sheet shows every partner's
 * capital; money they bring in, spend for the business or take out is posted to those accounts.
 */
export const PARTNERS_SCHEMA = `
CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  share_pct REAL NOT NULL DEFAULT 0 CHECK (share_pct >= 0 AND share_pct <= 100),  -- share of profit and loss
  capital_account_id INTEGER NOT NULL REFERENCES accounts (id),
  drawings_account_id INTEGER NOT NULL REFERENCES accounts (id),
  joined_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_capital ON partners (capital_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_drawings ON partners (drawings_account_id);
`;

/** An expense a partner paid from their own money (mode 'credit', credited to the partner's capital). */
export const PARTNER_COLUMNS: Array<[table: string, column: string, definition: string]> = [['expenses', 'partner_id', 'INTEGER REFERENCES partners (id)']];
