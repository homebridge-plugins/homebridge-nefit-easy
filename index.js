const NefitEasyClient = require('nefit-easy-commands');
var Service, Characteristic;
var deviceClient;

module.exports = function(homebridge) {
  Service        = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

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
  this.service = new Service.Thermostat(this.name);

  if (typeof deviceClient === 'undefined') {
    deviceClient  = NefitEasyClient(creds);
  }

  // Establish connection with device.
  deviceClient.connect().catch((e) => {
    throw Error(e);
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
      return temp;
    }

    // Try one more time, this almost always results in a valid value.
    this.log.debug('Request for temperature resulted in invalid value: %s', temp);
    const newStatus = await deviceClient.status(skipOutdoor);
    const newTemp = newStatus[prop];
    if (!isNaN(newTemp) && isFinite(newTemp)) {
      this.log.debug('Retry request for temperature resulted in valid value: %s', newTemp);
      return newTemp;
    }

    this.log.debug('Retry request for temperature resulted in invalid value again: %s', newTemp);

    // Return last known value, needed to keep service responsive for Siri.
    if (prop === 'in house temp' || prop === 'outdoor temp') {
      return this.service.getCharacteristic(Characteristic.CurrentTemperature).value;
    } else if (prop === 'temp setpoint') {
      return this.service.getCharacteristic(Characteristic.TargetTemperature).value;
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
};

NefitEasyAccessory.prototype.getTemperature = nefitEasyGetTemp;

NefitEasyAccessory.prototype.setTemperature = async function(temp) {
  // Round off to nearest half/full.
  temp = Math.round(temp * 2) / 2;

  this.log.info('Setting temperature to %s', temp);
  await deviceClient.setTemperature(temp);
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
    console.error(e);
    throw e;
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
  this.service = new Service.TemperatureSensor(this.name);

  if (typeof deviceClient === 'undefined') {
    deviceClient  = NefitEasyClient(creds);
  }

  // Establish connection with device.
  deviceClient.connect().catch((e) => {
    throw Error(e);
  });

  this.service
    .getCharacteristic(Characteristic.CurrentTemperature)
    .onGet(this.getTemperature.bind(this, 'outdoor', 'outdoor temp', false));
};

NefitEasyAccessoryOutdoorTemp.prototype.getTemperature = nefitEasyGetTemp;

NefitEasyAccessoryOutdoorTemp.prototype.getServices = nefitEasyServices;
