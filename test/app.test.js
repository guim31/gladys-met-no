// -----------------------------------------------------------------------------
// The integration end to end, against the fake Gladys of the SDK
// (@gladysassistant/integration-sdk/testing): a real GladysIntegration whose
// transport is in memory, with the checks of the core on what it sends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { MESSAGES } from '../src/texts.js';
import {
  FIXTURE_NOW,
  HOUSES,
  asGladysHouse,
  fakeFetch,
  houseForUrl,
  loadFixture,
  manualClock,
  metNoRoute,
  silentLogger,
  withNextHours,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;

/**
 * @param {object} [options] - { houses, config, route }.
 * @returns {Promise<object>} { gladys, app, fetchImpl, now }.
 */
async function start({ houses = [HOUSES.toulouse], config = {}, route } = {}) {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = fakeFetch(route ? route(now) : metNoRoute(now));
  const gladys = createFakeGladys({ houses: houses.map(asGladysHouse), config });
  const app = createApp(gladys, {
    fetchImpl,
    now,
    random: () => 0,
    timeZone: 'Europe/Paris',
    logger: silentLogger(),
    // No real timer: the tests must not keep the process alive.
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  await gladys.connect();
  await app.scheduler.settled();
  return { gladys, app, fetchImpl, now };
}

test('at connection, the houses are refreshed and the status is connected', async () => {
  const { gladys, fetchImpl } = await start({ houses: [HOUSES.toulouse, HOUSES.oslo] });
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  // A weather provider: no device, no state (the conformity test of the
  // devices has nothing to check here).
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.deepEqual(gladys.fake.states, []);
});

test('a weather request is answered from memory, in the pivot format', async () => {
  const { gladys, fetchImpl } = await start();
  const ack = await gladys.fake.weatherGet({
    latitude: HOUSES.toulouse.latitude,
    longitude: HOUSES.toulouse.longitude,
    language: 'fr',
    units: 'metric',
  });
  assert.equal(ack.success, true);
  assert.equal(ack.data.weather.temperature, 20.9);
  assert.equal(ack.data.weather.hours.length, 24);
  assert.equal(fetchImpl.calls.length, 1, 'no second call');

  const us = await gladys.fake.weatherGet({
    latitude: HOUSES.toulouse.latitude,
    longitude: HOUSES.toulouse.longitude,
    language: 'en',
    units: 'us',
  });
  assert.equal(us.data.weather.temperature, 69.6);
});

test('a weather request for a house not refreshed yet makes one call', async () => {
  const { gladys, fetchImpl } = await start();
  const ack = await gladys.fake.weatherGet({
    latitude: HOUSES.sydney.latitude,
    longitude: HOUSES.sydney.longitude,
    language: 'en',
    units: 'metric',
  });
  assert.equal(ack.success, true);
  assert.equal(fetchImpl.calls.length, 2);
  const failed = await gladys.fake.weatherGet({ language: 'en', units: 'metric' });
  assert.equal(failed.success, false, 'the core falls through to another provider');
});

test('no located house: the status says where to set it', async () => {
  const { gladys, fetchImpl } = await start({ houses: [] });
  assert.equal(fetchImpl.calls.length, 0);
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.noLocation,
  });
});

test('a refused User-Agent (403) shows in the status', async () => {
  const { gladys } = await start({ route: () => () => ({ status: 403, body: 'Forbidden' }) });
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: MESSAGES.forbidden,
  });
});

test('the scene actions answer in the language and the units of the last request', async () => {
  const { gladys } = await start({ houses: [HOUSES.toulouse, HOUSES.oslo] });
  await gladys.fake.weatherGet({
    latitude: HOUSES.oslo.latitude,
    longitude: HOUSES.oslo.longitude,
    language: 'de',
    units: 'metric',
  });
  const nextHour = await gladys.fake.sceneAction('get_precipitation_next_hour', {
    house: 'maison',
  });
  assert.equal(nextHour.success, true);
  assert.deepEqual(nextHour.data.outputs, {
    available: true,
    precipitation_expected: false,
    summary: 'Kein Niederschlag in der nächsten Stunde erwartet.',
  });
  const tomorrow = await gladys.fake.sceneAction('get_day_forecast', {
    house: 'hytte',
    day: 'tomorrow',
  });
  assert.equal(tomorrow.data.outputs.condition, 'rain');
  assert.match(tomorrow.data.outputs.summary, /^Morgen: Regen, 3,9 bis 8,1 °C/);
  // No house given: the first located house (Gladys sorts them by name).
  const first = await gladys.fake.sceneAction('get_day_forecast', {});
  assert.equal(first.success, true);
  const unknown = await gladys.fake.sceneAction('get_day_forecast', { house: 'nowhere' });
  assert.equal(unknown.success, false);
});

test('the settings pin the language and the units of the scenes', async () => {
  const { gladys } = await start({
    houses: [HOUSES.oslo],
    config: { language: 'es', units: 'us' },
  });
  const ack = await gladys.fake.sceneAction('get_day_forecast', { day: 'tomorrow' });
  assert.equal(ack.data.outputs.temperature_max, 46.6);
  assert.match(ack.data.outputs.summary, /^Mañana: lluvia, de 39 a 46,6 °F, 0,41 in/);
});

test('the trigger fires through Gladys when rain comes into the hour', async () => {
  let wet = false;
  const route = (now) => (url) => {
    const raw = loadFixture(houseForUrl(url).fixture);
    if (wet) {
      withNextHours(raw, { '2026-10-12T16:00:00Z': { symbol: 'rainshowers_day', amount: 1.4 } });
    }
    return { body: raw, headers: { expires: new Date(now() + 30 * MINUTE).toUTCString() } };
  };
  const { gladys, app, now } = await start({ route, config: { language: 'en' } });
  wet = true;
  now.advance(31 * MINUTE);
  await app.scheduler.requestCycle();
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: 'precipitation_expected',
      data: {
        house: 'maison',
        house_name: 'Maison',
        // 15:56: the shower of 16:00 starts in 4 minutes.
        summary: 'Moderate rain expected in 4 minutes.',
        minutes_until: 4,
        precipitation_type: 'rain',
        intensity: 'moderate',
        thunder: false,
        precipitation: 1.4,
      },
    },
  ]);
});

test('the test action reports the temperature in the four languages', async () => {
  const { gladys } = await start();
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  const { message } = ack.data;
  assert.equal(
    message.en,
    'It works: 69.6 °F (20.9 °C) now at Maison (146 m). MET Norway forecast of 15:18, refreshed about every 30 minutes.',
  );
  assert.match(message.fr, /^Ça fonctionne : 20,9 °C en ce moment à Maison \(146 m\)/);
  assert.deepEqual(Object.keys(message).sort(), ['de', 'en', 'es', 'fr']);
});

test('a new altitude is a new location: refreshed at once, with the altitude', async () => {
  const { gladys, fetchImpl } = await start();
  await gladys.fake.configUpdated({ altitude: 600, language: 'auto', units: 'auto' });
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[1].url, /&altitude=600$/);
  await gladys.fake.configUpdated({ altitude: 600, language: 'fr', units: 'auto' });
  assert.equal(fetchImpl.calls.length, 2, 'the language alone calls nothing');
});
