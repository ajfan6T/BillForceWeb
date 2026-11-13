# Online billing at billit.billforce.in from a Windows PC

BILLFORCE online is the **server edition** running on a Windows PC or laptop. People open
**https://billit.billforce.in**, sign in to their business and bill in the browser. The website's
**Bill online** button and **https://billforce.in/billit/** lead there.

A home or office connection usually cannot accept visitors from the internet (no fixed address,
the router blocks them, many Indian ISPs share one address between customers). A free
**Cloudflare Tunnel** solves this: a small Cloudflare program on the PC keeps a connection open to
Cloudflare, and Cloudflare sends the visitors of billit.billforce.in through it, with HTTPS.
No router settings, no open ports.

```
visitor -> https://billit.billforce.in -> Cloudflare -> tunnel -> this PC: BILLFORCE on port 3000
```

The PC must stay **on and online**: when it sleeps or is off, online billing is unavailable.

Use **PowerShell as Administrator** (Start → type PowerShell → right-click → Run as administrator).

## 1. Keep the PC awake

Settings → System → Power: when plugged in, **Screen** off after a few minutes is fine, but
**Sleep: Never**. On a laptop, also set "When I close the lid" (Control Panel → Power Options →
Choose what closing the lid does) to **Do nothing** for "Plugged in". Or run:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

## 2. Install Node.js

```powershell
winget install OpenJS.NodeJS.LTS
```

Close PowerShell, open it again as Administrator, and check `node --version` shows v22 or newer.

## 3. Install the BILLFORCE server

```powershell
New-Item -ItemType Directory -Force C:\billforce\data | Out-Null
Set-Location C:\billforce
Invoke-WebRequest https://github.com/ajfan6T/billforce-releases/releases/latest/download/Billforce-Server.tar.gz -OutFile Billforce-Server.tar.gz
tar -xzf Billforce-Server.tar.gz
Set-Location C:\billforce\billforce-server
npm ci --omit=dev
```

The program is in `C:\billforce\billforce-server`; the businesses' data is kept apart in
`C:\billforce\data`, so updating never touches it.

Create the start file and make BILLFORCE start with Windows (and restart if it stops):

```powershell
@'
@echo off
set PORT=3000
set BILLFORCE_DATA_DIR=C:\billforce\data
set TRUST_PROXY=1
rem set BILLFORCE_REGISTRATION=closed
cd /d C:\billforce\billforce-server
"C:\Program Files\nodejs\node.exe" --disable-warning=ExperimentalWarning dist\server.js >> C:\billforce\billforce.log 2>&1
'@ | Set-Content -Encoding ascii C:\billforce\start.cmd

$action   = New-ScheduledTaskAction -Execute 'C:\billforce\start.cmd'
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'BILLFORCE' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'BILLFORCE'
Start-Sleep 5
Invoke-RestMethod http://localhost:3000/api/health
```

The last command should show `status : ok`. Open http://localhost:3000 in your browser: the
BILLFORCE sign-in page appears. (If not, read `C:\billforce\billforce.log`.)

## 4. Move billforce.in's DNS to Cloudflare (free)

The tunnel needs Cloudflare to answer for billforce.in. The website keeps working.

1. Create an account at https://dash.cloudflare.com/sign-up.
2. **Add a domain** → `billforce.in` → choose the **Free** plan.
3. Cloudflare copies the existing DNS records. Check the list has the website records, and add any
   that are missing:

   | Type | Name | Value | Proxy status |
   |---|---|---|---|
   | A | `@` | `185.199.108.153` | DNS only (grey cloud) |
   | A | `@` | `185.199.109.153` | DNS only |
   | A | `@` | `185.199.110.153` | DNS only |
   | A | `@` | `185.199.111.153` | DNS only |
   | CNAME | `www` | `ajfan6t.github.io` (or `billforce.in`) | DNS only |

   Keep email (MX, TXT) records as they are. Set the records above to **DNS only** (click the
   orange cloud so it turns grey): GitHub Pages then keeps managing the website's certificate.
