# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions are the Mantel app version
(`YEAR.MINOR.PATCH`); every release is tagged `v<version>`.

## [2026.0.12] - 2026-11-08

### Changed

- Lighter: the app checks in far less often while idle or minimized, saving CPU and battery.
- Android always uses the current server key when connecting.
- In the ticket chat only the messages scroll, the reply field stays in place, and it opens at the newest message.

## [2026.0.11] - 2026-11-07

### Changed

- Faster: the app now checks the connection status without delay.

### Fixed

- Connecting to RAM-only locations works even after the server has restarted.

## [2026.0.10] - 2026-11-06

### Changed

- The app now starts in English unless you picked German in the settings.
- The language setting offers Deutsch and English.

## [2026.0.9] - 2026-11-06

### Changed

- New accounts start without time: the app then shows “No time yet” with a direct way to buy time or redeem a voucher.
- Clearer message when an account has no paid time.

## [2026.0.8] - 2026-11-05

### Added

- Two-factor sign-in with an authenticator app (optional, set up in the dashboard) – the app then asks for the code when you sign in.

### Changed

- MTProto proxies for Telegram on our servers, with a link that opens straight in Telegram.

## [2026.0.7] - 2026-11-05

### Added

- Tor over VPN with one switch, your own proxies on our servers (Tor or server IP), obfuscation for networks that block VPNs, and automatic key rotation.

### Changed

- Manage devices and port forwarding in the app, and see new sign-ins to your account.

### Fixed

- Autostart on/off, and disconnecting now always lifts the block.

## [2026.0.6] - 2026-11-04

### Added

- A Support tab – send tickets to our team right from the app, end-to-end encrypted, with a counter for new replies.

### Changed

- Calmer navigation: the active page is marked with an accent line instead of a large filled area.
- Uptime, handshake and data usage are shown as separate live tiles on the home screen.
- Renew now opens the subscription page directly.

## [2026.0.5] - 2026-10-25

### Added

- Port forwarding under Settings → Connection.

### Changed

- A switch opens one port (TCP and UDP) for this device at the connected location, with a copy button and a hint for torrent clients.
- Locations are being upgraded step by step; where it is not available yet, the app says so and the switch stays off.

## [2026.0.4] - 2026-10-25

### Changed

- Speed per location (fast, medium, slow) is now measured by your device instead of the server.
- Nothing is shown when there is no measurement, and nothing is measured while connected.

## [2026.0.3] - 2026-10-25

### Changed

- New design with a bottom tab bar and world map, a dedicated Locations tab, clearer buttons (green to connect, red to disconnect), a tidier connection card and smoother animations on Android.

## [2026.0.2] - 2026-10-24

### Changed

- Deleted devices are detected and disconnected.
- Disconnecting works without signing in.
- Notice when the connection is interrupted.
- Deleting your account removes devices immediately.

## [2026.0.1] - 2026-10-24

### Fixed

- Quantum-resistant tunnel (beta), location list only when signed in, bug fixes.

[2026.0.12]: https://github.com/Mantel-Collective-LLC/mantel-android/releases/tag/v2026.0.12
