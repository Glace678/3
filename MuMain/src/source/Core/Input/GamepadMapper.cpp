#include "Core/Input/GamepadMapper.h"

#include <algorithm>
#include <cmath>

namespace Core::Input
{
    namespace
    {
        constexpr float TriggerPressed = 0.5f;
        constexpr float NeutralThreshold = 0.25f;

        std::size_t Index(InputAction action)
        {
            return static_cast<std::size_t>(action);
        }
    }

    GamepadMapper::GamepadMapper(GamepadSettings settings)
        : m_settings(settings)
    {
    }

    GamepadFrameState GamepadMapper::Update(
        const GamepadSnapshot& snapshot,
        InputContext context,
        double deltaSeconds,
        float pointerWidth,
        float pointerHeight,
        bool acceptInput)
    {
        GamepadFrameState frame;
        frame.pointer = m_pointer;
        frame.pointer.leftPressed = false;
        frame.pointer.leftReleased = false;
        frame.pointer.rightPressed = false;
        frame.pointer.rightReleased = false;

        if (!m_settings.enabled || !snapshot.connected || !acceptInput)
        {
            if (m_previous.connected)
            {
                frame.pointer.leftReleased = m_pointer.leftDown;
                frame.pointer.rightReleased = m_pointer.rightDown;
            }
            frame.pointer.leftDown = false;
            frame.pointer.rightDown = false;
            m_pointer = frame.pointer;
            m_previous = {};
            m_requireNeutral = true;
            return frame;
        }

        const float maxAxis = std::max({
            std::abs(snapshot.leftX), std::abs(snapshot.leftY),
            std::abs(snapshot.rightX), std::abs(snapshot.rightY),
            ApplyTriggerDeadZone(snapshot.leftTrigger),
            ApplyTriggerDeadZone(snapshot.rightTrigger) });
        if (m_requireNeutral)
        {
            m_requireNeutral = maxAxis > NeutralThreshold;
            for (bool down : snapshot.buttons)
            {
                if (down)
                {
                    m_requireNeutral = true;
                    break;
                }
            }

            // Consume the first fully neutral sample as part of the ownership
            // handoff too. Falling through with a held previous snapshot would
            // synthesize release edges for the controls we intentionally hid.
            m_previous = snapshot;
            return frame;
        }

        const float leftX = ApplyDeadZone(snapshot.leftX, m_settings.stickDeadZone);
        const float leftY = ApplyDeadZone(snapshot.leftY, m_settings.stickDeadZone);
        const float rightX = ApplyDeadZone(snapshot.rightX, m_settings.stickDeadZone);
        float rightY = ApplyDeadZone(snapshot.rightY, m_settings.stickDeadZone);
        if (m_settings.invertPointerY) rightY = -rightY;

        float pointerX = rightX;
        float pointerY = rightY;
        if (context != InputContext::World)
        {
            const float pointerLeftY = m_settings.invertPointerY ? -leftY : leftY;
            if (std::abs(leftX) > std::abs(pointerX)) pointerX = leftX;
            if (std::abs(pointerLeftY) > std::abs(pointerY)) pointerY = pointerLeftY;

            const float dpadX = ButtonDown(snapshot, GamepadButton::DpadRight)
                - ButtonDown(snapshot, GamepadButton::DpadLeft);
            const float dpadY = ButtonDown(snapshot, GamepadButton::DpadDown)
                - ButtonDown(snapshot, GamepadButton::DpadUp);
            if (dpadX != 0.0f) pointerX = dpadX;
            if (dpadY != 0.0f) pointerY = dpadY;
        }

        const float seconds = static_cast<float>(std::clamp(deltaSeconds, 0.0, 0.1));
        frame.pointer.x = std::clamp(
            frame.pointer.x + pointerX * m_settings.pointerSpeed * seconds,
            0.0f,
            std::max(0.0f, pointerWidth - 1.0f));
        frame.pointer.y = std::clamp(
            frame.pointer.y + pointerY * m_settings.pointerSpeed * seconds,
            0.0f,
            std::max(0.0f, pointerHeight - 1.0f));

        const auto down = [this](const GamepadSnapshot& state, RemappableGamepadAction action) {
            return ActionDown(state, action);
        };
        const bool confirm = down(snapshot, RemappableGamepadAction::Confirm);
        const bool previousConfirm = down(m_previous, RemappableGamepadAction::Confirm);
        const bool skill = down(snapshot, RemappableGamepadAction::UseSkill);
        const bool previousSkill = down(m_previous, RemappableGamepadAction::UseSkill);
        const bool lockTarget = down(snapshot, RemappableGamepadAction::LockTarget);
        const bool previousLockTarget = down(m_previous, RemappableGamepadAction::LockTarget);

        frame.pointer.leftDown = confirm;
        frame.pointer.leftPressed = confirm && !previousConfirm;
        frame.pointer.leftReleased = !confirm && previousConfirm;
        frame.pointer.rightDown = skill;
        frame.pointer.rightPressed = skill && !previousSkill;
        frame.pointer.rightReleased = !skill && previousSkill;

        SetDigitalAction(frame, InputAction::Confirm, confirm, previousConfirm);
        SetDigitalAction(frame, InputAction::Cancel,
            down(snapshot, RemappableGamepadAction::Cancel),
            down(m_previous, RemappableGamepadAction::Cancel));
        SetDigitalAction(frame, InputAction::PrimaryAttack,
            down(snapshot, RemappableGamepadAction::PrimaryAttack),
            down(m_previous, RemappableGamepadAction::PrimaryAttack));
        SetDigitalAction(frame, InputAction::ContextAction,
            down(snapshot, RemappableGamepadAction::ContextAction),
            down(m_previous, RemappableGamepadAction::ContextAction));
        SetDigitalAction(frame, InputAction::SecondaryAction,
            down(snapshot, RemappableGamepadAction::PrimaryAttack),
            down(m_previous, RemappableGamepadAction::PrimaryAttack));
        SetDigitalAction(frame, InputAction::Details,
            down(snapshot, RemappableGamepadAction::ContextAction),
            down(m_previous, RemappableGamepadAction::ContextAction));
        SetDigitalAction(frame, InputAction::PreviousPage,
            down(snapshot, RemappableGamepadAction::PreviousPage),
            down(m_previous, RemappableGamepadAction::PreviousPage));
        SetDigitalAction(frame, InputAction::NextPage,
            down(snapshot, RemappableGamepadAction::NextPage),
            down(m_previous, RemappableGamepadAction::NextPage));
        SetDigitalAction(frame, InputAction::QuickItem1,
            down(snapshot, RemappableGamepadAction::QuickItem1),
            down(m_previous, RemappableGamepadAction::QuickItem1));
        SetDigitalAction(frame, InputAction::QuickItem2,
            down(snapshot, RemappableGamepadAction::QuickItem2),
            down(m_previous, RemappableGamepadAction::QuickItem2));
        SetDigitalAction(frame, InputAction::QuickItem3,
            down(snapshot, RemappableGamepadAction::QuickItem3),
            down(m_previous, RemappableGamepadAction::QuickItem3));
        SetDigitalAction(frame, InputAction::QuickItem4,
            down(snapshot, RemappableGamepadAction::QuickItem4),
            down(m_previous, RemappableGamepadAction::QuickItem4));
        SetDigitalAction(frame, InputAction::Map,
            down(snapshot, RemappableGamepadAction::Map),
            down(m_previous, RemappableGamepadAction::Map));
        SetDigitalAction(frame, InputAction::Menu,
            down(snapshot, RemappableGamepadAction::Menu),
            down(m_previous, RemappableGamepadAction::Menu));
        SetDigitalAction(frame, InputAction::AutoMove,
            down(snapshot, RemappableGamepadAction::AutoMove),
            down(m_previous, RemappableGamepadAction::AutoMove));
        SetDigitalAction(frame, InputAction::NextTarget,
            down(snapshot, RemappableGamepadAction::NextTarget),
            down(m_previous, RemappableGamepadAction::NextTarget));
        SetDigitalAction(frame, InputAction::UseSkill, skill, previousSkill);
        SetDigitalAction(frame, InputAction::LockTarget, lockTarget, previousLockTarget);

        auto& move = frame.actions[Index(InputAction::Move)];
        const float moveX = leftX;
        const float moveY = leftY;
        frame.moveX = moveX;
        frame.moveY = moveY;
        move.value = std::sqrt(moveX * moveX + moveY * moveY);
        move.down = move.value > 0.0f;

        auto& point = frame.actions[Index(InputAction::Point)];
        point.value = std::sqrt(pointerX * pointerX + pointerY * pointerY);
        point.down = point.value > 0.0f;

        // UI uses A as the complete pointer press/hold/release lifecycle. In the
        // world, the same state feeds the existing movement/interact state
        // machine while RT feeds the existing skill/right-button path.
        (void)context;

        m_pointer = frame.pointer;
        m_previous = snapshot;
        return frame;
    }

