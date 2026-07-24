import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import boschXmpp from 'bosch-xmpp';
import type { BoschClient } from 'bosch-xmpp';
import type { NefitEasyPlatform } from './platform.js';
import {
  parseScalarTemperature,
  parseUiStatus,
  type ScalarResponse,
  type ThermostatStatus,
  type UiStatusResponse,
} from './status.js';
import type { NefitEasyConfig, NefitEasyCredentials } from './types.js';

const UI_STATUS_URI = '/ecus/rrc/uiStatus';
const OUTDOOR_TEMPERATURE_URI = '/system/sensors/temperatures/outdoor_t1';
const SETPOINT_URI = '/heatingCircuits/hc1/temperatureRoomManual';
const OVERRIDE_STATUS_URI = '/heatingCircuits/hc1/manualTempOverride/status';
const OVERRIDE_TEMPERATURE_URI = '/heatingCircuits/hc1/manualTempOverride/temperature';

const MIN_TEMPERATURE = 5;
const MAX_TEMPERATURE = 30;
const TEMPERATURE_STEP = 0.5;

const DEFAULT_POLLING_INTERVAL = 60;
const MIN_POLLING_INTERVAL = 30;
const RECONNECT_DELAY = 30_000;

const OUTDOOR_SERVICE_SUBTYPE = 'outdoor';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NefitEasyThermostat {
  private readonly thermostatService: Service;
  private readonly outdoorService?: Service;

  private client: BoschClient | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  // Null until the first successful poll. A placeholder would be indistinguishable
  // from a real measurement in HomeKit, so an unknown reading is reported as a
  // communication failure instead. Once a value has been read it is retained
  // across a dropped connection, so a brief outage does not flap the accessory.
  private currentTemperature: number | null = null;
  private targetTemperature: number | null = null;
  private heating: boolean | null = null;
  private outdoorTemperature: number | null = null;

  constructor(
    private readonly platform: NefitEasyPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly credentials: NefitEasyCredentials,
  ) {
    const { Service, Characteristic } = this.platform.api.hap;
    const config = this.platform.config as NefitEasyConfig;

    this.accessory.getService(Service.AccessoryInformation)
      ?.setCharacteristic(Characteristic.Manufacturer, 'Nefit')
      .setCharacteristic(Characteristic.Model, 'Easy')
      .setCharacteristic(Characteristic.SerialNumber, this.credentials.serialNumber);

    this.thermostatService = this.accessory.getService(Service.Thermostat)
      ?? this.accessory.addService(Service.Thermostat, config.name ?? 'Nefit Easy');

    this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.readCached(this.currentTemperature));

    this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
      .setProps({
        minValue: MIN_TEMPERATURE,
        maxValue: MAX_TEMPERATURE,
        minStep: TEMPERATURE_STEP,
      })
      .onGet(() => this.readCached(this.targetTemperature))
      .onSet(value => this.setTargetTemperature(value));

    this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
      .setProps({
        validValues: [
          Characteristic.CurrentHeatingCoolingState.OFF,
          Characteristic.CurrentHeatingCoolingState.HEAT,
        ],
      })
      .onGet(() => this.readCached(this.heating)
        ? Characteristic.CurrentHeatingCoolingState.HEAT
        : Characteristic.CurrentHeatingCoolingState.OFF);

    // The Nefit Easy runs its own schedule; HomeKit only ever observes it.
    this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
      .setProps({ validValues: [Characteristic.TargetHeatingCoolingState.AUTO] })
      .onGet(() => Characteristic.TargetHeatingCoolingState.AUTO);

    this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
      .setProps({ validValues: [Characteristic.TemperatureDisplayUnits.CELSIUS] })
      .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS);

    const existingOutdoorService = this.accessory.getServiceById(
      Service.TemperatureSensor,
      OUTDOOR_SERVICE_SUBTYPE,
    );

    if (config.showOutdoorTemperature) {
      this.outdoorService = existingOutdoorService
        ?? this.accessory.addService(
          Service.TemperatureSensor,
          'Outdoor Temperature',
          OUTDOOR_SERVICE_SUBTYPE,
        );
      this.outdoorService.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -50, maxValue: 60 })
        .onGet(() => this.readCached(this.outdoorTemperature));
    } else if (existingOutdoorService) {
      this.accessory.removeService(existingOutdoorService);
    }

    void this.connect();
  }

  /** Stop polling and close the backend connection. Called on Homebridge shutdown. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopPolling();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    void this.teardownClient();
  }

  private readCached<T>(value: T | null): T {
    if (value === null) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    return value;
  }

  private async connect(): Promise<void> {
    if (this.disposed) {
      return;
    }

    this.platform.log.info('Connecting to the Nefit Easy backend...');

    try {
      this.client = boschXmpp.NefitEasyClient(this.credentials);
      await this.client.connect();

      // Homebridge may have shut down while the handshake was in flight; without
      // this the poll timer and socket below would outlive dispose().
      if (this.disposed) {
        await this.teardownClient();
        return;
      }

      this.platform.log.info('Connected to the Nefit Easy backend.');
      await this.poll();
      this.startPolling();
    } catch (error) {
      this.platform.log.error(
        'Connection failed: %s. Retrying in %d seconds.',
        errorMessage(error),
        RECONNECT_DELAY / 1000,
      );
      await this.teardownClient();
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, RECONNECT_DELAY);
  }

  private startPolling(): void {
    this.stopPolling();
    if (this.disposed) {
      return;
    }
    const config = this.platform.config as NefitEasyConfig;
    const seconds = Math.max(
      config.pollingInterval ?? DEFAULT_POLLING_INTERVAL,
      MIN_POLLING_INTERVAL,
    );
    this.platform.log.debug('Polling every %d seconds.', seconds);
    this.pollTimer = setInterval(() => void this.poll(), seconds * 1000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async teardownClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) {
      return;
    }
    try {
      await client.end();
    } catch (error) {
      this.platform.log.debug('Closing the connection failed: %s', errorMessage(error));
    }
  }

  private async poll(): Promise<void> {
    if (this.disposed || !this.client) {
      return;
    }

    try {
      const response = await this.client.get(UI_STATUS_URI) as UiStatusResponse;
      this.applyStatus(parseUiStatus(response));

      if (this.outdoorService) {
        await this.pollOutdoorTemperature();
      }
    } catch (error) {
      this.platform.log.warn('Polling failed: %s. Reconnecting.', errorMessage(error));
      this.stopPolling();
      await this.teardownClient();
      this.scheduleReconnect();
    }
  }

  private applyStatus(status: ThermostatStatus): void {
    const { Characteristic } = this.platform.api.hap;

    if (status.currentTemperature === null) {
      this.platform.log.debug('Backend reported a non-numeric in-house temperature.');
    } else if (status.currentTemperature !== this.currentTemperature) {
      this.currentTemperature = status.currentTemperature;
      this.thermostatService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .updateValue(status.currentTemperature);
    }

    if (status.targetTemperature === null) {
      this.platform.log.debug('Backend reported a non-numeric setpoint.');
    } else if (status.targetTemperature !== this.targetTemperature) {
      this.targetTemperature = status.targetTemperature;
      this.thermostatService
        .getCharacteristic(Characteristic.TargetTemperature)
        .updateValue(status.targetTemperature);
    }

    if (status.boilerIndicator === null) {
      this.platform.log.debug('Backend reported an unknown boiler indicator.');
      return;
    }

    // Only central heating counts as heating; producing hot water leaves the
    // thermostat itself idle.
    const heating = status.boilerIndicator === 'central heating';
    if (heating !== this.heating) {
      this.heating = heating;
      this.thermostatService
        .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
        .updateValue(heating
          ? Characteristic.CurrentHeatingCoolingState.HEAT
          : Characteristic.CurrentHeatingCoolingState.OFF);
    }
  }

  private async pollOutdoorTemperature(): Promise<void> {
    if (!this.client || !this.outdoorService) {
      return;
    }

    // A missing outdoor sensor must not take the whole poll down, so this
    // swallows its own errors.
    try {
      const response = await this.client.get(OUTDOOR_TEMPERATURE_URI) as ScalarResponse;
      const temperature = parseScalarTemperature(response);
      if (temperature === null) {
        this.platform.log.debug('Backend reported a non-numeric outdoor temperature.');
        return;
      }
      if (temperature !== this.outdoorTemperature) {
        this.outdoorTemperature = temperature;
        this.outdoorService
          .getCharacteristic(this.platform.api.hap.Characteristic.CurrentTemperature)
          .updateValue(temperature);
      }
    } catch (error) {
      this.platform.log.debug('Outdoor temperature poll failed: %s', errorMessage(error));
    }
  }

  private async setTargetTemperature(value: CharacteristicValue): Promise<void> {
    const temperature = Math.round((value as number) * 2) / 2;

    if (!this.client) {
      this.platform.log.error('Cannot set the temperature while disconnected.');
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }

    this.platform.log.info('Setting temperature to %s', temperature);
    const data = { value: temperature };

    try {
      // The thermostat only honours a manual setpoint once the override is
      // switched on, so all three writes are required.
      await Promise.all([
        this.client.put(SETPOINT_URI, data),
        this.client.put(OVERRIDE_STATUS_URI, { value: 'on' }),
        this.client.put(OVERRIDE_TEMPERATURE_URI, data),
      ]);
      this.targetTemperature = temperature;
    } catch (error) {
      this.platform.log.error('Setting the temperature failed: %s', errorMessage(error));
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }
}
