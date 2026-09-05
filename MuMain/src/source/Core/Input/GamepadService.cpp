#include "Core/Input/GamepadService.h"

#include <algorithm>

namespace Core::Input
{
    GamepadService& GamepadService::Instance()
    {
        static GamepadService instance;
        return instance;
    }

    GamepadService::GamepadService()
        : m_haptics(m_backend)
    {
    }

    bool GamepadService::Initialize(
        const GamepadSettings& gamepadSettings,
        const Core::Haptics::HapticSettings& hapticSettings)
    {
        m_gamepadEnabled = gamepadSettings.enabled;
        m_mapper.SetSettings(gamepadSettings);
        m_haptics.SetSettings(hapticSettings);
        m_initialized = m_backend.Initialize();
        m_lastDeviceId = m_backend.GetActiveDeviceId();
        m_inputOwnershipChanged = false;
        return m_initialized;
    }

    void GamepadService::Shutdown()
    {
        if (!m_initialized) return;
        m_haptics.Stop();
        m_backend.Shutdown();
        m_initialized = false;
        m_previousUpdateMs = 0.0;
        m_lastDeviceId = 0;
        m_inputOwnershipChanged = false;
        m_frame = {};
    }

    void GamepadService::HandleEvent(const SDL_Event& event)
    {
        if (!m_initialized) return;

        const SDL_JoystickID previousDeviceId = m_backend.GetActiveDeviceId();
        m_backend.HandleEvent(event);
        m_lastDeviceId = m_backend.GetActiveDeviceId();
        if (m_lastDeviceId != previousDeviceId)
        {
            m_inputOwnershipChanged = true;
            m_haptics.Stop();
            m_mapper.Reset(m_frame.pointer.x, m_frame.pointer.y);
        }
    }

    const GamepadFrameState& GamepadService::Update(
        InputContext context,
        double nowMs,
        float pointerWidth,
        float pointerHeight,
        bool acceptInput)
    {
        const double deltaSeconds = m_previousUpdateMs > 0.0
            ? std::clamp((nowMs - m_previousUpdateMs) / 1000.0, 0.0, 0.1)
            : 0.0;
        m_previousUpdateMs = nowMs;

        const GamepadSnapshot snapshot = m_initialized
            ? m_backend.Poll()
            : GamepadSnapshot{};
        const SDL_JoystickID deviceId = m_backend.GetActiveDeviceId();
        if (deviceId != m_lastDeviceId)
        {
            m_inputOwnershipChanged = true;
            m_haptics.Stop();
            m_mapper.Reset(m_frame.pointer.x, m_frame.pointer.y);
            m_lastDeviceId = deviceId;
        }
        const GamepadFrameState previousFrame = m_frame;
        m_frame = m_mapper.Update(
            snapshot,
            context,
            deltaSeconds,
            pointerWidth,
            pointerHeight,
            m_focused && acceptInput);
        if (m_focused && acceptInput && m_gamepadEnabled)
            PublishInputFeedback(previousFrame, nowMs);
        m_haptics.Update(nowMs);
        return m_frame;
    }

    void GamepadService::PublishInputFeedback(const GamepadFrameState& previous, double nowMs)
    {
        // A low-priority input acknowledgement is distinct from a confirmed
        // hit or successful transaction, which still comes from the server.
        for (std::size_t i = 0; i < m_frame.actions.size(); ++i)
        {
            const auto& action = m_frame.actions[i];
            if (action.pressed || (action.down && !previous.actions[i].down))
            {
                m_haptics.Publish(Core::Haptics::HapticEvent::InputAcknowledged, nowMs);
                return;
            }
        }
    }

    void GamepadService::OnFocusChanged(bool focused)
    {
        m_focused = focused;
        if (!focused)
        {
            m_haptics.Stop();
            m_mapper.Reset(m_frame.pointer.x, m_frame.pointer.y);
        }
    }

    void GamepadService::SetPointerPosition(float pointerX, float pointerY)
    {
        m_mapper.SetPointerPosition(pointerX, pointerY);
        m_frame.pointer.x = pointerX;
        m_frame.pointer.y = pointerY;
    }

    void GamepadService::OnPhysicalPointerInput(float pointerX, float pointerY)
    {
        // Physical pointer activity owns the cursor until every controller
        // control returns neutral, preventing a held A/RT from reclaiming it.
        m_frame.pointer.x = pointerX;
        m_frame.pointer.y = pointerY;
        m_mapper.Reset(pointerX, pointerY);
    }

    void GamepadService::RequireNeutralInput()
    {
        m_mapper.Reset(m_frame.pointer.x, m_frame.pointer.y);
    }

    bool GamepadService::PublishHaptic(Core::Haptics::HapticEvent event, double nowMs)
    {
        return m_gamepadEnabled && m_focused && m_haptics.Publish(event, nowMs);
    }

    void GamepadService::SetGamepadSettings(const GamepadSettings& settings)
    {
        const bool ownershipChanged = settings.enabled != m_gamepadEnabled
            || settings.bindings != m_mapper.GetSettings().bindings;
        m_gamepadEnabled = settings.enabled;
        m_mapper.SetSettings(settings);
        if (ownershipChanged)
        {
            m_mapper.Reset(m_frame.pointer.x, m_frame.pointer.y);
            m_inputOwnershipChanged = true;
        }
        if (!m_gamepadEnabled)
            m_haptics.Stop();
    }

    void GamepadService::SetHapticSettings(const Core::Haptics::HapticSettings& settings)
    {
        m_haptics.SetSettings(settings);
    }

    bool GamepadService::ConsumeInputOwnershipChanged()
    {
        const bool changed = m_inputOwnershipChanged;
        m_inputOwnershipChanged = false;
        return changed;
    }
}
