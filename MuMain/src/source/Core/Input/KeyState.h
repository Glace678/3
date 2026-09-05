#pragma once

namespace Core::Input
{
    // Portable replacement for the Win32 "is this key currently down" check
    // (HIBYTE(GetAsyncKeyState(vk)) == 128 / & 0x8000), backed by SDL keyboard
    // state. The argument is a Win32 virtual-key code (VK_*) or an ASCII letter
    // or digit, matching what the existing call sites already pass.
    bool IsKeyDown(int virtualKey);

    // Controller and other non-keyboard backends feed the existing legacy key
    // state machine through these overrides. The main thread owns all calls.
    void SetVirtualKeyDown(int virtualKey, bool down);
    void ClearVirtualKeys();
}
