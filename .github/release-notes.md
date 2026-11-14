## BILLFORCE for Windows

**Download `Billforce-Setup.exe` below and double-click it.** BILLFORCE installs and opens; a shortcut is added to the desktop and the Start menu. No internet, Node.js or Docker needed.

- **Your data is saved on this computer**, in `%APPDATA%\BILLFORCE\data` (one file per business). It stays when BILLFORCE is updated; when you uninstall, you choose whether to keep it.
- **Automatic backups** every day, week or month (Settings → Backup & recovery), saved in `Documents\BILLFORCE Backups` or in a folder you choose: a pen drive, an external disk or a OneDrive / Google Drive folder.
- **Bills print straight to your receipt printer**: choose it in Settings → Receipt & printer.
- Backups from the website or the browser edition can be restored in the app, and the other way round.

### New in this version
- **Bills on WhatsApp, fixed**: a WhatsApp chat link can only carry text, so the bill picture never went by itself. In the Windows app, Save & WhatsApp now shows how to add it before the chat opens: click in the message box, press Ctrl+V and Send. With online billing (billit.billforce.in) the message carries a link the customer taps to see the bill, so nothing has to be attached.
- **Online billing on phones**: pages scroll properly (the dashboard and others stopped at the first screen), the sign-in page fits the screen, the dashboard shows amounts in full, and on the billing screen each item is a card with its quantity, rate, discount and amount, with the customer, payment and Save buttons below.
- **Online billing: contact details and an admin**: a business registering online gives its mobile number and email address. The person running the server gets an admin login (set BILLFORCE_ADMIN_PASSWORD; open /#/admin) that lists every business with its owner, contact details, bills and last use, and can export the list, download a backup, reset the owner's password, turn a business off or on, and remove it (a copy is kept).

### New in 1.7
- **Partners**: for a business run by partners. Add each partner with their share of profit in Accounts → Partners; each gets their own capital and drawings account. Record the money each one invests, what they take out, and expenses they pay from their own pocket (on the Expenses page, tick "A partner paid this"). Every partner's page shows what they invested, paid for the business and took out, their balance and a full statement. At year-end closing the profit is shared by their profit-sharing ratio, and the balance sheet shows each partner's capital.
- **Moving your data is safe**: a data folder that was moved or copied (to another computer, or on a server) now works on its own files, and its backups are found in their new place. Before, a copy could keep writing to the folder it was copied from.

### New in 1.6
- **Reset data**: the owner can start again with empty books from Settings → Backup & recovery, with their password. Delete every bill, purchase, payment and accounts entry and keep your items, menu, customers, suppliers and employees, or delete everything. Settings, logins and the chart of accounts are kept, and a safety backup is saved first so a reset can be undone.
- **Uninstalling asks about your data**: when you uninstall BILLFORCE, you choose whether to delete all its data too, and then whether to delete the backups in Documents. Updating never deletes anything.

### "Windows protected your PC"
The installer is not code-signed yet, so Windows SmartScreen may warn the first time. Click **More info**, then **Run anyway**.

### Updating
Download the new `Billforce-Setup.exe` and run it. Your data and backups are kept.
