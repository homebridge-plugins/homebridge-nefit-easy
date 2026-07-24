import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Characteristic, HAPStatus, HapStatusError, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import type { NefitEasyPlatform } from '../src/platform.js';

interface StubClient {
  connect(): Promise<void>;
  get(uri: string): Promise<unknown>;
  put(uri: string, data: unknown): Promise<unknown>;
  end(): Promise<void>;
}

let clientFactory: () => StubClient = () => {
  throw new Error('no client configured');
};

mock.module('bosch-xmpp', {
  defaultExport: {
    NefitEasyClient: () => clientFactory(),
  },
});

const { NefitEasyThermostat } = await import('../src/thermostatAccessory.js');

const CREDENTIALS = { serialNumber: 'SERIAL', accessKey: 'KEY', password: 'PW' };

const UI_STATUS = '/ecus/rrc/uiStatus';
const OUTDOOR = '/system/sensors/temperatures/outdoor_t1';

/** Minimal stand-in for PlatformAccessory backed by real HAP services. */
class FakeAccessory {
  public displayName = 'Nefit Easy';
  public UUID = uuid.generate('SERIAL');
  public services: Service[] = [new Service.AccessoryInformation()];

  getService(type: typeof Service.AccessoryInformation | typeof Service.Thermostat) {
    return this.services.find(service => service.UUID === type.UUID && !service.subtype);
  }

  getServiceById(type: typeof Service.TemperatureSensor, subtype: string) {
    return this.services.find(service => service.UUID === type.UUID && service.subtype === subtype);
  }

  addService(type: typeof Service.Thermostat, name?: string, subtype?: string) {
    const service = new type(name, subtype);
    this.services.push(service);
    return service;
  }

  removeService(service: Service) {
    this.services = this.services.filter(candidate => candidate !== service);
  }
}

interface Harness {
  platform: NefitEasyPlatform;
  accessory: FakeAccessory;
  errors: unknown[][];
  warnings: unknown[][];
}

function makeHarness(config: Record<string, unknown> = {}): Harness {
  const errors: unknown[][] = [];
  const warnings: unknown[][] = [];
  const accessory = new FakeAccessory();

  const platform = {
    log: {
      info: () => {},
      debug: () => {},
      warn: (...args: unknown[]) => warnings.push(args),
      error: (...args: unknown[]) => errors.push(args),
    },
    config: { platform: 'NefitEasy', name: 'Nefit Easy', ...config },
    api: { hap: { Service, Characteristic, HapStatusError, HAPStatus, uuid } },
  } as unknown as NefitEasyPlatform;

  return { platform, accessory, errors, warnings };
}

/** Let the constructor's connect/poll chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function build(harness: Harness) {
  return new NefitEasyThermostat(
    harness.platform,
    harness.accessory as unknown as PlatformAccessory,
    CREDENTIALS,
  );
}

/**
 * Direct handler calls surface the HapStatusError itself, while HAP converts it
 * into the bare status code before rejecting a characteristic read. Both mean
 * the same thing to HomeKit.
 */
function isCommunicationFailure(error: unknown): boolean {
  if (error instanceof HapStatusError) {
    return error.hapStatus === HAPStatus.SERVICE_COMMUNICATION_FAILURE;
  }
  return error === HAPStatus.SERVICE_COMMUNICATION_FAILURE;
}

function thermostatOf(harness: Harness): Service {
  const service = harness.accessory.getService(Service.Thermostat);
  assert.ok(service, 'thermostat service missing');
  return service;
}

function healthyClient(status: Record<string, unknown>, puts: Array<[string, unknown]> = []): StubClient {
  return {
    connect: async () => {},
    get: async (uri: string) => {
      if (uri === UI_STATUS) {
        return { value: status };
      }
      if (uri === OUTDOOR) {
        return { value: 8.5 };
      }
      throw new Error(`unexpected GET ${uri}`);
    },
    put: async (uri: string, data: unknown) => {
      puts.push([uri, data]);
      return {};
    },
    end: async () => {},
  };
}

test('reports a communication failure before the first successful poll', async () => {
  const harness = makeHarness();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  clientFactory = () => ({
    connect: async () => gate,
    get: async () => ({}),
    put: async () => ({}),
    end: async () => {},
  });

  const thermostat = build(harness);
  await flush();

  const service = thermostatOf(harness);
  await assert.rejects(
    () => Promise.resolve(service.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest()),
    isCommunicationFailure,
  );
  await assert.rejects(
    () => Promise.resolve(service.getCharacteristic(Characteristic.TargetTemperature).handleGetRequest()),
    isCommunicationFailure,
  );
  await assert.rejects(
    () => Promise.resolve(
      service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).handleGetRequest(),
    ),
    isCommunicationFailure,
  );

  release();
  thermostat.dispose();
});

test('serves readings from the poll cache once connected', async () => {
  const harness = makeHarness();
  clientFactory = () => healthyClient({ IHT: '19.5', TSP: '21', BAI: 'CH' });

  const thermostat = build(harness);
  await flush();

  const service = thermostatOf(harness);
  assert.equal(await service.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(), 19.5);
  assert.equal(await service.getCharacteristic(Characteristic.TargetTemperature).handleGetRequest(), 21);
  assert.equal(
    await service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).handleGetRequest(),
    Characteristic.CurrentHeatingCoolingState.HEAT,
  );

  thermostat.dispose();
});

