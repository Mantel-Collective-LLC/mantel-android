# Mantel for Android

The Android client of [Mantel VPN](https://mantelvpn.com). A [Capacitor](https://capacitorjs.com) app: the user
interface is React (TypeScript, Tailwind CSS) running in a WebView, the tunnel is native Kotlin on top of the official
[WireGuard Android tunnel library](https://git.zx2c4.com/wireguard-android/) (`wireguard-go` in a `VpnService`).

This repository contains the app only. The Mantel server side (API, VPN servers) is not part of it.

## Features

- WireGuard tunnel with kill switch, LAN access, IPv6 and DNS blocker settings
- Quantum-resistant tunnel (optional): an ML-KEM-768 key exchange (BouncyCastle) derives a WireGuard pre-shared key
- Obfuscation: WireGuard over TLS 1.3 on TCP 443 for networks that block VPN traffic (Android 10+)
- Always-on VPN, quick settings tile, notification with connection status
- Split tunneling (exclude apps), port forwarding, server proxies, Tor over VPN
- Auto-connect on open Wi-Fi (Android 12+, no location permission)
- Latency per location, measured on the device
- End-to-end encrypted support tickets
- App disguise (calculator icon), light/dark theme, English and German
- Account number login with optional two-factor authentication; tokens and keys are stored in the Android Keystore

## Layout

| Path | Content |
|---|---|
| `src/` | Android-specific web code: platform bridge (`bridge/`), API client and schemas (`lib/`), native plugin types (`native/`), login screen, debug tools (debug builds only) |
| `shared/ui/` | The React user interface (shared with the Mantel desktop app, so some screens are desktop-only) |
| `shared/core/` | Contracts between UI and platform, i18n texts (`i18n/*.json`), shared helpers |
| `shared/ticket/` | Support ticket protocol and end-to-end encryption (WebCrypto) |
| `shared/main/` | WireGuard configuration and address ranges shared with the desktop app |
| `android/` | Native Android project (Gradle). Kotlin sources in `android/app/src/main/java/net/mantel/app/` |
| `scripts/` | Helpers that run Gradle, Capacitor and adb with `JAVA_HOME`/`ANDROID_HOME` set |

## Requirements

- Node.js 22 or newer and npm
- JDK 21 (the one bundled with Android Studio works)
- Android SDK with platform 36

The scripts look for Android Studio's JDK and the SDK in their default locations. Set `JAVA_HOME` and `ANDROID_HOME`
if yours are elsewhere.

## Build

```sh
npm ci
npm run typecheck
npm test            # Vitest
npm run test:jvm    # JVM unit tests of the Kotlin code (Gradle)
```

Debug APK (`net.mantel.app.debug`, installs next to the release app, includes a debug screen):

```sh
MANTEL_API_URL=https://mantelvpn.com npm run apk:debug
# android/app/build/outputs/apk/debug/app-debug.apk
```

Without `MANTEL_API_URL` a debug build talks to `http://10.0.2.2:3000` (a server on the host of an Android emulator).

Release APK (`net.mantel.app`, HTTPS only, no debug code):

```sh
MANTEL_API_URL=https://mantelvpn.com npm run apk:prod
```

The API server is fixed at build time; the app has no field to change it.

On Windows (PowerShell) set the variable with `$env:MANTEL_API_URL = "https://mantelvpn.com"` first.

## Signing your own release APK

Without signing configuration `apk:prod` produces `android/app/build/outputs/apk/release/app-release-unsigned.apk`,
which Android will not install. To sign:

1. Create a keystore once:
   ```sh
   keytool -genkeypair -v -keystore my-release.jks -alias mantel -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Copy `keystore.properties.example` to `keystore.properties` in the repository root and fill in the path and
   passwords. Alternatively point `MANTEL_ANDROID_KEYSTORE_PROPERTIES` to a properties file elsewhere. A relative
   `storeFile` is resolved against the folder of the properties file.
3. Run `MANTEL_API_URL=https://mantelvpn.com npm run apk:prod`. The result is
   `android/app/build/outputs/apk/release/app-release.apk`.

`keystore.properties`, keystores and APKs are ignored by git. Never commit them.

An APK signed with your own key cannot update the official Mantel app (Android rejects updates with a different
signature): uninstall it first, or install the debug variant next to it.

## Development

- `npm run dev` serves the UI in a browser on port 5175 and forwards `/api` to `MANTEL_DEV_API`
  (default `http://localhost:3000`).
- `npm run deploy` installs and starts the debug APK on a connected device, `npm run logcat` shows its log.
- `npm run open` opens the project in Android Studio. Always build the web bundle first (`npm run apk:debug` or
  `npm run build:debug && npm run sync`), Gradle packages whatever `cap sync` copied.

## License

GPL-3.0, see [LICENSE](LICENSE). "Mantel" and the Mantel logo are not covered by the license; if you publish a
modified build, use your own name, icon and application ID.
