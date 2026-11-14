BILLFORCE {{VERSION}}, server edition
=====================================

Runs BILLFORCE on a Mac, Linux or Windows computer or server; you use it in a web browser.
Website: https://billforce.in/

With Docker
-----------
  docker build -t billforce .
  docker run -d -p 3000:3000 -v billforce-data:/app/data --restart unless-stopped --name billforce billforce

With Node.js (22.13 or newer)
-----------------------------
  npm ci --omit=dev
  npm start

Then open http://localhost:3000 and choose "Register Business".
Other computers and phones on the same network open http://<this computer's IP address>:3000.
To use it over the internet, put it behind HTTPS (a reverse proxy such as Caddy or nginx).

Settings (environment variables)
--------------------------------
  PORT                     HTTP port (default 3000).
  BILLFORCE_DATA_DIR       Where every business's database, logins and backups are kept
                           (default ./data; /app/data in Docker). Back this folder up.
                           It can be moved or copied: stop BILLFORCE first.
  BILLFORCE_REGISTRATION   "closed" stops new businesses registering (existing ones still sign in).
  BILLFORCE_REGISTRATION_CONTACT  "optional": new businesses need not give a mobile number and email
                           (required by default).
  BILLFORCE_ADMIN_PASSWORD Turns on the admin login at /#/admin (8 characters or more; username
                           "admin", or BILLFORCE_ADMIN_USER): every business with its owner's
                           contact details and usage; backup, reset the owner's password, turn a
                           business off or on, remove it (a copy is kept in <data folder>/deleted).
  TRUST_PROXY              "1" behind a load balancer, so sign-in limits see real client addresses.
  BILLFORCE_MAX_UPLOAD_MB  Largest backup file that can be uploaded for a restore (default 200).

Updating: stop BILLFORCE, replace these files with the new download (keep the data folder), and
run the same commands again.
