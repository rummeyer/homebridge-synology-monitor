/**
 * What the tests share: the recorded DS920+ answers, a DSM that answers
 * from them, a log that keeps its lines, and a NAS's settings.
 */
import { readFileSync } from 'node:fs';

import type { Logging } from 'homebridge';

import { DEFAULT_SENSORS } from '../src/config.ts';
import type { NasConfig } from '../src/config.ts';
import type { Params, Transport } from '../src/dsm.ts';

export const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/ds920.json', import.meta.url), 'utf8')) as Record<string, any>;

/** A deep copy, so a test can change it without touching the others. */
export const copy = <T>(value: T): T => structuredClone(value);

export function nasConfig(overrides: Partial<NasConfig> = {}): NasConfig {
  return {
    name: 'Diskstation',
    host: '192.168.1.20',
    port: 5001,
    protocol: 'https',
    checkCertificate: false,
    username: 'monitor',
    password: 'secret',
    mac: '00:11:32:ab:cd:ef',
    broadcast: '255.255.255.255',
    startupSeconds: 180,
    shutdownSeconds: 120,
    sensors: { ...DEFAULT_SENSORS },
    ...overrides,
  };
}

export interface FakeDsm extends Transport {
  /** Every request, in order. */
  calls: Params[];
  /** What each `api.method` answers, as `data`; replaced or added to by a test. */
  data: Record<string, unknown>;
  /** Error codes to answer instead, next first, by `api.method`. */
  errors: Record<string, number[]>;
  /** Sessions handed out so far. */
  logins: number;
}

/** A DSM that logs in, hands out sessions and answers from the fixture. */
export function fakeDsm(): FakeDsm {
  const fake = (async (params: Params) => {
    fake.calls.push(params);
    const key = `${params.api}.${params.method}`;
    const error = fake.errors[key]?.shift();
    if (error !== undefined) {
      return { success: false, error: { code: error } };
    }
    if (key === 'SYNO.API.Auth.login') {
      fake.logins += 1;
      return { success: true, data: { sid: `sid-${fake.logins}` } };
    }
    if (key === 'SYNO.API.Auth.logout') {
      return { success: true };
    }
    if (!(key in fake.data)) {
      return { success: false, error: { code: 102 } };
    }
    return { success: true, data: fake.data[key] };
  }) as FakeDsm;
  fake.calls = [];
  fake.logins = 0;
  fake.errors = {};
  fake.data = {
    'SYNO.DSM.Info.getinfo': copy(FIXTURE.info),
    'SYNO.Core.System.Utilization.get': copy(FIXTURE.utilization),
    'SYNO.Storage.CGI.Storage.load_info': copy(FIXTURE.storage),
    'SYNO.Core.System.Status.get': copy(FIXTURE.status),
    'SYNO.Core.Upgrade.Server.check': copy(FIXTURE.upgrade),
    'SYNO.Core.System.shutdown': {},
    'SYNO.Core.System.reboot': {},
  };
  return fake;
}

export interface TestLog extends Logging {
  lines: string[];
}

/** A log that keeps its lines as "level: message". */
export function testLog(): TestLog {
  const lines: string[] = [];
  const at = (level: string) => (message: string) => void lines.push(`${level}: ${message}`);
  const log = Object.assign(at('info'), {
    lines,
    prefix: 'test',
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: () => undefined,
    success: at('info'),
    log: (level: string, message: string) => void lines.push(`${level}: ${message}`),
  });
  return log as unknown as TestLog;
}
