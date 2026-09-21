# Android

Android is a **source-level supported target**: the engine entry point, CMake
wiring, touch/gesture input and the delivery project all exist. Device-level
validation (native build on an actual phone, GPU drivers, IME) is still tracked
as pending — see the status table below.

## Components

| Piece | Location |
|---|---|
| Engine entry (SDL3, data root, config env) | `src/source/App/Platform/Android/main.cpp` |
| CMake mobile path (`MU_MOBILE`: shared SDL3, GLES via gl4es, `libmain.so`, 16 KiB page alignment) | `src/CMakeLists.txt` (`if(ANDROID OR OHOS)`) |
| Touch gestures (tap/double-tap/swipe/pinch → game actions) | `src/source/Core/Input/MobileGestureMapper.{h,cpp}` (+ tests in `tests/core/MobileGestureMapperTests.cpp`) |
| Delivery project (Gradle: `game-app` + native GM app `gm-app`) | `OpenMU-Android/` at the repository root |
| .NET protocol library (NativeAOT `linux-bionic-arm64` → `.so`) | `OpenMU-Android/nativeaot/` |
| Server-side mobile GM REST API + auth | `OpenMU/src/Web/AdminPanel/API/MobileGm*`, `OpenMU/src/Web/AdminPanel/Auth/MobileGm*` |

## Building

The supported route is the packaging script on a Windows dev box (it drives
CMake + Gradle and stages the native libraries, game data archive and a local
server build):

```powershell
cd OpenMU-Android
.\Build-AndroidPackage.ps1 -ServerAddress <lan-ip> -NdkPath <ndk-root>
```

The NDK is located via `-NdkPath`, `OPENMU_ANDROID_NDK_PATH`, `ANDROID_NDK_HOME`
or `ANDROID_NDK_ROOT`; without any of them AGP falls back to resolving
`ndkVersion` inside the Android SDK. Two build inputs are mandatory by design:

- `OPENMU_SERVER_ADDRESS` — LAN server address baked into the APK.
- `OPENMU_MOBILE_PACKAGE_KEY` — 43-char base64url pairing key shared with the
  server's `mobile-server-settings.json`; the game account credentials are
  derived from it via HMAC-SHA256 (auto-login), so builds fail without it.

`game-app/src/main/assets/game-data.zip` (~740 MB, built from `MuMain/src/bin`
by the script) is required at configuration time and never committed.

Manual native-only build (for engine development):

```bash
cmake -S OpenMU-Android/game-app/src/main/cpp -B build-android \
  -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK_HOME/build/cmake/android.toolchain.cmake \
  -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-26
cmake --build build-android --target Main
```

## Status

| Area | State |
|---|---|
| Java compile / lint / GM APK assembly | Verified (see `OpenMU-Android/MOBILE-GM-IMPLEMENTATION-REPORT.md`) |
| Gesture mapper + input timing unit tests | Wired into `core_input_timing_tests` |
| Native `libmain.so` on device | Pending device run (NDK build path exists; gl4es GLES rendering not yet device-verified) |
| Protocol library on device | Pending (`nativeaot/build-clientlibrary-android.sh` output not yet run against a live server from the APK) |
