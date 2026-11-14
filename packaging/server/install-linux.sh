#!/usr/bin/env bash
# Install or update the BILLFORCE server on Ubuntu / Debian (e.g. an AWS Lightsail or EC2 server).
#
#   sudo bash install-linux.sh                         install, or update to the files next to this script
#   sudo bash install-linux.sh --tunnel-token <token>  also connect a Cloudflare Tunnel (no open ports needed)
#   sudo bash install-linux.sh --import-data <file>    first bring in a data folder (.tar.gz of "data")
#
# What it sets up:
#   /opt/billforce/app            the program (replaced on every update)
#   /var/lib/billforce            every business's data and backups (never touched by updates)
#   /etc/billforce/billforce.env  settings: port, admin password, registration...
#   billforce.service             starts with the server, restarts if it stops
set -euo pipefail

APP_DIR=/opt/billforce/app
DATA_DIR=/var/lib/billforce
ENV_DIR=/etc/billforce
ENV_FILE=$ENV_DIR/billforce.env
SERVICE=/etc/systemd/system/billforce.service
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TUNNEL_TOKEN=""
IMPORT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel-token) TUNNEL_TOKEN="${2:-}"; shift 2 ;;
    --import-data) IMPORT="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo bash $0"; exit 1; }
[ -f "$SRC/dist/server.js" ] || { echo "Run this script from the unpacked billforce-server folder."; exit 1; }
command -v apt-get > /dev/null || { echo "This script is for Ubuntu or Debian."; exit 1; }

# 1. Node.js 22 or newer (BILLFORCE needs 22.13+). An older node elsewhere on the PATH is left alone.
node_ok() { [ -x "$1" ] && "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2> /dev/null; }
NODE_BIN=""
for candidate in "$(command -v node 2> /dev/null || true)" /usr/bin/node; do
  if [ -n "$candidate" ] && node_ok "$candidate"; then NODE_BIN="$candidate"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  say "Installing Node.js 22"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
  NODE_BIN=/usr/bin/node
  node_ok "$NODE_BIN" || { echo "Node.js 22.13 or newer could not be installed."; exit 1; }
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"
export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "Node.js $("$NODE_BIN" --version) ($NODE_BIN)"

# 2. A user that owns the data and runs the service (no login).
id billforce > /dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin billforce
mkdir -p "$DATA_DIR" "$ENV_DIR" /opt/billforce

# 3. Settings (kept on updates). The admin password is made once and shown at the end.
NEW_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  NEW_PASSWORD="$("$NODE_BIN" -e "process.stdout.write(require('crypto').randomBytes(12).toString('base64url'))")"
  cat > "$ENV_FILE" <<EOF
# BILLFORCE settings. After a change: sudo systemctl restart billforce
PORT=3000
BILLFORCE_DATA_DIR=$DATA_DIR
TRUST_PROXY=1
BILLFORCE_ADMIN_USER=admin
BILLFORCE_ADMIN_PASSWORD=$NEW_PASSWORD
# BILLFORCE_REGISTRATION=closed
# BILLFORCE_REGISTRATION_CONTACT=optional
EOF
fi
chmod 600 "$ENV_FILE"

# 4. The program: replaced as a whole, then its packages installed.
systemctl stop billforce 2> /dev/null || true
say "Installing BILLFORCE $("$NODE_BIN" -p "require('$SRC/package.json').version")"
rm -rf "$APP_DIR.new"
mkdir -p "$APP_DIR.new"
cp -r "$SRC/dist" "$SRC/public" "$SRC/package.json" "$SRC/package-lock.json" "$APP_DIR.new/"
[ -f "$SRC/supabase_schema.sql" ] && cp "$SRC/supabase_schema.sql" "$APP_DIR.new/"
(cd "$APP_DIR.new" && "$NPM_BIN" ci --omit=dev --no-audit --no-fund)
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$APP_DIR.new" "$APP_DIR"

# 5. Data brought from another computer (only into an empty data folder).
if [ -n "$IMPORT" ]; then
  [ -f "$IMPORT" ] || { echo "File not found: $IMPORT"; exit 1; }
  if [ -f "$DATA_DIR/businesses.json" ]; then
    echo "The data folder already has businesses, so $IMPORT was not imported."
    echo "To replace them: sudo systemctl stop billforce; sudo mv $DATA_DIR $DATA_DIR.before; then run this again."
    exit 1
  fi
  say "Importing data from $IMPORT"
  tmp="$(mktemp -d)"
  tar -xzf "$IMPORT" -C "$tmp"
  from="$tmp"
  [ -f "$tmp/data/businesses.json" ] && from="$tmp/data"
  [ -f "$from/businesses.json" ] || { echo "No businesses.json in $IMPORT: pack the whole data folder."; exit 1; }
  cp -a "$from/." "$DATA_DIR/"
  rm -rf "$tmp"
fi
chown -R billforce:billforce "$DATA_DIR"

# 6. The service.
cat > "$SERVICE" <<EOF
[Unit]
Description=BILLFORCE server
After=network-online.target
Wants=network-online.target

[Service]
User=billforce
Group=billforce
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$NODE_BIN --disable-warning=ExperimentalWarning $APP_DIR/dist/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now billforce

say "Checking that BILLFORCE answers"
ok=0
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/health > /dev/null; then ok=1; break; fi
  sleep 1
done
if [ $ok = 1 ]; then
  curl -s http://127.0.0.1:3000/api/health; echo
else
  echo "BILLFORCE did not start. See: sudo journalctl -u billforce -n 50"
  exit 1
fi

# 7. Cloudflare Tunnel (optional): billit.billforce.in reaches this server without open ports.
if [ -n "$TUNNEL_TOKEN" ]; then
  say "Connecting the Cloudflare Tunnel"
  if ! command -v cloudflared > /dev/null; then
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -y
    apt-get install -y cloudflared
  fi
  cloudflared service uninstall > /dev/null 2>&1 || true
  cloudflared service install "$TUNNEL_TOKEN"
  systemctl enable --now cloudflared
fi

rm -rf "$APP_DIR.old"
say "BILLFORCE is running"
echo "  Data:      $DATA_DIR"
echo "  Settings:  $ENV_FILE"
echo "  Logs:      sudo journalctl -u billforce -f"
if [ -n "$NEW_PASSWORD" ]; then
  echo
  echo "  Admin login (open /#/admin):  username admin   password $NEW_PASSWORD"
  echo "  Write it down. To change it: sudo nano $ENV_FILE, then sudo systemctl restart billforce"
fi
