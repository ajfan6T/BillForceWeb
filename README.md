<div align="center">
  <img src="public/billforce-logo-wordmark.svg" alt="Billforce ERP Logo" width="420" />
  <br /><br />

[![React](https://img.shields.io/badge/React-18.x-61dafb.svg?logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![SQLite](https://img.shields.io/badge/SQLite-Offline--First-003b57.svg?logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Cloud--Sync-3ecf8e.svg?logo=supabase&logoColor=white)](https://supabase.com/)

A modern, high-performance, offline-first Cloud ERP and Point of Sale (POS) system engineered for retail shops, restaurants, wholesalers, and multi-branch commercial enterprises.

---

## 🌟 Key Features

### 1. Multi-Business & Self-Service Registration
- **Dedicated Isolated Databases**: Each registered business gets its own isolated SQLite database (`data/businesses/<slug>.db`), ensuring zero data leakage, high performance, and simple backups.
- **Dual Tab Landing Screen**: Easily toggle between **Sign In** and **Register Business**.
- **Owner Setup & Recovery**: Automated chart of accounts initialization and emergency recovery codes for owner accounts.

### 2. Configurable Color Themes
Choose from 3 themes to match your brand:
- 🔵 **Blue and White** *(Default)*: Crisp corporate aesthetic with high-contrast slate typography.
- 🟢 **Green and White**: Fresh botanical emerald aesthetic for organic stores, supermarkets, and wellness shops.
- 🟤 **Brown and White**: Warm amber-bronze and ivory tones for bakeries, coffee shops, and artisan boutiques.
- **Instant Switcher**: Accessible from the Topbar, Business Settings (`/settings`), or directly from the Login page.

### 3. POS & Fast Billing
- **Keyboard-Optimized**: Lightning-fast sales workflow with hotkey shortcuts (`F2` for New Bill).
- **Payment Modes**: Seamless handling of Cash, Card, UPI, and Customer Credit.
- **Dynamic UPI QR Code**: Generates dynamic Indian UPI QR codes on receipts for instant payment via GPay, PhonePe, Paytm, or BHIM.
- **Thermal & Standard Printing**: Native support for POS-80 (80mm thermal receipt printers) and standard A4 invoice layouts.

### 4. Inventory, Stock & Recipes
- **Stock Tracking**: Real-time stock valuation, reorder alerts, and physical count reconciliation.
- **Menu & Food Production**: Recipe formulation, ingredient consumption tracking, and automated menu margin calculation.

### 5. Double-Entry Accounting & Bookkeeping
- **Complete General Ledger**: Cash Book, Bank & UPI Book, Day Book, and Journal Entries.
- **Capital & Loans**: Track owner capital, withdrawals (drawings), and secured/unsecured loans.
- **Financial Statements**: Instant real-time Trial Balance, Profit & Loss (P&L), Balance Sheet, and Cash Flow statements.

### 6. GST & Tax Compliance
- **Tax Invoices**: Full support for CGST, SGST, IGST, and composition schemes.
- **GST Reports**: Automated GSTR-1, GSTR-2, and GSTR-3B audit summaries.

### 7. Dual Engine: SQLite Offline-First + Supabase Cloud Sync
- **Zero-Latency Local Storage**: Works seamlessly offline without internet dependencies using SQLite.
- **Cloud Synchronization**: Optional automated and manual two-way synchronization to Supabase Cloud for cross-device access and remote backups.

### 8. Staff & Payroll Management
- Employee directory, daily attendance tracking, salary vouchers, and advance repayments.

---

## 🛠 Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, React Router
- **Backend**: Node.js, Express, Vite Middlewares (Dev Mode)
- **Local Engine**: Node SQLite (embedded, high concurrency)
- **Cloud Layer**: Supabase (PostgreSQL, Auth & Storage)
- **Bundler & Tooling**: Vite, ESBuild, TypeScript Compiler

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm** or **bun**

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ajfan6T/BillForceWeb.git
   cd BillForceWeb
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   *(Optional)* Configure Supabase Cloud credentials in `.env`:
   ```env
   PORT=3000
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```

4. **Run the Development Server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Build for Production:**
   ```bash
   npm run build
   npm start
   ```

---

## 📁 Project Structure

```
├── data/                    # Business SQLite databases & local file storage
│   ├── billforce.db         # Default single-business or legacy database
│   ├── businesses/          # Multi-tenant business databases (<slug>.db)
│   └── businesses.json      # Registered business catalog
├── src/
│   ├── core/                # Core domain, business logic, DB models, migrations
│   │   ├── business/        # Business manager & multi-tenant provisioning
│   │   ├── db/              # SQLite migrations, schema definitions, connection pool
│   │   ├── modules/         # Auth, Billing, Inventory, Accounts, GST services
│   │   └── supabase/        # Cloud sync service, schemas & client
│   ├── renderer/            # React SPA UI application
│   │   ├── components/      # UI component library (Button, Modal, Card, Forms)
│   │   ├── layout/          # Shell, Sidebar, Topbar, Mobile Bottom Nav
│   │   ├── pages/           # Pages (Dashboard, Sales, Stock, Accounts, Reports, Settings)
│   │   ├── styles/          # Design system & theme tokens (app.css)
│   │   └── theme.tsx        # Theme context & color scheme switchers
│   └── shared/              # Shared TypeScript types, date utilities, constants
├── server.ts                # Express fullstack server & API gateway
├── vite.config.ts           # Vite build configuration
└── package.json             # NPM package specifications & scripts
```

---

## 🎨 Color Themes

The application features three built-in palettes configured in `src/renderer/styles/app.css` and `src/renderer/theme.tsx`:

| Theme | Primary Color | Backgrounds | Best For |
| :--- | :--- | :--- | :--- |
| **Blue & White** *(Default)* | `#2563eb` (Royal Blue) | `#f4f7fb` & `#ffffff` | Corporate offices, wholesale, electronics, logistics |
| **Green & White** | `#059669` (Emerald) | `#f2f8f5` & `#ffffff` | Supermarkets, organic stores, pharmacy, eco-retail |
| **Brown & White** | `#854d0e` (Amber Bronze) | `#f9f6f2` & `#ffffff` | Bakeries, cafes, leather, artisan and luxury boutiques |

---

## 🔐 Security & Access Control

- **Password Hashing**: PBKDF2 with SHA-512 & per-user salts.
- **Account Lockout**: Automated brute-force lockout after repeated failed login attempts.
- **RBAC**: Strict role permissions (`billing.create`, `stock.manage`, `accounts.manage`, `reports.financial`, etc.).
- **Recovery Mode**: Cryptographic offline recovery codes for owner account password recovery.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
