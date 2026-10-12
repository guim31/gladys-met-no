// -----------------------------------------------------------------------------
// MET Norway Locationforecast 2.0 client: ONE call per location returns
// everything the integration uses (the current hour, about 60 hourly steps,
// then 6-hourly steps up to 9 days).
//
//   GET https://api.met.no/weatherapi/locationforecast/2.0/complete
//       ?lat=..&lon=..[&altitude=..]
//
// No key, no account. The terms of service (https://api.met.no/doc/TermsOfService)
// and the HOWTO (https://docs.api.met.no/doc/locationforecast/HowTO) ask:
//   - an identifying User-Agent with a contact: `gladys-met-no/<version>
//     github.com/guim31/gladys-met-no` (a missing or generic one gets 403);
//   - coordinates with at most 4 decimals (5 and more: 403 on new products);
//   - no new request before the `Expires` of the previous answer, and a
//     conditional one after it (`If-Modified-Since` with the exact
//     `Last-Modified` received): 304 Not Modified means the cached forecast
//     is still the latest;
//   - 429 means throttled: slow down at once;
//   - 203 means the product is deprecated: log it, it will be terminated;
//   - gzip: Node's fetch asks for it and decompresses on its own.
//
// `complete`, not `compact`: it adds the dew point, the fog, the UV index,
// the apparent temperature and, in the Nordic countries, the probabilities
// and the gusts — what the pivot format has room for.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const API_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
const CONTACT = 'github.com/guim31/gladys-met-no';

// Under the 15 s the core waits for a weather answer, with room to build it.
const REQUEST_TIMEOUT_MS = 10000;

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const USER_AGENT = `gladys-met-no/${PACKAGE.version} ${CONTACT}`;

// What went wrong, as the rest of the integration needs to react to it.
const ERROR_KINDS = Object.freeze({
  THROTTLED: 'throttled', // 429: too many requests — back off
  FORBIDDEN: 'forbidden', // 403: User-Agent refused (or banned) — stop for a long while
  REQUEST: 'request', // other 4xx: bad coordinates — skip this location
  UPSTREAM: 'upstream', // 5xx: retry later
  NETWORK: 'network', // DNS, timeout, reset: retry later
  INVALID: 'invalid', // 200 with an unusable body
});

class MetNoError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - A message safe to log.
   * @param {object} [details] - { status, retryAfterMs }.
   */
  constructor(kind, message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'MetNoError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * @description A coordinate with at most 4 decimals (about 10 m), as the
 * terms of service ask; trailing zeros dropped.
 * @param {number} value - Degrees.
 * @returns {string} The coordinate.
 * @example
 * formatCoordinate(43.604512); // -> '43.6045'
 */
function formatCoordinate(value) {
  return String(Number(value.toFixed(4)));
}

/**
 * @description Build the request URL.
 * @param {number} latitude - The latitude.
 * @param {number} longitude - The longitude.
 * @param {number|null} [altitude] - Metres above sea level; null lets MET
 * Norway use its terrain model.
 * @returns {string} The URL.
 * @example
 * buildUrl(43.6045, 1.444, 146);
 */
function buildUrl(latitude, longitude, altitude = null) {
  const params = new URLSearchParams({
    lat: formatCoordinate(latitude),
    lon: formatCoordinate(longitude),
  });
  if (Number.isInteger(altitude)) {
    params.set('altitude', String(altitude));
  }
  return `${API_URL}?${params}`;
}

/**
 * @description Classify a non-success status.
 * @param {number} status - The HTTP status.
 * @returns {string} One of ERROR_KINDS.
 * @example
 * kindOfStatus(429); // -> 'throttled'
 */
function kindOfStatus(status) {
  if (status === 429) {
    return ERROR_KINDS.THROTTLED;
  }
  if (status === 403) {
    return ERROR_KINDS.FORBIDDEN;
  }
  if (status >= 400 && status < 500) {
    return ERROR_KINDS.REQUEST;
  }
  return ERROR_KINDS.UPSTREAM;
}

/**
 * @description Read an HTTP date header.
 * @param {string|null} value - The header value (RFC 1123).
 * @returns {number|null} The date in ms.
 * @example
 * readHttpDate('Mon, 12 Oct 2026 15:35:51 GMT');
 */
function readHttpDate(value) {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @description Read a `Retry-After` header: seconds or an HTTP date.
 * @param {string|null} value - The header value.
 * @param {number} now - The current time in ms.
 * @returns {number|null} The delay in ms.
 * @example
 * readRetryAfter('120', Date.now()); // -> 120000
 */
function readRetryAfter(value, now) {
  if (value === null || value === undefined || value.trim() === '') {
    return null;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value.trim()) * 1000;
  }
  const date = readHttpDate(value);
  return date === null ? null : Math.max(0, date - now);
}

/**
 * @description The first line of an error body, bounded (MET Norway answers
 * errors in plain text: "400 Bad Request\nInvalid parameter 'lat'...").
 * @param {string} text - The body.
 * @returns {string|null} The reason.
 * @example
 * readReason("400 Bad Request\nInvalid parameter 'lat': Illegal latitude value");
 */
function readReason(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !/^<|^\d{3} /.test(line));
  return lines.length > 0 ? lines[0].slice(0, 200) : null;
}

