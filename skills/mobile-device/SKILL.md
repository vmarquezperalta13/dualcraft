---
name: mobile-device
description: Works with Android emulators/devices (and the iOS Simulator on macOS) - list and start emulators, install and run the app, screenshots and screen recordings, logcat and flutter logs, deep links, UI automation with adb (tap, type, swipe, read the UI tree), permissions and app data. Use when the user runs /dualcraft:mobile-device, "arranca el emulador", "instala la app", "haz captura del móvil", "mira los logs", "prueba el deep link", or to check a mobile UI change on a device.
---

# DualCraft mobile device

Work in the scratchpad for screenshots/dumps. Never wipe data or uninstall without asking.

## Devices
- List: `flutter devices` · `adb devices -l` · emulators: `flutter emulators` (or `emulator -list-avds`).
- Start: `flutter emulators --launch <id>` (or `emulator -avd <name> -no-snapshot-load` in the background); wait with `adb wait-for-device` then poll `adb shell getprop sys.boot_completed` until `1`.
- Several devices: always pass `-d <id>` (flutter) / `-s <serial>` (adb).

## Run & install
- `flutter run -d <id> [--flavor x -t lib/main_x.dart]` in the background; hot reload isn't available to you — restart the command after code changes.
- Install a built APK: `adb install -r build/app/outputs/flutter-apk/app-debug.apk`; launch: `adb shell monkey -p <applicationId> 1`.

## Look
- Screenshot: `adb exec-out screencap -p > <scratchpad>/shot.png`, then read the image.
- Recording: `adb shell screenrecord /sdcard/rec.mp4` (stop with Ctrl-C/timeout), `adb pull /sdcard/rec.mp4`.
- UI tree: `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml` → find elements and their bounds (Flutter widgets with `Semantics` labels show up as content-desc).

## Interact
`adb shell input tap X Y` · `input text "hola%smundo"` (`%s` = space) · `input swipe X1 Y1 X2 Y2 300` · `input keyevent KEYCODE_BACK` (4) / `KEYCODE_ENTER` (66). Take a screenshot after each step to confirm.

## Logs
- `flutter logs` or `adb logcat -v time | grep -iE "flutter|AndroidRuntime|<package>"`; clear first with `adb logcat -c` to isolate a reproduction.
- Native crash: look for `FATAL EXCEPTION` / `signal 11` → `dualcraft:mobile-crash`.

## Other
- Deep link: `adb shell am start -W -a android.intent.action.VIEW -d "<scheme://path>" <applicationId>`.
- Permissions: `adb shell pm grant|revoke <pkg> android.permission.CAMERA`; reset app: `adb shell pm clear <pkg>` (ask first — deletes app data).
- Dark mode: `adb shell cmd uimode night yes|no`; font scale: `adb shell settings put system font_scale 1.3` (accessibility check; restore to 1.0).
- iOS Simulator (macOS only): `xcrun simctl list`, `boot`, `install`, `launch`, `io booted screenshot`, `openurl booted <url>`.
