# Static analysis and sanitizers

The client ships opt-in tooling for finding memory and lifetime bugs — the bug
class behind the `delete`/`delete[]` mismatch that used to live in
`ZzzBMD.cpp`. Both are **off by default**; a normal build is unaffected.

This tooling is a *defect hunter, not a style gate*. It deliberately does not
run the modernization and readability checks. See [Why not the style
checks](#why-not-the-style-checks) below.

## What's here

| File | Purpose |
|------|---------|
| `.clang-tidy` | The check list, at the repository root. Edit this to change what is reported. |
| `cmake/StaticAnalysis.cmake` | Wires the tools into CMake targets. |
| `docs/build/static-analysis.md` | This file. |

## clang-tidy

Run clang-tidy over the engine sources as part of the build:

```sh
cmake --preset windows-x64-tidy        # or windows-x86-tidy
cmake --build --preset windows-x64-tidy-release
```

clang-tidy runs once per translation unit and prints findings to the build
output. It **cannot fail the build** — `WarningsAsErrors` is empty in
`.clang-tidy`. Treat the output as a review queue, not a gate.

Only `MuClient` and `Main` are analysed. Vendored third-party (SDL, SDL_mixer,
imgui, GLEW) is excluded; its findings are not actionable here.

### Running by hand

clang-tidy needs the compile flags CMake generated, plus two MSVC-specific
arguments that the CMake integration supplies automatically:

```sh
clang-tidy -p out/build/windows-x64 \
  src/source/Engine/Object/ZzzObject.cpp
```

For the **x86** build, add the target triple and the exceptions flag:

```sh
clang-tidy -p out/build/windows-x86 \
  -extra-arg=--target=i686-pc-windows-msvc -extra-arg=/EHsc \
  src/source/Engine/Object/ZzzObject.cpp
```

Why both are needed:

- **`--target`** — the x86 build defines `_USE_32BIT_TIME_T`, which `corecrt.h`
  rejects under a 64-bit target. clang-tidy defaults to the host's pointer
  size, so an x86 compile fails to parse the CRT until the triple is spelled
  out ("You cannot use 32-bit time_t with _WIN64").
- **`/EHsc`** — the engine throws (`BaseCls.h`) and compiles with `/EHsc`, but
  clang defaults to exceptions off and reports *cannot use 'throw' with
  exceptions disabled* on every throw site. Restating `/EHsc` as an extra
  argument is what enables them; `-fexceptions` looks like the portable
  spelling but clang's MSVC driver mode silently drops it.

On Git Bash, write the flag as `//EHsc` (or export `MSYS_NO_PATHCONV=1`):
the path conversion rewrites a bare `/EHsc` to `C:/Program Files/Git/EHsc`.

### A single file quickly

```sh
clang-tidy -p out/build/windows-x64 --quiet src/source/Render/Models/ZzzBMD.cpp
```

`--quiet` suppresses the per-file "N warnings generated" progress lines, which
are loud because third-party headers are parsed even when their findings are
filtered out.

## AddressSanitizer

MSVC's AddressSanitizer is **x64-only** — there is no 32-bit runtime, and the
32-bit client cannot be built under it:

```sh
cmake --preset windows-x64-asan
cmake --build --preset windows-x64-asan-release
```

`Main` is built as a GUI application (no console), so ASan's report goes to the
debugger output window. Attach a debugger, or override the subsystem for the
asan build, to read the report on stdout.

MSVC ASan requires the *C++ AddressSanitizer* component of Visual Studio. If
the link fails on `vcasan.lib`, install it via the Visual Studio Installer
(Individual components → "C++ AddressSanitizer").

## What the checks are looking for

The enabled checks are the ones that find real defects in a C++ codebase of
this shape:

- `bugprone-undefined-memory-manipulation`, `bugprone-suspicious-memset-usage`,
  `bugprone-suspicious-sizeof` — `memset` over a non-trivial type, or `sizeof`
  taken on a pointer where an array was meant. These are the exact failure mode
  of the old lightmap-buffer bug.
- `bugprone-shared-ptr-array-mismatch` — `shared_ptr<T>` constructed from
  `new T[n]`, which deletes with the wrong form.
- `bugprone-suspicious-semicolon` — `if (cond); { ... }`, where the block
  always runs.
- `bugprone-use-after-move`, `bugprone-dangling-handle`,
  `bugprone-move-forwarding-reference` — lifetime bugs.
- `bugprone-swapped-arguments`, `bugprone-suspicious-missing-comma` —
  argument-order and comma bugs.
- `clang-analyzer-*` — the static analyzer (dead stores, null dereferences,
  uninitialized reads), with its noisy `NewDelete` checker disabled.

Every exclusion in `.clang-tidy` has a comment saying why.

## Why not the style checks

`modernize-*`, `performance-*` and `readability-*` are not enabled. Measured on
`ZzzObject.cpp` alone:

| Check | Findings |
|-------|----------|
| `modernize-use-trailing-return-type` | 3127 |
| `modernize-use-override` | 1037 |
| `modernize-use-using` | 829 |
| `modernize-macro-to-enum` | 669 |
| `modernize-avoid-c-arrays` | 598 |
| `performance-enum-size` | 370 |

Enabling them turns the tool into a diff generator for a refactor that
[`AGENTS.md`](../../AGENTS.md) explicitly rules out — *"Don't perform large
retroactive cleanups of existing code to fit the rules unless the user
explicitly asks for it."* The coding rules apply to **changed** code; this
tooling applies to **broken** code.

Apply the modernization checks to a file you are already rewriting by running
them explicitly:

```sh
clang-tidy -p out/build/windows-x64 --quiet \
  -checks='-*,modernize-use-override,modernize-use-nullptr' \
  src/source/SomeFile.cpp --fix
```

## A finding it already caught

Passing `0.5f` into the `int BlendMesh` parameter of `RenderBody` in
`ZzzObject.cpp` — a literal copied from the `+ 0.5f` on the `sine` line above
it. It truncated to `0`, so the behaviour was the same as the sibling
`MODEL_SCROLL_OF_BLOOD` call, but the narrowing was invisible until
`-Wliteral-conversion` surfaced it. Fixed by spelling the truncation out.
