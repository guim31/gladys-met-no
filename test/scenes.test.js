// -----------------------------------------------------------------------------
// The next hour (next-hour.js), the trigger that announces precipitation
// (scene-triggers.js) and the two scene actions (scene-actions.js), on the
// real responses — dry Toulouse, wet Sydney, Nordic Oslo — and on staged
// showers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast } from '../src/forecast.js';
import { isPrecipitationAnnounced, readNextHour } from '../src/next-hour.js';
import { dayForecast, precipitationNextHour } from '../src/scene-actions.js';
import { COOLDOWN_MS, createPrecipitationWatcher } from '../src/scene-triggers.js';
import { HOUR_MS } from '../src/time.js';
import {
  FIXTURE_NOW,
  HOUSES,
  forecastOf,
  loadFixture,
  manualClock,
  silentLogger,
  withNextHours,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;

/**
 * @param {object} changes - withNextHours() changes on the Toulouse response.
 * @returns {object} The forecast.
 */
function toulouseWith(changes) {
  return parseForecast(withNextHours(loadFixture('real-toulouse.json'), changes));
}

test('dry Toulouse: nothing within the hour', () => {
  const reading = readNextHour(forecastOf('real-toulouse.json'), FIXTURE_NOW);
  assert.equal(reading.available, true);
  assert.equal(reading.minutesUntil, null);
});

test('wet Sydney: heavy rain now', () => {
  const reading = readNextHour(forecastOf('real-sydney.json'), FIXTURE_NOW);
  assert.equal(reading.available, true);
  assert.equal(reading.wetNow, true);
  assert.equal(reading.minutesUntil, 0);
  assert.equal(reading.type, 'rain');
  assert.equal(reading.intensity, 'heavy', 'heavyrain: MET says heavy');
  assert.equal(reading.amount, 1.6);
  assert.equal(reading.probability, null, 'no probability outside the Nordic countries');
});

test('rain in the next hour starts at the next full hour', () => {
  const forecast = toulouseWith({
    '2026-10-12T16:00:00Z': {
      symbol: 'lightrainshowersandthunder_day',
      amount: 0.7,
      probability: 60,
    },
  });
  const reading = readNextHour(forecast, FIXTURE_NOW);
  assert.equal(reading.minutesUntil, 35);
  assert.equal(reading.type, 'rain');
  assert.equal(reading.intensity, 'light');
  assert.equal(reading.thunder, true);
  assert.equal(reading.probability, 60);
});

test('what falls: the symbol, else the temperature; the intensity: MET, else the amount', () => {
  const sleet = toulouseWith({ '2026-10-12T15:00:00Z': { symbol: 'sleet', amount: 1 } });
  assert.deepEqual(
    [readNextHour(sleet, FIXTURE_NOW).type, readNextHour(sleet, FIXTURE_NOW).intensity],
    ['sleet', 'moderate'],
  );
  const trace = toulouseWith({ '2026-10-12T15:00:00Z': { symbol: 'cloudy', amount: 8 } });
  assert.deepEqual(
    [readNextHour(trace, FIXTURE_NOW).type, readNextHour(trace, FIXTURE_NOW).intensity],
    ['rain', 'heavy'],
  );
  const below = toulouseWith({ '2026-10-12T15:00:00Z': { symbol: 'cloudy', amount: 0.05 } });
  assert.equal(readNextHour(below, FIXTURE_NOW).minutesUntil, null, 'under 0.1 mm is dry');
});

test('no hourly step covering now: not available, never "dry"', () => {
  const forecast = forecastOf('real-toulouse.json');
  assert.deepEqual(readNextHour(forecast, FIXTURE_NOW + 5 * 24 * HOUR_MS), { available: false });
  assert.deepEqual(readNextHour(forecast, FIXTURE_NOW - 2 * HOUR_MS), { available: false });
});

test('only a dry → wet transition is announced, never the first reading', () => {
  const dry = { available: true, minutesUntil: null };
  const wet = { available: true, minutesUntil: 20 };
  assert.equal(isPrecipitationAnnounced(null, wet), false);
  assert.equal(isPrecipitationAnnounced(dry, wet), true);
  assert.equal(isPrecipitationAnnounced(wet, wet), false);
  assert.equal(isPrecipitationAnnounced({ available: false }, wet), false);
  assert.equal(isPrecipitationAnnounced(dry, { available: false }), false);
});

test('the trigger fires once when rain comes into the hour, with its variables', async () => {
  const now = manualClock(FIXTURE_NOW);
  const events = [];
  const watcher = createPrecipitationWatcher({
    publish: async (key, data) => events.push({ key, data }),
    getLanguage: () => 'fr',
    getUnits: () => 'metric',
    logger: silentLogger(),
    now,
  });
  // Rain forecast from 17:00 UTC: not within the hour at 15:25.
  const forecast = toulouseWith({
    '2026-10-12T17:00:00Z': { symbol: 'rain', amount: 3.1 },
  });
  assert.equal(await watcher.observe(HOUSES.toulouse, forecast), null, 'baseline');
  now.advance(30 * MINUTE);
  assert.equal(await watcher.observe(HOUSES.toulouse, forecast), null, '15:55: still dry');
  // 16:25: the same forecast (a 304), but 17:00 is now within the hour.
  now.advance(30 * MINUTE);
  const data = await watcher.observe(HOUSES.toulouse, forecast);
  assert.deepEqual(events, [{ key: 'precipitation_expected', data }]);
  assert.deepEqual(data, {
    house: 'maison',
    house_name: 'Maison',
    summary: 'Pluie modérée attendue dans 35 minutes.',
    minutes_until: 35,
    precipitation_type: 'rain',
    intensity: 'moderate',
    thunder: false,
    precipitation: 3.1,
  });
  now.advance(30 * MINUTE);
  assert.equal(await watcher.observe(HOUSES.toulouse, forecast), null, 'still wet: no repeat');
});

test('a shower that vanishes and comes back within the hour fires once', async () => {
  const now = manualClock(FIXTURE_NOW);
  const events = [];
  const watcher = createPrecipitationWatcher({
    publish: async (key, data) => events.push(data),
    getLanguage: () => 'en',
    getUnits: () => 'us',
    logger: silentLogger(),
    now,
  });
  const dry = forecastOf('real-toulouse.json');
  const wet = toulouseWith({ '2026-10-12T16:00:00Z': { symbol: 'heavyrain', amount: 9.5 } });
  await watcher.observe(HOUSES.toulouse, dry);
  await watcher.observe(HOUSES.toulouse, wet);
  assert.equal(events.length, 1);
  assert.equal(events[0].precipitation, 0.37, 'inches');
  assert.equal(events[0].summary, 'Heavy rain expected in 35 minutes.');
  now.advance(20 * MINUTE);
  await watcher.observe(HOUSES.toulouse, dry);
  await watcher.observe(HOUSES.toulouse, wet);
  assert.equal(events.length, 1, 'cooldown');
  now.advance(COOLDOWN_MS);
  await watcher.observe(HOUSES.toulouse, dry);
  await watcher.observe(HOUSES.toulouse, wet);
  assert.equal(events.length, 2);
});

test('a refused event never breaks the refresh', async () => {
  const watcher = createPrecipitationWatcher({
    publish: async () => {
      throw new Error('429');
    },
    getLanguage: () => 'en',
    getUnits: () => 'metric',
    logger: silentLogger(),
    now: () => FIXTURE_NOW,
  });
  await watcher.observe(HOUSES.toulouse, forecastOf('real-toulouse.json'));
  const data = await watcher.observe(
    HOUSES.toulouse,
    toulouseWith({ '2026-10-12T15:00:00Z': { symbol: 'lightsnow', amount: 0.3 } }),
  );
  assert.equal(data.precipitation_type, 'snow');
  assert.equal(data.minutes_until, 0);
});

test('the next-hour action, dry and wet, in the Nordic countries', () => {
  assert.deepEqual(
    precipitationNextHour(forecastOf('real-toulouse.json'), {
      language: 'de',
      units: 'metric',
      now: FIXTURE_NOW,
    }),
    {
      available: true,
      precipitation_expected: false,
      summary: 'Kein Niederschlag in der nächsten Stunde erwartet.',
    },
  );
  const sydney = precipitationNextHour(forecastOf('real-sydney.json'), {
    language: 'es',
    units: 'metric',
    now: FIXTURE_NOW,
  });
  assert.equal(sydney.precipitation_expected, true);
  assert.equal(sydney.summary, 'Lluvia fuerte en este momento.');
  assert.equal(sydney.probability, undefined);
  const oslo = toulouseWith({});
  assert.equal(
    precipitationNextHour(oslo, { language: 'en', units: 'metric', now: 0 }).available,
    false,
  );
});

test('the day action: today and tomorrow, in words and in numbers', () => {
  const forecast = forecastOf('real-oslo.json');
  const options = {
    house: HOUSES.oslo,
    language: 'en',
    units: 'metric',
    timeZone: 'Europe/Oslo',
    now: FIXTURE_NOW,
  };
  const tomorrow = dayForecast(forecast, { ...options, day: 'tomorrow' });
  assert.equal(tomorrow.available, true);
  assert.equal(tomorrow.condition, 'rain');
  assert.equal(tomorrow.condition_name, 'Rain');
  assert.equal(tomorrow.temperature_min, 3.9);
  assert.equal(tomorrow.temperature_max, 8.1);
  assert.equal(tomorrow.precipitation, 10.3);
  assert.equal(tomorrow.precipitation_probability, 100);
  assert.equal(tomorrow.wind_gust, 9.6);
  assert.equal(
    tomorrow.summary,
    'Tomorrow: rain, 3.9 to 8.1 °C, 10.3 mm of precipitation (100% chance).',
  );
  const french = dayForecast(forecast, { ...options, day: 'tomorrow', language: 'fr' });
  assert.equal(
    french.summary,
    'Demain : pluie, de 3,9 à 8,1 °C, 10,3 mm de précipitations (probabilité 100 %).',
  );

  const today = dayForecast(forecast, { ...options, day: undefined });
  assert.equal(today.temperature_max, 9.4);
  assert.match(
    today.summary,
    /^Today: partly cloudy, 3.9 to 9.4 °C, no precipitation \(0% chance\)\.$/,
  );

  const us = dayForecast(forecastOf('real-toulouse.json'), {
    ...options,
    house: HOUSES.toulouse,
    timeZone: 'Europe/Paris',
    units: 'us',
    day: 'tomorrow',
  });
  assert.equal(us.temperature_max, 75.9);
  assert.equal(us.precipitation_probability, undefined, 'none outside the Nordic countries');
  assert.equal(us.wind_gust, undefined);
  assert.match(us.summary, /°F, no precipitation\.$/);

  const late = dayForecast(forecast, { ...options, now: FIXTURE_NOW + 30 * 24 * HOUR_MS });
  assert.deepEqual(late, { available: false, summary: 'No forecast for this day.' });
});
