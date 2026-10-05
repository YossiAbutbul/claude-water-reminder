# Changelog

All notable changes to water-reminder. Versions follow [semantic versioning](https://semver.org): the version in `.claude-plugin/plugin.json` is what `/water-version` shows and what `/water-update` compares against. Each version is tagged in git (`v0.4.1` and so on).

## [0.7.1] - 2026-10-05

### Fixed
- Reply icons in the desktop app no longer sit on a white box: their frame is transparent and follows the app's light or dark theme.

## [0.7.0] - 2026-10-05

### Changed
- Every reply icon in the desktop app is animated and keeps moving while it is on screen: the drop bobs and ripples, the clock ticks, the hourglass flips, the moon sways under a twinkling star, the sound waves pulse, the target ripples, the tick redraws itself, the arrow flies up and the warning sign wobbles.
- New icons for `/water-every` (a clock face whose minute hand ticks), `/water-pause` (a pause sign that breathes like a standby light) and `/water-resume` (a play sign with a spinning ring).
- The README's icon and command images show the animated icons.

## [0.6.2] - 2026-10-05

### Fixed
- The 🌙 quiet-hours icon is centered in its tile (it sat low and to the left).

### Changed
- The README's icon image shows a real `/water-quiet` reply instead of a placeholder caption, and the README explains when a reply gets a two-row or a one-row icon.

## [0.6.1] - 2026-10-05

### Changed
- `/water-version` shows the critter dancing: it steps from foot to foot, sways, bounces on the beat, shakes its water bottle like a maraca and grins, with music notes floating up.
- The README's command image uses the new icons and the dancing critter.

## [0.6.0] - 2026-10-05

### Added
- `/water-quiet <from>-<to>`: quiet hours with no reminders, such as `18:00-09:00` (windows across midnight work, `22-7` is short for `22:00-07:00`). A reminder or a "Not yet" that would land inside them waits until they end. `/water-quiet` shows them, `/water-quiet off` removes them. Shared by every session. `/water` still asks right away.

### Changed
- Command replies in the desktop app use the plugin's own icon set instead of Windows emoji: one style, tinted to match the reply, as tall as the reply (two rows beside a title and a hint, one row beside a single line). The terminal keeps the emoji.

## [0.5.0] - 2026-10-05

### Added
- `/water-goal <glasses>`: set your daily goal (1 to 30, default 8). It's shared by every session, and the stats card, its goal line and your rank use it. The rank now measures your daily average against your goal.
- Automated tests (`claude plugin test .`) for the shared schedule, answers across sessions, the goal, the stats and `/water-update`.

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

[0.7.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/YossiAbutbul/claude-water-reminder/releases/tag/v0.1.0
