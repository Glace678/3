# iOS (planned)

iOS is not yet a supported build target. The desktop macOS bootstrap cannot be
reused for iOS: the renderer/input layers still require an OpenGL ES or Metal
port and touch-specific application lifecycle work.

This folder is a placeholder so the build docs can grow per-tool guides (Xcode,
command line) once the port begins. See [../README.md](../README.md) for the
platforms that work today (Linux, Windows).
