const NefitEasyClient = require('nefit-easy-commands');
var Service, Characteristic, HapStatusError, HAPStatus;
var deviceClient;

module.exports = function(homebridge) {
  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  HapStatusError = homebridge.hap.HapStatusError;
  HAPStatus      = homebridge.hap.HAPStatus;

  homebridge.registerAccessory('homebridge-nefit-easy', 'NefitEasy', NefitEasyAccessory);
  homebridge.registerAccessory('homebridge-nefit-easy', 'NefitEasyOutdoorTemp', NefitEasyAccessoryOutdoorTemp);
};

const nefitEasyServices = function() {
  const informationService = new Service.AccessoryInformation()
        .setCharacteristic(Characteristic.Manufacturer, 'Nefit')
        .setCharacteristic(Characteristic.Model, 'Easy')
        .setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

  return [informationService, this.service];
};

function NefitEasyAccessory(log, config) {
  this.log     = log;
  this.name    = config.name;

  // Make sure that the credentials are there.
  var creds = config.options || config.authentication;
  if (! creds || typeof creds.serialNumber !== 'string' ||
      typeof creds.accessKey !== 'string' || typeof creds.password !== 'string') {
    throw Error('[homebridge-nefit-easy] Invalid/missing credentials in configuration file.');
  }

  this.serialNumber = creds.serialNumber;
  this.lastKnown    = {};
  this.service = new Service.Thermostat(this.name);

  if (typeof deviceClient === 'undefined') {
    deviceClient  = NefitEasyClient(creds);
  }

  // Establish connection with device. Throwing from here would be an unhandled
  // rejection, which terminates the Homebridge process on Node 20+.
  deviceClient.connect().catch((e) => {
    this.log.error('Failed to connect to Nefit Easy device:', e.message || e);
  });

  this.service
    .getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .onGet(() => Characteristic.TemperatureDisplayUnits.CELSIUS)
    .setProps({validValues: [Characteristic.TemperatureDisplayUnits.CELSIUS]});

  this.service
    .getCharacteristic(Characteristic.CurrentTemperature)
    .onGet(this.getTemperature.bind(this, 'current', 'in house temp', true));

  this.service
    .getCharacteristic(Characteristic.TargetTemperature)
    .onGet(this.getTemperature.bind(this, 'target', 'temp setpoint', true))
    .onSet(this.setTemperature.bind(this))
    .setProps({minValue: 5, maxValue: 30, minStep: 0.5});

  this.service
    .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .onGet(this.getCurrentState.bind(this))
    .setProps(
      {validValues: [Characteristic.CurrentHeatingCoolingState.OFF,
                     Characteristic.CurrentHeatingCoolingState.HEAT]
      });

  this.service
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .onGet(() => Characteristic.TargetHeatingCoolingState.AUTO)
    .setProps({validValues: [Characteristic.TargetHeatingCoolingState.AUTO]});
};

const nefitEasyGetTemp = async function(type, prop, skipOutdoor) {
  this.log.debug('Getting %s temperature...', type);

  try {
    const status = await deviceClient.status(skipOutdoor);
    const temp = status[prop];
    if (!isNaN(temp) && isFinite(temp)) {
      this.log.debug('...%s temperature is %s', type, temp);
      this.lastKnown[prop] = temp;
      return temp;
    }

    // Try one more time, this almost always results in a valid value.
    this.log.debug('Request for temperature resulted in invalid value: %s', temp);
    const newStatus = await deviceClient.status(skipOutdoor);
    const newTemp = newStatus[prop];
    if (!isNaN(newTemp) && isFinite(newTemp)) {
      this.log.debug('Retry request for temperature resulted in valid value: %s', newTemp);
      this.lastKnown[prop] = newTemp;
      return newTemp;
    }

    this.log.debug('Retry request for temperature resulted in invalid value again: %s', newTemp);

    // Return last known value, needed to keep service responsive for Siri. Tracked
    // separately because the characteristic itself defaults to 0, which would be
    // reported as a real 0°C reading before the first successful poll.
    if (prop in this.lastKnown) {
      return this.lastKnown[prop];
    }

    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  } catch (e) {
    if (e instanceof HapStatusError) {
      throw e;
    }
    this.log.error('Error getting %s temperature:', type, e.message || e);
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
};

NefitEasyAccessory.prototype.getTemperature = nefitEasyGetTemp;

NefitEasyAccessory.prototype.setTemperature = async function(temp) {
  // Round off to nearest half/full.
  temp = Math.round(temp * 2) / 2;

  this.log.info('Setting temperature to %s', temp);
  try {
    await deviceClient.setTemperature(temp);
  } catch (e) {
    this.log.error('Error setting temperature:', e.message || e);
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
};

NefitEasyAccessory.prototype.getCurrentState = async function() {
  this.log.debug('Getting current state..');

  try {
    const status = await deviceClient.status(true);
    const state = status['boiler indicator'];
    const isHeating = state === 'central heating';
    this.log.debug('...current state is', state);
    return isHeating ? Characteristic.CurrentHeatingCoolingState.HEAT :
                       Characteristic.CurrentHeatingCoolingState.OFF;
  } catch (e) {
    this.log.error('Error getting current state:', e.message || e);
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }
};

NefitEasyAccessory.prototype.getServices = nefitEasyServices;

function NefitEasyAccessoryOutdoorTemp(log, config) {
  this.log     = log;
  this.name    = config.name;

  // Make sure that the credentials are there.
  var creds = config.options || config.authentication;
  if (! creds || typeof creds.serialNumber !== 'string' ||
      typeof creds.accessKey !== 'string' || typeof creds.password !== 'string') {
    throw Error('[homebridge-nefit-easy] Invalid/missing credentials in configuration file.');
  }

  this.serialNumber = creds.serialNumber;
  this.lastKnown    = {};
  this.service = new Service.TemperatureSensor(this.name);

  if (typeof deviceClient === 'undefined') {
    deviceClient  = NefitEasyClient(creds);
  }

  // Establish connection with device. Throwing from here would be an unhandled
  // rejection, which terminates the Homebridge process on Node 20+.
  deviceClient.connect().catch((e) => {
    this.log.error('Failed to connect to Nefit Easy device:', e.message || e);
  });

  this.service
    .getCharacteristic(Characteristic.CurrentTemperature)
    .onGet(this.getTemperature.bind(this, 'outdoor', 'outdoor temp', false));
};

NefitEasyAccessoryOutdoorTemp.prototype.getTemperature = nefitEasyGetTemp;

NefitEasyAccessoryOutdoorTemp.prototype.getServices = nefitEasyServices;
