/**
 * One NAS in HomeKit: an accessory with a service per thing it shows. The
 * Power switch always; the rest as the settings choose:
 *
 * - Temperature: a temperature sensor with the system temperature
 * - CPU and Memory: fans whose speed is the load, in %
 * - Storage: a leak sensor that goes off when a volume, pool or drive is in trouble
 * - DSM Update: an occupancy sensor, occupied while an update is waiting
 * - Restart: a switch that restarts the NAS and turns itself off again
 * - a temperature sensor per drive, and a humidity sensor per volume with how full it is
 *
 * While the NAS is off its sensors say they are not active, and keep their
 * last values.
 */
import type { API, Characteristic as CharacteristicType, Logging, PlatformAccessory, Service as ServiceType, WithUUID } from 'homebridge';

import type { NasMonitor } from './monitor.ts';
import { firmwareRevision } from './readings.ts';

/** What is kept about the accessory between restarts, for services that depend on what DSM said. */
interface Context {
  disks?: { id: string; name: string }[];
  volumes?: { id: string; name: string }[];
}

/** How long a momentary switch, or a fan someone tapped, takes to go back. */
const BOUNCE_MS = 1000;

export class NasAccessory {
  readonly #api: API;
  readonly #log: Logging;
  readonly #accessory: PlatformAccessory;
  readonly #monitor: NasMonitor;

  constructor(api: API, log: Logging, accessory: PlatformAccessory, monitor: NasMonitor) {
    this.#api = api;
    this.#log = log;
    this.#accessory = accessory;
    this.#monitor = monitor;
    this.#setUp();
    monitor.on('update', () => this.refresh());
    this.refresh();
  }

