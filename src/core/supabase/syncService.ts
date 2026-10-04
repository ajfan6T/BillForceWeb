import type { Db } from '../db/database';
import type { SupabaseConfig, SupabaseSyncStats, SupabaseSyncState } from '../../shared/supabaseConfig';
import { DEFAULT_SUPABASE_CONFIG } from '../../shared/supabaseConfig';
import { getSupabaseServerClient } from './client';

/**
 * Optional one-way copy of a business's data to its own Supabase project.
 * The connection details are kept in the business's own database, and the
 * sync state is kept per business, so businesses never see each other's
 * cloud settings or data.
 */
const syncStates = new Map<string, SupabaseSyncState>();

function stateOf(db: Db): SupabaseSyncState {
  let state = syncStates.get(db.path);
  if (!state) {
    state = { configured: false, connected: false, status: 'idle', lastSyncedAt: null };
    syncStates.set(db.path, state);
  }
  return state;
}

function setState(db: Db, patch: Partial<SupabaseSyncState>): void {
  syncStates.set(db.path, { ...stateOf(db), ...patch });
}

export function loadSupabaseConfig(db: Db): SupabaseConfig {
  let config: SupabaseConfig = { ...DEFAULT_SUPABASE_CONFIG };
  try {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['supabase_config']);
    if (row?.value) config = { ...DEFAULT_SUPABASE_CONFIG, ...JSON.parse(row.value) };
  } catch (e) {
    console.error('Failed to read the Supabase settings:', e);
  }
  return config;
}

