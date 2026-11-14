# Online billing on AWS (billit.billforce.in)

BILLFORCE online runs on one small AWS **Lightsail** server in Mumbai. It is always on, so online
billing no longer depends on a laptop. The existing **Cloudflare Tunnel** moves to the server, so
billit.billforce.in keeps working with HTTPS and no ports need to be opened.

**Database:** BILLFORCE keeps each business in its own SQLite database file on the server's disk
(`/var/lib/billforce`). There is no separate database service to rent (no RDS). Lightsail's
automatic daily snapshots back up the whole disk, databases included.

```
visitor -> https://billit.billforce.in -> Cloudflare -> tunnel -> Lightsail server: BILLFORCE (port 3000)
                                                                  data: /var/lib/billforce (SQLite)
```

Cost: the 2 GB Lightsail plan is about USD 12 a month, plus a few cents a month for snapshots.

## 1. Create the server

1. Sign in to the AWS console, search for **Lightsail** and open it.
2. **Create instance**:
   - Location: **Mumbai, Zone A (ap-south-1a)**.
   - Platform: **Linux/Unix**. Blueprint: **OS Only** → **Ubuntu 24.04 LTS**.
   - Plan: **2 GB RAM** (General purpose, about USD 12/month). The 1 GB plan works for a handful of
     businesses.
   - Name: `billforce-server`. Click **Create instance** and wait until it says **Running**.
3. Open the instance → **Networking**. Under IPv4 firewall, delete the **HTTP (80)** rule; keep
   **SSH (22)**. The tunnel needs no open ports.
4. Open **Snapshots** → **Automatic snapshots** → turn it **on** (a daily backup of the whole
   server, kept for 7 days).

## 2. Move the data from the laptop

On the laptop, in **PowerShell as Administrator**:

```powershell
Stop-ScheduledTask -TaskName 'BILLFORCE'
Disable-ScheduledTask -TaskName 'BILLFORCE'
& 'C:\Program Files (x86)\cloudflared\cloudflared.exe' service uninstall
tar -czf C:\billforce\billforce-data.tar.gz -C C:\billforce data
```

(If the `cloudflared` line says the file is not found, use `cloudflared.exe service uninstall`.) From
now until step 3 is done, billit.billforce.in is offline.

Copy the file to the server:

1. In Lightsail, open **Account** (top right) → **SSH keys** → **Download** the default key for
   **Mumbai**. It saves as `LightsailDefaultKey-ap-south-1.pem` in Downloads.
2. On the instance page, note its **Public IPv4 address** (e.g. `13.233.10.20`).
3. In PowerShell (replace the address with yours):

```powershell
$key = "$env:USERPROFILE\Downloads\LightsailDefaultKey-ap-south-1.pem"
icacls $key /inheritance:r /grant:r "$($env:USERNAME):R"
scp -i $key C:\billforce\billforce-data.tar.gz ubuntu@13.233.10.20:~
```

Type `yes` if it asks whether to trust the server.

## 3. Install BILLFORCE on the server

Get the tunnel token: Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** →
**billforce-pc** → **Configure**. In the install command shown there, copy only the long token after
`service install`.

On the Lightsail instance page click **Connect using SSH**. In the window that opens, run (paste
your token in place of `PASTE_TOKEN_HERE`):

```bash
curl -fsSLO https://github.com/ajfan6T/billforce-releases/releases/latest/download/Billforce-Server.tar.gz
tar -xzf Billforce-Server.tar.gz
sudo bash billforce-server/install-linux.sh --import-data ~/billforce-data.tar.gz --tunnel-token PASTE_TOKEN_HERE
```

It installs Node.js, BILLFORCE (as a service that starts with the server), your data and the
tunnel, and ends with:

```
==> BILLFORCE is running
  Admin login (open /#/admin):  username admin   password Xy7...
```

Write the admin password down.

## 4. Check

- Open **https://billit.billforce.in** and sign in to a business with its usual name, username and
  password: the bills from the laptop are there.
- Open **https://billit.billforce.in/#/admin** and sign in with `admin` and the password from step 3.
- In Cloudflare → Tunnels, **billforce-pc** shows one connector, now on the server (Linux).

The laptop is no longer needed for online billing. Its copy of the data (`C:\billforce\data`) can
stay as an extra backup.

## Everyday commands (Connect using SSH)

| What | Command |
|---|---|
| Is it running? | `systemctl status billforce` |
| Last log lines | `sudo journalctl -u billforce -n 50` |
| Restart | `sudo systemctl restart billforce` |
| Change settings (admin password, close registration) | `sudo nano /etc/billforce/billforce.env`, then restart |
| Download a copy of all data | `sudo tar -czf ~/billforce-data-$(date +%F).tar.gz -C /var/lib billforce`, then on the laptop: `scp -i $key ubuntu@13.233.10.20:~/billforce-data-*.tar.gz .` |

## Updating BILLFORCE

When a new version is released, Connect using SSH and run:

```bash
rm -rf Billforce-Server.tar.gz billforce-server
curl -fsSLO https://github.com/ajfan6T/billforce-releases/releases/latest/download/Billforce-Server.tar.gz
tar -xzf Billforce-Server.tar.gz
sudo bash billforce-server/install-linux.sh
```

The data and settings are kept; only the program is replaced. Take a manual snapshot first
(Snapshots → Create snapshot) for a big update.

## If something does not work

| Problem | Check |
|---|---|
| billit.billforce.in shows Cloudflare error 1033 | The tunnel is not connected: `systemctl status cloudflared`; run the install again with `--tunnel-token` |
| Error 502 | BILLFORCE is not running: `sudo journalctl -u billforce -n 50` |
| "The data folder already has businesses" | The data was imported before. To import again: `sudo systemctl stop billforce`, `sudo mv /var/lib/billforce /var/lib/billforce.before`, run the install command again |
| `scp`: "UNPROTECTED PRIVATE KEY FILE" | Run the `icacls` line again, in the same PowerShell window |
| `scp`: connection timed out | The Lightsail firewall must allow SSH (22) |
