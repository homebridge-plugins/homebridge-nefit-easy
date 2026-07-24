import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
} from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { NefitEasyThermostat } from './thermostatAccessory.js';
import type { NefitEasyConfig, NefitEasyCredentials } from './types.js';

export class NefitEasyPlatform implements DynamicPlatformPlugin {
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private thermostat?: NefitEasyThermostat;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => this.discoverDevices());
    // Stop the poll timer and close the XMPP socket so a Homebridge restart
    // does not leave the connection dangling.
    this.api.on('shutdown', () => this.thermostat?.dispose());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  private discoverDevices(): void {
    const config = this.config as NefitEasyConfig;
    const credentials = this.readCredentials(config);
    if (!credentials) {
      return;
    }

    // Keyed on the serial number so the accessory survives restarts and a
    // renamed thermostat does not orphan the cached one.
    const uuid = this.api.hap.uuid.generate(credentials.serialNumber);

    const stale = this.cachedAccessories.filter(accessory => accessory.UUID !== uuid);
    if (stale.length > 0) {
      this.log.info('Removing %d cached accessory/accessories for another device.', stale.length);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    let accessory = this.cachedAccessories.find(candidate => candidate.UUID === uuid);
    if (accessory) {
      this.log.info('Restoring existing accessory:', accessory.displayName);
    } else {
      accessory = new this.api.platformAccessory(config.name ?? 'Nefit Easy', uuid);
      this.log.info('Registering new accessory:', accessory.displayName);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    this.thermostat = new NefitEasyThermostat(this, accessory, credentials);
  }

  private readCredentials(config: NefitEasyConfig): NefitEasyCredentials | null {
    const { serialNumber, accessKey, password } = config;

    if (!serialNumber || !accessKey || !password) {
      this.log.error(
        'Missing credentials. Set the serial number, access key and password in the plugin settings.',
      );
      return null;
    }

    return { serialNumber, accessKey, password };
  }
}
