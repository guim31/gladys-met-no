// -----------------------------------------------------------------------------
// The forecast store: the last forecast of each location, and the only thing
// that ever calls MET Norway.
//
// Every reader — the core's weather requests (dashboard, chat, the core's
// 30-minute alert check), the scene actions, the "Test" button — is served
// from memory. The scheduler (scheduler.js) refreshes the houses; a reader
// only causes a call for a location nobody refreshed recently (a house added
// since the last cycle), and concurrent requests for one location share one
// call.
//
// The terms of MET Norway are enforced HERE, so that no caller can break
// them:
//   - no call before the `Expires` of the cached answer: refresh() serves the
//     cache until then, however often it is asked;
//   - after it, a conditional call (`If-Modified-Since`): a 304 keeps the
//     cached forecast and only moves its expiry;
//   - a 429 blocks every call, with a doubling delay (10 minutes, up to
//     2 hours) or the server's `Retry-After`;
//   - a 403 (User-Agent refused) blocks every call for 6 hours: insisting
//     would get the integration banned for every Gladys user.
//
// When a call fails, a forecast up to 3 hours old is still served: an hour-old
// forecast beats the core falling back to another provider or an empty
// dashboard. Older, the request fails and the core moves on.
// -----------------------------------------------------------------------------

import { ERROR_KINDS, MetNoError, fetchForecast } from './api.js';
import { parseForecast } from './forecast.js';

// Beyond this, a cached forecast is no longer served when a refresh fails.
const STALE_MAX_MS = 3 * 60 * 60 * 1000;

// Without an `Expires` header, the answer is taken as valid this long.
const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

const THROTTLE_FIRST_MS = 10 * 60 * 1000;
const THROTTLE_MAX_MS = 2 * 60 * 60 * 1000;
const FORBIDDEN_BLOCK_MS = 6 * 60 * 60 * 1000;

/**
 * @description The cache key of a location: the coordinates as sent (4
 * decimals) and the altitude.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @param {number|null} [altitude] - Metres, or null.
 * @returns {string} The key.
 * @example
 * locationKey(43.604512, 1.444, null); // -> '43.6045,1.4440,'
 */
function locationKey(latitude, longitude, altitude = null) {
  return `${latitude.toFixed(4)},${longitude.toFixed(4)},${altitude ?? ''}`;
}

/**
 * @description Create the forecast store.
 * @param {object} [options] - Options.
 * @param {Function} [options.getAltitude] - `() => number|null`, the
 * configured altitude.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {Function} [options.now] - `() => ms`, injectable for the tests.
 * @param {object} [options.logger] - Logger with info/warn/debug.
 * @returns {object} The store.
 * @example
 * const store = createForecastStore({ getAltitude: () => config.altitude });
 */
