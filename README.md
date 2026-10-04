<div align="center">
  <img src="public/billforce-logo-wordmark.svg" alt="Billforce ERP Logo" width="420" />
  <br /><br />

[![React](https://img.shields.io/badge/React-19.x-61dafb.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.x-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-per--business-003b57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Supabase](https://img.shields.io/badge/Supabase-optional_copy-3ecf8e.svg?logo=supabase&logoColor=white)](https://supabase.com/)

An ERP and point of sale (POS) for shops, restaurants and wholesalers: billing, purchases, stock, double-entry accounts, GST, payroll and reports. Use it as a **Windows app** (data on your PC), on a **server** (many businesses, each with its own database) or **in the browser**.

**[⬇ Download for Windows (Billforce-Setup.exe)](https://github.com/ajfan6T/BillForceWeb/releases/latest/download/Billforce-Setup.exe)** · [Website](https://ajfan6t.github.io/BillForceWeb/)

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
- **Automatic backups** every day, week or month (or off), after your data changes; choose how many to keep. Back up any time with one click.
- **Windows app**: backups are saved in `Documents\BILLFORCE Backups` or a folder you choose (pen drive, external disk, OneDrive / Google Drive folder). If that folder is not available, the backup is saved in BILLFORCE's own folder instead.
- **Server**: backups are kept on the server per business and downloaded to your computer with one click. **Restore** from a `.bfbackup` file (a safety copy is kept first).
- Reports export to Excel, CSV and PDF (the Windows app saves real PDF files; in a browser use the print window's "Save as PDF").
- Optional one-way copy of a business's data to its own Supabase project (Settings → Supabase Cloud Sync).

---

## Windows app (no technical setup)

1. Download **[Billforce-Setup.exe](https://github.com/ajfan6T/BillForceWeb/releases/latest/download/Billforce-Setup.exe)** (from the [Releases page](https://github.com/ajfan6T/BillForceWeb/releases/latest)).
2. Double-click it. BILLFORCE installs for your Windows user (no administrator needed), opens, and adds a desktop and Start menu shortcut.
3. Choose **Register Business** and keep the recovery code it shows you.

The installer is not code-signed yet: if Windows shows *"Windows protected your PC"*, click **More info → Run anyway**.

| What | Where |
| :--- | :--- |
| Your data (one database per business) | `%APPDATA%\BILLFORCE\data` (kept when BILLFORCE is updated or uninstalled) |
| Backups | `Documents\BILLFORCE Backups\<business>`, or the folder chosen in Settings → Backup & recovery |
| Log file (for support) | `%APPDATA%\BILLFORCE\logs\billforce.log` (also under Help in the menu bar: press `Alt`) |

- **Backup interval**: Settings → Backup & recovery → *Automatic backup* on/off and *How often*: every day, every week or every month.
- **Receipt printer**: Settings → Receipt & printer → *Receipt printer*: bills then print straight to it, without the print window.
- **Update**: download the new `Billforce-Setup.exe` and run it; data and backups stay.
- **Move to another PC**: *Back up now*, copy the `.bfbackup` file, install Billforce on the new PC, register any business name, then *Restore from a backup*.

The installer is built and tested on Windows by `.github/workflows/desktop.yml` (it installs it, runs the app's self-check, and uninstalls it) and published on the Releases page on every push to `main`. To build it yourself on Windows: `npm ci && npm run dist:win` → `release/Billforce-Setup.exe`.

---

## Server (web) edition

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

### Browser edition (not published)

The same app can also run **entirely in the browser**, with no server: the Billforce engine runs in the page (SQLite compiled to WebAssembly) and the data is saved in the browser (IndexedDB). It is no longer published on GitHub Pages (the website is; see below), but you can host it yourself:

- Build it: `npm run build:pages` → `dist-pages/` (any static host works).
- Data stays on **that browser and device**. Download a backup regularly (Settings → Backup & recovery); restore it on another computer or after clearing the browser.
- One tab at a time: a second tab of the same browser is refused so changes are never overwritten.
- Backups move freely between the browser edition and the server edition.

For several computers sharing the same live data, run the server edition (above).

### Website (GitHub Pages)

**https://ajfan6t.github.io/BillForceWeb/** is the BILLFORCE website: what the app does, how to install it and the **Download for Windows** button. Short download link: **https://ajfan6t.github.io/BillForceWeb/download/**.

- Source: `website/` (plain HTML and CSS, no framework). `npm run build:website` → `dist-website/` (fills in the version and copies the logo).
- Published from the `gh-pages` branch by `.github/workflows/pages.yml` on every push to `main`. The download buttons always point to the latest release's `Billforce-Setup.exe`.

---

## Checks

```bash
npm run lint   # TypeScript type check
npm test                     # automated tests (business isolation, logins, backups and their schedule, documents, GST/stock postings)
npm run test:browser-engine  # the same tests on the browser edition's engine (sql.js, in-memory files, JS crypto)
npm run build:desktop        # Windows app files (dist-desktop/); npm run dist:win makes the installer (on Windows)
```

---

## Project structure

```
├── server.ts                # Express server: API, downloads, backup uploads, static files
├── electron/                # Windows app: window, printing & dialogs, self-check (--smoke-test)
├── electron-builder.yml     # Windows installer (Billforce-Setup.exe)
├── website/                 # The website on GitHub Pages (download page)
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
│   ├── standalone/          # Browser edition: Node stand-ins (sqlite via sql.js, files in IndexedDB)
│   ├── desktop/             # Windows app: API calls go to the engine inside the app
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
- Backups live in each business's own server folder; restores accept only uploaded Billforce backups and keep a safety copy first. Only the Windows app lets a user choose a backup folder.
- Windows app: the screens have no file or system access of their own; they talk to the engine only through one bridge (`window.billforce`), which answers the app's own window only.

## Color themes

Blue (default), green and brown palettes, switchable from the top bar, Settings or the login page (`src/renderer/styles/app.css`, `src/renderer/theme.tsx`).

## License

This project is licensed under the [MIT License](LICENSE).
