# Homebridge Nefit Easy™ plugin

This is a plugin for [Homebridge](https://homebridge.io) to allow controlling your Nefit Easy™ (aka Worcester Wave™, Junkers Control™) thermostat through Apple HomeKit.

Uses the [`bosch-xmpp`](https://github.com/robertklep/bosch-xmpp) module under the hood to communicate with the Nefit/Bosch backend.

## Requirements

* Node.js 22.12.0 or later
* Homebridge v1.6.0 or later, including Homebridge v2

## Installation

Search for `homebridge-nefit-easy` on the Plugins tab of the Homebridge UI, or install it from the command line:

```
$ npm i homebridge-nefit-easy -g
```

Homebridge plugins need to be installed globally, so the `-g` is mandatory.

## Configuration

Configure the plugin from the Homebridge UI, or add a platform block to your `config.json`:

```json
"platforms": [
    {
        "platform": "NefitEasy",
        "name": "Nefit Easy",
        "serialNumber": "NEFIT_SERIAL_NUMBER",
        "accessKey": "NEFIT_ACCESS_KEY",
        "password": "NEFIT_PASSWORD",
        "showOutdoorTemperature": false,
        "pollingInterval": 60
    }
]
```

| Option | Required | Default | Description |
|---|---|---|---|
| `platform` | yes | | Must be `NefitEasy`. |
| `name` | no | `Nefit Easy` | The name shown in HomeKit, and the one you use in Siri commands. |
| `serialNumber` | yes | | The serial number of your thermostat. |
| `accessKey` | yes | | The access key of your thermostat. |
| `password` | yes | | The password you set in the Nefit Easy app. |
| `showOutdoorTemperature` | no | `false` | Adds a separate temperature sensor for the outdoor temperature measured by the thermostat. |
| `pollingInterval` | no | `60` | Seconds between backend polls. Values below 30 are raised to 30. |

## Upgrading from 2.x

Version 3.0.0 turns the plugin into a platform plugin, so the configuration format has changed.

Remove the old `NefitEasy` and `NefitEasyOutdoorTemp` entries from the `accessories` array and add a single `platforms` entry as shown above. The outdoor temperature sensor is now the `showOutdoorTemperature` option rather than a separate accessory.

Because the accessory is registered fresh, you may need to reassign it to a room in the Home app once after upgrading.

## Supported actions

* Getting the current temperature
* Getting the target temperature
* Setting the target temperature
* Reading whether the boiler is currently heating
* Getting the outdoor temperature (optional)

The thermostat keeps running its own schedule; the plugin reports the mode as `AUTO` and does not switch it off. Setting a temperature from HomeKit applies a manual override, the same as turning the dial on the device.

## Behaviour when the backend is unreachable

The Nefit/Bosch backend is not always reliable. The plugin polls it on an interval and serves the last reading it actually received, so a short outage does not disturb HomeKit.

Until a first successful reading arrives, characteristics report a communication failure and HomeKit shows "No Response". This is deliberate: reporting a placeholder value would be indistinguishable from a real measurement and would make automations act on data that was never measured.

## Problems on recent Linux distributions

If you're having problems getting any data from the thermostat, and you're using a recent Linux distribution (for instance, Raspbian Buster or later), take a look at [this comment](https://github.com/robertklep/nefit-easy-http-server/issues/35#issuecomment-510818042).

In short: OpenSSL defaults have changed to require a minimum TLS version and cipher implementation. These defaults cause the Nefit client code to not be able to connect to the Nefit/Bosch backend.

The solution is mentioned [here](https://www.debian.org/releases/stable/amd64/release-notes/ch-information.en.html#openssl-defaults): edit the file `/etc/ssl/openssl.cnf` and change the following keys to these values:
```
MinProtocol = None
CipherString = DEFAULT
```

## Development

```
npm install
npm run build    # compile src/ to dist/
npm run lint
npm test         # unit tests plus accessory tests against the real HAP API
```
