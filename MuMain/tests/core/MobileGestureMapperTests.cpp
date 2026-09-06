#include <doctest.h>

#include <algorithm>

#include "Core/Input/MobileGestureMapper.h"

using Core::Input::MobileGestureActionType;
using Core::Input::MobileGestureMapper;
using Core::Input::TouchPhase;
using Core::Input::TouchSample;

namespace
{
    bool Has(const std::vector<Core::Input::MobileGestureAction>& actions,
        MobileGestureActionType type)
    {
        return std::any_of(actions.begin(), actions.end(),
            [type](const auto& action) { return action.type == type; });
    }
}

TEST_CASE("single-finger drag preserves the legacy left mouse contract")
{
    MobileGestureMapper mapper;
    auto down = mapper.Handle({1, TouchPhase::Down, 0.2f, 0.6f, 100});
    CHECK(Has(down, MobileGestureActionType::PointerMove));
    CHECK(Has(down, MobileGestureActionType::LeftButtonDown));

    auto move = mapper.Handle({1, TouchPhase::Move, 0.35f, 0.55f, 150});
    CHECK(Has(move, MobileGestureActionType::PointerMove));

    auto up = mapper.Handle({1, TouchPhase::Up, 0.35f, 0.55f, 200});
    CHECK(Has(up, MobileGestureActionType::LeftButtonUp));
}

TEST_CASE("right-half double tap casts with the legacy right mouse button")
{
    MobileGestureMapper mapper;
    mapper.Handle({1, TouchPhase::Down, 0.75f, 0.5f, 100});
    mapper.Handle({1, TouchPhase::Up, 0.75f, 0.5f, 160});

    auto secondDown = mapper.Handle({2, TouchPhase::Down, 0.76f, 0.51f, 300});
    CHECK(Has(secondDown, MobileGestureActionType::RightButtonDown));
    CHECK_FALSE(Has(secondDown, MobileGestureActionType::LeftButtonDown));
    auto secondUp = mapper.Handle({2, TouchPhase::Up, 0.76f, 0.51f, 350});
    CHECK(Has(secondUp, MobileGestureActionType::RightButtonUp));
}

TEST_CASE("left-handed mode swaps action zones without mirroring pointer coordinates")
{
    MobileGestureMapper mapper;
    mapper.SetLeftHanded(true);

    mapper.Handle({1, TouchPhase::Down, 0.2f, 0.4f, 100});
    mapper.Handle({1, TouchPhase::Up, 0.2f, 0.4f, 180});
    const auto secondDown = mapper.Handle({2, TouchPhase::Down, 0.2f, 0.4f, 260});

    CHECK(Has(secondDown, MobileGestureActionType::RightButtonDown));
    REQUIRE_FALSE(secondDown.empty());
    CHECK(secondDown.front().x == doctest::Approx(0.2f));
}

TEST_CASE("two-finger gestures cancel held movement without producing a click")
{
    MobileGestureMapper mapper;
    mapper.Handle({1, TouchPhase::Down, 0.3f, 0.5f, 100});
    auto second = mapper.Handle({2, TouchPhase::Down, 0.5f, 0.5f, 120});
    CHECK(Has(second, MobileGestureActionType::CancelLeftButton));
    CHECK_FALSE(Has(second, MobileGestureActionType::LeftButtonUp));

    mapper.Handle({1, TouchPhase::Move, 0.42f, 0.5f, 150});
    auto swipe = mapper.Handle({2, TouchPhase::Move, 0.62f, 0.5f, 150});
    CHECK(Has(swipe, MobileGestureActionType::NextSkill));
}

TEST_CASE("system cancellation clears a held touch without clicking")
{
    MobileGestureMapper mapper;
    mapper.Handle({1, TouchPhase::Down, 0.2f, 0.5f, 100});
    const auto cancelled = mapper.Handle({1, TouchPhase::Cancel, 0.2f, 0.5f, 120});
    CHECK(Has(cancelled, MobileGestureActionType::CancelLeftButton));
    CHECK_FALSE(Has(cancelled, MobileGestureActionType::LeftButtonUp));
}

TEST_CASE("pinch and vertical two-finger motion control camera zoom")
{
    MobileGestureMapper mapper;
    mapper.Handle({1, TouchPhase::Down, 0.4f, 0.5f, 100});
    mapper.Handle({2, TouchPhase::Down, 0.6f, 0.5f, 110});
    auto pinch = mapper.Handle({1, TouchPhase::Move, 0.32f, 0.5f, 150});
    CHECK(Has(pinch, MobileGestureActionType::ZoomIn));

    mapper.Reset();
    mapper.Handle({1, TouchPhase::Down, 0.4f, 0.6f, 200});
    mapper.Handle({2, TouchPhase::Down, 0.6f, 0.6f, 210});
    mapper.Handle({1, TouchPhase::Move, 0.4f, 0.48f, 250});
    auto vertical = mapper.Handle({2, TouchPhase::Move, 0.6f, 0.48f, 250});
    CHECK(Has(vertical, MobileGestureActionType::ZoomIn));
}

TEST_CASE("three-finger vertical swipes open map and settings")
{
    MobileGestureMapper mapper;
    mapper.Handle({1, TouchPhase::Down, 0.3f, 0.7f, 100});
    mapper.Handle({2, TouchPhase::Down, 0.5f, 0.7f, 110});
    mapper.Handle({3, TouchPhase::Down, 0.7f, 0.7f, 120});
    mapper.Handle({1, TouchPhase::Move, 0.3f, 0.45f, 170});
    mapper.Handle({2, TouchPhase::Move, 0.5f, 0.45f, 170});
    mapper.Handle({3, TouchPhase::Move, 0.7f, 0.45f, 170});
    auto up = mapper.Handle({3, TouchPhase::Up, 0.7f, 0.45f, 190});
    CHECK(Has(up, MobileGestureActionType::OpenMap));

    mapper.Reset();
    mapper.Handle({4, TouchPhase::Down, 0.3f, 0.3f, 300});
    mapper.Handle({5, TouchPhase::Down, 0.5f, 0.3f, 310});
    mapper.Handle({6, TouchPhase::Down, 0.7f, 0.3f, 320});
    mapper.Handle({4, TouchPhase::Move, 0.3f, 0.55f, 370});
    mapper.Handle({5, TouchPhase::Move, 0.5f, 0.55f, 370});
    mapper.Handle({6, TouchPhase::Move, 0.7f, 0.55f, 370});
    auto down = mapper.Handle({6, TouchPhase::Up, 0.7f, 0.55f, 390});
    CHECK(Has(down, MobileGestureActionType::OpenSettings));
}