/**
 * @description Fetch the forecast of a location.
 * @param {object} options - Options.
 * @param {number} options.latitude - The latitude.
 * @param {number} options.longitude - The longitude.
 * @param {number|null} [options.altitude] - Metres, or null.
 * @param {string|null} [options.lastModified] - The `Last-Modified` of the
 * cached answer, sent back as `If-Modified-Since`.
 * @param {Function} [options.fetchImpl] - fetch, injectable for the tests.
 * @param {Function} [options.now] - `() => ms`, for the tests.
 * @param {number} [options.timeoutMs] - The request timeout.
 * @returns {Promise<object>} `{ status (200, 203 or 304), body (null on
 * 304), expiresAt (ms or null), lastModified (string or null) }`.
 * @throws {MetNoError} On any failure, classified by `kind`.
 * @example
 * const answer = await fetchForecast({ latitude: 43.6045, longitude: 1.444 });
 */
async function fetchForecast({
  latitude,
  longitude,
  altitude = null,
  lastModified = null,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new MetNoError(ERROR_KINDS.REQUEST, 'Invalid coordinates');
  }
  const headers = { 'user-agent': USER_AGENT, accept: 'application/json' };
  if (lastModified !== null) {
    headers['if-modified-since'] = lastModified;
  }

  let response;
  try {
    response = await fetchImpl(buildUrl(latitude, longitude, altitude), {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code || err?.name;
    throw new MetNoError(ERROR_KINDS.NETWORK, `MET Norway unreachable (${reason})`);
  }

  const expiresAt = readHttpDate(response.headers.get('expires'));
  const received = response.headers.get('last-modified');

  if (response.status === 304) {
    return { status: 304, body: null, expiresAt, lastModified: received ?? lastModified };
  }
  if (response.status !== 200 && response.status !== 203) {
    const reason = readReason(await response.text().catch(() => ''));
    throw new MetNoError(
      kindOfStatus(response.status),
      `MET Norway answered HTTP ${response.status}${reason ? `: ${reason}` : ''}`,
      {
        status: response.status,
        retryAfterMs: readRetryAfter(response.headers.get('retry-after'), now()),
      },
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new MetNoError(ERROR_KINDS.INVALID, 'MET Norway sent an unreadable body', {
      status: response.status,
    });
  }
  return { status: response.status, body, expiresAt, lastModified: received };
}

export {
  API_URL,
  ERROR_KINDS,
  MetNoError,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  buildUrl,
  fetchForecast,
  formatCoordinate,
  kindOfStatus,
  readReason,
  readRetryAfter,
};
