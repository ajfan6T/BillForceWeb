# Online billing at billit.billforce.in (AWS, Windows Server)

BILLFORCE online is the **server edition** running on your AWS Windows server. People open
**https://billit.billforce.in**, sign in to their business and bill in the browser. The website's
**Bill online** button and **https://billforce.in/billit/** both lead there.

It uses a subdomain (`billit.billforce.in`) rather than a folder (`billforce.in/billit`) because
billforce.in itself is served by GitHub Pages: one domain name can only point to one server, so the
app gets its own name that points to your AWS server.

```
billforce.in          ->  GitHub Pages  (website, downloads)
billforce.in/billit/  ->  forwards to billit.billforce.in
billit.billforce.in   ->  your AWS server: Caddy (HTTPS) -> BILLFORCE server on port 3000
```

Run every command below in **PowerShell as Administrator** on the server (Remote Desktop).

## 1. AWS

1. **Elastic IP**: EC2 → Elastic IPs → Allocate, then Associate it with the instance. Without it
   the address changes when the instance stops.
2. **Security group** of the instance, inbound rules:
   - HTTP, TCP 80, from `0.0.0.0/0` (needed for the HTTPS certificate)
   - HTTPS, TCP 443, from `0.0.0.0/0`
   - RDP, TCP 3389, from **My IP** only
   - Do not open 3000.
3. Size: a `t3.small` (2 GB RAM) is plenty to start; each business is one small database file.

## 2. DNS

At your domain registrar add:

| Type | Name / Host | Value |
|---|---|---|
| A | `billit` | your Elastic IP |

## 3. Windows firewall

```powershell
New-NetFirewallRule -DisplayName "BILLFORCE HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow
New-NetFirewallRule -DisplayName "BILLFORCE HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

## 4. Node.js

Install **Node.js 22 LTS** (22.13 or newer) with the Windows installer (`.msi`, x64) from
https://nodejs.org. Then open a **new** PowerShell window and check:

```powershell
node --version
```

## 5. BILLFORCE server

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

Create the start file `C:\billforce\start.cmd`:

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
```

Start it now and at every boot (it restarts by itself if it stops):

```powershell
$action   = New-ScheduledTaskAction -Execute 'C:\billforce\start.cmd'
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'BILLFORCE' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'BILLFORCE'
Start-Sleep 5
Invoke-RestMethod http://localhost:3000/api/health
```

The last command should show `status: ok`. If not, read `C:\billforce\billforce.log`.

## 6. HTTPS with Caddy

Caddy gets and renews a free Let's Encrypt certificate by itself.

1. Download Caddy for **Windows amd64** from https://caddyserver.com/download, rename the file to
   `caddy.exe` and put it in `C:\caddy\`.
2. Create its settings and start it at every boot:

```powershell
@'
billit.billforce.in {
	encode gzip
	reverse_proxy localhost:3000
}
'@ | Set-Content -Encoding ascii C:\caddy\Caddyfile

$action   = New-ScheduledTaskAction -Execute 'C:\caddy\caddy.exe' -Argument 'run --config C:\caddy\Caddyfile' -WorkingDirectory 'C:\caddy'
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Caddy' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest
Start-ScheduledTask -TaskName 'Caddy'
```

Do this after the DNS record of step 2 works (`nslookup billit.billforce.in` shows the Elastic IP),
or the certificate cannot be issued yet; Caddy keeps retrying.

Open **https://billit.billforce.in** and choose **Register Business**.

## 7. Who can register

By default anyone who opens the site can register a new business. To create the businesses
yourself and then stop sign-ups, remove `rem ` from the `BILLFORCE_REGISTRATION=closed` line in
`C:\billforce\start.cmd` and restart:

```powershell
Stop-ScheduledTask -TaskName 'BILLFORCE'; Start-ScheduledTask -TaskName 'BILLFORCE'
```

Existing businesses can still sign in.

## 8. Backups

- Every business can turn on automatic backups (Settings → Backup & recovery); they are saved in
  `C:\billforce\data\backups`, on the same disk.
- Also protect the whole disk: AWS → EC2 → **Lifecycle Manager** → create a policy that takes a
  daily EBS snapshot of the instance's volume and keeps, for example, 14.

## 9. Updating BILLFORCE

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

The data in `C:\billforce\data` is kept; the database is updated on first start.
