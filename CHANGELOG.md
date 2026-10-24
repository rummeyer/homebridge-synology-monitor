# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-10-24

### Changed

- The settings page is a form of its own, as Appliance Monitor's: one NAS
  at a time, picked from a list with Add and Delete, its account, power and
  accessories below, and General with the link to the dashboard under its
  switch and the port beside it. Only what differs from the default is
  saved. Homebridge's generated form is hidden.

### Fixed

- Since 1.1.1 the settings showed almost none of the saved values: the form
  the page drew did not take them. Nothing saved was lost.

## [1.1.2] — 2026-10-24

### Fixed

- The password showed as an empty field in the settings since 1.1.1; it
  shows as dots again. It was never lost.

## [1.1.1] — 2026-10-24

### Changed

- The link to the dashboard stands in the settings form itself, under the
  Dashboard switch and its port in General, as in Appliance Monitor. The
  form is drawn by the plugin's settings page from the same schema.

### Fixed

- The settings form added an empty NAS each time it was saved, and showed
  them as errors; the plugin logged each as left out. Empty rows are no
  longer saved, those saved before are dropped when the settings are
  opened, and the plugin passes over any left without a word.

## [1.1.0] — 2026-10-24

### Added

- The settings page shows the link to the dashboard at the top while it is
  switched on, as Appliance Monitor's does, with Homebridge's form below.

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
