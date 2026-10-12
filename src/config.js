// -----------------------------------------------------------------------------
// Configuration of the integration.
//
// DEFAULT_CONFIG mirrors the `default` values of the manifest `config_schema`
// (test/manifest.test.js keeps both sides in sync). The supervisor sends the
// values as the form stored them: normalizeConfig() validates them and falls
// back to the defaults, so the rest of the code never sees a malformed value.
//
// There is no refresh setting: the cadence is the one MET Norway's terms of
// service set (scheduler.js).
// -----------------------------------------------------------------------------

// Language of the texts the integration writes itself (scene variables and
// outputs), French by default (the maintainer's choice). 'auto' follows the
// language of the last weather request of the core. The others are the
// languages of the Gladys interface.
const LANGUAGE_CHOICES = ['auto', 'en', 'fr', 'de', 'es'];

// Units of the scene variables and outputs. 'auto' follows the unit system of
// the last weather request of the core (the preference of the user who
// looked at the weather last).
const UNITS_CHOICES = ['auto', 'metric', 'us'];

// Altitude bounds, in metres: the Dead Sea shore to above Everest's base camp.
const ALTITUDE_MIN = -500;
const ALTITUDE_MAX = 9000;

const DEFAULT_CONFIG = Object.freeze({
  altitude: null,
  language: 'fr',
  units: 'auto',
});

/**
 * @description Read the altitude field: whole metres, empty for "let MET
 * Norway use its terrain model".
 * @param {any} value - The raw value (number, or string from an older form).
 * @returns {number|null} The altitude, or null.
 * @example
 * readAltitude('1050'); // -> 1050
 */
function readAltitude(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const number = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(number)) {
    return null;
  }
  const metres = Math.round(number);
  return metres >= ALTITUDE_MIN && metres <= ALTITUDE_MAX ? metres : null;
}

/**
 * @description Normalize the raw configuration sent by Gladys.
 * @param {object} [raw] - The configuration values, as stored by the form.
 * @returns {{altitude: number|null, language: string, units: string}} The
 * normalized configuration.
 * @example
 * normalizeConfig({ altitude: 1050, language: 'fr' });
 */
function normalizeConfig(raw = {}) {
  const source = raw !== null && typeof raw === 'object' ? raw : {};
  const pick = (key, choices) => {
    const value = String(source[key] ?? DEFAULT_CONFIG[key]).trim();
    return choices.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  return {
    altitude: readAltitude(source.altitude),
    language: pick('language', LANGUAGE_CHOICES),
    units: pick('units', UNITS_CHOICES),
  };
}

export {
  ALTITUDE_MAX,
  ALTITUDE_MIN,
  DEFAULT_CONFIG,
  LANGUAGE_CHOICES,
  UNITS_CHOICES,
  normalizeConfig,
  readAltitude,
};
