// -----------------------------------------------------------------------------
// Fixture loading and a fake fetch answering like MET Norway.
// See test/fixtures/README.md for where each fixture comes from.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { parseForecast } from '../../src/forecast.js';

// The real responses were recorded on 2026-10-12 between 15:20 and 15:24 UTC;
// their first instant is 15:00 UTC.
const FIXTURE_NOW = Date.UTC(2026, 9, 12, 15, 25);

// The locations of the real fixtures, as houses of Gladys.
const HOUSES = Object.freeze({
  toulouse: {
    id: 'h-toulouse',
    name: 'Maison',
    selector: 'maison',
    latitude: 43.6045,
    longitude: 1.444,
    fixture: 'real-toulouse.json',
    timeZone: 'Europe/Paris',
  },
  oslo: {
    id: 'h-oslo',
    name: 'Hytte',
    selector: 'hytte',
    latitude: 59.9139,
    longitude: 10.7522,
    fixture: 'real-oslo.json',
    timeZone: 'Europe/Oslo',
  },
  newYork: {
    id: 'h-ny',
    name: 'Home',
    selector: 'home',
    latitude: 40.7128,
    longitude: -74.006,
    fixture: 'real-new-york.json',
    timeZone: 'America/New_York',
  },
  sydney: {
    id: 'h-syd',
    name: 'Beach house',
    selector: 'beach-house',
    latitude: -33.8688,
    longitude: 151.2093,
    fixture: 'real-sydney.json',
    timeZone: 'Australia/Sydney',
  },
  atlantic: {
    id: 'h-sea',
    name: 'Boat',
    selector: 'boat',
    latitude: 45,
    longitude: -30,
    fixture: 'real-north-atlantic.json',
    timeZone: 'UTC',
  },
  picDuMidi: {
    id: 'h-pic',
    name: 'Refuge',
    selector: 'refuge',
    latitude: 42.9364,
    longitude: 0.1422,
    fixture: 'real-pic-du-midi-2877m.json',
    timeZone: 'Europe/Paris',
  },
  longyearbyen: {
    id: 'h-lyr',
    name: 'Svalbard',
    selector: 'svalbard',
    latitude: 78.2232,
    longitude: 15.6267,
    fixture: 'real-longyearbyen.json',
    timeZone: 'Arctic/Longyearbyen',
  },
});

/**
 * @description The house as Gladys returns it (GET /house): the five fields.
 * @param {object} house - A HOUSES entry.
 * @returns {object} `{ id, name, selector, latitude, longitude }`.
 * @example
 * asGladysHouse(HOUSES.toulouse);
 */
function asGladysHouse({ id, name, selector, latitude, longitude }) {
  return { id, name, selector, latitude, longitude };
}

/**
 * @description Load a fixture (a fresh copy on every call).
 * @param {string} name - The file name in test/fixtures.
 * @returns {object} The parsed JSON.
 * @example
 * loadFixture('real-oslo.json');
 */
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}

/**
 * @description The slim forecast of a fixture.
 * @param {string} name - The file name in test/fixtures.
 * @returns {object} The parsed forecast.
 * @example
 * forecastOf('real-oslo.json');
 */
function forecastOf(name) {
  return parseForecast(loadFixture(name));
}

/**
 * @description Change the next hour of some instants of a raw response, to
 * stage a shower.
 * @param {object} raw - A raw response (modified in place).
 * @param {object} changes - `{ 'ISO time': { symbol, amount, probability? } }`.
 * @returns {object} The response.
 * @example
 * withNextHours(raw, { '2026-10-12T16:00:00Z': { symbol: 'rain', amount: 1.2 } });
 */
function withNextHours(raw, changes) {
  for (const entry of raw.properties.timeseries) {
    const change = changes[entry.time];
    if (change === undefined) {
      continue;
    }
    entry.data.next_1_hours = {
      summary: { symbol_code: change.symbol },
      details: {
        precipitation_amount: change.amount,
        ...(change.probability === undefined
          ? {}
          : { probability_of_precipitation: change.probability }),
      },
    };
  }
  return raw;
}

/**
 * @description A fake fetch. `route(url, init)` returns `{ status, body,
 * headers }` (or throws to simulate a network error); every call is recorded
 * with its headers.
 * @param {Function} route - The router.
 * @returns {Function} The fetch, with `.calls` (`{ url, headers }`).
 * @example
 * const fetchImpl = fakeFetch(() => ({ body: loadFixture('real-oslo.json') }));
 */
function fakeFetch(route) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...init.headers } });
    const { status = 200, body = {}, headers = {} } = await route(String(url), init);
    const text = status === 304 ? null : typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/**
 * @description The house of a request URL, by its coordinates.
 * @param {string} url - The request URL.
 * @returns {object} The HOUSES entry.
 * @example
 * houseForUrl('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=59.9139&lon=10.7522');
 */
function houseForUrl(url) {
  const params = new URL(url).searchParams;
  const house = Object.values(HOUSES).find(
    (candidate) =>
      Number(params.get('lat')) === Number(candidate.latitude.toFixed(4)) &&
      Number(params.get('lon')) === Number(candidate.longitude.toFixed(4)),
  );
  if (house === undefined) {
    throw new Error(`No fixture for ${url}`);
  }
  return house;
}

/**
 * @description An answer like MET Norway's for a request: the fixture of its
 * location, valid 30 minutes after `now`.
 * @param {Function} now - `() => ms`.
 * @returns {Function} A route for fakeFetch.
 * @example
 * fakeFetch(metNoRoute(() => FIXTURE_NOW));
 */
function metNoRoute(now) {
  return (url) => ({
    body: loadFixture(houseForUrl(url).fixture),
    headers: {
      expires: new Date(now() + 30 * 60 * 1000).toUTCString(),
      'last-modified': new Date(now() - 5 * 60 * 1000).toUTCString(),
    },
  });
}

/**
 * @description A logger that records nothing.
 * @returns {object} The logger.
 * @example
 * createApp(gladys, { logger: silentLogger() });
 */
function silentLogger() {
  return { info() {}, warn() {}, debug() {}, error() {} };
}

/**
 * @description A clock the test moves by hand.
 * @param {number} start - The start, in ms.
 * @returns {Function} `() => ms`, with `.advance(ms)` and `.set(ms)`.
 * @example
 * const clock = manualClock(FIXTURE_NOW); clock.advance(60000);
 */
function manualClock(start) {
  let current = start;
  const now = () => current;
  now.advance = (ms) => {
    current += ms;
  };
  now.set = (ms) => {
    current = ms;
  };
  return now;
}

export {
  FIXTURE_NOW,
  HOUSES,
  asGladysHouse,
  fakeFetch,
  forecastOf,
  houseForUrl,
  loadFixture,
  manualClock,
  metNoRoute,
  silentLogger,
  withNextHours,
};
