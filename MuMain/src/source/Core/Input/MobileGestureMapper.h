#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace Core::Input
{
    enum class TouchPhase
    {
        Down,
        Move,
        Up,
        Cancel,
    };

    struct TouchSample
    {
        std::int64_t fingerId{};
        TouchPhase phase{TouchPhase::Move};
        float x{};
        float y{};
        std::uint64_t timestampMs{};
    };

    enum class MobileGestureActionType
    {
        PointerMove,
        LeftButtonDown,
        LeftButtonUp,
        RightButtonDown,
        RightButtonUp,
        CancelLeftButton,
        CancelRightButton,
        PreviousSkill,
        NextSkill,
        ZoomIn,
        ZoomOut,
        OpenMap,
        OpenSettings,
    };

    struct MobileGestureAction
    {
        MobileGestureActionType type{MobileGestureActionType::PointerMove};
        float x{};
        float y{};
    };

    class MobileGestureMapper
    {
    public:
        std::vector<MobileGestureAction> Handle(const TouchSample& sample);
        void SetLeftHanded(bool leftHanded) { m_leftHanded = leftHanded; }
        void Reset();

    private:
        struct Finger;
        enum class Mode;

        Finger* Find(std::int64_t fingerId);
        const Finger* Find(std::int64_t fingerId) const;
        std::size_t ActiveCount() const;
        void StartMultiGesture();
        void StartThreeFingerGesture();
        void ReleaseActiveButton(std::vector<MobileGestureAction>& actions, float x, float y);
        void CancelActiveButton(std::vector<MobileGestureAction>& actions, float x, float y);
        bool IsActionRegion(float x) const;

        static constexpr std::size_t MaxFingers = 10;
        Finger* FirstFree();

        struct Finger
        {
            bool active{};
            std::int64_t id{};
            float startX{};
            float startY{};
            float x{};
            float y{};
            std::uint64_t downAtMs{};
        };

        enum class Mode
        {
            Idle,
            SingleLeft,
            SingleRight,
            Multi,
            Three,
            Suppressed,
        };

        Finger m_fingers[MaxFingers]{};
        Mode m_mode{Mode::Idle};
        float m_anchorX{};
        float m_anchorY{};
        float m_anchorDistance{};
        float m_threeStartX{};
        float m_threeStartY{};
        bool m_threeActionSent{};
        std::uint64_t m_lastRightTapAtMs{};
        float m_lastRightTapX{};
        float m_lastRightTapY{};
        bool m_leftHanded{};
    };
}
