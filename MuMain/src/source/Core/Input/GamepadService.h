#pragma once

#include "Core/Haptics/Haptics.h"
#include "Core/Input/GamepadMapper.h"
#include "Core/Input/SdlGamepadBackend.h"

#include <SDL3/SDL.h>

namespace Core::Input
{
    class GamepadService
    {
    public:
        static GamepadService& Instance();

        bool Initialize(
            const GamepadSettings& gamepadSettings,
            const Core::Haptics::HapticSettings& hapticSettings);
        void Shutdown();
        void HandleEvent(const SDL_Event& event);
        const GamepadFrameState& Update(
            InputContext context,
            double nowMs,
            float pointerWidth,
            float pointerHeight,
            bool acceptInput);
        void OnFocusChanged(bool focused);
        void SetPointerPosition(float pointerX, float pointerY);
        void OnPhysicalPointerInput(float pointerX, float pointerY);
        void RequireNeutralInput();

        bool PublishHaptic(Core::Haptics::HapticEvent event, double nowMs);
        void SetGamepadSettings(const GamepadSettings& settings);
        void SetHapticSettings(const Core::Haptics::HapticSettings& settings);
        bool ConsumeInputOwnershipChanged();

        bool IsConnected() const { return m_backend.IsConnected(); }
        bool IsInputEnabled() const { return m_gamepadEnabled; }
        bool SupportsRumble() const { return m_haptics.SupportsRumble(); }
        std::string GetDeviceName() const { return m_backend.GetDeviceName(); }
        GamepadIconFamily GetIconFamily() const { return m_backend.GetIconFamily(); }
        SDL_Gamepad* GetActiveGamepad() const { return m_backend.GetActiveGamepad(); }

    private:
        GamepadService();
        void PublishInputFeedback(const GamepadFrameState& previous, double nowMs);

        SdlGamepadBackend m_backend;
        GamepadMapper m_mapper;
        Core::Haptics::HapticScheduler m_haptics;
        GamepadFrameState m_frame;
        double m_previousUpdateMs = 0.0;
        SDL_JoystickID m_lastDeviceId = 0;
        bool m_initialized = false;
        bool m_focused = true;
        bool m_gamepadEnabled = true;
        bool m_inputOwnershipChanged = false;
    };
}