    void GamepadMapper::Reset(float pointerX, float pointerY)
    {
        m_pointer = {};
        m_pointer.x = pointerX;
        m_pointer.y = pointerY;
        m_previous = {};
        m_requireNeutral = true;
    }

    void GamepadMapper::SetPointerPosition(float pointerX, float pointerY)
    {
        m_pointer.x = pointerX;
        m_pointer.y = pointerY;
    }

    float GamepadMapper::ApplyDeadZone(float value, float deadZone) const
    {
        const float magnitude = std::abs(value);
        if (magnitude <= deadZone) return 0.0f;
        const float normalized = (magnitude - deadZone) / (1.0f - deadZone);
        return std::copysign(std::clamp(normalized, 0.0f, 1.0f), value);
    }

    float GamepadMapper::ApplyTriggerDeadZone(float value) const
    {
        const float deadZone = std::clamp(m_settings.triggerDeadZone, 0.0f, 0.95f);
        if (value <= deadZone)
            return 0.0f;
        return std::clamp((value - deadZone) / (1.0f - deadZone), 0.0f, 1.0f);
    }

    bool GamepadMapper::ButtonDown(const GamepadSnapshot& snapshot, GamepadButton button) const
    {
        return snapshot.connected && snapshot.buttons[static_cast<std::size_t>(button)];
    }

