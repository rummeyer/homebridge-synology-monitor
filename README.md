# Synology Monitor

A [Homebridge](https://homebridge.io) plugin for a Synology NAS: turn it on and
off from HomeKit, and see how it is doing — its temperature, CPU and memory
load, storage health, how full its volumes are, its drives' temperatures and
whether a DSM update is waiting. With a dashboard of its own, for a browser
on the home network.

It talks to the NAS through the DSM Web API, and wakes it with Wake-on-LAN.
In place of [homebridge-synology](https://github.com/stfnhmplr/homebridge-synology):
the same Power switch, and everything else beside it.

## In the Home app

Each NAS is one accessory. The Power switch is always there; every other
part can be switched off in the settings.

| Accessory | Shows as | What it does |
| --- | --- | --- |
| **Power** | Switch | On wakes the NAS with Wake-on-LAN, off shuts it down through DSM. On while DSM answers. |
| **Temperature** | Temperature sensor | The system temperature |
| **CPU** | Fan | Its speed is the CPU load, in % |
| **Memory** | Fan | Its speed is the memory in use, in % |
| **Storage** | Leak sensor | Goes off when a volume or storage pool is degraded or crashed, a drive is failing, worn out or has too many bad sectors, or the system has crashed. HomeKit sends a critical notification. |
| **DSM Update** | Occupancy sensor | Occupied while a DSM update is waiting |
| **Restart** | Switch | Restarts the NAS, and turns itself off again |
| **Drive 1** … | Temperature sensor | One per drive, with its temperature, the M.2 cache drives too |
| **Volume 1** … | Humidity sensor | One per volume; its humidity is how full the volume is, in % |

HomeKit has no service for a load or a fill level, so a fan and a humidity
sensor stand in: their numbers are the ones DSM's Resource Monitor and
Storage Manager show. Tapping a fan changes nothing; it goes back.

A NAS just woken takes a few minutes before DSM answers. Meanwhile the Power
switch stays on, for up to **Startup time** (180 s); after a shutdown it stays
off for up to **Shutdown time** (120 s) while DSM still answers. A restart
keeps it on until the NAS has gone away and come back.

While the NAS is off the fans stop and the sensors say they are not active,
keeping their last values; the drives and volumes stay in HomeKit, with
their names, until the next reading.

## Requirements

- Homebridge 2 and Node.js 22.18, 24 or 26
- DSM 7; DSM 6.2 has the same API and is expected to work
- A DSM account in the **administrators** group, **without 2-step
  verification** — shutting down and restarting need an administrator. Best
  a separate account just for this, such as `homebridge`.
- For the Power switch to turn the NAS on: **Wake-on-LAN** enabled on the NAS,
  under *Control Panel → Hardware & Power → General*, and its MAC address,
  from *Control Panel → Info Center → Network*

## Installation

Search for **Synology Monitor** under *Plugins* in the Homebridge UI, or:

```bash
npm install -g homebridge-synology-monitor
```

Then add a NAS in the plugin's settings and restart Homebridge. Running it as
a **child bridge** keeps a NAS that does not answer from slowing down the rest.

## Configuration

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
  ]
}
```

| Setting | Default | |
| --- | --- | --- |
| `name` | | The accessory's name in HomeKit. The NAS is remembered by it. |
| `host` | | Its IP address or name on the home network |
| `protocol` | `https` | `https` or `http` |
| `port` | 5001, or 5000 for HTTP | DSM's port, as under *Control Panel → Login Portal* |
| `checkCertificate` | `false` | Check the HTTPS certificate. Only with one valid for `host`; DSM's own is self-signed. |
| `username`, `password` | | The DSM account |
| `mac` | | For Wake-on-LAN. Without it the NAS can be shut down but not woken. |
| `broadcast` | `255.255.255.255` | Where the Wake-on-LAN packet goes; the network's own, such as `10.0.1.255`, if the default does not reach the NAS |
| `startupSeconds` | 180 | How long Power stays on after a wake before DSM must answer |
| `shutdownSeconds` | 120 | How long Power stays off after a shutdown while DSM still answers |
| `sensors` | all `true` | `temperature`, `cpu`, `memory`, `storage`, `update`, `restart`, `disks`, `volumes`: `false` leaves that accessory out |
| `pollSeconds` | 30 | How often each NAS is asked, at least 10 |
| `dashboard` | `false` | The dashboard, see below |
| `dashboardPort` | 8583 | Its port |
| `dashboardControls` | `true` | Its Power on, Shut down and Restart buttons |

Each poll asks DSM five things — its info, the utilization, the storage, its
status and, every six hours, whether an update is waiting — with one session
that is kept while it works. The session shows as *SynologyMonitor* under
*Control Panel → Security → Account* in DSM's list of connections.

### Coming from homebridge-synology

Its settings map straight across: `host`, `port`, `protocol`, `username`,
`password` and `mac` keep their meaning, and `startupTime` and
`shutdownTime` are `startupSeconds` and `shutdownSeconds`. Add the NAS
here, check the new accessory works, then remove homebridge-synology and its
accessory.

## Dashboard

A web page with every NAS, for a phone, a tablet or a desk, without logging in
to Homebridge — what nas-control was, inside the plugin: whether the NAS is
on, its temperature, CPU, memory, storage, volumes, drives and DSM update,
and buttons to **Power on**, **Shut down** and **Restart**. A button needs a
second press within four seconds, so a stray tap does nothing.

It opens in the **Home** look, after Apple's Home app — glass tiles on a
wallpaper, white for what is on — and the button at the top right switches
to **light** and **dark**. It is in English, or in German where the browser
is.

<img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/dashboard-home.png" alt="The dashboard in the Home look: a DS920+ with tiles for Power (on, white), temperature, CPU and memory load, storage health, Volume 1 at 44 % used, DSM Update up to date, and each drive's temperature, with the buttons Power on, Shut down and Restart below" width="760">

On a phone the tiles are two side by side:

<img src="https://raw.githubusercontent.com/rummeyer/homebridge-synology-monitor/main/docs/dashboard-phone.png" alt="The dashboard on a phone: two tiles side by side" width="300">

Switch it on in the settings under *General* → **Dashboard**, restart the
child bridge, and open `http://<your Homebridge machine>:8583/` — the
plugin's settings page shows the link at the top while it is on. Any free
port will do under **Dashboard port**; the Homebridge UI itself is usually
on 8581.

### Who can press the buttons

The page has no login. The buttons answer only devices on the home network —
private, link-local and loopback addresses, as nas-control did — and only
the page's own script: another website open in the same browser cannot press
them. Still, anyone on your network can, so do not forward the port to the
internet. Untick **Buttons on the dashboard** for a page that only shows.

## Troubleshooting

**"wrong username or password"**, **"2-step verification"**: the account
cannot log in as it is. Use one without 2-step verification.

**"the account has no permission for this"** on shutting down or restarting:
the account is not an administrator.

**"this address is blocked by DSM"**: too many failed logins from the
Homebridge machine. Unblock it under *Control Panel → Security → Protection*.

**The Power switch does not turn the NAS on**: check Wake-on-LAN is enabled
on the NAS and the MAC address is that of the port it is cabled to. Behind a
router or in another VLAN, set **Broadcast address** to that network's.

**The log says "could not read it" while the NAS is starting**: DSM accepts
connections before it can log in. It reads again by itself once it can.

## Licence

MIT
