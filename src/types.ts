import type { PlatformConfig } from 'homebridge';

export interface NefitEasyCredentials {
  serialNumber: string;
  accessKey: string;
  password: string;
}

export interface NefitEasyConfig extends PlatformConfig {
  serialNumber?: string;
  accessKey?: string;
  password?: string;
  /** Seconds between backend polls. */
  pollingInterval?: number;
  showOutdoorTemperature?: boolean;
}
