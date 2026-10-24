<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/icon.png" alt="" width="120" height="120">
</p>

<h1 align="center">homebridge-synology-monitor</h1>

<p align="center">
  Your <b>Synology NAS</b> in the Apple Home app &mdash; switch it <b>on and off</b>, and see how it is doing: temperature, CPU and memory, storage health, drives and DSM updates. With a dashboard of its own.
</p>

<p align="center">
  <a href="https://github.com/rummeyer/homebridge-synology-monitor/actions/workflows/build.yml"><img src="https://github.com/rummeyer/homebridge-synology-monitor/actions/workflows/build.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/rummeyer/homebridge-synology-monitor/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-MIT-blue" alt="Licence"></a>
  <img src="https://img.shields.io/badge/homebridge-%E2%89%A5%202.0.0-purple" alt="Homebridge 2.0.0+">
  <img src="https://img.shields.io/badge/node-22%20%7C%2024%20%7C%2026-green" alt="Node 22, 24 or 26">
  <img src="https://img.shields.io/badge/DSM-7-0070c0" alt="DSM 7">
</p>

<p align="center">
  <a href="https://buymeacoffee.com/rummeyer"><img src="https://img.shields.io/badge/donate-Buy%20Me%20a%20Coffee-yellow" alt="Buy Me a Coffee"></a>
  <a href="https://paypal.me/rummeyer"><img src="https://img.shields.io/badge/donate-PayPal-00457C" alt="PayPal"></a>
  <a href="https://github.com/sponsors/rummeyer"><img src="https://img.shields.io/badge/sponsor-GitHub-ea4aaa" alt="GitHub Sponsors"></a>
</p>

---

**Power** your NAS on with Wake-on-LAN and shut it down cleanly through DSM,
from a tile in the Home app, a scene or Siri. Beside it, the NAS tells HomeKit
how it is doing: its **temperature**, its **CPU and memory load**, whether
its **storage** is healthy, how full its **volumes** are, how warm each
**drive** runs, and whether a **DSM update** is waiting. A storage problem
reaches your phone as a critical alert.

Everything comes from the NAS itself, through the **DSM Web API** — no
SNMP, no scripts on the NAS, no cloud. And a **dashboard** shows it all in the
look of Apple's Home app, with buttons to power on, shut down and restart.

<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/dashboard-home.png" alt="The dashboard in the Home look: a DS920+ with tiles for Power (on, white), temperature, CPU and memory load, storage health, Volume 1 at 44 % used, DSM Update up to date, and each drive's temperature, with the buttons Power on, Shut down and Restart below" width="760">
</p>

## Contents

