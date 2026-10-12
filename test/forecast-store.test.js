// -----------------------------------------------------------------------------
// The forecast store enforces MET Norway's terms whoever asks: never before
// `Expires`, conditional after it, paused on 429 and 403.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORBIDDEN_BLOCK_MS,
  STALE_MAX_MS,
  THROTTLE_FIRST_MS,
  createForecastStore,
  locationKey,
} from '../src/forecast-store.js';
import {
  FIXTURE_NOW,
  HOUSES,
  fakeFetch,
  loadFixture,
  manualClock,
  silentLogger,
} from './helpers/fixtures.js';

const MINUTE = 60 * 1000;
const { latitude, longitude } = HOUSES.oslo;
const LAST_MODIFIED = 'Mon, 12 Oct 2026 15:05:01 GMT';

/**
 * @param {Function} now - The clock.
 * @param {Array<object>} answers - The answers, in order (the last repeats).
 * @returns {Function} A fake fetch.
 */
function scripted(now, answers) {
  let index = 0;
  return fakeFetch(() => {
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return typeof answer === 'function' ? answer() : answer;
  });
}

const fresh =
  (now, minutes = 30) =>
  () => ({
    body: loadFixture('real-oslo.json'),
    headers: {
      expires: new Date(now() + minutes * MINUTE).toUTCString(),
      'last-modified': LAST_MODIFIED,
    },
  });

test('no call before Expires, however often it is asked', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [fresh(now)]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  const first = await store.refresh(latitude, longitude);
  now.advance(29 * MINUTE);
  const again = await store.refresh(latitude, longitude);
  assert.equal(again, first);
  assert.equal(fetchImpl.calls.length, 1);
});

test('after Expires, a conditional call; a 304 keeps the forecast', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [
    fresh(now),
    () => ({ status: 304, headers: { expires: new Date(now() + 30 * MINUTE).toUTCString() } }),
  ]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  const first = await store.refresh(latitude, longitude);
  now.advance(31 * MINUTE);
  const second = await store.refresh(latitude, longitude);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[1].headers['if-modified-since'], LAST_MODIFIED);
  assert.equal(second.forecast, first.forecast);
  assert.equal(second.fetchedAt, first.fetchedAt);
  assert.equal(second.checkedAt, now());
  assert.equal(second.expiresAt, now() + 30 * MINUTE);
});

test('concurrent readers of one location share one call', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [fresh(now)]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  const [a, b] = await Promise.all([
    store.load(latitude, longitude, { maxAgeMs: 0 }),
    store.load(latitude + 0.00001, longitude, { maxAgeMs: 0 }),
  ]);
  assert.equal(a.forecast, b.forecast);
  assert.equal(fetchImpl.calls.length, 1);
});

test('a 429 pauses every call, longer each time, or as long as Retry-After says', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [{ status: 429, body: 'Too Many Requests' }]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  await assert.rejects(store.refresh(latitude, longitude), { kind: 'throttled' });
  assert.equal(store.blockedUntil, now() + THROTTLE_FIRST_MS);
  await assert.rejects(store.refresh(10, 10), { kind: 'throttled' });
  assert.equal(fetchImpl.calls.length, 1, 'no call while paused');

  now.advance(THROTTLE_FIRST_MS);
  await assert.rejects(store.refresh(latitude, longitude), { kind: 'throttled' });
  assert.equal(store.blockedUntil, now() + 2 * THROTTLE_FIRST_MS, 'doubled');

  const patient = createForecastStore({
    fetchImpl: scripted(now, [{ status: 429, headers: { 'retry-after': '3600' } }]),
    now,
    logger: silentLogger(),
  });
  await assert.rejects(patient.refresh(latitude, longitude));
  assert.equal(patient.blockedUntil, now() + 60 * MINUTE);
});

test('a 403 pauses every call for 6 hours', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [{ status: 403, body: 'Forbidden' }, fresh(now)]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  await assert.rejects(store.refresh(latitude, longitude), { kind: 'forbidden' });
  now.advance(FORBIDDEN_BLOCK_MS - MINUTE);
  await assert.rejects(store.refresh(latitude, longitude), { kind: 'forbidden' });
  assert.equal(fetchImpl.calls.length, 1);
  now.advance(MINUTE);
  await store.refresh(latitude, longitude);
  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(store.lastError, null);
});

test('a failed refresh serves the cached forecast up to 3 hours', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [fresh(now), { status: 503, body: 'down' }]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  await store.load(latitude, longitude, { maxAgeMs: 0 });
  now.advance(2 * 60 * MINUTE);
  const stale = await store.load(latitude, longitude, { maxAgeMs: 35 * MINUTE });
  assert.equal(stale.stale, true);
  assert.equal(store.lastError.kind, 'upstream');
  now.advance(STALE_MAX_MS);
  await assert.rejects(store.load(latitude, longitude, { maxAgeMs: 35 * MINUTE }), {
    kind: 'upstream',
  });
});

test('a reader is served from memory while the forecast is recent', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [fresh(now, 10), fresh(now)]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  await store.load(latitude, longitude, { maxAgeMs: 0 });
  now.advance(20 * MINUTE);
  // Expired (10 minutes), but recent enough for a reader: no call.
  await store.load(latitude, longitude, { maxAgeMs: 35 * MINUTE });
  assert.equal(fetchImpl.calls.length, 1);
});

test('without Expires, an answer is valid 30 minutes', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [{ body: loadFixture('real-oslo.json') }]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  const entry = await store.refresh(latitude, longitude);
  assert.equal(entry.expiresAt, now() + 30 * MINUTE);
  assert.equal(entry.lastModified, null);
});

test('the altitude is part of the location', async () => {
  const now = manualClock(FIXTURE_NOW);
  let altitude = null;
  const fetchImpl = scripted(now, [fresh(now)]);
  const store = createForecastStore({
    getAltitude: () => altitude,
    fetchImpl,
    now,
    logger: silentLogger(),
  });
  await store.refresh(latitude, longitude);
  altitude = 120;
  assert.equal(store.peek(latitude, longitude), null);
  await store.refresh(latitude, longitude);
  assert.equal(fetchImpl.calls.length, 2);
  assert.match(fetchImpl.calls[1].url, /altitude=120$/);
  assert.equal(store.keyOf(latitude, longitude), locationKey(latitude, longitude, 120));
});

test('a body without a forecast is refused and not cached', async () => {
  const now = manualClock(FIXTURE_NOW);
  const fetchImpl = scripted(now, [{ body: { type: 'Feature', properties: { timeseries: [] } } }]);
  const store = createForecastStore({ fetchImpl, now, logger: silentLogger() });
  await assert.rejects(store.refresh(latitude, longitude), { kind: 'invalid' });
  assert.equal(store.size, 0);
});

test('locations no longer refreshed are dropped once too old', async () => {
  const now = manualClock(FIXTURE_NOW);
  const store = createForecastStore({
    fetchImpl: scripted(now, [fresh(now)]),
    now,
    logger: silentLogger(),
  });
  await store.refresh(latitude, longitude);
  store.prune(new Set());
  assert.equal(store.size, 1);
  now.advance(STALE_MAX_MS + MINUTE);
  store.prune(new Set());
  assert.equal(store.size, 0);
});
