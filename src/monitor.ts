/**
 * One NAS: polled every so often for whether it answers and what it reads,
 * and woken, shut down or restarted on request. HomeKit and the dashboard
 * both show what this knows and both act through it.
 */
import { EventEmitter } from 'node:events';

import type { Logging } from 'homebridge';

import type { NasConfig } from './config.ts';
import { describe, DsmClient, DsmError } from './dsm.ts';
import { reachable as tcpReachable, wake as sendWake } from './network.ts';
import { PowerTracker } from './power.ts';
import type { PowerState } from './power.ts';
import { readInfo, readStatus, readStorage, readUpdate, readUtilization } from './readings.ts';
import type { Readings } from './readings.ts';

/** How often to ask DSM whether an update is waiting; it checks only daily itself. */
export const UPDATE_CHECK_MS = 6 * 3600 * 1000;

/** What the dashboard is sent about one NAS. */
export interface NasSnapshot {
  name: string;
  host: string;
  power: PowerState;
  canWake: boolean;
  readings?: Readings;
  updateAvailable?: boolean;
  /** Why the last reading failed while the NAS answered, if it did. */
  error?: string;
}

export interface MonitorDeps {
  dsm?: DsmClient;
  reachable?: (host: string, port: number) => Promise<boolean>;
  wake?: (mac: string, broadcast: string) => Promise<void>;
  now?: () => number;
}

export class NasMonitor extends EventEmitter<{ update: [] }> {
  readonly config: NasConfig;
  readonly power = new PowerTracker();
  readings: Readings | undefined;
  updateAvailable: boolean | undefined;
  error: string | undefined;

  readonly #log: Logging;
  readonly #dsm: DsmClient;
  readonly #reachable: (host: string, port: number) => Promise<boolean>;
  readonly #wake: (mac: string, broadcast: string) => Promise<void>;
  readonly #now: () => number;
  #timer: NodeJS.Timeout | undefined;
  #polling: Promise<void> | undefined;
  /** When DSM was last asked for an update; never yet means at the first reading. */
  #lastUpdateCheck: number | undefined;
  /** What was last logged about whether it answers, so each change is logged once. */
  #wasReachable: boolean | undefined;

  constructor(config: NasConfig, log: Logging, deps: MonitorDeps = {}) {
    super();
    this.config = config;
    this.#log = log;
    this.#dsm = deps.dsm ?? new DsmClient(config);
    this.#reachable = deps.reachable ?? tcpReachable;
    this.#wake = deps.wake ?? sendWake;
    this.#now = deps.now ?? Date.now;
  }

  /** Polls now and then every *intervalMs*. */
  start(intervalMs: number): void {
    void this.poll();
    this.#timer = setInterval(() => void this.poll(), intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.#timer);
    await this.#dsm.logout();
  }

  /** One round: does it answer, and if so what does it read. Rounds never overlap. */
  poll(): Promise<void> {
    this.#polling ??= this.#round().finally(() => {
      this.#polling = undefined;
    });
    return this.#polling;
  }

  /** The Power switch: on while on, starting or restarting. */
  isOn(): boolean {
    return this.power.isOn(this.#now());
  }

  snapshot(): NasSnapshot {
    return {
      name: this.config.name,
      host: this.config.host,
      power: this.power.state(this.#now()),
      canWake: Boolean(this.config.mac),
      readings: this.readings,
      updateAvailable: this.updateAvailable,
      error: this.error,
    };
  }

  /** Sends the Wake-on-LAN packet. */
  async powerOn(): Promise<void> {
    if (!this.config.mac) {
      throw new Error(`${this.config.name} has no MAC address set, so it cannot be woken`);
    }
    if (this.isOn()) {
      return;
    }
    await this.#wake(this.config.mac, this.config.broadcast);
    this.#log.info(`${this.config.name}: Wake-on-LAN sent to ${this.config.mac}`);
    this.power.expect('starting', this.config.startupSeconds, this.#now());
    this.emit('update');
  }

  /** Shuts the NAS down through DSM. */
  async powerOff(): Promise<void> {
    if (!this.isOn()) {
      return;
    }
    if (!this.power.reachable) {
      throw new Error(`${this.config.name} does not answer yet, so it cannot be shut down`);
    }
    await this.#dsm.call('SYNO.Core.System', 1, 'shutdown');
    this.#log.info(`${this.config.name}: shutting down`);
    this.#dsm.forget();
    this.power.expect('stopping', this.config.shutdownSeconds, this.#now());
    this.emit('update');
  }

  /** Restarts the NAS through DSM. */
  async restart(): Promise<void> {
    if (!this.power.reachable) {
      throw new Error(`${this.config.name} does not answer, so it cannot be restarted`);
    }
    await this.#dsm.call('SYNO.Core.System', 1, 'reboot');
    this.#log.info(`${this.config.name}: restarting`);
    this.#dsm.forget();
    this.power.expect('restarting', this.config.shutdownSeconds + this.config.startupSeconds, this.#now());
    this.emit('update');
  }

  async #round(): Promise<void> {
    const answers = await this.#reachable(this.config.host, this.config.port);
    this.power.seen(answers, this.#now());
    if (answers !== this.#wasReachable) {
      if (answers || this.#wasReachable !== undefined) {
        this.#log.info(`${this.config.name} is ${answers ? 'on' : 'off'}`);
      }
      this.#wasReachable = answers;
    }
    if (answers) {
      await this.#read();
    } else {
      this.#dsm.forget();
      this.error = undefined;
    }
    this.emit('update');
  }

  async #read(): Promise<void> {
    try {
      const [info, utilization, storage, status] = [
        await this.#dsm.call('SYNO.DSM.Info', 2, 'getinfo'),
        await this.#dsm.call('SYNO.Core.System.Utilization', 1, 'get'),
        await this.#dsm.call('SYNO.Storage.CGI.Storage', 1, 'load_info'),
        await this.#dsm.call('SYNO.Core.System.Status', 1, 'get'),
      ];
      const stored = readStorage(storage);
      this.readings = {
        ...readInfo(info),
        ...readUtilization(utilization),
        ...stored,
        problems: [...readStatus(status), ...stored.problems],
        at: this.#now(),
      };
      if (this.#lastUpdateCheck === undefined || this.#now() - this.#lastUpdateCheck >= UPDATE_CHECK_MS) {
        this.updateAvailable = readUpdate(await this.#dsm.call('SYNO.Core.Upgrade.Server', 1, 'check'));
        this.#lastUpdateCheck = this.#now();
      }
      if (this.error) {
        this.#log.info(`${this.config.name}: reading again`);
      }
      this.error = undefined;
    } catch (error) {
      const message = error instanceof DsmError ? describe(error.code) : (error as Error).message;
      // A NAS starting up answers before DSM can log in; only a new reason is worth a line.
      if (message !== this.error) {
        this.#log.warn(`${this.config.name}: could not read it: ${message}`);
      }
      this.error = message;
    }
  }
}
