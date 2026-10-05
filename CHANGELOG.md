# Changelog

All notable changes to water-reminder. Versions follow [semantic versioning](https://semver.org): the version in `.claude-plugin/plugin.json` is what `/water-version` shows and what `/water-update` compares against. Each version is tagged in git (`v0.4.1` and so on).

## [0.4.1] - 2026-10-05

### Fixed
- One reminder is never counted twice: answering in a second session after another session already answered doesn't log it again or move the timer. The band closes with "Already answered in another session ✓".
- Other sessions pick up an answer within about 5 seconds instead of 30.

## [0.4.0] - 2026-10-05

### Changed
- All open sessions share one schedule. Settings, the schedule and your history moved to `~/.claude/water-reminder/` (`shared.json`, `log.json`), read fresh by every session.
- A due reminder shows in every session, and only one of them sends the Windows notification.
- Answering in any session clears the others and moves everyone to the new time.
- `/water-every`, `/water-snooze`, pause/resume and mute reach every session.
- New sessions join the existing schedule instead of starting their own hour.
- Existing settings and history are carried over on first run.

### Fixed
- The Windows notification could fire from one session while `/water-status` in another showed a different time.

## [0.3.0] - 2026-10-05

### Added
- `/water-version`: version, author, repo link and copyright.

### Fixed
- 0.2.0 failed to load (a helper taking `$` was declared inside `register()`). Anyone on 0.2.0 should update.

### Removed
- The in-app toast when a reminder fires.

## [0.2.0] - 2026-10-05

> **Broken release:** the plugin fails to load. Use 0.3.0 or later.

### Added
- `/water-stats [days]`: daily and hourly charts, streaks, yes rate, trend, rank, and an "at a glance" panel, with an animated drinking critter.
- Your answers are logged across sessions.
- Styled replies for `/water`, `/water-status` (countdown and progress bar), pause/resume, every/snooze and mute/unmute.
- `/water-help` and `/water-update`.

### Fixed
- The reminder band didn't appear when it fired while Claude was replying.
- The critter's animation never played; its frame no longer shows a white box in dark mode.

## [0.1.0] - 2026-10-04

### Added
- First release: the Claude critter asks "Have you drunk water?" above the prompt every hour, "Not yet" asks again after 5 minutes, and Windows shows a system notification with a sound.
- `/water`, `/water-status`, `/water-pause`, `/water-resume`, `/water-every`, `/water-snooze`, `/water-mute`, `/water-unmute`.

[0.4.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/YossiAbutbul/claude-water-reminder/releases/tag/v0.1.0