  get #context(): Context {
    return this.#accessory.context as Context;
  }

  #setUp(): void {
    const { Service, Characteristic } = this.#api.hap;
    const sensors = this.#monitor.config.sensors;
    this.#accessory
      .getService(Service.AccessoryInformation)!
      .setCharacteristic(Characteristic.Manufacturer, 'Synology')
      .setCharacteristic(Characteristic.Model, 'DiskStation')
      .setCharacteristic(Characteristic.SerialNumber, this.#monitor.config.host);

    const power = this.#service(Service.Switch, 'power', 'Power', true);
    power.getCharacteristic(Characteristic.On).onSet(async (value) => {
      try {
        await (value ? this.#monitor.powerOn() : this.#monitor.powerOff());
      } catch (error) {
        this.#log.error(`${this.#monitor.config.name}: ${(error as Error).message}`);
        this.#bounce(power, Characteristic.On, () => this.#monitor.isOn());
        throw new this.#api.hap.HapStatusError(this.#api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    });

    this.#service(Service.TemperatureSensor, 'temperature', 'Temperature', sensors.temperature);
    for (const [subtype, name, on] of [['cpu', 'CPU', sensors.cpu], ['memory', 'Memory', sensors.memory]] as const) {
      const fan = this.#service(Service.Fanv2, subtype, name, on);
      if (fan) {
        // Shows the load; tapping it changes nothing, so it goes back.
        fan.getCharacteristic(Characteristic.Active).onSet(() => this.#bounce(fan, Characteristic.Active, () => this.#fan(subtype).active));
        fan.getCharacteristic(Characteristic.RotationSpeed).onSet(() => this.#bounce(fan, Characteristic.RotationSpeed, () => this.#fan(subtype).speed));
      }
    }
    this.#service(Service.LeakSensor, 'storage', 'Storage', sensors.storage);
    this.#service(Service.OccupancySensor, 'update', 'DSM Update', sensors.update);

    const restart = this.#service(Service.Switch, 'restart', 'Restart', sensors.restart);
    if (restart) {
      restart.getCharacteristic(Characteristic.On).onSet(async (value) => {
        if (!value) {
          return;
        }
        this.#bounce(restart, Characteristic.On, () => false);
        try {
          await this.#monitor.restart();
        } catch (error) {
          this.#log.error(`${this.#monitor.config.name}: ${(error as Error).message}`);
          throw new this.#api.hap.HapStatusError(this.#api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
        }
      });
    }
    this.#syncParts();
  }

  /** The drives' and volumes' services, for those DSM listed last; kept while it is off. */
  #syncParts(): void {
    const { Service } = this.#api.hap;
    const sensors = this.#monitor.config.sensors;
    const readings = this.#monitor.readings;
    if (readings) {
      this.#context.disks = readings.disks.filter((disk) => disk.temperature !== undefined).map(({ id, name }) => ({ id, name }));
      this.#context.volumes = readings.volumes.map(({ id, name }) => ({ id, name }));
    }
    const wanted = new Set<string>();
    for (const disk of sensors.disks ? (this.#context.disks ?? []) : []) {
      wanted.add(`disk:${disk.id}`);
      this.#service(Service.TemperatureSensor, `disk:${disk.id}`, disk.name, true);
    }
    for (const volume of sensors.volumes ? (this.#context.volumes ?? []) : []) {
      wanted.add(`volume:${volume.id}`);
      this.#service(Service.HumiditySensor, `volume:${volume.id}`, volume.name, true);
    }
    for (const service of [...this.#accessory.services]) {
      const subtype = service.subtype ?? '';
      if ((subtype.startsWith('disk:') || subtype.startsWith('volume:')) && !wanted.has(subtype)) {
        this.#accessory.removeService(service);
      }
    }
  }

  /** Brings every service up to what the monitor knows. */
  refresh(): void {
    const { Service, Characteristic } = this.#api.hap;
    const monitor = this.#monitor;
    const on = monitor.isOn();
    const readings = monitor.readings;
    // Readings count only while the NAS answers; before that they are the last known.
    const live = monitor.power.reachable && readings !== undefined && monitor.error === undefined;
    this.#syncParts();

    const info = this.#accessory.getService(Service.AccessoryInformation)!;
    if (readings?.model) {
      info.updateCharacteristic(Characteristic.Model, readings.model);
    }
    if (readings?.serial) {
      info.updateCharacteristic(Characteristic.SerialNumber, readings.serial);
    }
    const firmware = firmwareRevision(readings?.version);
    if (firmware) {
      info.updateCharacteristic(Characteristic.FirmwareRevision, firmware);
    }

    this.#find(Service.Switch, 'power')?.updateCharacteristic(Characteristic.On, on);
    this.#find(Service.Switch, 'restart')?.updateCharacteristic(Characteristic.On, false);

    const temperature = this.#find(Service.TemperatureSensor, 'temperature');
    if (temperature) {
      if (readings?.temperature !== undefined) {
        temperature.updateCharacteristic(Characteristic.CurrentTemperature, readings.temperature);
      }
      temperature.updateCharacteristic(Characteristic.StatusActive, live);
    }
    for (const subtype of ['cpu', 'memory'] as const) {
      const fan = this.#find(Service.Fanv2, subtype);
      if (fan) {
        const { active, speed } = this.#fan(subtype);
        fan.updateCharacteristic(Characteristic.Active, active);
        fan.updateCharacteristic(Characteristic.RotationSpeed, speed);
      }
    }
    const storage = this.#find(Service.LeakSensor, 'storage');
    if (storage) {
      const trouble = Boolean(readings?.problems.length);
      storage.updateCharacteristic(
        Characteristic.LeakDetected,
        trouble ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );
      storage.updateCharacteristic(Characteristic.StatusActive, live);
    }
    const update = this.#find(Service.OccupancySensor, 'update');
    if (update) {
      update.updateCharacteristic(
        Characteristic.OccupancyDetected,
        monitor.updateAvailable ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
      );
      update.updateCharacteristic(Characteristic.StatusActive, live);
    }
    for (const disk of readings?.disks ?? []) {
      const service = this.#find(Service.TemperatureSensor, `disk:${disk.id}`);
      if (service && disk.temperature !== undefined) {
        service.updateCharacteristic(Characteristic.CurrentTemperature, disk.temperature);
      }
    }
    for (const volume of readings?.volumes ?? []) {
      this.#find(Service.HumiditySensor, `volume:${volume.id}`)?.updateCharacteristic(Characteristic.CurrentRelativeHumidity, volume.usedPercent);
    }
    for (const service of this.#accessory.services) {
      if (service.subtype?.startsWith('disk:') || service.subtype?.startsWith('volume:')) {
        service.updateCharacteristic(Characteristic.StatusActive, live);
      }
    }
  }

  /** A fan's state: running at the load while the NAS answers, off otherwise. */
  #fan(subtype: 'cpu' | 'memory'): { active: number; speed: number } {
    const monitor = this.#monitor;
    const load = monitor.readings?.[subtype];
    if (!monitor.power.reachable || load === undefined) {
      return { active: 0, speed: 0 };
    }
    // At 0 % the Home app would show it off; the NAS is on, so at least 1.
    return { active: 1, speed: Math.max(1, load) };
  }

  #find(type: WithUUID<typeof ServiceType>, subtype: string): ServiceType | undefined {
    return this.#accessory.getServiceById(type, subtype);
  }

  /**
   * The service of *type* and *subtype*, added if it is *wanted* and not
   * there, removed if it is there and not wanted. Named with
   * ConfiguredName, which is what the Home app shows; one the user renamed
   * in the Home app keeps its name.
   */
  #service(type: WithUUID<typeof ServiceType>, subtype: string, name: string, wanted: true): ServiceType;
  #service(type: WithUUID<typeof ServiceType>, subtype: string, name: string, wanted: boolean): ServiceType | undefined;
  #service(type: WithUUID<typeof ServiceType>, subtype: string, name: string, wanted: boolean): ServiceType | undefined {
    const { Characteristic } = this.#api.hap;
    const existing = this.#find(type, subtype);
    if (!wanted) {
      if (existing) {
        this.#accessory.removeService(existing);
      }
      return undefined;
    }
    if (existing) {
      return existing;
    }
    const service = this.#accessory.addService(type, name, subtype);
    if (!service.testCharacteristic(Characteristic.ConfiguredName)) {
      service.addOptionalCharacteristic(Characteristic.ConfiguredName);
    }
    service.setCharacteristic(Characteristic.ConfiguredName, name);
    return service;
  }

  /** Puts a characteristic someone changed back to what it shows, a moment later. */
  #bounce(service: ServiceType, characteristic: WithUUID<new () => CharacteristicType>, value: () => boolean | number): void {
    setTimeout(() => service.updateCharacteristic(characteristic, value()), BOUNCE_MS);
  }
}