    bool GamepadMapper::ControlDown(const GamepadSnapshot& snapshot, GamepadControl control) const
    {
        switch (control)
        {
        case GamepadControl::South: return ButtonDown(snapshot, GamepadButton::South);
        case GamepadControl::East: return ButtonDown(snapshot, GamepadButton::East);
        case GamepadControl::West: return ButtonDown(snapshot, GamepadButton::West);
        case GamepadControl::North: return ButtonDown(snapshot, GamepadButton::North);
        case GamepadControl::Back: return ButtonDown(snapshot, GamepadButton::Back);
        case GamepadControl::Start: return ButtonDown(snapshot, GamepadButton::Start);
        case GamepadControl::LeftStick: return ButtonDown(snapshot, GamepadButton::LeftStick);
        case GamepadControl::RightStick: return ButtonDown(snapshot, GamepadButton::RightStick);
        case GamepadControl::LeftShoulder: return ButtonDown(snapshot, GamepadButton::LeftShoulder);
        case GamepadControl::RightShoulder: return ButtonDown(snapshot, GamepadButton::RightShoulder);
        case GamepadControl::DpadUp: return ButtonDown(snapshot, GamepadButton::DpadUp);
        case GamepadControl::DpadDown: return ButtonDown(snapshot, GamepadButton::DpadDown);
        case GamepadControl::DpadLeft: return ButtonDown(snapshot, GamepadButton::DpadLeft);
        case GamepadControl::DpadRight: return ButtonDown(snapshot, GamepadButton::DpadRight);
        case GamepadControl::LeftTrigger: return ApplyTriggerDeadZone(snapshot.leftTrigger) >= TriggerPressed;
        case GamepadControl::RightTrigger: return ApplyTriggerDeadZone(snapshot.rightTrigger) >= TriggerPressed;
        default: return false;
        }
    }

    bool GamepadMapper::ActionDown(
        const GamepadSnapshot& snapshot,
        RemappableGamepadAction action) const
    {
        const auto index = static_cast<std::size_t>(action);
        return index < m_settings.bindings.size()
            && ControlDown(snapshot, m_settings.bindings[index]);
    }

    void GamepadMapper::SetDigitalAction(
        GamepadFrameState& frame,
        InputAction action,
        bool down,
        bool previousDown) const
    {
        auto& state = frame.actions[Index(action)];
        state.down = down;
        state.pressed = down && !previousDown;
        state.released = !down && previousDown;
        state.value = down ? 1.0f : 0.0f;
    }
}