4. Cloudflare shows **two nameservers** (like `xxx.ns.cloudflare.com`). At the registrar where you
   bought billforce.in, change the domain's **nameservers** to those two (replacing the
   registrar's own). Cloudflare emails you when it is active: usually within an hour, sometimes up
   to a day. Check that https://billforce.in still opens.

## 5. Create the tunnel

1. In the Cloudflare dashboard open **Zero Trust** (left menu). The first time, pick a team name
   and the **Free** plan.
2. **Networks → Tunnels → Create a tunnel** → type **Cloudflared** → name it `billforce-pc` → Save.
3. Choose **Windows** and **64-bit**. Cloudflare shows how to install `cloudflared` and a command
   that starts with `cloudflared.exe service install` followed by a long token.
   - Install: `winget install --id Cloudflare.cloudflared`, then close and reopen PowerShell as
     Administrator.
   - Run the `cloudflared.exe service install ...` command exactly as Cloudflare shows it. This
     installs the tunnel as a Windows service, so it starts with Windows.
   The dashboard then shows the connector as **Connected**. Click **Next**.
4. **Public hostname** (also called "Route traffic" / "Published application"):
   - Subdomain: `billit`
   - Domain: `billforce.in`
   - Path: leave empty
   - Service type: **HTTP**, URL: `localhost:3000`
   Save. Cloudflare creates the `billit` DNS record itself.

Open **https://billit.billforce.in** on your phone (on mobile data, to be sure it works from
outside) and choose **Register Business**.

## 6. Who can register

By default anyone who opens the site can register a business. To create the businesses yourself
and then stop new sign-ups: in `C:\billforce\start.cmd` remove `rem ` from the
`BILLFORCE_REGISTRATION=closed` line and restart BILLFORCE:

```powershell
Stop-ScheduledTask -TaskName 'BILLFORCE'; Start-ScheduledTask -TaskName 'BILLFORCE'
```

Existing businesses can still sign in.

## 7. Backups

Each business turns on automatic backups in Settings → Backup & recovery; they are saved in
`C:\billforce\data\backups`. That is the same disk, so copy them off the PC every day, for example
into OneDrive or Google Drive (replace the folder with yours):

```powershell
$copy = New-ScheduledTaskAction -Execute 'robocopy.exe' -Argument '"C:\billforce\data\backups" "C:\Users\YOU\OneDrive\BILLFORCE server backups" /E /R:1 /W:1'
Register-ScheduledTask -TaskName 'BILLFORCE backup copy' -Action $copy -Trigger (New-ScheduledTaskTrigger -Daily -At 11pm) -User 'SYSTEM' -RunLevel Highest
```

## 8. Updating BILLFORCE

```powershell
Stop-ScheduledTask -TaskName 'BILLFORCE'
Set-Location C:\billforce
Invoke-WebRequest https://github.com/ajfan6T/billforce-releases/releases/latest/download/Billforce-Server.tar.gz -OutFile Billforce-Server.tar.gz
Remove-Item -Recurse -Force C:\billforce\billforce-server
tar -xzf Billforce-Server.tar.gz
Set-Location C:\billforce\billforce-server
npm ci --omit=dev
Start-ScheduledTask -TaskName 'BILLFORCE'
```

The data in `C:\billforce\data` is kept; the databases are updated on first start.

## If something does not work

| Problem | Check |
|---|---|
| http://localhost:3000 does not open | `C:\billforce\billforce.log`; `Get-ScheduledTask BILLFORCE` shows *Running* |
| billit.billforce.in shows a Cloudflare error 1033 / 502 | The tunnel is not connected (Zero Trust → Tunnels) or BILLFORCE is not running on port 3000 |
| billforce.in stopped opening after moving to Cloudflare | The four A records for `@` exist and are *DNS only* |
| Works on Wi-Fi but not elsewhere | Test on mobile data; the tunnel must show *Connected* |
