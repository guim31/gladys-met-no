// -----------------------------------------------------------------------------
// The refresh timer: MET Norway's cadence (never before Expires nor 30
// minutes, plus a random delay), one call per location, a pause on 429/403
// and sooner retries after a passing failure.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForecastStore } from '../src/forecast-store.js';
import { createHouseRegistry } from '../src/houses.js';
import { JITTER_MS, MIN_INTERVAL_MS, RETRY_FIRST_MS, createScheduler } from '../src/scheduler.js';
import {
  FIXTURE_NOW,
  HOUSES,
  asGladysHouse,
  fakeFetch,
  manualClock,
  metNoRoute,
  silentLogger,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;

/**
 * @param {object} options - { houses, route, random }.
 * @returns {object} { scheduler, store, fetchImpl, timers, now, refreshed }.
 */
function setup({ houses = [HOUSES.toulouse], route, random = () => 0 } = {}) {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = fakeFetch(route ?? metNoRoute(now));
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  const registry = createHouseRegistry({
    fetchHouses: async () => houses.map(asGladysHouse),
    logger: silentLogger(),
  });
  const timers = [];
  const refreshed = [];
  const scheduler = createScheduler({
    houses: registry,
    store,
    now,
    random,
    logger: silentLogger(),
    onRefreshed: (house) => refreshed.push(house.name),
    setTimer: (fn, delay) => {
      timers.push({ fn, delay });
      return {};
    },
    clearTimer: () => {},
  });
  return { scheduler, store, fetchImpl, timers, now, refreshed };
}

test('one cycle refreshes every located house, then waits 30 minutes or more', async () => {
  const { scheduler, fetchImpl, timers, refreshed } = setup({
    houses: [HOUSES.toulouse, HOUSES.oslo, { ...HOUSES.oslo, id: 'x', name: 'Annexe' }],
  });
  const summary = await scheduler.start();
  assert.equal(summary.houses, 3);
  assert.equal(summary.locations, 2, 'two houses at one location share a call');
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(refreshed.sort(), ['Annexe', 'Hytte', 'Maison']);
  assert.equal(timers.at(-1).delay, MIN_INTERVAL_MS);
});

test('a later Expires pushes the next cycle back; the jitter spreads the calls', async () => {
  const expiresIn = 47 * MINUTE;
  const { scheduler, timers } = setup({
    random: () => 0.5,
    route: (url) => ({
      ...metNoRoute(() => FIXTURE_NOW)(url),
      headers: { expires: new Date(FIXTURE_NOW + expiresIn).toUTCString() },
    }),
  });
  await scheduler.start();
  assert.equal(timers.at(-1).delay, expiresIn + JITTER_MS / 2);
});

test('a cycle before Expires makes no call', async () => {
  const { scheduler, fetchImpl, now, refreshed } = setup();
  await scheduler.start();
  now.advance(10 * MINUTE);
  await scheduler.requestCycle();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(refreshed.length, 2, 'the trigger still reads the hour that moved');
});

test('a passing failure retries sooner, then less and less often', async () => {
  const { scheduler, timers } = setup({ route: () => ({ status: 503, body: 'down' }) });
  const first = await scheduler.start();
  assert.equal(first.refreshed, 0);
  assert.equal(timers.at(-1).delay, RETRY_FIRST_MS);
  await scheduler.requestCycle();
  assert.equal(timers.at(-1).delay, 2 * RETRY_FIRST_MS);
  await scheduler.requestCycle();
  assert.equal(timers.at(-1).delay, 4 * RETRY_FIRST_MS);
});

test('a 429 stops the cycle and waits for the end of the pause', async () => {
  const { scheduler, fetchImpl, timers, store } = setup({
    houses: [HOUSES.toulouse, HOUSES.oslo],
    route: () => ({ status: 429, body: 'slow down' }),
  });
  const summary = await scheduler.start();
  assert.equal(fetchImpl.calls.length, 1, 'the second house is not tried');
  assert.equal(summary.error.kind, 'throttled');
  assert.equal(timers.at(-1).delay, store.blockedUntil - FIXTURE_NOW);
});

test('cycles never overlap; one asked for meanwhile runs after', async () => {
  const { scheduler } = setup();
  const first = scheduler.start();
  const second = scheduler.requestCycle();
  assert.equal(first, second);
  await scheduler.settled();
  scheduler.stop();
  assert.equal(scheduler.started, false);
});

test('without a located house, nothing is called', async () => {
  const { scheduler, fetchImpl } = setup({
    houses: [{ ...HOUSES.toulouse, latitude: null, longitude: null }],
  });
  const summary = await scheduler.start();
  assert.equal(summary.houses, 0);
  assert.equal(fetchImpl.calls.length, 0);
});