- [In the Home app](#in-the-home-app)
- [Dashboard](#dashboard)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setting up](#setting-up)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Coming from homebridge-synology or nas-control](#coming-from-homebridge-synology-or-nas-control)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Licence](#licence)

## In the Home app

Each NAS is one accessory. The **Power** switch is always there; every other
part can be switched off in the settings.

| Accessory | Shows as | What it does |
| --- | --- | --- |
| **Power** | Switch | On wakes the NAS with Wake-on-LAN, off shuts it down through DSM. On while DSM answers. |
| **Temperature** | Temperature sensor | The system temperature |
| **CPU** | Fan | Its speed is the CPU load, in % |
| **Memory** | Fan | Its speed is the memory in use, in % |
| **Storage** | Leak sensor | Goes off when a volume or storage pool is degraded or crashed, a drive is failing, worn out or has too many bad sectors, or the system has crashed — with a critical alert from HomeKit |
| **DSM Update** | Occupancy sensor | Occupied while a DSM update is waiting |
| **Restart** | Switch | Restarts the NAS, and turns itself off again |
| **Drive 1** … **Cache device 1** … | Temperature sensor | One per drive, the M.2 cache drives too |
| **Volume 1** … | Humidity sensor | One per volume; its humidity is how full it is, in % |

HomeKit has no service for a load or a fill level, so a fan and a humidity
sensor stand in: their numbers are the ones DSM's Resource Monitor and Storage
Manager show. Tapping a fan changes nothing; it goes back.

**Power that does not flip back.** A NAS just woken takes minutes before DSM
answers, and one just shut down answers for a while yet. So after a wake the
switch stays on for up to **Startup time** (180 s), and after a shutdown off
for up to **Shutdown time** (120 s); a restart keeps it on until the NAS has
gone away and come back.

**While the NAS is off,** the fans stop and the sensors say they are not
active, keeping their last values. The drives and volumes stay in HomeKit,
with their names, until the next reading.

### Ideas for automations

- *When Storage detects a leak* — notify everyone at home.
- *At 1:00, if nobody is home* — turn **Power** off; *at 7:00* — on again.
- *When the CPU fan runs above 80 %* — turn on a light, to see a long
  indexing or backup job.
- *When DSM Update is occupied* — a reminder in the morning.

## Dashboard

A web page with every NAS, for a phone, a tablet on the wall or a desk —
without logging in to Homebridge: whether the NAS is on and for how long, its
temperature, CPU, memory, storage, each volume and drive, and whether DSM is
up to date. Below them, **Power on**, **Shut down** and **Restart**: each
needs a second press within four seconds, so a stray tap does nothing.

It opens in the **Home** look, after Apple's Home app — glass tiles on a
wallpaper, white for what is on — and the button at the top right switches to
**light** and **dark**. It updates itself every five seconds.

<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/dashboard-phone.png" alt="The dashboard on a phone: two tiles side by side" width="300">
</p>

**Turning it on:** tick **Dashboard** under *General* in the plugin's
settings, save, and restart the child bridge. The link appears under the
switch — `http://<your Homebridge machine>:8583/`. Any free port will do;
the Homebridge UI itself is usually on 8581.

**Who can press the buttons:** the page has no login. The buttons answer only
devices on the home network — private, link-local and loopback addresses —
and only the page's own script: another website open in the same browser
cannot press them. Still, anyone on your network can, so do not forward the
port to the internet. Untick **Buttons on the dashboard** for a page that
only shows.

## Requirements

- **Homebridge 2** and **Node.js 22.18, 24 or 26**
- A Synology NAS with **DSM 7**. DSM 6.2 has the same API and is expected to
  work. Tested on a DS920+ with DSM 7.4.
- A DSM account in the **administrators** group, **without 2-step
  verification** — shutting down and restarting need an administrator
- For the Power switch to turn the NAS **on**: Wake-on-LAN enabled on the NAS,
  and the Homebridge machine on the same network

## Installation

Search for **Synology Monitor** under *Plugins* in the Homebridge UI and
install it, or:

```bash
npm install -g homebridge-synology-monitor
```

Run it as a **child bridge**, so a NAS that does not answer never slows down
the rest of Homebridge: the plugin's bridge settings in the Homebridge UI, or
`"_bridge"` in config.json.

## Setting up

**1. An account for the plugin.** In DSM, *Control Panel → User & Group →
Create*: a user such as `homebridge` with a long password, in the
**administrators** group, without 2-step verification. A separate account
keeps it apart from your own, and shows its session by name.

**2. Wake-on-LAN.** *Control Panel → Hardware & Power → General* → **Enable
WOL on LAN 1** (and LAN 2, if the NAS is cabled there). The MAC address is
under *Control Panel → Info Center → Network*.

**3. The plugin.** Open its settings in the Homebridge UI, **+ Add** a NAS,
and fill in the host, the account and the MAC address. Save, and restart the
child bridge.

<p align="center">
  <img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/settings.png" alt="The plugin's settings: a NAS picked from a list with Add and Delete, its name, host, protocol and port, the DSM account, the power settings with the MAC address, the accessories as tick boxes, and General with the Dashboard switch, its link and its port" width="560">
</p>

**4. The Home app.** Add the child bridge with its code or QR code from the
Homebridge UI. The NAS appears as one accessory; *Show as Separate Tiles* in
its settings puts each sensor on a tile of its own.

## Settings

The settings page shows one NAS at a time, picked from the list. In
config.json:

```json
{
  "platform": "SynologyMonitor",
  "nas": [
    {
      "name": "Diskstation",
      "host": "192.168.1.20",
      "port": 5001,
      "username": "homebridge",
      "password": "…",
      "mac": "00:11:32:aa:bb:cc"
    }
  ],
  "dashboard": true
}
```

| Setting | Default | |
| --- | --- | --- |
| `name` | | The accessory's name in HomeKit. The NAS is remembered by it, so renaming it adds it anew. |
| `host` | | Its IP address or name on the home network |
| `protocol` | `https` | `https` or `http` |
| `port` | 5001, or 5000 for HTTP | DSM's port, as under *Control Panel → Login Portal* |
| `checkCertificate` | `false` | Check the HTTPS certificate. Only with one valid for `host`; DSM's own is self-signed. |
| `username`, `password` | | The DSM account |
| `mac` | | For Wake-on-LAN. Without it the NAS can be shut down but not woken. |
| `broadcast` | `255.255.255.255` | Where the Wake-on-LAN packet goes; the network's own, such as `192.168.1.255`, if the default does not reach the NAS |
| `startupSeconds` | 180 | How long Power stays on after a wake before DSM must answer |
| `shutdownSeconds` | 120 | How long Power stays off after a shutdown while DSM still answers |
| `sensors` | all `true` | `temperature`, `cpu`, `memory`, `storage`, `update`, `restart`, `disks`, `volumes`: `false` leaves that accessory out |
| `pollSeconds` | 30 | How often each NAS is asked, at least 10 |
| `dashboard` | `false` | The dashboard |
| `dashboardPort` | 8583 | Its port |
| `dashboardControls` | `true` | Its Power on, Shut down and Restart buttons |

Only what differs from the default needs to be written; the settings page
writes nothing else.

## How it works

- **Is it on?** Every poll opens a TCP connection to DSM's port. Whether it
  connects is whether the NAS is on — the same as a ping, without needing
  raw sockets.
- **Readings.** While it is on, the plugin asks DSM five things: its info
  (model, DSM version, temperature, uptime), the utilization (CPU, memory),
  the storage (volumes, pools, drives), the system status and — every six
  hours — whether an update is waiting. About 30 KB a poll.
- **One session.** It logs in once and keeps the session while it works,
  logging in again only when DSM ends it. The session is named
  *SynologyMonitor* in DSM's list of connections. Requests are POSTed, so the
  password is never part of a URL, and it is never sent to the dashboard.
- **Power.** On is a Wake-on-LAN magic packet broadcast to UDP port 9; off
  and restart are `SYNO.Core.System` `shutdown` and `reboot`.
- **Errors in words.** DSM answers with numbers; the log says what they mean
  — *wrong username or password*, *the account uses 2-step verification*,
  *this address is blocked by DSM after too many failed logins* — and says
  each only once, until it changes.

## Coming from homebridge-synology or nas-control

**[homebridge-synology](https://github.com/stfnhmplr/homebridge-synology):**
its settings map straight across — `host`, `port`, `protocol`, `username`,
`password` and `mac` keep their meaning, and `startupTime` and
`shutdownTime` are `startupSeconds` and `shutdownSeconds`. Add the NAS here,
check the new accessory works, then uninstall homebridge-synology and remove
its bridge in the Home app; automations that used its switch need the new
**Power** switch.

**[nas-control](https://github.com/rummeyer/nas-control):** the dashboard does
what it did — wake, shut down, status, buttons for the home network only —
inside Homebridge, with the readings beside it. Its
`nas.url`, `nas.user`, `nas.pass` and `nas.mac` are `protocol` / `host` /
`port`, `username`, `password` and `mac` here.

## Troubleshooting

**"wrong username or password"**, **"2-step verification"**: the account
cannot log in as it is. Use one without 2-step verification.

**"the account has no permission for this"** on shutting down or restarting:
the account is not an administrator.

**"this address is blocked by DSM"**: too many failed logins from the
Homebridge machine. Unblock it under *Control Panel → Security →
Protection*.

**The Power switch does not turn the NAS on**: check Wake-on-LAN is enabled
for the port the NAS is cabled to, and that the MAC address is that port's.
In another subnet or VLAN, set **Broadcast address** to that network's — or
use a router that forwards it.

**"could not read it" while the NAS is starting**: DSM accepts connections
before it can log in. It reads again by itself once it can.

**The sensors show "Not responding" or old values**: the NAS is off, or the
Homebridge machine cannot reach it. The Power switch says which.

**The dashboard does not open**: is **Dashboard** ticked, and the child
bridge restarted since? The log says `Dashboard on port 8583` when it is up,
or why the port could not be used.

## Support

Questions and bugs: [GitHub issues](https://github.com/rummeyer/homebridge-synology-monitor/issues).
When something does not work, the log lines of the child bridge help most.

If the plugin is useful to you, you can support its development:

<p>
  <a href="https://buymeacoffee.com/rummeyer"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?logo=buymeacoffee&logoColor=000" alt="Buy Me a Coffee"></a>
  <a href="https://paypal.me/rummeyer"><img src="https://img.shields.io/badge/PayPal-00457C?logo=paypal&logoColor=fff" alt="PayPal"></a>
  <a href="https://github.com/sponsors/rummeyer"><img src="https://img.shields.io/badge/GitHub%20Sponsors-ea4aaa?logo=githubsponsors&logoColor=fff" alt="GitHub Sponsors"></a>
</p>

The Homebridge UI shows the same links behind the plugin's **Donate** button.

## Licence

MIT. Synology and DiskStation are trademarks of Synology Inc.; this plugin is
not made by or affiliated with Synology.
