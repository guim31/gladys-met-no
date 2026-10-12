# MET Norway for Gladys Assistant

Weather provider for [Gladys Assistant](https://gladysassistant.com) backed by
the forecasts of [MET Norway](https://www.met.no/en), the Norwegian
Meteorological Institute: worldwide, free, **no account, no API key**. It is
the default weather of Home Assistant.

**Weather data from [MET Norway](https://api.met.no/)**, under the
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) licence. This
integration is a community project and is **not affiliated with MET Norway**.

## What it does

- **Feeds the Gladys weather widget and chat assistant** (manifest
  `type: "weather"`): current conditions, the next 24 hours with their
  precipitation, the next 8 days, feels-like temperature, dew point, wind,
  cloud cover, clear-sky UV index, sunrise and sunset (computed), in
  °F/mph/in or °C/m/s/mm after each user's unit system. In the Nordic
  countries, also the gusts and the probability of precipitation. The 83
  weather symbols of MET Norway are mapped to the Gladys conditions (sleet,
  thundery snow and freezing fog included), day and night apart.
- **Scene trigger "Rain or snow expected within the hour"**, from the hourly
  forecast.
- **Scene action "Get the precipitation of the next hour"**.
- **Scene action "Get the forecast of the day"** (today or tomorrow): sky,
  minimum and maximum, precipitation, wind, and a sentence ready to send.

No dashboard widget: the core weather widget already draws everything
Locationforecast has. **No weather alerts**: MET Norway's MetAlerts only
cover Norway. Install the Météo France or Pirate Weather integration next to
it for official warnings.

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Install

1. In Gladys (**5.2 or later**), give your house a location: **Settings →
   Houses**.
2. Install **MET Norway** from the integration catalog, or **Integrations →
   Install from GitHub** with `https://github.com/guim31/gladys-met-no`, and
   allow access to the house location (used to watch the next hour for the
   scene trigger).
3. In the **Configuration** tab, click **Test MET Norway**.

## Calls and MET Norway's terms

One request per location returns everything:

```
GET https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=..&lon=..[&altitude=..]
User-Agent: gladys-met-no/<version> github.com/guim31/gladys-met-no
```

The integration follows the
[terms of service](https://api.met.no/doc/TermsOfService) and the
[HOWTO](https://docs.api.met.no/doc/locationforecast/HowTO):

- an identifying `User-Agent` with a contact;
- coordinates with at most 4 decimals;
- **never a call before the `Expires` of the cached answer**, and after it a
  conditional request (`If-Modified-Since` with the exact `Last-Modified`): a
  `304` keeps the cached forecast. This is enforced in the forecast store, so
  no caller can break it;
- a timer refreshes every house with a location when its answer expires, never
  sooner than 30 minutes, plus a random 0-5 minutes so that installations do
  not call in step; houses at the same location share one call, and the
  weather requests of Gladys (dashboard, chat, alert check) are served from
  memory;
- `429`: every call paused for 10 minutes, doubling up to 2 hours (or the
  server's `Retry-After`); `403`: paused for 6 hours; `203` (deprecated
  product) is logged;
- when a refresh fails, a forecast up to 3 hours old keeps being served.

Sunrise and sunset are computed locally (NOAA algorithm) rather than costing a
Sunrise 3.0 call per house and day. Days are cut at the midnights of the time
zone of Gladys (`TZ`).

## Limits

- **No official alerts** outside Norway (see above). Nowcast 2.0
  (minute-by-minute rain) only covers the Nordic countries and is not used:
  the trigger works to the hour.
- Gusts and probabilities exist only where MET Norway runs its own models
  (the Nordic countries); elsewhere they are left out.
- No visibility (MET gives a fog fraction). The UV index is the clear-sky one.
- One optional altitude for all houses (Gladys does not store the altitude of
  a house).
- Requires Gladys 5.2 or later: the scene cards let you pick a house from a
  list (`source: "houses"`), new in 5.2.0.
- Verified against the live API on 12 October 2026 (Toulouse, Oslo, New York,
  Sydney, the North Atlantic, the Pic du Midi at 2,877 m, Longyearbyen); the
  automated tests run on those recorded responses, see
  [the fixtures](test/fixtures/README.md). Not yet run against a real Gladys
  instance: feedback welcome.

## Development

Node.js 22+, ESM, no build step; the only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm ci
npm run format:check   # Prettier (Markdown included)
npm run lint           # ESLint
npm test               # node --test, never touches the network
npx github:GladysAssistant/integration-store .   # store admission checks
```

```
index.js                 SDK wiring only
src/app.js               the integration on an injected client (handlers, status)
src/api.js               the one MET Norway call: User-Agent, conditional request, error kinds
src/forecast.js          GeoJSON response → slim metric forecast
src/forecast-store.js    cache per location, Expires / 304, shared calls, 429 / 403 pauses
src/scheduler.js         the refresh timer (Expires, 30 min floor, jitter, retries)
src/pivot.js             slim forecast → Gladys pivot weather, in the requested units
src/daily.js             the days, from the hours and the 6-hour periods
src/symbols.js           MET Norway symbols → Gladys conditions, day/night
src/sun.js, time.js      computed sunrise/sunset, local days
src/next-hour.js         precipitation within the hour
src/scene-triggers.js    "precipitation expected within the hour"
src/scene-actions.js     "precipitation of the next hour", "forecast of the day"
src/houses.js            the houses of Gladys
src/units.js, texts.js   conversions, the texts in English, French, German, Spanish
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="met-no" \
LOG_LEVEL=debug \
npm start
```

## Releasing

Versions belong to the **Release** workflow (Actions → Release → patch, minor
or major): it bumps `package.json` and the manifest `version`/`docker_image`,
moves the `## [Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md), tags,
builds the multi-arch image to `ghcr.io/guim31/gladys-met-no` and publishes
the GitHub Release.

> A hand-pushed tag (`git tag v1.0.0 && git push --tags`) triggers the same
> build and Release but touches no file: bump `version` in `package.json` and
> in `gladys-assistant-integration.json` (with the `docker_image` tag) and
> commit **before** tagging.

## Credits

- Weather data from [MET Norway](https://api.met.no/) (CC BY 4.0), the
  Norwegian Meteorological Institute.
- The symbol legend comes from
  [metno/weathericons](https://github.com/metno/weathericons) (MIT, © Yr),
  copied in `test/fixtures/weathericons-legend.csv`.
- The condition mapping and the daily summary follow the Home Assistant
  [`met`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/met)
  integration (Apache-2.0) and its
  [`pymetno`](https://github.com/Danielhiversen/pyMetno) library (MIT).
- Cover: the official logo of MET Norway, from
  [met.no](https://www.met.no/en), on its brand colour.
- Architecture shared with the sister integration
  [Open-Meteo for Gladys](https://github.com/guim31/gladys-open-meteo).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js).

## License

Apache-2.0