export function saveSupabaseConfig(db: Db, patch: Partial<SupabaseConfig>): SupabaseConfig {
  const config = { ...loadSupabaseConfig(db), ...patch };
  db.run(
    `INSERT INTO settings (key, value) VALUES ('supabase_config', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [JSON.stringify(config)],
  );
  return config;
}

/** Is a cloud copy set up for this business? */
function isConfigured(config: SupabaseConfig): boolean {
  return !!(config.url && config.anonKey);
}

export function getSyncState(db: Db): SupabaseSyncState {
  const config = loadSupabaseConfig(db);
  return { ...stateOf(db), configured: isConfigured(config), lastSyncedAt: stateOf(db).lastSyncedAt ?? config.lastSyncedAt ?? null };
}

const running = new Set<string>();

export async function runFullSync(db: Db): Promise<{
  success: boolean;
  message: string;
  stats?: SupabaseSyncStats;
}> {
  const config = loadSupabaseConfig(db);
  const client = isConfigured(config) ? getSupabaseServerClient(config) : null;

  if (!client) {
    setState(db, { status: 'offline', connected: false, errorMessage: 'Supabase credentials not configured' });
    return { success: false, message: 'Supabase credentials not configured.' };
  }
  if (running.has(db.path)) return { success: false, message: 'A sync is already running. Try again in a moment.' };
  running.add(db.path);
  setState(db, { status: 'syncing' });

  const stats: SupabaseSyncStats = {
    customers: 0,
    suppliers: 0,
    items: 0,
    bills: 0,
    purchases: 0,
    accounts: 0,
    journals: 0,
    employees: 0,
    stockMoves: 0,
    settings: 0,
  };

  try {
    // 1. Sync Settings
    try {
      // Internal values (recovery code hash, cloud keys) never leave the server.
      const settings = db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE 'meta.%' AND key <> 'supabase_config'");
      if (settings.length > 0) {
        const { error } = await client.from('billforce_settings').upsert(
          settings.map((s) => ({
            key: s.key,
            value: s.value,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.settings = settings.length;
      }
    } catch (e) {
      console.warn('Sync settings error:', e);
    }

    // 2. Sync Accounts
    try {
      const accounts = db.all<any>('SELECT * FROM accounts');
      if (accounts.length > 0) {
        const { error } = await client.from('billforce_accounts').upsert(
          accounts.map((a) => ({
            id: a.id,
            code: a.code,
            name: a.name,
            group_id: a.group_id,
            type: a.type,
            is_system: !!a.is_system,
            is_active: a.is_active !== undefined ? !!a.is_active : true,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.accounts = accounts.length;
      }
    } catch (e) {
      console.warn('Sync accounts error:', e);
    }

    // 3. Sync Customers
    try {
      const customers = db.all<any>('SELECT * FROM customers');
      if (customers.length > 0) {
        const { error } = await client.from('billforce_customers').upsert(
          customers.map((c) => ({
            id: c.id,
            name: c.name,
            phone: c.phone || null,
            address: c.address || null,
            gstin: c.gstin || null,
            state_code: c.state_code || null,
            credit_limit: c.credit_limit || null,
            opening_balance: c.opening_balance || 0,
            notes: c.notes || null,
            is_active: c.is_active !== undefined ? !!c.is_active : true,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.customers = customers.length;
      }
    } catch (e) {
      console.warn('Sync customers error:', e);
    }

    // 4. Sync Suppliers
    try {
      const suppliers = db.all<any>('SELECT * FROM suppliers');
      if (suppliers.length > 0) {
        const { error } = await client.from('billforce_suppliers').upsert(
          suppliers.map((s) => ({
            id: s.id,
            name: s.name,
            phone: s.phone || null,
            address: s.address || null,
            gstin: s.gstin || null,
            state_code: s.state_code || null,
            opening_balance: s.opening_balance || 0,
            notes: s.notes || null,
            is_active: s.is_active !== undefined ? !!s.is_active : true,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.suppliers = suppliers.length;
      }
    } catch (e) {
      console.warn('Sync suppliers error:', e);
    }

    // 5. Sync Items
    try {
      const items = db.all<any>('SELECT * FROM items');
      if (items.length > 0) {
        const { error } = await client.from('billforce_items').upsert(
          items.map((i) => ({
            id: i.id,
            name: i.name,
            code: i.code || null,
            barcode: i.barcode || null,
            hsn: i.hsn || null,
            unit: i.unit || 'pcs',
            rate: i.rate || 0,
            purchase_rate: i.purchase_rate || 0,
            gst_rate: i.gst_rate || 0,
            cess_rate: i.cess_rate || 0,
            track_stock: !!i.track_stock,
            min_stock: i.min_stock || 0,
            sellable: i.sellable !== undefined ? !!i.sellable : true,
            menu: !!i.menu,
            category_id: i.category_id || null,
            is_active: i.is_active !== undefined ? !!i.is_active : true,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.items = items.length;
      }
    } catch (e) {
      console.warn('Sync items error:', e);
    }

    // 6. Sync Bills & Bill Items & Payments
    try {
      const bills = db.all<any>('SELECT * FROM bills');
      if (bills.length > 0) {
        const { error: billErr } = await client.from('billforce_bills').upsert(
          bills.map((b) => ({
            id: b.id,
            bill_no: b.bill_no,
            date: b.date,
            customer_id: b.customer_id || null,
            customer_name: b.customer_name || null,
            subtotal: b.subtotal || 0,
            discount: b.discount || 0,
            tax: b.tax || 0,
            round_off: b.round_off || 0,
            total: b.total || 0,
            paid: b.paid || 0,
            balance: b.balance || 0,
            status: b.status || 'completed',
            gst_mode: b.gst_mode || null,
            stock_tracked: !!b.stock_tracked,
            cancelled_reason: b.cancelled_reason || null,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!billErr) stats.bills = bills.length;

        // Items for bills
        const billItems = db.all<any>('SELECT * FROM bill_items');
        if (billItems.length > 0) {
          await client.from('billforce_bill_items').upsert(
            billItems.map((bi) => ({
              id: bi.id,
              bill_id: bi.bill_id,
              item_id: bi.item_id || null,
              item_name: bi.item_name,
              qty: bi.qty,
              unit: bi.unit || null,
              rate: bi.rate,
              discount: bi.discount || 0,
              gst_rate: bi.gst_rate || 0,
              amount: bi.amount,
              updated_at: new Date().toISOString(),
            }))
          );
        }

        // Payments for bills
        const billPayments = db.all<any>('SELECT * FROM bill_payments');
        if (billPayments.length > 0) {
          await client.from('billforce_bill_payments').upsert(
            billPayments.map((bp) => ({
              id: bp.id,
              bill_id: bp.bill_id,
              mode: bp.mode,
              amount: bp.amount,
              account_id: bp.account_id || null,
              reference: bp.reference || null,
              date: bp.date,
              updated_at: new Date().toISOString(),
            }))
          );
        }
      }
    } catch (e) {
      console.warn('Sync bills error:', e);
    }

    // 7. Sync Purchases & Purchase Items
    try {
      const purchases = db.all<any>('SELECT * FROM purchases');
      if (purchases.length > 0) {
        const { error: purErr } = await client.from('billforce_purchases').upsert(
          purchases.map((p) => ({
            id: p.id,
            invoice_no: p.invoice_no,
            supplier_id: p.supplier_id,
            supplier_name: p.supplier_name || null,
            date: p.date,
            total: p.total,
            paid: p.paid || 0,
            balance: p.balance || 0,
            status: p.status || 'completed',
            gst_mode: p.gst_mode || null,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!purErr) stats.purchases = purchases.length;

        const purchaseItems = db.all<any>('SELECT * FROM purchase_items');
        if (purchaseItems.length > 0) {
          await client.from('billforce_purchase_items').upsert(
            purchaseItems.map((pi) => ({
              id: pi.id,
              purchase_id: pi.purchase_id,
              item_id: pi.item_id || null,
              item_name: pi.item_name,
              qty: pi.qty,
              unit: pi.unit || null,
              rate: pi.rate,
              discount: pi.discount || 0,
              gst_rate: pi.gst_rate || 0,
              amount: pi.amount,
              updated_at: new Date().toISOString(),
            }))
          );
        }
      }
    } catch (e) {
      console.warn('Sync purchases error:', e);
    }

    // 8. Sync Employees
    try {
      const employees = db.all<any>('SELECT * FROM employees');
      if (employees.length > 0) {
        const { error } = await client.from('billforce_employees').upsert(
          employees.map((e) => ({
            id: e.id,
            name: e.name,
            phone: e.phone || null,
            designation: e.designation || null,
            salary_paise: e.salary_paise || 0,
            is_active: e.is_active !== undefined ? !!e.is_active : true,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.employees = employees.length;
      }
    } catch (e) {
      console.warn('Sync employees error:', e);
    }

    // 9. Sync Journal Entries & Lines
    try {
      const entries = db.all<any>('SELECT * FROM journal_entries');
      if (entries.length > 0) {
        const { error } = await client.from('billforce_journal_entries').upsert(
          entries.map((j) => ({
            id: j.id,
            entry_no: j.entry_no,
            date: j.date,
            voucher_type: j.voucher_type,
            source_type: j.source_type || null,
            source_id: j.source_id || null,
            narration: j.narration || null,
            is_void: !!j.is_void,
            updated_at: new Date().toISOString(),
          }))
        );
        if (!error) stats.journals = entries.length;

        const lines = db.all<any>('SELECT * FROM journal_lines');
        if (lines.length > 0) {
          await client.from('billforce_journal_lines').upsert(
            lines.map((l) => ({
              id: l.id,
              entry_id: l.entry_id,
              account_id: l.account_id,
              debit: l.debit || 0,
              credit: l.credit || 0,
              party_type: l.party_type || null,
              party_id: l.party_id || null,
              notes: l.notes || null,
              updated_at: new Date().toISOString(),
            }))
          );
        }
      }
    } catch (e) {
      console.warn('Sync journals error:', e);
    }

    // 10. Record Sync Log
    const nowIso = new Date().toISOString();
    try {
      await client.from('billforce_sync_log').insert({
        direction: 'push',
        entity_count: Object.values(stats).reduce((a, b) => a + b, 0),
        details: stats,
        synced_at: nowIso,
      });
    } catch (e) {
      /* ignore */
    }

    saveSupabaseConfig(db, { lastSyncedAt: nowIso });
    setState(db, { configured: true, connected: true, status: 'synced', lastSyncedAt: nowIso, errorMessage: null, stats });

    return {
      success: true,
      message: `Successfully synchronized ${Object.values(stats).reduce((a, b) => a + b, 0)} records with Supabase!`,
      stats,
    };
  } catch (e: any) {
    setState(db, { status: 'error', connected: false, errorMessage: e.message || String(e) });
    return {
      success: false,
      message: `Synchronization failed: ${e.message || String(e)}`,
    };
  } finally {
    running.delete(db.path);
  }
}

const autoSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function cancelAutoSync(dbPath: string): void {
  const timer = autoSyncTimers.get(dbPath);
  if (timer) clearTimeout(timer);
  autoSyncTimers.delete(dbPath);
}

/** After a change, copy the business's data to its Supabase project (when automatic sync is on). */
export function triggerAutoSyncDebounced(db: Db, delayMs = 3000): void {
  const config = loadSupabaseConfig(db);
  if (!isConfigured(config) || config.autoSync === false) return;
  cancelAutoSync(db.path);
  const timer = setTimeout(() => {
    autoSyncTimers.delete(db.path);
    runFullSync(db).catch((err) => {
      console.warn('[AutoSync] Background sync notice:', err.message);
    });
  }, delayMs);
  timer.unref?.();
  autoSyncTimers.set(db.path, timer);
}
