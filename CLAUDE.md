# homebridge-nefit-easy

Homebridge plugin for the Nefit Easy™ thermostat (aka Worcester Wave™, Junkers Control™). Talks to the Nefit/Bosch cloud backend over XMPP.

## Layout

```
src/index.ts               registers the platform with Homebridge
src/platform.ts            dynamic platform: validates config, manages the cached accessory
src/thermostatAccessory.ts connection, polling, characteristics, writes
src/status.ts              pure parsing of backend payloads, no Homebridge imports
src/types.ts               config and credential types
src/bosch-xmpp.d.ts        ambient types for the untyped bosch-xmpp package
test/                      unit tests for status.ts, accessory tests against the real HAP API
config.schema.json         Homebridge UI settings form
```

Build output goes to `dist/`, which is what npm publishes (`files` in package.json). `src/` is never shipped.

## Commands

```
npm run build    rimraf dist && tsc
npm run lint     eslint src test
npm test         tsx --test --experimental-test-module-mocks test/*.test.ts
```

`prepublishOnly` runs lint, build and test, so a broken tree cannot be published.

## Backend

`bosch-xmpp` gives a thin client: `NefitEasyClient({serialNumber, accessKey, password})` with `connect()`, `get(uri)`, `put(uri, data)` and `end()`. There is no higher-level API, so the endpoints and payload shapes live in this repo.

Endpoints in use:

| URI | Purpose |
|---|---|
| `/ecus/rrc/uiStatus` | main status poll |
| `/system/sensors/temperatures/outdoor_t1` | outdoor temperature |
| `/heatingCircuits/hc1/temperatureRoomManual` | setpoint |
| `/heatingCircuits/hc1/manualTempOverride/status` | enable manual override |
| `/heatingCircuits/hc1/manualTempOverride/temperature` | override temperature |

Fields read from the `uiStatus` payload:

| Field | Meaning |
|---|---|
| `IHT` | in-house temperature |
| `TSP` | temperature setpoint |
| `BAI` | boiler activity: `CH` central heating, `HW` hot water, `No` off |

Setting a temperature needs all three PUTs. The thermostat ignores a new setpoint unless the manual override is switched on as well.

### `LINE_SEPARATOR` is not optional

`connect()` sets `client.LINE_SEPARATOR = '\r'`. Do not remove it.

`bosch-xmpp` builds `PUT` bodies by joining the header lines with a bare `\n`, and `GET` bodies with `\n\n`. The thermostat answers every bare-LF `PUT` with `400 Bad Request` and an empty body, while `GET` happens to use a separator it tolerates. So reads work, writes silently do not, which looks like a credentials or endpoint problem but is neither.

A lone `\r` is the right value because `NefitEasyClient.buildMessage` serialises it into the stanza as `&#13;\n`, which reaches the device as a proper CRLF. Verified against a live device:

| Separator | GET | PUT |
|---|---|---|
| `\n` (library default for PUT) | n/a | 400 |
| `\r` (becomes CRLF) | ok | ok |
| `\r\n` (becomes CR LF LF) | ok | 400 |
| `\n\n` (library default for GET) | ok | ok |

`\n\n` also works, but `\r` is the only variant that produces valid HTTP framing and is clearly what the library intended. There is a regression test for this in `test/thermostatAccessory.test.ts`; if a `bosch-xmpp` upgrade ever makes it unnecessary, delete the line and the test together, and re-test writes against a real device first.

These endpoint and field definitions were taken from `nefit-easy-commands`, the library this plugin depended on up to 2.x (`lib/commands/status.js` and `lib/commands/setTemperature.js`), and from the `bosch-xmpp` README. Both are MIT and by the same author as the original plugin. If you need a field this plugin does not read yet, look there first rather than guessing.

## Conventions that matter

**Never report a value that was not measured.** Cached readings start as `null` and `readCached()` throws `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` while they are. Initialising to something like `20` would be indistinguishable from a real measurement in HomeKit and would make automations act on invented data. Once a real reading has arrived it is retained across a dropped connection, so a brief outage does not flap the accessory.

**Only `BAI === 'CH'` counts as heating.** Producing hot water leaves the thermostat itself idle, so `HW` maps to `OFF` for `CurrentHeatingCoolingState`.

**Errors go through `this.platform.log`, never `console`.** Failures surfaced to HomeKit use `HapStatusError`, not raw throws, otherwise Homebridge logs a stack trace instead of a clean "No Response".

**Never throw from inside a `.catch()` or an untracked promise.** That becomes an unhandled rejection, which terminates Homebridge on current Node versions. `connect()` catches everything and schedules a reconnect instead.

**Re-check `disposed` after every await in the connect path.** Homebridge can shut down mid-handshake; without the check the poll timer and socket outlive `dispose()`.

**`status.ts` stays free of Homebridge imports** so it can be unit tested without a platform.

## Testing

`test/status.test.ts` covers parsing directly.

`test/thermostatAccessory.test.ts` builds the accessory against the real `@homebridge/hap-nodejs` classes with a stubbed backend client, injected via `mock.module` (hence the `--experimental-test-module-mocks` flag). A fake `PlatformAccessory` wraps real HAP `Service` instances.

Note that `handleGetRequest()` rejects with the bare HAP status code, while calling a handler directly surfaces the `HapStatusError` object. The `isCommunicationFailure` helper accepts both.

Tests must call `thermostat.dispose()`, otherwise the poll timer keeps the runner alive.

## Releasing

The default branch is `latest` and it is protected, so everything goes through a PR. Publishing runs from `.github/workflows/release.yml` using npm OIDC trusted publishing, so no npm token is needed.

* **Beta**: push a branch named `beta-X.Y.Z`. Publishes `X.Y.Z-beta.N` to the npm `beta` tag. Does not need to be merged to `latest` first.
* **Release**: create a GitHub Release with tag `vX.Y.Z` pointing at `latest`. Publishes to the `latest` tag.

`npm ci` in the workflows carries `--allow-remote=all`. That was needed for the 2.x dependency tree, which pulled a transitive dependency from a GitHub tarball that npm 12 refuses by default. The 3.x tree is entirely registry-resolved and no longer needs it, so the flag can be dropped once 2.x is no longer maintained.

## History

2.x was an accessory plugin in a single `index.js`, built on `nefit-easy-commands`. That library was last published in 2022 and pulled in the deprecated `node-xmpp-client` stack, including a dependency fetched from a GitHub tarball. 3.0.0 moved to `bosch-xmpp`, which is maintained and resolves entirely from the registry, and converted the plugin to a platform so it can be configured from the Homebridge UI.