function createForecastStore({
  getAltitude = () => null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  logger = console,
} = {}) {
  // key -> { forecast, fetchedAt, checkedAt, expiresAt, lastModified }
  const entries = new Map();
  // key -> Promise of the call under way
  const inflight = new Map();
  // { kind, message, at } of the last failed call, null after a success.
  let lastError = null;
  let blockedUntil = 0;
  let blockedKind = null;
  let throttleMs = THROTTLE_FIRST_MS;
  let deprecationLogged = false;
  let calls = 0;

  /**
   * @description Why calls are refused right now, if they are.
   * @returns {MetNoError|null} The error to throw, or null.
   * @example
   * store.blockedError();
   */
  function blockedError() {
    if (blockedUntil > now()) {
      return new MetNoError(
        blockedKind,
        `MET Norway calls paused until ${new Date(blockedUntil).toISOString()} (${blockedKind})`,
      );
    }
    return null;
  }

  /**
   * @description Remember a failure, and pause the calls when MET asks.
   * @param {MetNoError} err - The error.
   * @example
   * recordFailure(err);
   */
  function recordFailure(err) {
    const kind = err.kind ?? ERROR_KINDS.NETWORK;
    lastError = { kind, message: err.message, at: now() };
    if (kind === ERROR_KINDS.THROTTLED) {
      const delay = Math.min(Math.max(err.retryAfterMs ?? 0, throttleMs), THROTTLE_MAX_MS);
      blockedUntil = now() + delay;
      blockedKind = kind;
      throttleMs = Math.min(throttleMs * 2, THROTTLE_MAX_MS);
      logger.warn(
        `MET Norway throttles the requests (429): pausing ${Math.round(delay / 60000)} min`,
      );
    } else if (kind === ERROR_KINDS.FORBIDDEN) {
      blockedUntil = now() + FORBIDDEN_BLOCK_MS;
      blockedKind = kind;
      logger.error('MET Norway refused the requests (403): pausing 6 hours');
    }
  }

  /**
   * @description Call the API for a location — unless its cached answer has
   * not expired yet — sharing a call under way.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @returns {Promise<object>} The entry `{ forecast, fetchedAt, checkedAt,
   * expiresAt, lastModified }`.
   * @throws {MetNoError} When the call fails or is paused.
   * @example
   * await store.refresh(43.6045, 1.444);
   */
  function refresh(latitude, longitude) {
    const altitude = getAltitude();
    const key = locationKey(latitude, longitude, altitude);
    const cached = entries.get(key);
    if (cached !== undefined && cached.expiresAt > now()) {
      return Promise.resolve(cached);
    }
    const pending = inflight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const blocked = blockedError();
    if (blocked !== null) {
      return Promise.reject(blocked);
    }
    const call = (async () => {
      calls += 1;
      try {
        const answer = await fetchForecast({
          latitude,
          longitude,
          altitude,
          lastModified: cached?.lastModified ?? null,
          fetchImpl,
          now,
        });
        const at = now();
        const expiresAt =
          answer.expiresAt !== null && answer.expiresAt > at
            ? answer.expiresAt
            : at + DEFAULT_EXPIRY_MS;
        let entry;
        if (answer.status === 304 && cached !== undefined) {
          entry = { ...cached, checkedAt: at, expiresAt, lastModified: answer.lastModified };
        } else if (answer.status === 304) {
          throw new MetNoError(ERROR_KINDS.INVALID, 'MET Norway answered 304 to a first call');
        } else {
          if (answer.status === 203 && !deprecationLogged) {
            deprecationLogged = true;
            logger.warn('MET Norway marks Locationforecast 2.0 as deprecated (HTTP 203)');
          }
          let forecast;
          try {
            forecast = parseForecast(answer.body);
          } catch (err) {
            throw new MetNoError(ERROR_KINDS.INVALID, err.message, { status: answer.status });
          }
          entry = {
            forecast,
            fetchedAt: at,
            checkedAt: at,
            expiresAt,
            lastModified: answer.lastModified,
          };
        }
        // The altitude changed while the call ran: its answer is not cached.
        if (altitude === getAltitude()) {
          entries.set(key, entry);
        }
        lastError = null;
        throttleMs = THROTTLE_FIRST_MS;
        return entry;
      } catch (err) {
        recordFailure(err);
        throw err;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, call);
    return call;
  }

  /**
   * @description The cached entry of a location, whatever its age.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @returns {object|null} The entry, or null.
   * @example
   * store.peek(43.6045, 1.444);
   */
  function peek(latitude, longitude) {
    return entries.get(locationKey(latitude, longitude, getAltitude())) ?? null;
  }

  /**
   * @description The forecast of a location for a reader: the cached one when
   * checked less than `maxAgeMs` ago, else a refresh — falling back to a
   * cached one up to 3 hours old when the call fails.
   * @param {number} latitude - The latitude.
   * @param {number} longitude - The longitude.
   * @param {object} options - Options.
   * @param {number} options.maxAgeMs - The age under which the cache is used
   * without asking MET Norway.
   * @returns {Promise<object>} The entry, with `stale`.
   * @throws {MetNoError} When there is nothing to serve.
   * @example
   * const { forecast } = await store.load(43.6045, 1.444, { maxAgeMs: 35 * 60000 });
   */
  async function load(latitude, longitude, { maxAgeMs }) {
    const cached = peek(latitude, longitude);
    if (cached !== null && now() - cached.checkedAt <= maxAgeMs) {
      return { ...cached, stale: false };
    }
    try {
      return { ...(await refresh(latitude, longitude)), stale: false };
    } catch (err) {
      if (cached !== null && now() - cached.checkedAt <= STALE_MAX_MS) {
        const minutes = Math.round((now() - cached.checkedAt) / 60000);
        logger.warn(`Serving a forecast checked ${minutes} min ago: ${err.message}`);
        return { ...cached, stale: true };
      }
      throw err;
    }
  }

  /**
   * @description The earliest instant a cached location may be asked again.
   * @param {Set<string>} keys - The keys of the locations to consider.
   * @returns {number|null} The latest `Expires` among them, in ms, or null.
   * @example
   * store.latestExpiry(new Set(['43.6045,1.4440,']));
   */
  function latestExpiry(keys) {
    let latest = null;
    for (const key of keys) {
      const entry = entries.get(key);
      if (entry !== undefined && (latest === null || entry.expiresAt > latest)) {
        latest = entry.expiresAt;
      }
    }
    return latest;
  }

  /**
   * @description Drop the entries of locations no longer refreshed, once they
   * are too old to be served: memory stays bounded by the houses.
   * @param {Set<string>} keep - The keys of the refreshed locations.
   * @example
   * store.prune(new Set(['43.6045,1.4440,']));
   */
  function prune(keep) {
    for (const [key, entry] of entries) {
      if (!keep.has(key) && now() - entry.checkedAt > STALE_MAX_MS) {
        entries.delete(key);
      }
    }
  }

  return {
    refresh,
    peek,
    load,
    latestExpiry,
    prune,
    blockedError,
    keyOf: (latitude, longitude) => locationKey(latitude, longitude, getAltitude()),
    get lastError() {
      return lastError;
    },
    get blockedUntil() {
      return blockedUntil;
    },
    get calls() {
      return calls;
    },
    get size() {
      return entries.size;
    },
  };
}

export {
  DEFAULT_EXPIRY_MS,
  FORBIDDEN_BLOCK_MS,
  STALE_MAX_MS,
  THROTTLE_FIRST_MS,
  THROTTLE_MAX_MS,
  createForecastStore,
  locationKey,
};
