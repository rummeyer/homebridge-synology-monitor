/**
 * The settings, as config.json has them, and what the plugin makes of them:
 * every value checked, every missing one given its default. Nothing here
 * talks to a NAS, so all of it is tested on its own.
 */
import type { PlatformConfig } from 'homebridge';

/** Which accessories a NAS shows, beside its Power switch. */
export interface Sensors {
  /** The system temperature. */
  temperature: boolean;
  /** A fan whose speed is the CPU load. */
  cpu: boolean;
  /** A fan whose speed is the memory in use. */
  memory: boolean;
  /** A leak sensor that goes off when a volume, pool or drive is in trouble. */
  storage: boolean;
  /** An occupancy sensor that is on while a DSM update is available. */
  update: boolean;
  /** A switch that restarts the NAS and turns itself off again. */
  restart: boolean;
  /** A temperature sensor per drive. */
  disks: boolean;
  /** A humidity sensor per volume, its humidity how full the volume is. */
  volumes: boolean;
}

/** One NAS as the plugin uses it. */
export interface NasConfig {
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  /** Whether an HTTPS certificate must be valid; DSM's own is self-signed. */
  checkCertificate: boolean;
  username: string;
  password: string;
  /** For Wake-on-LAN; without it the Power switch cannot turn the NAS on. */
  mac?: string;
  /** Where the Wake-on-LAN packet goes. */
  broadcast: string;
  /** How long the Power switch stays on after a wake before the NAS must answer. */
  startupSeconds: number;
  /** How long it stays off after a shutdown while the NAS still answers. */
  shutdownSeconds: number;
  sensors: Sensors;
}

/** The whole platform as the plugin uses it. */
export interface PluginConfig {
  name: string;
  nas: NasConfig[];
  pollSeconds: number;
  dashboard: boolean;
  dashboardPort: number;
  /** Whether the dashboard has the Power on, Shut down and Restart buttons. */
  dashboardControls: boolean;
}

export const DEFAULTS = {
  port: 5001,
  protocol: 'https' as const,
  broadcast: '255.255.255.255',
  startupSeconds: 180,
  shutdownSeconds: 120,
  pollSeconds: 30,
  dashboardPort: 8583,
};

export const DEFAULT_SENSORS: Sensors = {
  temperature: true,
  cpu: true,
  memory: true,
  storage: true,
  update: true,
  restart: true,
  disks: true,
  volumes: true,
};

/** Poll no faster than this: DSM answers each round with five requests. */
export const MIN_POLL_SECONDS = 10;

const MAC = /^([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})$/i;

/** `00:11:32:ab:cd:ef` however it was typed — with colons, dashes or nothing — or undefined. */
export function parseMac(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = MAC.exec(value.trim());
  return match ? match.slice(1).join(':').toLowerCase() : undefined;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** A whole number between *min* and *max*, else *fallback*. */
export function wholeIn(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

/**
 * One NAS from config.json, or the reasons it cannot be used. A missing MAC
 * is no reason: the NAS is then shown and can be shut down, only not woken.
 */
export function readNas(raw: unknown, index: number): { nas?: NasConfig; problems: string[] } {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = text(entry.name) || `NAS ${index + 1}`;
  const problems: string[] = [];
  const host = text(entry.host);
  const username = text(entry.username);
  const password = typeof entry.password === 'string' ? entry.password : '';
  if (!host) {
    problems.push(`${name}: no host`);
  }
  if (!username || !password) {
    problems.push(`${name}: no username or password`);
  }
  const macText = text(entry.mac);
  const mac = parseMac(macText);
  if (macText && !mac) {
    problems.push(`${name}: "${macText}" is not a MAC address`);
  }
  if (problems.length) {
    return { problems };
  }
  const protocol = entry.protocol === 'http' ? 'http' : DEFAULTS.protocol;
  const given = (entry.sensors && typeof entry.sensors === 'object' ? entry.sensors : {}) as Record<string, unknown>;
  const sensors = Object.fromEntries(
    Object.entries(DEFAULT_SENSORS).map(([key, fallback]) => [key, flag(given[key], fallback)]),
  ) as unknown as Sensors;
  return {
    problems,
    nas: {
      name,
      host,
      port: wholeIn(entry.port, 1, 65535, protocol === 'http' ? 5000 : DEFAULTS.port),
      protocol,
      checkCertificate: flag(entry.checkCertificate, false),
      username,
      password,
      mac,
      broadcast: text(entry.broadcast) || DEFAULTS.broadcast,
      startupSeconds: wholeIn(entry.startupSeconds, 0, 900, DEFAULTS.startupSeconds),
      shutdownSeconds: wholeIn(entry.shutdownSeconds, 0, 900, DEFAULTS.shutdownSeconds),
      sensors,
    },
  };
}

/** The platform's settings, and why any NAS among them was left out. */
export function readConfig(raw: PlatformConfig | Record<string, unknown>): { config: PluginConfig; problems: string[] } {
  const entries = Array.isArray(raw.nas) ? raw.nas : [];
  const problems: string[] = [];
  const nas: NasConfig[] = [];
  entries.forEach((entry: unknown, index: number) => {
    const read = readNas(entry, index);
    problems.push(...read.problems);
    if (read.nas) {
      if (nas.some((other) => other.name === read.nas!.name)) {
        problems.push(`${read.nas.name}: a second NAS by that name; names must differ`);
      } else {
        nas.push(read.nas);
      }
    }
  });
  return {
    problems,
    config: {
      name: text(raw.name) || 'Synology Monitor',
      nas,
      pollSeconds: wholeIn(raw.pollSeconds, MIN_POLL_SECONDS, 3600, DEFAULTS.pollSeconds),
      dashboard: flag(raw.dashboard, false),
      dashboardPort: wholeIn(raw.dashboardPort, 1, 65535, DEFAULTS.dashboardPort),
      dashboardControls: flag(raw.dashboardControls, true),
    },
  };
}
