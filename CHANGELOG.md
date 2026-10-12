# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- MET Norway weather for Gladys (Gladys 5.2.0 or later): current conditions,
  the next 24 hours with their precipitation and the next 8 days, worldwide,
  with no account or API key, in the unit system of each user. Gusts and the
  probability of precipitation in the Nordic countries. Sunrise and sunset,
  day and night icons.
- Scene trigger "Rain or snow expected within the hour", filtered by house,
  precipitation (rain, sleet, snow) and intensity, with a sentence ready to
  send.
- Scene actions "Get the precipitation of the next hour" and "Get the
  forecast of the day" (today or tomorrow: sky, minimum and maximum,
  precipitation, wind, summary).
- Optional altitude for houses in the mountains, and the language (French by
  default) and units of the scene texts.
- A "Test MET Norway" button showing the current temperature of your first
  house.
- Refreshes about every 30 minutes, as MET Norway's terms of service ask:
  never before the forecast expires, conditional requests, pauses when MET
  Norway asks to slow down.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-met-no/commits/main
