# Changelog

All notable changes to water-reminder. Versions follow [semantic versioning](https://semver.org): the version in `.claude-plugin/plugin.json` is what `/water-version` shows and what `/water-update` compares against. Each version is tagged in git (`v0.4.1` and so on).

## [0.9.3] - 2026-10-06

Readied for the Claude plugin directory: the plugin does nothing new, and says plainly what it does.

### Changed
- `/water-update` no longer fetches anything itself: it runs Claude Code's own `claude plugin marketplace update` and `claude plugin update`, and tells from their output whether a newer version was installed. The plugin makes no network requests of its own.
- The Windows notification runs as plain-text PowerShell (`-Command`), written out at the call in its two forms (with and without sound), instead of an encoded command.
- The README has a section on what the plugin writes, runs and hooks, and `plugin.json` links to it as the privacy policy. The plugin has an icon, and its description is up to date.
- `plugin.json` links the homepage, documentation and support (GitHub Issues) for the directory listing.

### Fixed
- Code the directory's checks couldn't follow: no name `h` besides JSX's own, session state read and written through the plugin's own functions, and the version and author kept as constants instead of read from `plugin.json` at run time.

## [0.9.2] - 2026-10-06

### Changed
- `/water-help` in the desktop app shows a button for every command: press one to put it in the prompt box, then press Enter (add a value first where it needs one). The terminal keeps the table.
- The README's commands image shows the `/water-help` buttons, and its status card the new snooze wording.
- The last "Not yet" wording is gone now that there are two snooze buttons: `/water-status` and `/water-help` say "snooze 5 or 10 min", `/water-snooze` replies with both waits, and the stats say "snoozed".

## [0.9.1] - 2026-10-06

### Fixed
- The victory jump fits the same frame as the dance, so the card above the prompt keeps its height: a lower hop, the trophy bottle held lower in its hand and the sparkles kept inside.
- The README's preview image shows the replies' real **Close** button instead of an ✕.
- The README's commands image shows `/water-drank`.

## [0.9.0] - 2026-10-06

### Added
- `/water-drank`: log a glass whenever you drink, without waiting for a reminder. It restarts the countdown, and answers the question if one is up.
- A victory jump for the glass that reaches your daily goal: the critter hops with the bottle held up like a trophy, under sparkles and falling confetti, with a cheerful message picked at random.
- `/water-quiet` takes several windows separated by commas, such as `/water-quiet 10:00-12:00, 20:00-22:00` (up to 6). Windows that touch are walked through to the end of the last one; windows that cover the whole day are refused.

### Changed
- "Not yet" is now two buttons, **In 5 min** and **In 10 min**. They follow `/water-snooze`: the first waits that long, the second twice as long.
- On the hydration check the critter's bottle is empty but for one last drop, and every couple of seconds it gives it a hopeful shake.
- The README's preview image shows the new buttons, the empty bottle and the victory jump.

## [0.8.1] - 2026-10-06

### Changed
- The README's preview image shows how the critter reacts: dancing after "Yes, I drank" and sighing after "Not yet".

## [0.8.0] - 2026-10-06

### Added
- The critter reacts to your answer in the desktop app: it dances when you press **Yes, I drank 💧**, and lets out a slow, sad sigh when you press **Not yet** (it sinks onto its legs, looks down and lets its bottle droop).

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

[0.9.3]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.9.2...v0.9.3
[0.9.2]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/YossiAbutbul/claude-water-reminder/compare/v0.7.1...v0.8.0
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
