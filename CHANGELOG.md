# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] — 2026-10-24

### Changed

- The settings' number fields are plain fields, without a slider, and say
  what an empty one means. The dashboard's switch and port sit side by side
  and are always shown, as in Appliance Monitor.

## [1.0.0] — 2026-10-24

### Added

- A **Power** switch per NAS: on wakes it with Wake-on-LAN, off shuts it down
  through DSM, with a startup and a shutdown time so the switch does not
  flip back while the NAS is on its way.
- **Temperature**, **CPU** and **Memory** (as fans), **Storage** (a leak
  sensor for degraded or crashed volumes and pools and failing drives),
  **DSM Update** (an occupancy sensor), **Restart**, a temperature sensor
  per drive and a humidity sensor per volume for how full it is — each
  switchable in the settings.
- The DSM Web API with one kept session, renewed when DSM ends it, and DSM's
  error codes in words in the log.
- A **dashboard** in the Home, light and dark looks, in English and German,
  with Power on, Shut down and Restart buttons that answer only the home
  network.
