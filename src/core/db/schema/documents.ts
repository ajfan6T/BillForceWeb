/**
 * Migration 7: quotations (estimates) to customers, purchase orders to suppliers,
 * and purchase returns (debit notes) of goods sent back to a supplier.
 * Quotations and purchase orders are not in the books: only the bill / purchase
 * they become is. Purchase returns are posted like a purchase in reverse.
 */
export const DOCUMENTS_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS quotations (
  id INTEGER PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  fy_start TEXT NOT NULL,
  date TEXT NOT NULL,
  valid_until TEXT,
  customer_id INTEGER REFERENCES customers (id),
  customer_name TEXT,
  customer_phone TEXT,
  subtotal INTEGER NOT NULL,               -- sum of qty x rate
  item_discount INTEGER NOT NULL DEFAULT 0,
  bill_discount INTEGER NOT NULL DEFAULT 0,
  bill_discount_pct REAL,
  tax INTEGER NOT NULL DEFAULT 0,          -- GST (regular registration)
  round_off INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'cancelled')),
  bill_id INTEGER REFERENCES bills (id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_seq ON quotations (fy_start, seq);
CREATE INDEX IF NOT EXISTS idx_quotations_date ON quotations (date);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON quotations (customer_id);

CREATE TABLE IF NOT EXISTS quotation_items (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items (id),
  item_name TEXT NOT NULL,
  unit TEXT,
  qty REAL NOT NULL CHECK (qty > 0),
  rate INTEGER NOT NULL CHECK (rate >= 0),
  discount INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
  discount_pct REAL,
  gst_rate REAL,
  hsn TEXT,
  amount INTEGER NOT NULL                  -- qty x rate - discount
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items (quotation_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  po_no TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  fy_start TEXT NOT NULL,
  date TEXT NOT NULL,
  expected_date TEXT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  total INTEGER NOT NULL,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'received', 'cancelled')),
  purchase_id INTEGER REFERENCES purchases (id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_by INTEGER,
  updated_at TEXT,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_seq ON purchase_orders (fy_start, seq);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders (date);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders (supplier_id);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_id INTEGER REFERENCES items (id),
  description TEXT NOT NULL,
  unit TEXT,
  qty REAL NOT NULL CHECK (qty > 0),
  rate INTEGER NOT NULL CHECK (rate >= 0),
  amount INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items (po_id);

CREATE TABLE IF NOT EXISTS purchase_returns (
  id INTEGER PRIMARY KEY,
  return_no TEXT NOT NULL UNIQUE,
  seq INTEGER NOT NULL,
  fy_start TEXT NOT NULL,
  date TEXT NOT NULL,
  purchase_id INTEGER NOT NULL REFERENCES purchases (id),
  supplier_id INTEGER REFERENCES suppliers (id),
  supplier_name TEXT,
  value INTEGER NOT NULL,                  -- credited to the purchase account
  cgst INTEGER NOT NULL DEFAULT 0,         -- input tax credit given back
  sgst INTEGER NOT NULL DEFAULT 0,
  igst INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL CHECK (total > 0),
  settlement TEXT NOT NULL CHECK (settlement IN ('adjust', 'cash', 'upi', 'bank')),
  account_id INTEGER REFERENCES accounts (id), -- where a refund was received
  reference TEXT,
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  stock_tracked INTEGER NOT NULL DEFAULT 0,
  journal_entry_id INTEGER REFERENCES journal_entries (id),
  revision INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_returns_seq ON purchase_returns (fy_start, seq);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON purchase_returns (date);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON purchase_returns (supplier_id);

CREATE TABLE IF NOT EXISTS purchase_return_items (
  id INTEGER PRIMARY KEY,
  return_id INTEGER NOT NULL REFERENCES purchase_returns (id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  purchase_line_no INTEGER NOT NULL,       -- the line of the purchase the goods came on
  item_id INTEGER REFERENCES items (id),
  description TEXT NOT NULL,
  unit TEXT,
  qty REAL NOT NULL CHECK (qty > 0),
  value INTEGER NOT NULL,                  -- without the input tax claimed back
  cgst INTEGER NOT NULL DEFAULT 0,
  sgst INTEGER NOT NULL DEFAULT 0,
  igst INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON purchase_return_items (return_id);
`;
