// -----------------------------------------------------------------------------
// Parse a Locationforecast 2.0 `complete` response into the slim forecast the
// integration caches.
//
// The response is GeoJSON: `geometry.coordinates` is [longitude, latitude,
// altitude], and `properties.timeseries` a list of instants, every hour for
// about two and a half days, then every six hours up to nine or ten days.
// Each instant holds:
//   - `instant.details`: the state of the air at that time (temperature,
//     humidity, pressure at sea level, wind and its direction, clouds, dew
//     point, fog, clear-sky UV index, apparent temperature);
//   - `next_1_hours` (hourly part only), `next_6_hours`, `next_12_hours`: the
//     period starting at that time, with its symbol and, for the first two,
//     the precipitation amount; `next_6_hours` also has the minimum and
//     maximum temperature of the period.
//
// The values are metric (`meta.units`: celsius, m/s, hPa, mm, %), the same
// for every location. Some fields only exist where MET Norway runs its own
// high-resolution and ensemble models (the Nordic countries): wind gusts,
// precipitation and thunder probabilities, percentiles. Anywhere else they
// are absent, and the slim forecast keeps null rather than inventing them.
//
// Only what the integration reads is kept: a few hundred numbers per house,
// far below the 256 MB of the sandbox.
// -----------------------------------------------------------------------------

/**
 * @description Read a finite number, null otherwise.
 * @param {any} value - The raw value.
 * @returns {number|null} The number.
 * @example
 * num(null); // -> null
 */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @description Read a symbol code.
 * @param {any} summary - A period's `summary`.
 * @returns {string|null} The code.
 * @example
 * symbolOf({ symbol_code: 'rain' }); // -> 'rain'
 */
function symbolOf(summary) {
  const code = summary?.symbol_code;
  return typeof code === 'string' && code.trim() !== '' ? code.trim() : null;
}

/**
 * @description Read a period block (`next_1_hours`, `next_6_hours`,
 * `next_12_hours`).
 * @param {any} block - The raw block.
 * @returns {object|null} `{ symbol, precipitation, precipitationMin,
 * precipitationMax, probability, thunderProbability, temperatureMin,
 * temperatureMax }`, or null when absent.
 * @example
 * periodOf(raw.data.next_1_hours);
 */
function periodOf(block) {
  if (block === null || typeof block !== 'object') {
    return null;
  }
  const details = block.details ?? {};
  const period = {
    symbol: symbolOf(block.summary),
    precipitation: num(details.precipitation_amount),
    precipitationMin: num(details.precipitation_amount_min),
    precipitationMax: num(details.precipitation_amount_max),
    probability: num(details.probability_of_precipitation),
    thunderProbability: num(details.probability_of_thunder),
    temperatureMin: num(details.air_temperature_min),
    temperatureMax: num(details.air_temperature_max),
  };
  return Object.values(period).every((value) => value === null) ? null : period;
}

/**
 * @description Parse a Locationforecast response.
 * @param {object} raw - The JSON body.
 * @returns {object} The slim forecast: `{ latitude, longitude, altitude,
 * updatedAt (ms or null), points: [{ time (ms), temperature,
 * apparentTemperature, humidity, pressure, dewPoint, windSpeed,
 * windDirection, windGust, cloudCover, fog, uvIndex, next1, next6, next12
 * }] }`, the points sorted by time.
 * @throws {Error} When the body holds no usable instant.
 * @example
 * const forecast = parseForecast(await response.json());
 */
function parseForecast(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('The MET Norway response is not an object');
  }
  const units = raw.properties?.meta?.units ?? {};
  if (units.air_temperature !== undefined && units.air_temperature !== 'celsius') {
    // The API only speaks metric: anything else is a change worth refusing.
    throw new Error(`Unexpected temperature unit "${units.air_temperature}"`);
  }
  const series = raw.properties?.timeseries;
  if (!Array.isArray(series)) {
    throw new Error('The MET Norway response has no time series');
  }

  const points = [];
  for (const entry of series) {
    const time = Date.parse(entry?.time);
    const details = entry?.data?.instant?.details;
    if (!Number.isFinite(time) || details === null || typeof details !== 'object') {
      continue;
    }
    const temperature = num(details.air_temperature);
    if (temperature === null) {
      continue;
    }
    points.push({
      time,
      temperature,
      apparentTemperature: num(details.apparent_air_temperature),
      humidity: num(details.relative_humidity),
      pressure: num(details.air_pressure_at_sea_level),
      dewPoint: num(details.dew_point_temperature),
      windSpeed: num(details.wind_speed),
      windDirection: num(details.wind_from_direction),
      windGust: num(details.wind_speed_of_gust),
      cloudCover: num(details.cloud_area_fraction),
      fog: num(details.fog_area_fraction),
      uvIndex: num(details.ultraviolet_index_clear_sky),
      next1: periodOf(entry.data.next_1_hours),
      next6: periodOf(entry.data.next_6_hours),
      next12: periodOf(entry.data.next_12_hours),
    });
  }
  if (points.length === 0) {
    throw new Error('The MET Norway response has no forecast for this location');
  }
  points.sort((a, b) => a.time - b.time);

  const [longitude, latitude, altitude] = Array.isArray(raw.geometry?.coordinates)
    ? raw.geometry.coordinates
    : [];
  const updatedAt = Date.parse(raw.properties?.meta?.updated_at);
  return {
    latitude: num(latitude),
    longitude: num(longitude),
    altitude: num(altitude),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    points,
  };
}

export { num, parseForecast, periodOf };
