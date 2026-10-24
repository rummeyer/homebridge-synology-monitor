/**
 * What DSM's answers say, turned into what HomeKit and the dashboard show.
 * Pure functions of the answers' `data`, so they are tested on answers
 * recorded from a DS920+ on DSM 7.4.
 */

export interface Volume {
  id: string;
  name: string;
  status: string;
  usedBytes: number;
  totalBytes: number;
  /** How full, 0–100. */
  usedPercent: number;
}

export interface Disk {
  id: string;
  name: string;
  model: string;
  /** °C, or undefined where the drive does not say. */
  temperature?: number;
  status: string;
}

export interface Readings {
  model?: string;
  serial?: string;
  /** "DSM 7.4.1-90080 Update 1". */
  version?: string;
  /** °C */
  temperature?: number;
  temperatureWarning: boolean;
  uptimeSeconds?: number;
  /** 0–100 */
  cpu?: number;
  /** 0–100 */
  memory?: number;
  volumes: Volume[];
  disks: Disk[];
  /** What is wrong with the storage or the system, in words; empty while all is well. */
  problems: string[];
  /** When these were read, in ms. */
  at: number;
}

type Data = Record<string, unknown>;

const record = (value: unknown): Data => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Data) : {});
const list = (value: unknown): Data[] => (Array.isArray(value) ? value.map(record) : []);
const string = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** A number, also from a string as DSM gives sizes; undefined for anything else. */
export function number(value: unknown): number | undefined {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : undefined;
}

const percent = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/** States of a volume, pool or drive that mean trouble. Anything else — normal, repairing, expanding — does not. */
const TROUBLE = new Set(['degraded', 'crashed', 'attention', 'abnormal', 'broken', 'failing', 'warning', 'critical', 'damage']);

/** `SYNO.DSM.Info` `getinfo`: the model, DSM version, system temperature and uptime. */
export function readInfo(data: unknown): Pick<Readings, 'model' | 'serial' | 'version' | 'temperature' | 'temperatureWarning' | 'uptimeSeconds'> {
  const info = record(data);
  return {
    model: string(info.model) || undefined,
    serial: string(info.serial) || undefined,
    version: string(info.version_string) || undefined,
    temperature: number(info.temperature),
    temperatureWarning: info.temperature_warn === true,
    uptimeSeconds: number(info.uptime),
  };
}

/**
 * `SYNO.Core.System.Utilization` `get`: the CPU load as DSM's Resource
 * Monitor shows it, user, system and other together, and the memory in use.
 */
export function readUtilization(data: unknown): Pick<Readings, 'cpu' | 'memory'> {
  const cpu = record(record(data).cpu);
  const loads = [cpu.user_load, cpu.system_load, cpu.other_load].map(number);
  const memory = number(record(record(data).memory).real_usage);
  return {
    cpu: loads.every((load) => load === undefined) ? undefined : percent(loads.reduce<number>((sum, load) => sum + (load ?? 0), 0)),
    memory: memory === undefined ? undefined : percent(memory),
  };
}

/** "volume_1" → "Volume 1", for a volume without a description. */
function volumeName(volume: Data): string {
  const description = string(volume.vol_desc).trim() || string(volume.display_name).trim();
  if (description) {
    return description;
  }
  const id = number(volume.num_id);
  return id === undefined ? string(volume.id) : `Volume ${id}`;
}

/**
 * `SYNO.Storage.CGI.Storage` `load_info`: the volumes, how full they are,
 * the drives with their temperatures, and what is wrong with any of them.
 */
export function readStorage(data: unknown): Pick<Readings, 'volumes' | 'disks' | 'problems'> {
  const storage = record(data);
  const problems: string[] = [];
  const volumes = list(storage.volumes).map((volume): Volume => {
    const size = record(volume.size);
    const usedBytes = number(size.used) ?? 0;
    const totalBytes = number(size.total) ?? 0;
    const name = volumeName(volume);
    const status = string(volume.status) || 'unknown';
    if (TROUBLE.has(status)) {
      problems.push(`${name} is ${status}`);
    }
    return {
      id: string(volume.id),
      name,
      status,
      usedBytes,
      totalBytes,
      usedPercent: totalBytes > 0 ? percent((usedBytes / totalBytes) * 100) : 0,
    };
  });
  for (const pool of list(storage.storagePools)) {
    const status = string(pool.status);
    if (TROUBLE.has(status)) {
      problems.push(`Storage pool ${number(pool.num_id) ?? string(pool.id)} is ${status}`);
    }
  }
  const disks = list(storage.disks)
    .map((disk): Disk => {
      const name = string(disk.longName) || string(disk.name) || string(disk.id);
      const status = string(disk.overview_status) || string(disk.status) || 'unknown';
      if (TROUBLE.has(status) || TROUBLE.has(string(disk.smart_status))) {
        problems.push(`${name} is ${TROUBLE.has(status) ? status : string(disk.smart_status)}`);
      } else if (disk.below_remain_life_thr === true) {
        problems.push(`${name} is near the end of its life`);
      } else if (disk.exceed_bad_sector_thr === true) {
        problems.push(`${name} has too many bad sectors`);
      }
      const temperature = number(disk.temp);
      return {
        id: string(disk.id),
        name,
        model: string(disk.model).trim(),
        temperature: temperature !== undefined && temperature > 0 ? temperature : undefined,
        status,
      };
    })
    // Drive 1, Drive 2 … before Cache device 1, as Storage Manager lists them.
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  return { volumes, disks, problems };
}

/** `SYNO.Core.System.Status` `get`: a crashed system is a problem too. */
export function readStatus(data: unknown): string[] {
  return record(data).is_system_crashed === true ? ['The system has crashed'] : [];
}

/** `SYNO.Core.Upgrade.Server` `check`: whether a DSM update is waiting, in either version's shape. */
export function readUpdate(data: unknown): boolean {
  const answer = record(data);
  return answer.available === true || record(answer.update).available === true;
}

/** "DSM 7.4.1-90080 Update 1" → "7.4.1", as HomeKit's firmware revision wants it. */
export function firmwareRevision(version: string | undefined): string | undefined {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(version ?? '');
  return match ? [match[1], match[2], match[3] ?? '0'].join('.') : undefined;
}