test('treats hot water production as idle rather than heating', async () => {
  const harness = makeHarness();
  clientFactory = () => healthyClient({ IHT: '20', TSP: '20', BAI: 'HW' });

  const thermostat = build(harness);
  await flush();

  assert.equal(
    await thermostatOf(harness)
      .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .handleGetRequest(),
    Characteristic.CurrentHeatingCoolingState.OFF,
  );

  thermostat.dispose();
});

test('a non-numeric reading never becomes a fabricated measurement', async () => {
  const harness = makeHarness();
  clientFactory = () => healthyClient({ IHT: '', TSP: 'n/a', BAI: '??' });

  const thermostat = build(harness);
  await flush();

  await assert.rejects(
    () => Promise.resolve(
      thermostatOf(harness).getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(),
    ),
    isCommunicationFailure,
  );

  thermostat.dispose();
});

test('keeps the last real reading when a later poll fails', async () => {
  const harness = makeHarness();
  let polls = 0;
  clientFactory = () => ({
    connect: async () => {},
    get: async () => {
      polls++;
      if (polls === 1) {
        return { value: { IHT: '18.5', TSP: '20', BAI: 'No' } };
      }
      throw new Error('backend gone');
    },
    put: async () => ({}),
    end: async () => {},
  });

  const thermostat = build(harness);
  await flush();

  const service = thermostatOf(harness);
  assert.equal(await service.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(), 18.5);

  // Force the failing second poll through the private timer callback.
  await (thermostat as unknown as { poll(): Promise<void> }).poll();
  assert.equal(await service.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(), 18.5);
  assert.ok(harness.warnings.length > 0, 'expected the failed poll to be logged');

  thermostat.dispose();
});

test('setting the temperature rounds and writes all three endpoints', async () => {
  const harness = makeHarness();
  const puts: Array<[string, unknown]> = [];
  clientFactory = () => healthyClient({ IHT: '19', TSP: '20', BAI: 'No' }, puts);

  const thermostat = build(harness);
  await flush();

  await thermostatOf(harness)
    .getCharacteristic(Characteristic.TargetTemperature)
    .handleSetRequest(20.3);

  assert.deepEqual(puts, [
    ['/heatingCircuits/hc1/temperatureRoomManual', { value: 20.5 }],
    ['/heatingCircuits/hc1/manualTempOverride/status', { value: 'on' }],
    ['/heatingCircuits/hc1/manualTempOverride/temperature', { value: 20.5 }],
  ]);

  thermostat.dispose();
});

test('a failing write surfaces as a communication failure', async () => {
  const harness = makeHarness();
  clientFactory = () => ({
    connect: async () => {},
    get: async () => ({ value: { IHT: '19', TSP: '20', BAI: 'No' } }),
    put: async () => {
      throw new Error('write rejected');
    },
    end: async () => {},
  });

  const thermostat = build(harness);
  await flush();

  await assert.rejects(
    () => (thermostat as unknown as {
      setTargetTemperature(value: number): Promise<void>;
    }).setTargetTemperature(21),
    isCommunicationFailure,
  );
  assert.ok(harness.errors.length > 0, 'expected the failed write to be logged');

  thermostat.dispose();
});

test('a failing connection is logged instead of crashing the process', async () => {
  const harness = makeHarness();
  clientFactory = () => ({
    connect: async () => {
      throw new Error('backend unreachable');
    },
    get: async () => ({}),
    put: async () => ({}),
    end: async () => {},
  });

  const thermostat = build(harness);
  await flush();

  assert.ok(
    harness.errors.some(entry => String(entry[0]).includes('Connection failed')),
    'expected a connection failure to be logged',
  );
  await assert.rejects(
    () => Promise.resolve(
      thermostatOf(harness).getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(),
    ),
    isCommunicationFailure,
  );

  thermostat.dispose();
});

test('the outdoor sensor is only present when enabled, and reports its reading', async () => {
  const withoutSensor = makeHarness();
  clientFactory = () => healthyClient({ IHT: '19', TSP: '20', BAI: 'No' });
  const plain = build(withoutSensor);
  await flush();
  assert.equal(
    withoutSensor.accessory.getServiceById(Service.TemperatureSensor, 'outdoor'),
    undefined,
  );
  plain.dispose();

  const withSensor = makeHarness({ showOutdoorTemperature: true });
  clientFactory = () => healthyClient({ IHT: '19', TSP: '20', BAI: 'No' });
  const thermostat = build(withSensor);
  await flush();

  const outdoor = withSensor.accessory.getServiceById(Service.TemperatureSensor, 'outdoor');
  assert.ok(outdoor, 'outdoor service missing');
  assert.equal(await outdoor.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest(), 8.5);

  thermostat.dispose();
});

test('dispose closes the connection and stops polling', async () => {
  const harness = makeHarness();
  let ended = false;
  clientFactory = () => ({
    connect: async () => {},
    get: async () => ({ value: { IHT: '19', TSP: '20', BAI: 'No' } }),
    put: async () => ({}),
    end: async () => {
      ended = true;
    },
  });

  const thermostat = build(harness);
  await flush();

  thermostat.dispose();
  await flush();

  assert.ok(ended, 'expected the client to be closed');
  assert.equal((thermostat as unknown as { pollTimer: unknown }).pollTimer, null);
});
