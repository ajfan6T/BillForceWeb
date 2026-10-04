/**
 * Complete Supabase PostgreSQL schema for Billforce Cloud Synchronization.
 * This can be run directly in the Supabase SQL Editor.
 */
export const SUPABASE_SCHEMA_SQL = `-- BILLFORCE Cloud ERP - Supabase PostgreSQL Schema
-- Run this in your Supabase SQL Editor to set up all tables and security policies.

-- 1. Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Business Settings Table
CREATE TABLE IF NOT EXISTS billforce_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Users Table (Linked to Supabase Auth & BILLFORCE Roles)
CREATE TABLE IF NOT EXISTS billforce_users (
  id BIGINT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL,
  supabase_uid UUID,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Chart of Accounts
CREATE TABLE IF NOT EXISTS billforce_accounts (
  id BIGINT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_id TEXT NOT NULL,
  type TEXT NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Customers
CREATE TABLE IF NOT EXISTS billforce_customers (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  gstin TEXT,
  state_code TEXT,
  credit_limit BIGINT,
  opening_balance BIGINT DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Suppliers
CREATE TABLE IF NOT EXISTS billforce_suppliers (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  gstin TEXT,
  state_code TEXT,
  opening_balance BIGINT DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Items / Products
CREATE TABLE IF NOT EXISTS billforce_items (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  barcode TEXT,
  hsn TEXT,
  unit TEXT DEFAULT 'pcs',
  rate BIGINT DEFAULT 0,
  purchase_rate BIGINT DEFAULT 0,
  gst_rate NUMERIC DEFAULT 0,
  cess_rate NUMERIC DEFAULT 0,
  track_stock BOOLEAN DEFAULT FALSE,
  min_stock NUMERIC DEFAULT 0,
  sellable BOOLEAN DEFAULT TRUE,
  menu BOOLEAN DEFAULT FALSE,
  category_id BIGINT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Sales Bills
CREATE TABLE IF NOT EXISTS billforce_bills (
  id BIGINT PRIMARY KEY,
  bill_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  customer_id BIGINT,
  customer_name TEXT,
  subtotal BIGINT DEFAULT 0,
  discount BIGINT DEFAULT 0,
  tax BIGINT DEFAULT 0,
  round_off BIGINT DEFAULT 0,
  total BIGINT NOT NULL,
  paid BIGINT DEFAULT 0,
  balance BIGINT DEFAULT 0,
  status TEXT DEFAULT 'completed',
  gst_mode TEXT,
  stock_tracked BOOLEAN DEFAULT FALSE,
  cancelled_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Bill Items
CREATE TABLE IF NOT EXISTS billforce_bill_items (
  id BIGINT PRIMARY KEY,
  bill_id BIGINT NOT NULL,
  item_id BIGINT,
  item_name TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  unit TEXT,
  rate BIGINT NOT NULL,
  discount BIGINT DEFAULT 0,
  gst_rate NUMERIC DEFAULT 0,
  amount BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Bill Payments
CREATE TABLE IF NOT EXISTS billforce_bill_payments (
  id BIGINT PRIMARY KEY,
  bill_id BIGINT NOT NULL,
  mode TEXT NOT NULL,
  amount BIGINT NOT NULL,
  account_id BIGINT,
  reference TEXT,
  date DATE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Credit Notes
CREATE TABLE IF NOT EXISTS billforce_credit_notes (
  id BIGINT PRIMARY KEY,
  note_no TEXT NOT NULL UNIQUE,
  bill_id BIGINT,
  date DATE NOT NULL,
  customer_id BIGINT,
  total BIGINT NOT NULL,
  status TEXT DEFAULT 'completed',
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Receipts (Customer Payments)
CREATE TABLE IF NOT EXISTS billforce_receipts (
  id BIGINT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  customer_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  discount BIGINT DEFAULT 0,
  mode TEXT NOT NULL,
  account_id BIGINT,
  reference TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. Purchases
CREATE TABLE IF NOT EXISTS billforce_purchases (
  id BIGINT PRIMARY KEY,
  invoice_no TEXT NOT NULL,
  supplier_id BIGINT NOT NULL,
  supplier_name TEXT,
  date DATE NOT NULL,
  total BIGINT NOT NULL,
  paid BIGINT DEFAULT 0,
  balance BIGINT DEFAULT 0,
  status TEXT DEFAULT 'completed',
  gst_mode TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. Purchase Items
CREATE TABLE IF NOT EXISTS billforce_purchase_items (
  id BIGINT PRIMARY KEY,
  purchase_id BIGINT NOT NULL,
  item_id BIGINT,
  item_name TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  unit TEXT,
  rate BIGINT NOT NULL,
  discount BIGINT DEFAULT 0,
  gst_rate NUMERIC DEFAULT 0,
  amount BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Supplier Payments
CREATE TABLE IF NOT EXISTS billforce_supplier_payments (
  id BIGINT PRIMARY KEY,
  payment_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  supplier_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  discount BIGINT DEFAULT 0,
  mode TEXT NOT NULL,
  account_id BIGINT,
  reference TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. Expenses
CREATE TABLE IF NOT EXISTS billforce_expenses (
  id BIGINT PRIMARY KEY,
  expense_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  category_id BIGINT,
  account_id BIGINT,
  amount BIGINT NOT NULL,
  mode TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 17. Journal Entries (Double-Entry General Ledger)
CREATE TABLE IF NOT EXISTS billforce_journal_entries (
  id BIGINT PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  date DATE NOT NULL,
  voucher_type TEXT NOT NULL,
  source_type TEXT,
  source_id BIGINT,
  narration TEXT,
  is_void BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 18. Journal Lines
CREATE TABLE IF NOT EXISTS billforce_journal_lines (
  id BIGINT PRIMARY KEY,
  entry_id BIGINT NOT NULL,
  account_id BIGINT NOT NULL,
  debit BIGINT DEFAULT 0,
  credit BIGINT DEFAULT 0,
  party_type TEXT,
  party_id BIGINT,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 19. Employees
CREATE TABLE IF NOT EXISTS billforce_employees (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  designation TEXT,
  salary_paise BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 20. Employee Advances & Salaries
CREATE TABLE IF NOT EXISTS billforce_employee_advances (
  id BIGINT PRIMARY KEY,
  date DATE NOT NULL,
  employee_id BIGINT NOT NULL,
  amount BIGINT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billforce_salaries (
  id BIGINT PRIMARY KEY,
  slip_no TEXT NOT NULL UNIQUE,
  month TEXT NOT NULL,
  employee_id BIGINT NOT NULL,
  gross BIGINT NOT NULL,
  net BIGINT NOT NULL,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 21. Stock Moves
CREATE TABLE IF NOT EXISTS billforce_stock_moves (
  id BIGINT PRIMARY KEY,
  item_id BIGINT NOT NULL,
  date DATE NOT NULL,
  move_type TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  rate BIGINT DEFAULT 0,
  source_type TEXT,
  source_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 22. Restaurant Menu Recipes
CREATE TABLE IF NOT EXISTS billforce_recipe_items (
  id BIGINT PRIMARY KEY,
  dish_id BIGINT NOT NULL,
  ingredient_id BIGINT NOT NULL,
  qty NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 23. Activity Audit Trail
CREATE TABLE IF NOT EXISTS billforce_activity_log (
  id BIGINT PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT,
  entity_type TEXT,
  entity_id BIGINT,
  user_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 24. Sync Metadata Table
CREATE TABLE IF NOT EXISTS billforce_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  direction TEXT NOT NULL,
  entity_count INTEGER DEFAULT 0,
  details JSONB
);

-- 25. Row Level Security Policies (Allow Authenticated Users & Anon Access with Key)
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'billforce_settings',
    'billforce_users',
    'billforce_accounts',
    'billforce_customers',
    'billforce_suppliers',
    'billforce_items',
    'billforce_bills',
    'billforce_bill_items',
    'billforce_bill_payments',
    'billforce_credit_notes',
    'billforce_receipts',
    'billforce_purchases',
    'billforce_purchase_items',
    'billforce_supplier_payments',
    'billforce_expenses',
    'billforce_journal_entries',
    'billforce_journal_lines',
    'billforce_employees',
    'billforce_employee_advances',
    'billforce_salaries',
    'billforce_stock_moves',
    'billforce_recipe_items',
    'billforce_activity_log',
    'billforce_sync_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "Public access for all operations" ON %I;', tbl);
    EXECUTE format('CREATE POLICY "Public access for all operations" ON %I FOR ALL USING (true) WITH CHECK (true);', tbl);
  END LOOP;
END $$;

-- Enable Realtime publication for tables
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE billforce_bills, billforce_customers, billforce_items, billforce_purchases, billforce_accounts;
  EXCEPTION WHEN OTHERS THEN
    -- Publication might already have tables or not exist yet
    NULL;
  END;
END $$;
`;
