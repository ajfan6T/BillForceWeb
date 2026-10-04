<div align="center">
  <img src="public/billforce-logo-wordmark.svg" alt="Billforce ERP Logo" width="420" />
  <br /><br />

[![React](https://img.shields.io/badge/React-19.x-61dafb.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-per--business-003b57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Supabase](https://img.shields.io/badge/Supabase-optional_copy-3ecf8e.svg?logo=supabase&logoColor=white)](https://supabase.com/)

A web ERP and point of sale (POS) for shops, restaurants and wholesalers: billing, purchases, stock, double-entry accounts, GST, payroll and reports. Many businesses can use one server; each has its own database.

</div>

---

## Features

### Sales
- **Fast billing (POS)** with keyboard shortcuts (`F2` new bill, `F9` save & print, `F10` save), cash / UPI / bank / credit and split payments, dynamic UPI QR on receipts.
- **Quotations (estimates)**: price a job for a customer, print it, and turn it into a bill in one click. Totals use the same calculation as bills, so the bill matches the quote.
- **Sales returns & credit notes**, customer receipts, outstanding and statements.

### Purchases
- **Purchase orders**: order from a supplier; when the goods arrive, "Goods received: enter bill" fills the purchase bill from the order.
- **Purchase bills** with GST input tax credit, freight / other charges, part payments.
- **Purchase returns (debit notes)**: send goods back against a purchase bill. The amount is taken off what you owe the supplier (or recorded as a refund), the input tax credit claimed is given back, and the goods leave stock.
- Supplier payments, payables and ageing.

### Stock & menu
- Stock levels, item ledger, counts & adjustments, opening stock, moving average cost, low-stock alerts.
- Restaurant menu with recipes and menu costing.

### Accounts & GST
- Double-entry ledger: cash book, bank & UPI book, day book, journals, expenses, capital & drawings, loans, transfers, year-end closing.
- Profit & loss, balance sheet, trial balance, cash flow, receivables / payables ageing.
- GST: CGST / SGST / IGST, composition scheme, GST summary (including debit notes), sales & purchase registers, HSN summary, "Pay GST" with legal set-off order.

### People & control
- Employees, attendance, salary and advances.
- Owner / manager / cashier roles with editable permissions, full activity log and document history.

### Data
- **Backups** are kept on the server (per business, daily automatic copy) and downloaded to your computer with one click. **Restore** by uploading a `.bfbackup` file (a safety copy is kept first).
- Reports export to Excel and CSV; PDF and printing use the browser's print window ("Save as PDF").
- Optional one-way copy of a business's data to its own Supabase project (Settings → Supabase Cloud Sync).

---

## Getting started

Requirements: **Node.js 22.5 or newer** (Billforce uses the built-in `node:sqlite`).

```bash
npm install
npm run dev          # http://localhost:3000 (Vite + API, live reload)
```

Open the app, choose **Register Business**, and keep the recovery code it shows you.

Production:

```bash
npm run build
npm start            # serves dist/ and the API on $PORT (default 3000)
```

### Settings (environment variables)

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port. |
| `BILLFORCE_DATA_DIR` | `./data` | Where every business's database, logins and backups are stored. **Back this folder up / put it on a persistent disk.** |
| `BILLFORCE_REGISTRATION` | `open` | Set to `closed` to stop new businesses registering (existing ones can still sign in). |
| `TRUST_PROXY` | _(unset)_ | Set to `1` behind a load balancer / Cloud Run so sign-in rate limits see real client addresses. |
| `BILLFORCE_MAX_UPLOAD_MB` | `200` | Largest backup file that can be uploaded for a restore. |

### Docker

```bash
docker build -t billforce .
docker run -p 3000:3000 -v billforce-data:/app/data billforce
```

The image stores data in `/app/data` (a volume). On platforms with a temporary disk (e.g. Cloud Run) mount a persistent volume there and run a **single instance**: each business is a SQLite file on that server.

---

## Checks

```bash
npm run lint   # TypeScript type check
npm test       # automated tests (business isolation, logins, backups, documents, GST/stock postings)
```

---

## Project structure

```
├── server.ts                # Express server: API, downloads, backup uploads, static files
├── src/
│   ├── core/                # Business logic (runs on the server)
│   │   ├── app.ts           # Request handling: session token -> business database -> route
│   │   ├── sessions.ts      # Logins (hashed tokens in data/system.db, expiry)
│   │   ├── web.ts           # Browser printing / downloads returned with API replies
│   │   ├── business/        # Business registry & per-business databases
│   │   ├── db/              # SQLite wrapper, schema & migrations
│   │   ├── accounting/      # Ledger posting, chart of accounts, financial years
│   │   └── modules/         # Sales, quotations, purchases, purchase orders/returns, stock, GST, ...
│   ├── renderer/            # React app (pages, components, layout, themes)
│   └── shared/              # Types and calculations shared by server and browser
└── tests/                   # node:test suite (npm test)
```

### Data folder

```
data/
├── businesses.json          # business name -> database file
├── businesses/<id>.db       # one SQLite database per business
├── backups/<id>/            # that business's backups
├── system.db                # sign-in sessions (no business data)
└── uploads/                 # backup files waiting to be restored (removed after an hour)
```

---

## Security

- Every request carries a session token bound to one business; a token never gives access to another business. Tokens are stored hashed, expire after 7 days unused (30 days at most) and end on logout, password change / reset or deactivation.
- Passwords are hashed with scrypt and a per-user salt. Wrong passwords lock a login for a minute, then for longer and longer (up to an hour).
- Sign-in, recovery, registration and uploads are rate limited per client address.
- Owner password recovery uses the business's recovery code (shown once at registration).
- Backups live in each business's own server folder; restores accept only uploaded Billforce backups and keep a safety copy first.

## Color themes

Blue (default), green and brown palettes, switchable from the top bar, Settings or the login page (`src/renderer/styles/app.css`, `src/renderer/theme.tsx`).

## License

This project is licensed under the [MIT License](LICENSE).
