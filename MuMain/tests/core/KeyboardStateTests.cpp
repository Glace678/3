#include "doctest.h"
#include "Core/Input/KeyState.h"
#include "Core/Platform/WinCompat.h"
#include <SDL3/SDL.h>

TEST_CASE("quick keyboard taps survive an event pump until a game frame consumes them")
{
    Core::Input::ClearKeyboardPresses();
    Core::Input::ClearVirtualKeys();
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_I);
    CHECK(Core::Input::IsKeyDown('I'));
    CHECK(Core::Input::IsKeyDown('I')); // More than one input consumer in a frame.
    Core::Input::ClearKeyboardPresses();
    CHECK_FALSE(Core::Input::IsKeyDown('I'));
}

TEST_CASE("keyboard modifiers and keypad enter retain fast presses")
{
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_RSHIFT);
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_LCTRL);
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_KP_ENTER);
    CHECK(Core::Input::IsKeyDown(VK_SHIFT));
    CHECK(Core::Input::IsKeyDown(VK_CONTROL));
    CHECK(Core::Input::IsKeyDown(VK_RETURN));
    Core::Input::ClearKeyboardPresses();
    CHECK_FALSE(Core::Input::IsKeyDown(VK_SHIFT));
    CHECK_FALSE(Core::Input::IsKeyDown(VK_RETURN));
}

TEST_CASE("clearing keyboard presses preserves independent controller keys")
{
    Core::Input::SetVirtualKeyDown('V', true);
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_V);
    Core::Input::ClearKeyboardPresses();
    CHECK(Core::Input::IsKeyDown('V'));
    Core::Input::ClearVirtualKeys();
    CHECK_FALSE(Core::Input::IsKeyDown('V'));
}

TEST_CASE("unknown keyboard scancodes cannot access outside the input table")
{
    Core::Input::ClearKeyboardPresses();
    Core::Input::RecordKeyboardPress(-1);
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_UNKNOWN);
    Core::Input::RecordKeyboardPress(SDL_SCANCODE_COUNT);
    CHECK_FALSE(Core::Input::IsKeyDown(-1));
    CHECK_FALSE(Core::Input::IsKeyDown('I'));
}
