# iOS (preview scaffold)

iOS is **not yet a supported build target**, but it is no longer an empty
placeholder: the platform entry, an opt-in CMake branch and a delivery project
scaffold exist, so porting work can start immediately.

## What exists today

| Piece | Location |
|---|---|
| Engine entry (SDL3 iOS bootstrap, sandbox data root, config env) | `src/source/App/Platform/iOS/main.mm` |
| Opt-in CMake branch (`-DMU_IOS_PREVIEW=ON`; default configure still fails loudly) | `src/CMakeLists.txt` (`CMAKE_SYSTEM_NAME STREQUAL "iOS"`) |
| Xcode project generator + bundle metadata + signing env | `OpenMU-iOS/` at the repository root (`build-ios.sh`, `game-ios/`) |
| .NET protocol library script (NativeAOT `ios-arm64`, experimental) | `OpenMU-iOS/nativeaot-ios/` |

## What is still missing

- **Renderer**: the engine uses fixed-function desktop OpenGL; iOS needs the
  gl4es→GLES2 route (same as Android/HarmonyOS) or the SDL GPU Metal backend,
  validated on device.
- **Protocol library loading**: iOS only allows `dlopen` of properly embedded
  frameworks/dylibs; the library must ship inside `OpenMU-Game.app/Frameworks/`
  and be loaded via `@rpath` (the AOT props already set that install name).
- First-run extraction of `game-data.zip` into `Documents/Data`, system IME,
  SafeArea/notch handling, ProMotion 120 Hz opt-in, signing/distribution
  (PrivacyInfo.xcprivacy, TestFlight).

Build instructions, the ordered porting checklist and an honest status
statement live in `OpenMU-iOS/BUILD-iOS构建说明.md`. Touch input itself is
shared with Android/HarmonyOS through `Core/Input/MobileGestureMapper`.
