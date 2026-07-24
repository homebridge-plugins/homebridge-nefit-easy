/**
 * Parsing helpers for the raw Nefit Easy backend payloads.
 *
 * Deliberately free of any Homebridge dependency so they can be unit tested
 * without standing up a platform. The field names and the boiler indicator
 * mapping follow nefit-easy-commands, which this plugin used up to 2.x.
 */

/** Raw `value` object of a `/ecus/rrc/uiStatus` response. */
export interface UiStatusValue {
  /** In-house temperature. */
  IHT?: unknown;
  /** Temperature setpoint. */
  TSP?: unknown;
  /** Boiler activity indicator. */
  BAI?: unknown;
  [key: string]: unknown;
}

export interface UiStatusResponse {
  value?: UiStatusValue;
}

/** Response shape of the endpoints that return a single reading. */
export interface ScalarResponse {
  value?: unknown;
}

export type BoilerIndicator = 'central heating' | 'hot water' | 'off';

export interface ThermostatStatus {
  currentTemperature: number | null;
  targetTemperature: number | null;
  /** Null when the backend reported a code we do not recognise. */
  boilerIndicator: BoilerIndicator | null;
}

const BOILER_INDICATORS: Record<string, BoilerIndicator> = {
  CH: 'central heating',
  HW: 'hot water',
  No: 'off',
};

/**
 * Coerce a raw backend value to a finite number, or null when it is not
 * numeric. Empty strings and null are rejected explicitly because Number()
 * turns both into 0, which would read as a real 0°C measurement.
 */
export function parseTemperature(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseBoilerIndicator(raw: unknown): BoilerIndicator | null {
  return typeof raw === 'string' ? BOILER_INDICATORS[raw] ?? null : null;
}

export function parseUiStatus(response: UiStatusResponse | null | undefined): ThermostatStatus {
  const value = response?.value ?? {};
  return {
    currentTemperature: parseTemperature(value.IHT),
    targetTemperature: parseTemperature(value.TSP),
    boilerIndicator: parseBoilerIndicator(value.BAI),
  };
}

export function parseScalarTemperature(response: ScalarResponse | null | undefined): number | null {
  return parseTemperature(response?.value);
}
