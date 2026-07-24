# Changelog

All notable changes to this plugin are documented here.

## 3.0.0

**This release changes the configuration format. Your existing configuration will not be picked up until you migrate it.**

### Breaking

- The plugin is now a platform plugin. Remove the `NefitEasy` and `NefitEasyOutdoorTemp` entries from the `accessories` array in your `config.json` and add a single entry to `platforms` instead. See the README, or use the new settings form in the Homebridge UI.
- The separate outdoor temperature accessory is now the `showOutdoorTemperature` option.
- Requires Node.js 22.12.0 or later.
- The accessory is registered anew, so you may need to reassign it to a room in the Home app once.

### Changed

- Switched the backend library from `nefit-easy-commands` to `bosch-xmpp`. The previous library was last published in 2022 and pulled in the deprecated `node-xmpp-client` stack, including a dependency fetched from a GitHub tarball that current npm versions refuse to install. The dependency tree now resolves entirely from the npm registry and reports no audit advisories.
- The backend is polled on an interval instead of being queried on every characteristic read, so HomeKit responds immediately and the backend sees far less traffic. The interval is configurable with `pollingInterval` and defaults to 60 seconds.
- Producing hot water no longer reports the thermostat as heating. Only central heating does.

### Added

- `config.schema.json`, so the plugin can be configured from the Homebridge UI instead of by hand.
- Unit tests for the payload parsing, and accessory tests against the real HAP API.

### Fixed

- The connection and poll timer are now closed cleanly when Homebridge shuts down, including when the shutdown happens while the connection is still being established.

## 2.4.0

Restores compatibility with Homebridge v2. No configuration changes are needed.

### Fixed

- Every characteristic returned "No Response" on Homebridge v2. The `.on('get')` / `.on('set')` handlers were removed in Homebridge v2 and HAP-NodeJS v1, and have been replaced with `.onGet()` / `.onSet()`.
- A failed connection threw from inside a promise rejection handler, which surfaced as an unhandled rejection and terminates Homebridge on Node 20 and later. The failure is now logged instead.
- When the very first reading came back as a non-number, the plugin reported 0°C as though it were a real measurement. It now reports a communication failure until an actual reading arrives.
- Failures are reported to HomeKit as a communication failure rather than a raw error, so the log shows a clean "No Response" instead of a stack trace.
- Errors now go through the Homebridge logger instead of `console.error`.

### Changed

- Requires Node.js 20.18.0 or later, matching Homebridge v2's baseline.
- Repository, issue and homepage links now point at the `homebridge-plugins` organisation.
- Removed the deprecation notice from the README. The plugin is maintained again.
