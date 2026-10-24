/**
 * The platform: an accessory and a monitor per NAS in the settings, and the
 * dashboard if it is switched on.
 */
import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig } from 'homebridge';

import { NasAccessory } from './accessory.ts';
import { readConfig } from './config.ts';
import type { PluginConfig } from './config.ts';
import { Dashboard } from './dashboard.ts';
import { NasMonitor } from './monitor.ts';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.ts';

export class SynologyMonitorPlatform implements DynamicPlatformPlugin {
  readonly #log: Logging;
  readonly #api: API;
  readonly #config: PluginConfig;
  readonly #cached = new Map<string, PlatformAccessory>();
  readonly #monitors: NasMonitor[] = [];
  #dashboard: Dashboard | undefined;

  constructor(log: Logging, raw: PlatformConfig, api: API) {
    this.#log = log;
    this.#api = api;
    const { config, problems } = readConfig(raw);
    this.#config = config;
    for (const problem of problems) {
      log.error(`Left out: ${problem}`);
    }
    api.on('didFinishLaunching', () => void this.#launch());
    api.on('shutdown', () => {
      this.#dashboard?.close();
      for (const monitor of this.#monitors) {
        void monitor.stop();
      }
    });
  }

  /** Homebridge replays cached accessories here before `didFinishLaunching`. */
  configureAccessory(accessory: PlatformAccessory): void {
    this.#cached.set(accessory.UUID, accessory);
  }

  async #launch(): Promise<void> {
    const keep = new Set<string>();
    for (const nas of this.#config.nas) {
      const uuid = this.#api.hap.uuid.generate(`${PLUGIN_NAME}:${nas.name}`);
      keep.add(uuid);
      let accessory = this.#cached.get(uuid);
      if (!accessory) {
        accessory = new this.#api.platformAccessory(nas.name, uuid);
        this.#api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      const monitor = new NasMonitor(nas, this.#log);
      this.#monitors.push(monitor);
      new NasAccessory(this.#api, this.#log, accessory, monitor);
      monitor.start(this.#config.pollSeconds * 1000);
    }
    const gone = [...this.#cached.values()].filter((accessory) => !keep.has(accessory.UUID));
    if (gone.length) {
      this.#api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, gone);
    }
    if (!this.#config.nas.length) {
      this.#log.warn('No NAS set up yet: add one in the settings');
    }
    if (this.#config.dashboard) {
      const dashboard = new Dashboard({ monitors: () => this.#monitors, controls: this.#config.dashboardControls });
      try {
        await dashboard.listen(this.#config.dashboardPort);
        this.#dashboard = dashboard;
        this.#log.info(`Dashboard on port ${this.#config.dashboardPort}`);
      } catch (error) {
        this.#log.error(`Dashboard: port ${this.#config.dashboardPort} cannot be used (${(error as Error).message}); running on without it`);
      }
    }
  }
}
