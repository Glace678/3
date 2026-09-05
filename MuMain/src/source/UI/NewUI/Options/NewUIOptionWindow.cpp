// NewUIOptionWindow.cpp: implementation of the CNewUIOptionWindow class.
//
//////////////////////////////////////////////////////////////////////

#include "stdafx.h"
#include "UI/NewUI/Options/NewUIOptionWindow.h"
#include "UI/NewUI/NewUISystem.h"
#include "Render/Textures/ZzzTexture.h"
#include "Audio/DSPlaySound.h"
#include "Data/GameConfig/GameConfig.h"
#include "Audio/AudioPlayer.h"
#include "App/Platform/Windows/Winmain.h"
#include "Core/Input/FocusNavigator.h"
#include "Core/Input/GamepadService.h"
#include "Scenes/SceneManager.h"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <cwchar>
#include "I18N/All.h"

extern int m_MusicOnOff;
extern int m_SoundOnOff;
extern unsigned int WindowWidth, WindowHeight;
extern BOOL g_bUseWindowMode;
void ReinitializeFonts();
void MuApplyWindowResolution(unsigned int width, unsigned int height, bool windowed);
float ConvertX(float x);
float ConvertY(float y);

using namespace SEASON3B;

static const struct { int width; int height; const wchar_t* label; } s_Resolutions[] = {
    { 640, 480, L"640 x 480" },
    { 800, 600, L"800 x 600" },
    { 1024, 768, L"1024 x 768" },
    { 1280, 720, L"1280 x 720" },
    { 1280, 1024, L"1280 x 1024" },
    { 1600, 900, L"1600 x 900" },
    { 1600, 1200, L"1600 x 1200" },
    { 1680, 1050, L"1680 x 1050" },
    { 1920, 1080, L"1920 x 1080" },
    { 2560, 1440, L"2560 x 1440" },
};
static const int s_NumResolutions = sizeof(s_Resolutions) / sizeof(s_Resolutions[0]);
static const int s_DefaultResolutionIndex = 8;  // the 1920 x 1080 entry above

// Index into s_Resolutions of an exact size match, or -1 when the size is not
// a listed mode (e.g. borderless desktop on an unlisted display size).
static int FindListedResolutionIndex(int width, int height)
{
    for (int i = 0; i < s_NumResolutions; ++i)
    {
        if (s_Resolutions[i].width == width && s_Resolutions[i].height == height)
            return i;
    }
    return -1;
}

// I18N locale codes (ASCII) paired with the language's display name in that
// language. The set mirrors what ResxGen emits and what I18N::GetAvailableLocales()
// returns at runtime; held here as wide strings so the CNewUIComboBox can show
// them without per-frame UTF-8 -> wide conversions.
static const struct { const char* code; const wchar_t* label; } s_Languages[] = {
    { "en",    L"English" },
    // Non-ASCII characters use universal-character-name escapes so MSVC reads
    // the wide-string literals correctly regardless of source charset.
    { "de",    L"Deutsch" },
    { "es",    L"Espa\u00f1ol" },                                                  // Español
    { "id",    L"Bahasa Indonesia" },
    { "ja",    L"\u65E5\u672C\u8A9E" },                                       // 日本語
    { "pl",    L"Polski" },
    { "pt",    L"Portugu\u00eas" },                                                // Português
    { "ru",    L"\u0420\u0443\u0441\u0441\u043a\u0438\u0439" },                   // Русский
    { "tl",    L"Tagalog" },
    { "uk",    L"\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430" }, // Українська
    { "zh-CN", L"\u7b80\u4f53\u4e2d\u6587" },                                      // 简体中文
    { "zh-TW", L"\u7e41\u9ad4\u4e2d\u6587" },                                      // 繁體中文
};
static const int s_NumLanguages = sizeof(s_Languages) / sizeof(s_Languages[0]);

// Label pointer array for the resolution combo box. Built once on first use
// from s_Resolutions so the combo can consume a plain `const wchar_t* const*`.
static const wchar_t* const* GetResolutionLabels()
{
    static const wchar_t* labels[s_NumResolutions] = {};
    static bool initialized = false;
    if (!initialized)
    {
        for (int i = 0; i < s_NumResolutions; i++)
            labels[i] = s_Resolutions[i].label;
        initialized = true;
    }
    return labels;
}

static const wchar_t* const* GetLanguageLabels()
{
    static const wchar_t* labels[s_NumLanguages] = {};
    static bool initialized = false;
    if (!initialized)
    {
        for (int i = 0; i < s_NumLanguages; i++)
            labels[i] = s_Languages[i].label;
        initialized = true;
    }
    return labels;
}

// UI font families offered by the font combo. `name` is the GameConfig font
// family value ([UI] Font); empty = the platform default (so the look is
// unchanged). The curated entries are bundled in the client's ./fonts directory
// (see Core/Platform/GdiText.cpp), so they resolve even without a system install.
static const struct { const wchar_t* name; const wchar_t* label; } s_Fonts[] = {
    { L"",                L"Default" },
    { L"Noto Sans CJK SC", L"Noto Sans CJK SC" },
    { L"Liberation Sans", L"Liberation Sans" },
    { L"DejaVu Sans",     L"DejaVu Sans" },
};
static const int s_NumFonts = sizeof(s_Fonts) / sizeof(s_Fonts[0]);

static const wchar_t* const* GetFontLabels()
{
    // Rebuilt on every call so the localized "Default" entry follows a live
    // language switch. The curated font names (Liberation Sans, ...) are proper
    // nouns and stay as-is.
    static const wchar_t* labels[s_NumFonts] = {};
    labels[0] = I18N::Game::DefaultFont;
    for (int i = 1; i < s_NumFonts; i++)
        labels[i] = s_Fonts[i].label;
    return labels;
}

struct FrameRateEntry
{
    double frameRate;
    bool followDisplay;
    bool displayNative;
};

static constexpr FrameRateEntry s_FrameRates[] = {
    { 0.0, true,  false },
    { 30.0, false, false },
    { 60.0, false, false },
    { 90.0, false, false },
    { 120.0, false, false },
    { 144.0, false, false },
    { 180.0, false, false },
    { 0.0, false, true  },
};
static constexpr int s_NumFrameRates = sizeof(s_FrameRates) / sizeof(s_FrameRates[0]);

static const wchar_t* const* GetFrameRateLabels()
{
    static const wchar_t* labels[s_NumFrameRates] = {};
    labels[0] = I18N::Game::FollowDisplay;
    labels[1] = L"30 FPS";
    labels[2] = L"60 FPS";
    labels[3] = L"90 FPS";
    labels[4] = L"120 FPS";
    labels[5] = L"144 FPS";
    labels[6] = L"180 FPS";
    labels[7] = I18N::Game::DisplayNativeMaximum;
    return labels;
}

static const wchar_t* const* GetGamepadActionLabels()
{
    static const wchar_t* labels[
        static_cast<std::size_t>(Core::Input::RemappableGamepadAction::Count)] = {};
    labels[0] = I18N::Game::GamepadActionConfirm;
    labels[1] = I18N::Game::GamepadActionCancel;
    labels[2] = I18N::Game::GamepadActionPrimaryAttack;
    labels[3] = I18N::Game::GamepadActionContext;
    labels[4] = I18N::Game::GamepadActionUseSkill;
    labels[5] = I18N::Game::GamepadActionLockTarget;
    labels[6] = I18N::Game::GamepadActionPreviousSkill;
    labels[7] = I18N::Game::GamepadActionNextSkill;
    labels[8] = I18N::Game::GamepadActionQuickItem1;
    labels[9] = I18N::Game::GamepadActionQuickItem2;
    labels[10] = I18N::Game::GamepadActionQuickItem3;
    labels[11] = I18N::Game::GamepadActionQuickItem4;
    labels[12] = I18N::Game::GamepadActionMap;
    labels[13] = I18N::Game::GamepadActionMenu;
    labels[14] = I18N::Game::GamepadActionHelper;
    labels[15] = I18N::Game::GamepadActionNextTarget;
    return labels;
}

static const wchar_t* const* GetGamepadControlLabels()
{
    // SDL names controls by physical position. Each label also shows the
    // familiar legends used by Xbox, PlayStation, and Nintendo controllers.
    static constexpr const wchar_t* Labels[] = {
        L"South: A / Cross / B", L"East: B / Circle / A",
        L"West: X / Square / Y", L"North: Y / Triangle / X",
        L"View / Share / Minus", L"Menu / Options / Plus",
        L"L3", L"R3", L"LB / L1", L"RB / R1",
        L"D-pad Up", L"D-pad Down", L"D-pad Left", L"D-pad Right",
        L"LT / L2", L"RT / R2",
    };
    static_assert(std::size(Labels) == static_cast<std::size_t>(Core::Input::GamepadControl::Count));
    return Labels;
}

static const wchar_t* GetGamepadFamilyLabel(Core::Input::GamepadIconFamily family)
{
    switch (family)
    {
    case Core::Input::GamepadIconFamily::Xbox: return L"Xbox A/B/X/Y";
    case Core::Input::GamepadIconFamily::PlayStation: return L"PlayStation Cross/Circle";
    case Core::Input::GamepadIconFamily::Nintendo: return L"Nintendo B/A/Y/X";
    default: return I18N::Game::GenericController;
    }
}

namespace
{
    // Volume levels are integers 0..MAX_VOLUME; the slider track is SLIDER_WIDTH pixels wide.
    constexpr int MAX_VOLUME = 10;
    constexpr int SLIDER_WIDTH = 124;        // pixels
    constexpr int SLIDER_HIT_PADDING = 8;    // extra px on each side for easier clicks
    constexpr int SLIDER_HIT_HEIGHT = 16;
    constexpr int SLIDER_X_LOCAL = 33;       // slider start relative to m_Pos.x
    constexpr int BASIC_CHECKBOX_X_LOCAL = 150;
    constexpr int BASIC_CHECKBOX_SIZE = 15;
    constexpr int AUTO_ATTACK_CHECK_Y_LOCAL = 43;
    constexpr int WHISPER_SOUND_CHECK_Y_LOCAL = 65;
    constexpr int SOUND_SLIDER_Y_LOCAL = 104;
    constexpr int MUSIC_SLIDER_Y_LOCAL = 132;
    constexpr int SLIDE_HELP_CHECK_Y_LOCAL = 155;
    constexpr int RENDER_ALL_EFFECTS_CHECK_Y_LOCAL = 217;
    constexpr int WINDOWED_MODE_CHECK_Y_LOCAL = 356;
    constexpr int CLOSE_BUTTON_X_LOCAL = 68;
    constexpr int CLOSE_BUTTON_Y_LOCAL = 425;
    constexpr int CLOSE_BUTTON_WIDTH = 54;
    constexpr int CLOSE_BUTTON_HEIGHT = 30;

    // Render-level slider ("Effect limitation"). Drawn at ~half the legacy
    // 141x29 and horizontally centered: the window content centers on x+95, so a
    // 70-wide bar starts at x+60. Y nudged down to keep it centered in its row.
    // Both the render (RenderButtons) and the hit test (HandleRenderLevelSlider)
    // read these, so size/position stay in sync.
    constexpr int RENDER_SLIDER_X_LOCAL = 60;
    constexpr int RENDER_SLIDER_Y_LOCAL = 191;
    constexpr int RENDER_SLIDER_WIDTH = 70;
    constexpr int RENDER_SLIDER_HEIGHT = 15;
    constexpr float RENDER_LEVEL_MAX = 5.f;
    // Native size of the effect-bar sprite (the 5 numbered squares). Scaled down
    // to RENDER_SLIDER_WIDTH x HEIGHT via RenderImageStretch, so the whole bar
    // shrinks instead of cropping.
    constexpr int EFFECT_BAR_SRC_WIDTH  = 141;
    constexpr int EFFECT_BAR_SRC_HEIGHT = 29;

    // Resolution combo box placement (relative to m_Pos)
    constexpr int RES_COMBO_X_LOCAL = 22;
    constexpr int RES_COMBO_Y_LOCAL = 335;
    constexpr int RES_COMBO_WIDTH   = 148;  // spans the old left-to-right arrow area
    constexpr int RES_COMBO_HEIGHT  = 16;
    constexpr int RES_COMBO_MAX_VISIBLE = 4;  // scrollbar appears when list > this

    // Language combo box placement (relative to m_Pos).
    constexpr int LANG_LABEL_Y_LOCAL = 283;
    constexpr int LANG_COMBO_X_LOCAL = 22;
    constexpr int LANG_COMBO_Y_LOCAL = 296;
    constexpr int LANG_COMBO_WIDTH   = 148;
    constexpr int LANG_COMBO_HEIGHT  = 16;
    constexpr int LANG_COMBO_MAX_VISIBLE = 5;

    // Font combo box placement (relative to m_Pos). Row order below the effect
    // rows is: Font, Language, Resolution, Windowed mode (combos grouped at the
    // top so an open dropdown never overlaps the Close button).
    constexpr int FONT_LABEL_Y_LOCAL = 244;
    constexpr int FONT_COMBO_X_LOCAL = 22;
    constexpr int FONT_COMBO_Y_LOCAL = 257;
    constexpr int FONT_COMBO_WIDTH   = 148;
    constexpr int FONT_COMBO_HEIGHT  = 16;
    constexpr int FONT_COMBO_MAX_VISIBLE = 5;

    constexpr int WINDOW_PANEL_WIDTH = 190;
    constexpr int WINDOW_WIDTH = WINDOW_PANEL_WIDTH * 3;
    constexpr int WINDOW_HEIGHT = 459;
    constexpr int ADVANCED_X_LOCAL = WINDOW_PANEL_WIDTH;

    constexpr int FPS_COMBO_X_LOCAL = ADVANCED_X_LOCAL + 22;
    constexpr int FPS_COMBO_Y_LOCAL = 58;
    constexpr int FPS_COMBO_WIDTH = 148;
    constexpr int FPS_COMBO_HEIGHT = 16;
    constexpr int FPS_COMBO_MAX_VISIBLE = 5;

    constexpr int ADVANCED_CHECKBOX_X_LOCAL = ADVANCED_X_LOCAL + 150;
    constexpr int ADVANCED_CHECKBOX_SIZE = 15;
    constexpr int VSYNC_CHECK_Y_LOCAL = 79;
    constexpr int GAMEPAD_CHECK_Y_LOCAL = 196;
    constexpr int HAPTICS_CHECK_Y_LOCAL = 306;
    constexpr int COMBAT_HAPTICS_CHECK_Y_LOCAL = 356;
    constexpr int UI_HAPTICS_CHECK_Y_LOCAL = 374;
    constexpr int TRANSACTION_HAPTICS_CHECK_Y_LOCAL = 392;

    constexpr int ADVANCED_SLIDER_X_LOCAL = ADVANCED_X_LOCAL + 33;
    constexpr int ADVANCED_SLIDER_WIDTH = 124;
    constexpr int DEAD_ZONE_SLIDER_Y_LOCAL = 226;
    constexpr int POINTER_SPEED_SLIDER_Y_LOCAL = 258;
    constexpr int HAPTIC_INTENSITY_SLIDER_Y_LOCAL = 336;

    constexpr int SHORT_TEST_X_LOCAL = ADVANCED_X_LOCAL + 20;
    constexpr int LONG_TEST_X_LOCAL = ADVANCED_X_LOCAL + 100;
    constexpr int TEST_BUTTON_Y_LOCAL = 414;
    constexpr int TEST_BUTTON_WIDTH = 70;
    constexpr int TEST_BUTTON_HEIGHT = 16;

    constexpr int MAPPING_X_LOCAL = WINDOW_PANEL_WIDTH * 2;
    constexpr int MAPPING_COMBO_X_LOCAL = MAPPING_X_LOCAL + 21;
    constexpr int MAPPING_COMBO_WIDTH = 148;
    constexpr int MAPPING_COMBO_HEIGHT = 16;
    constexpr int ACTION_COMBO_Y_LOCAL = 83;
    constexpr int CONTROL_COMBO_Y_LOCAL = 119;
    constexpr int MAPPING_COMBO_MAX_VISIBLE = 5;
    constexpr int TRIGGER_DEAD_ZONE_SLIDER_Y_LOCAL = 157;
    constexpr int MAPPING_CHECKBOX_X_LOCAL = MAPPING_X_LOCAL + 150;
    constexpr int INVERT_POINTER_CHECK_Y_LOCAL = 181;
    constexpr int MAPPING_SUMMARY_Y_LOCAL = 207;
    constexpr int MAPPING_SUMMARY_ROW_HEIGHT = 13;
    constexpr int RESET_BINDINGS_X_LOCAL = MAPPING_X_LOCAL + 25;
    constexpr int RESET_BINDINGS_Y_LOCAL = 420;
    constexpr int RESET_BINDINGS_WIDTH = 140;
    constexpr int RESET_BINDINGS_HEIGHT = 16;

    constexpr std::uint64_t DISPLAY_CONFIRMATION_DURATION_MS = 10000;
    constexpr int MIN_PERFORMANCE_DIAGNOSTIC_SAMPLES = 60;
    constexpr double PERFORMANCE_DIAGNOSTIC_RATIO = 0.95;
    constexpr int DISPLAY_CONFIRMATION_X_LOCAL = 155;
    constexpr int DISPLAY_CONFIRMATION_Y_LOCAL = 155;
    constexpr int DISPLAY_CONFIRMATION_WIDTH = 260;
    constexpr int DISPLAY_CONFIRMATION_HEIGHT = 118;
    constexpr int KEEP_DISPLAY_X_LOCAL = DISPLAY_CONFIRMATION_X_LOCAL + 20;
    constexpr int REVERT_DISPLAY_X_LOCAL = DISPLAY_CONFIRMATION_X_LOCAL + 140;
    constexpr int DISPLAY_BUTTON_Y_LOCAL = DISPLAY_CONFIRMATION_Y_LOCAL + 78;
    constexpr int DISPLAY_BUTTON_WIDTH = 100;
    constexpr int DISPLAY_BUTTON_HEIGHT = 18;

    constexpr std::uint64_t ADJUSTMENT_INITIAL_REPEAT_MS = 300;
    constexpr std::uint64_t ADJUSTMENT_REPEAT_MS = 110;

    enum class OptionFocusId : std::uint32_t
    {
        AutoAttack = 1,
        WhisperSound,
        SoundVolume,
        MusicVolume,
        SlideHelp,
        RenderLevel,
        RenderAllEffects,
        WindowedMode,
        VerticalSync,
        GamepadEnabled,
        StickDeadZone,
        PointerSpeed,
        HapticsEnabled,
        HapticIntensity,
        CombatHaptics,
        UIHaptics,
        TransactionHaptics,
        TriggerDeadZone,
        InvertPointerY,
        ShortRumbleTest,
        LongRumbleTest,
        ResetBindings,
        KeepDisplaySettings,
        RevertDisplaySettings,
    };

    struct OptionFocusTarget
    {
        OptionFocusId id;
        int xLocal;
        int yLocal;
        int width;
        int height;
    };

    constexpr std::array StandardFocusTargets = {
        OptionFocusTarget{ OptionFocusId::AutoAttack, BASIC_CHECKBOX_X_LOCAL, AUTO_ATTACK_CHECK_Y_LOCAL, BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::WhisperSound, BASIC_CHECKBOX_X_LOCAL, WHISPER_SOUND_CHECK_Y_LOCAL, BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::SoundVolume, SLIDER_X_LOCAL - SLIDER_HIT_PADDING, SOUND_SLIDER_Y_LOCAL, SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::MusicVolume, SLIDER_X_LOCAL - SLIDER_HIT_PADDING, MUSIC_SLIDER_Y_LOCAL, SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::SlideHelp, BASIC_CHECKBOX_X_LOCAL, SLIDE_HELP_CHECK_Y_LOCAL, BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::RenderLevel, RENDER_SLIDER_X_LOCAL, RENDER_SLIDER_Y_LOCAL, RENDER_SLIDER_WIDTH, RENDER_SLIDER_HEIGHT },
        OptionFocusTarget{ OptionFocusId::RenderAllEffects, BASIC_CHECKBOX_X_LOCAL, RENDER_ALL_EFFECTS_CHECK_Y_LOCAL, BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::WindowedMode, BASIC_CHECKBOX_X_LOCAL, WINDOWED_MODE_CHECK_Y_LOCAL, BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::VerticalSync, ADVANCED_CHECKBOX_X_LOCAL, VSYNC_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::GamepadEnabled, ADVANCED_CHECKBOX_X_LOCAL, GAMEPAD_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::StickDeadZone, ADVANCED_SLIDER_X_LOCAL - SLIDER_HIT_PADDING, DEAD_ZONE_SLIDER_Y_LOCAL, ADVANCED_SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::PointerSpeed, ADVANCED_SLIDER_X_LOCAL - SLIDER_HIT_PADDING, POINTER_SPEED_SLIDER_Y_LOCAL, ADVANCED_SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::HapticsEnabled, ADVANCED_CHECKBOX_X_LOCAL, HAPTICS_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::HapticIntensity, ADVANCED_SLIDER_X_LOCAL - SLIDER_HIT_PADDING, HAPTIC_INTENSITY_SLIDER_Y_LOCAL, ADVANCED_SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::CombatHaptics, ADVANCED_CHECKBOX_X_LOCAL, COMBAT_HAPTICS_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::UIHaptics, ADVANCED_CHECKBOX_X_LOCAL, UI_HAPTICS_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::TransactionHaptics, ADVANCED_CHECKBOX_X_LOCAL, TRANSACTION_HAPTICS_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::TriggerDeadZone, MAPPING_X_LOCAL + 33 - SLIDER_HIT_PADDING, TRIGGER_DEAD_ZONE_SLIDER_Y_LOCAL, ADVANCED_SLIDER_WIDTH + SLIDER_HIT_PADDING, SLIDER_HIT_HEIGHT },
        OptionFocusTarget{ OptionFocusId::InvertPointerY, MAPPING_CHECKBOX_X_LOCAL, INVERT_POINTER_CHECK_Y_LOCAL, ADVANCED_CHECKBOX_SIZE, ADVANCED_CHECKBOX_SIZE },
        OptionFocusTarget{ OptionFocusId::ShortRumbleTest, SHORT_TEST_X_LOCAL, TEST_BUTTON_Y_LOCAL, TEST_BUTTON_WIDTH, TEST_BUTTON_HEIGHT },
        OptionFocusTarget{ OptionFocusId::LongRumbleTest, LONG_TEST_X_LOCAL, TEST_BUTTON_Y_LOCAL, TEST_BUTTON_WIDTH, TEST_BUTTON_HEIGHT },
        OptionFocusTarget{ OptionFocusId::ResetBindings, RESET_BINDINGS_X_LOCAL, RESET_BINDINGS_Y_LOCAL, RESET_BINDINGS_WIDTH, RESET_BINDINGS_HEIGHT },
    };

    constexpr std::array DisplayConfirmationFocusTargets = {
        OptionFocusTarget{ OptionFocusId::KeepDisplaySettings, KEEP_DISPLAY_X_LOCAL, DISPLAY_BUTTON_Y_LOCAL, DISPLAY_BUTTON_WIDTH, DISPLAY_BUTTON_HEIGHT },
        OptionFocusTarget{ OptionFocusId::RevertDisplaySettings, REVERT_DISPLAY_X_LOCAL, DISPLAY_BUTTON_Y_LOCAL, DISPLAY_BUTTON_WIDTH, DISPLAY_BUTTON_HEIGHT },
    };

    constexpr std::uint32_t FocusId(OptionFocusId id)
    {
        return static_cast<std::uint32_t>(id);
    }

    const OptionFocusTarget* FindFocusTarget(std::uint32_t focusId)
    {
        const auto matches = [focusId](const OptionFocusTarget& target)
        {
            return FocusId(target.id) == focusId;
        };
        const auto standard = std::find_if(
            StandardFocusTargets.begin(), StandardFocusTargets.end(), matches);
        if (standard != StandardFocusTargets.end())
            return &*standard;

        const auto confirmation = std::find_if(
            DisplayConfirmationFocusTargets.begin(), DisplayConfirmationFocusTargets.end(), matches);
        return confirmation != DisplayConfirmationFocusTargets.end() ? &*confirmation : nullptr;
    }

    bool IsAdjustableFocus(std::uint32_t focusId)
    {
        switch (static_cast<OptionFocusId>(focusId))
        {
        case OptionFocusId::SoundVolume:
        case OptionFocusId::MusicVolume:
        case OptionFocusId::RenderLevel:
        case OptionFocusId::StickDeadZone:
        case OptionFocusId::PointerSpeed:
        case OptionFocusId::HapticIntensity:
        case OptionFocusId::TriggerDeadZone:
            return true;
        default:
            return false;
        }
    }
}

//////////////////////////////////////////////////////////////////////
// Construction/Destruction
//////////////////////////////////////////////////////////////////////

SEASON3B::CNewUIOptionWindow::CNewUIOptionWindow()
{
    m_pNewUIMng = NULL;
    m_Pos.x = 0;
    m_Pos.y = 0;

    m_bAutoAttack = true;
    m_bWhisperSound = false;
    m_bSlideHelp = true;
    m_iVolumeLevel = GameConfig::GetInstance().GetSoundVolume();
    m_iMusicLevel = GameConfig::GetInstance().GetMusicVolume();
    m_iRenderLevel = 4;
    m_bRenderAllEffects = true;
    m_iResolutionIndex = FindCurrentResolutionIndex();
    m_bWindowedMode = (g_bUseWindowMode == TRUE);
    m_iLanguageIndex = FindCurrentLanguageIndex();
    m_iFontIndex = FindCurrentFontIndex();
    m_iFrameRateIndex = FindCurrentFrameRateIndex();

    const auto& frameSettings = GameConfig::GetInstance().GetFrameTimingSettings();
    m_bVSync = frameSettings.verticalSync;

    const auto& gamepadSettings = GameConfig::GetInstance().GetGamepadSettings();
    m_bGamepadEnabled = gamepadSettings.enabled;
    m_iStickDeadZonePercent = static_cast<int>(gamepadSettings.stickDeadZone * 100.0f + 0.5f);
    m_iTriggerDeadZonePercent = static_cast<int>(gamepadSettings.triggerDeadZone * 100.0f + 0.5f);
    m_iPointerSpeed = static_cast<int>(gamepadSettings.pointerSpeed + 0.5f);
    m_bInvertPointerY = gamepadSettings.invertPointerY;
    m_iGamepadActionIndex = 0;
    m_iGamepadControlIndex = static_cast<int>(gamepadSettings.bindings[0]);

    const auto& hapticSettings = GameConfig::GetInstance().GetHapticSettings();
    m_bHapticsEnabled = hapticSettings.enabled;
    m_iHapticIntensity = hapticSettings.intensityPercent;
    m_bCombatHaptics = hapticSettings.combatEnabled;
    m_bUIHaptics = hapticSettings.uiEnabled;
    m_bTransactionHaptics = hapticSettings.transactionEnabled;
}

SEASON3B::CNewUIOptionWindow::~CNewUIOptionWindow()
{
    Release();
}

bool SEASON3B::CNewUIOptionWindow::Create(CNewUIManager* pNewUIMng, int x, int y)
{
    if (NULL == pNewUIMng)
        return false;

    m_pNewUIMng = pNewUIMng;
    m_pNewUIMng->AddUIObj(SEASON3B::INTERFACE_OPTION, this);
    SetPos(x, y);
    LoadImages();
    SetButtonInfo();
    InitResolutionCombo();
    InitLanguageCombo();
    InitFontCombo();
    InitFrameRateCombo();
    InitGamepadMappingCombos();
    Show(false);
    return true;
}

void SEASON3B::CNewUIOptionWindow::InitResolutionCombo()
{
    m_ResolutionCombo.Setup(
        m_Pos.x + RES_COMBO_X_LOCAL,
        m_Pos.y + RES_COMBO_Y_LOCAL,
        RES_COMBO_WIDTH,
        RES_COMBO_HEIGHT,
        GetResolutionLabels(),
        s_NumResolutions,
        m_iResolutionIndex,
        RES_COMBO_MAX_VISIBLE);
}

void SEASON3B::CNewUIOptionWindow::InitLanguageCombo()
{
    m_LanguageCombo.Setup(
        m_Pos.x + LANG_COMBO_X_LOCAL,
        m_Pos.y + LANG_COMBO_Y_LOCAL,
        LANG_COMBO_WIDTH,
        LANG_COMBO_HEIGHT,
        GetLanguageLabels(),
        s_NumLanguages,
        m_iLanguageIndex,
        LANG_COMBO_MAX_VISIBLE);
}

void SEASON3B::CNewUIOptionWindow::InitFontCombo()
{
    m_FontCombo.Setup(
        m_Pos.x + FONT_COMBO_X_LOCAL,
        m_Pos.y + FONT_COMBO_Y_LOCAL,
        FONT_COMBO_WIDTH,
        FONT_COMBO_HEIGHT,
        GetFontLabels(),
        s_NumFonts,
        m_iFontIndex,
        FONT_COMBO_MAX_VISIBLE);
}

void SEASON3B::CNewUIOptionWindow::InitFrameRateCombo()
{
    m_FrameRateCombo.Setup(
        m_Pos.x + FPS_COMBO_X_LOCAL,
        m_Pos.y + FPS_COMBO_Y_LOCAL,
        FPS_COMBO_WIDTH,
        FPS_COMBO_HEIGHT,
        GetFrameRateLabels(),
        s_NumFrameRates,
        m_iFrameRateIndex,
        FPS_COMBO_MAX_VISIBLE);
}

void SEASON3B::CNewUIOptionWindow::InitGamepadMappingCombos()
{
    m_GamepadActionCombo.Setup(
        m_Pos.x + MAPPING_COMBO_X_LOCAL,
        m_Pos.y + ACTION_COMBO_Y_LOCAL,
        MAPPING_COMBO_WIDTH,
        MAPPING_COMBO_HEIGHT,
        GetGamepadActionLabels(),
        static_cast<int>(Core::Input::RemappableGamepadAction::Count),
        m_iGamepadActionIndex,
        MAPPING_COMBO_MAX_VISIBLE);
    m_GamepadControlCombo.Setup(
        m_Pos.x + MAPPING_COMBO_X_LOCAL,
        m_Pos.y + CONTROL_COMBO_Y_LOCAL,
        MAPPING_COMBO_WIDTH,
        MAPPING_COMBO_HEIGHT,
        GetGamepadControlLabels(),
        static_cast<int>(Core::Input::GamepadControl::Count),
        m_iGamepadControlIndex,
        MAPPING_COMBO_MAX_VISIBLE);
}

void SEASON3B::CNewUIOptionWindow::SetButtonInfo()
{
    m_BtnClose.ChangeTextBackColor(RGBA(255, 255, 255, 0));
    m_BtnClose.ChangeButtonImgState(true, IMAGE_OPTION_BTN_CLOSE, true);
    m_BtnClose.ChangeButtonInfo(
        m_Pos.x + CLOSE_BUTTON_X_LOCAL,
        m_Pos.y + CLOSE_BUTTON_Y_LOCAL,
        CLOSE_BUTTON_WIDTH,
        CLOSE_BUTTON_HEIGHT);
    m_BtnClose.ChangeImgColor(BUTTON_STATE_UP, RGBA(255, 255, 255, 255));
    m_BtnClose.ChangeImgColor(BUTTON_STATE_DOWN, RGBA(255, 255, 255, 255));
}

void SEASON3B::CNewUIOptionWindow::Release()
{
    UnloadImages();

    if (m_pNewUIMng)
    {
        m_pNewUIMng->RemoveUIObj(this);
        m_pNewUIMng = NULL;
    }
}

void SEASON3B::CNewUIOptionWindow::SetPos(int x, int y)
{
    m_Pos.x = x;
    m_Pos.y = y;
    m_ResolutionCombo.SetPos(m_Pos.x + RES_COMBO_X_LOCAL, m_Pos.y + RES_COMBO_Y_LOCAL);
    m_LanguageCombo.SetPos(m_Pos.x + LANG_COMBO_X_LOCAL, m_Pos.y + LANG_COMBO_Y_LOCAL);
    m_FontCombo.SetPos(m_Pos.x + FONT_COMBO_X_LOCAL, m_Pos.y + FONT_COMBO_Y_LOCAL);
    m_FrameRateCombo.SetPos(m_Pos.x + FPS_COMBO_X_LOCAL, m_Pos.y + FPS_COMBO_Y_LOCAL);
    m_GamepadActionCombo.SetPos(m_Pos.x + MAPPING_COMBO_X_LOCAL, m_Pos.y + ACTION_COMBO_Y_LOCAL);
    m_GamepadControlCombo.SetPos(m_Pos.x + MAPPING_COMBO_X_LOCAL, m_Pos.y + CONTROL_COMBO_Y_LOCAL);
}

bool SEASON3B::CNewUIOptionWindow::UpdateMouseEvent()
{
    HandleFocusedAdjustment();
    RegisterFocusNodes();
    const bool result = ProcessMouseEvent();
    RememberCurrentFocus();
    return result;
}

SEASON3B::CNewUIComboBox* SEASON3B::CNewUIOptionWindow::FindOpenCombo()
{
    CNewUIComboBox* const combos[] = {
        &m_ResolutionCombo, &m_LanguageCombo, &m_FontCombo,
        &m_FrameRateCombo, &m_GamepadActionCombo, &m_GamepadControlCombo,
    };
    for (CNewUIComboBox* combo : combos)
    {
        if (combo->IsOpen())
            return combo;
    }
    return nullptr;
}

void SEASON3B::CNewUIOptionWindow::RegisterFocusNodes()
{
    if (m_bDisplayChangePending)
    {
        RegisterDisplayConfirmationFocusNodes();
        return;
    }

    if (CNewUIComboBox* openCombo = FindOpenCombo())
    {
        openCombo->RegisterFocusNodes();
        return;
    }

    CNewUIComboBox* const combos[] = {
        &m_ResolutionCombo, &m_LanguageCombo, &m_FontCombo,
        &m_FrameRateCombo, &m_GamepadActionCombo, &m_GamepadControlCombo,
    };
    for (CNewUIComboBox* combo : combos)
    {
        if (combo->IsFocusRestorePending())
        {
            combo->RegisterFocusNodes();
            return;
        }
    }
    RegisterStandardFocusNodes();
}

void SEASON3B::CNewUIOptionWindow::RegisterStandardFocusNodes()
{
    auto& navigator = Core::Input::FocusNavigator::Instance();
    if (m_uActiveAdjustmentFocusId != 0)
    {
        if (const OptionFocusTarget* target = FindFocusTarget(m_uActiveAdjustmentFocusId))
        {
            navigator.Register(this, m_uActiveAdjustmentFocusId,
                static_cast<float>(m_Pos.x + target->xLocal),
                static_cast<float>(m_Pos.y + target->yLocal),
                static_cast<float>(target->width), static_cast<float>(target->height));
        }
        return;
    }

    m_ResolutionCombo.RegisterFocusNodes();
    m_LanguageCombo.RegisterFocusNodes();
    m_FontCombo.RegisterFocusNodes();
    m_FrameRateCombo.RegisterFocusNodes();
    m_GamepadActionCombo.RegisterFocusNodes();
    m_GamepadControlCombo.RegisterFocusNodes();
    for (const OptionFocusTarget& target : StandardFocusTargets)
    {
        navigator.Register(this, FocusId(target.id),
            static_cast<float>(m_Pos.x + target.xLocal),
            static_cast<float>(m_Pos.y + target.yLocal),
            static_cast<float>(target.width), static_cast<float>(target.height));
    }
    navigator.Register(&m_BtnClose, 0,
        static_cast<float>(m_Pos.x + CLOSE_BUTTON_X_LOCAL),
        static_cast<float>(m_Pos.y + CLOSE_BUTTON_Y_LOCAL),
        static_cast<float>(CLOSE_BUTTON_WIDTH), static_cast<float>(CLOSE_BUTTON_HEIGHT));
}

void SEASON3B::CNewUIOptionWindow::RegisterDisplayConfirmationFocusNodes()
{
    auto& navigator = Core::Input::FocusNavigator::Instance();
    for (const OptionFocusTarget& target : DisplayConfirmationFocusTargets)
    {
        navigator.Register(this, FocusId(target.id),
            static_cast<float>(m_Pos.x + target.xLocal),
            static_cast<float>(m_Pos.y + target.yLocal),
            static_cast<float>(target.width), static_cast<float>(target.height));
    }
}

void SEASON3B::CNewUIOptionWindow::FocusOptionControl(std::uint32_t focusId)
{
    const OptionFocusTarget* target = FindFocusTarget(focusId);
    if (target == nullptr)
        return;
    Core::Input::FocusNavigator::Instance().SetCurrent(this, focusId);
    MouseX = m_Pos.x + target->xLocal + target->width / 2;
    MouseY = m_Pos.y + target->yLocal + target->height / 2;
    Core::Input::GamepadService::Instance().SetPointerPosition(
        static_cast<float>(MouseX), static_cast<float>(MouseY));
}

void SEASON3B::CNewUIOptionWindow::RememberCurrentFocus()
{
    if (m_uActiveAdjustmentFocusId != 0)
        return;
    const auto current = Core::Input::FocusNavigator::Instance().Current();
    if (current.has_value())
    {
        m_uPreviousFocusOwner = current->owner;
        m_uPreviousFocusId = current->id;
    }
}

void SEASON3B::CNewUIOptionWindow::HandleFocusedAdjustment()
{
    const bool decrease = SEASON3B::IsPress(VK_LEFT) || SEASON3B::IsRepeat(VK_LEFT)
        || SEASON3B::IsPress(VK_PRIOR) || SEASON3B::IsRepeat(VK_PRIOR);
    const bool increase = SEASON3B::IsPress(VK_RIGHT) || SEASON3B::IsRepeat(VK_RIGHT)
        || SEASON3B::IsPress(VK_NEXT) || SEASON3B::IsRepeat(VK_NEXT);
    if (m_bDisplayChangePending || FindOpenCombo() != nullptr || decrease == increase)
    {
        m_uActiveAdjustmentFocusId = 0;
        m_iHeldAdjustmentDirection = 0;
        m_uNextAdjustmentRepeatMs = 0;
        return;
    }

    const int direction = decrease ? -1 : 1;
    const bool pressed = SEASON3B::IsPress(VK_LEFT) || SEASON3B::IsPress(VK_RIGHT)
        || SEASON3B::IsPress(VK_PRIOR) || SEASON3B::IsPress(VK_NEXT);
    const std::uint64_t nowMs = SDL_GetTicks();
    bool apply = false;
    if (pressed || direction != m_iHeldAdjustmentDirection)
    {
        if (m_uPreviousFocusOwner != reinterpret_cast<std::uintptr_t>(this)
            || !IsAdjustableFocus(m_uPreviousFocusId))
            return;
        m_uActiveAdjustmentFocusId = m_uPreviousFocusId;
        m_iHeldAdjustmentDirection = direction;
        m_uNextAdjustmentRepeatMs = nowMs + ADJUSTMENT_INITIAL_REPEAT_MS;
        apply = true;
    }
    else if (m_uActiveAdjustmentFocusId != 0 && nowMs >= m_uNextAdjustmentRepeatMs)
    {
        m_uNextAdjustmentRepeatMs = nowMs + ADJUSTMENT_REPEAT_MS;
        apply = true;
    }
    if (!apply)
        return;

    int* value = nullptr;
    int minimum = 0;
    int maximum = 0;
    int step = 1;
    switch (static_cast<OptionFocusId>(m_uActiveAdjustmentFocusId))
    {
    case OptionFocusId::SoundVolume: value = &m_iVolumeLevel; maximum = MAX_VOLUME; break;
    case OptionFocusId::MusicVolume: value = &m_iMusicLevel; maximum = MAX_VOLUME; break;
    case OptionFocusId::RenderLevel: value = &m_iRenderLevel; maximum = static_cast<int>(RENDER_LEVEL_MAX); break;
    case OptionFocusId::StickDeadZone: value = &m_iStickDeadZonePercent; maximum = 40; break;
    case OptionFocusId::PointerSpeed: value = &m_iPointerSpeed; minimum = 100; maximum = 1000; step = 25; break;
    case OptionFocusId::HapticIntensity: value = &m_iHapticIntensity; maximum = 100; step = 5; break;
    case OptionFocusId::TriggerDeadZone: value = &m_iTriggerDeadZonePercent; maximum = 50; break;
    default: return;
    }
    const int previous = *value;
    *value = std::clamp(*value + direction * step, minimum, maximum);
    FocusOptionControl(m_uActiveAdjustmentFocusId);
    if (*value == previous)
        return;

    switch (static_cast<OptionFocusId>(m_uActiveAdjustmentFocusId))
    {
    case OptionFocusId::SoundVolume: OnSoundVolumeChanged(); break;
    case OptionFocusId::MusicVolume: OnMusicVolumeChanged(); break;
    case OptionFocusId::RenderLevel: PublishSettingHaptic(); break;
    case OptionFocusId::HapticIntensity: ApplyHapticSettings(); PublishSettingHaptic(); break;
    default: ApplyGamepadSettings(); PublishSettingHaptic(); break;
    }
}

bool SEASON3B::CNewUIOptionWindow::ProcessMouseEvent()
{
    if (m_bDisplayChangePending)
    {
        UpdateDisplayChangeMouseEvent();
        return false;
    }

    // A combo selects on mouse-PRESS and closes its dropdown there and then; the
    // mouse is still held. The Close button fires on RELEASE-over-button, so a
    // press on a dropdown row that happens to sit over Close would pick the item
    // AND, on the release, shut the window (feels like a fast double-click).
    // Once a combo has consumed a click we swallow the rest of that hold until the
    // button comes up, so the release can't fall through to Close.
    if (m_bSwallowClickHold)
    {
        if (!SEASON3B::IsRepeat(VK_LBUTTON))   // button released → hold is over
            m_bSwallowClickHold = false;
        return false;
    }

    // Combos are processed BEFORE the Close button (and the checkboxes/sliders):
    // an open dropdown overflows below the window and can overlap the Close button
    // and the windowed-mode checkbox, so handling combos first lets the dropdown
    // consume the click - picking an item never also closes the window or toggles
    // a control behind it.

    // Z-order matters: an OPEN dropdown is drawn on top, so it must win the click
    // over a closed combo whose field its list overlaps (e.g. the Font dropdown
    // extends down over the Language field). Process the open combo first, then
    // the closed ones - a fixed Resolution/Language/Font order would let the
    // closed combo underneath grab the click and open instead. Selecting an item
    // also sets m_bSwallowClickHold so the still-held press's release can't fall
    // through to the Close button or a checkbox behind the dropdown.
    struct ComboSlot { CNewUIComboBox* combo; int* index; void (CNewUIOptionWindow::*apply)(); };
    const ComboSlot slots[] = {
        { &m_ResolutionCombo, &m_iResolutionIndex, &CNewUIOptionWindow::ApplyResolution },
        { &m_LanguageCombo,   &m_iLanguageIndex,   &CNewUIOptionWindow::ApplyLanguage   },
        { &m_FontCombo,       &m_iFontIndex,       &CNewUIOptionWindow::ApplyFont        },
        { &m_FrameRateCombo,  &m_iFrameRateIndex,  &CNewUIOptionWindow::ApplyFrameRate   },
        { &m_GamepadActionCombo,  &m_iGamepadActionIndex,  &CNewUIOptionWindow::ApplyGamepadActionSelection  },
        { &m_GamepadControlCombo, &m_iGamepadControlIndex, &CNewUIOptionWindow::ApplyGamepadControlSelection },
    };
    for (int pass = 0; pass < 2; ++pass)   // pass 0 = open combo (on top), pass 1 = closed
    {
        for (const ComboSlot& s : slots)
        {
            const bool wasOpen = s.combo->IsOpen();
            if (wasOpen != (pass == 0))
                continue;
            if (s.combo->UpdateMouseEvent())
            {
                *s.index = s.combo->GetSelectedIndex();
                (this->*s.apply)();
                m_bSwallowClickHold = true;
                return false;
            }
            if (s.combo->IsMouseOverWidget())
                return false;
            // A press elsewhere closed this open dropdown (clicked outside, or
            // re-picked the current item): consume it and swallow the hold too.
            if (wasOpen && !s.combo->IsOpen() && SEASON3B::IsPress(VK_LBUTTON))
            {
                m_bSwallowClickHold = true;
                return false;
            }
        }
    }

    // Close button after the combos, so an open dropdown drawn over it wins the
    // click instead of closing the window.
    if (m_BtnClose.UpdateMouseEvent() == true)
    {
        g_pNewUISystem->Hide(SEASON3B::INTERFACE_OPTION);
        return false;
    }

    bool oldWindowedMode = m_bWindowedMode;
    HandleCheckboxInputs();

    if (m_bWindowedMode != oldWindowedMode)
        ApplyWindowModeToggle();

    if (HandleVolumeSlider(m_iVolumeLevel, SOUND_SLIDER_Y_LOCAL))
        OnSoundVolumeChanged();

    if (HandleVolumeSlider(m_iMusicLevel, MUSIC_SLIDER_Y_LOCAL))
        OnMusicVolumeChanged();

    HandleRenderLevelSlider();
    HandleAdvancedInputs();

    // Combo box already processed at the top. Just consume clicks inside the
    // option window itself so they don't fall through to the world.
    if (CheckMouseIn(m_Pos.x, m_Pos.y, WINDOW_WIDTH, WINDOW_HEIGHT))
        return false;

    return true;
}

void SEASON3B::CNewUIOptionWindow::HandleCheckboxInputs()
{
    struct Checkbox { int yLocal; bool* target; };
    const Checkbox boxes[] = {
        { AUTO_ATTACK_CHECK_Y_LOCAL, &m_bAutoAttack        },
        { WHISPER_SOUND_CHECK_Y_LOCAL, &m_bWhisperSound      },
        { SLIDE_HELP_CHECK_Y_LOCAL, &m_bSlideHelp         },
        { RENDER_ALL_EFFECTS_CHECK_Y_LOCAL, &m_bRenderAllEffects  },
        { WINDOWED_MODE_CHECK_Y_LOCAL, &m_bWindowedMode      },
    };

    if (!SEASON3B::IsPress(VK_LBUTTON))
        return;

    bool changed = false;
    for (const auto& cb : boxes)
    {
        if (CheckMouseIn(m_Pos.x + BASIC_CHECKBOX_X_LOCAL, m_Pos.y + cb.yLocal,
                         BASIC_CHECKBOX_SIZE, BASIC_CHECKBOX_SIZE))
        {
            *cb.target = !*cb.target;
            changed = true;
        }
    }

    if (changed)
        PublishSettingHaptic();
}

// Handles wheel + drag input on a volume slider track.
// Returns true if the level changed this frame.
bool SEASON3B::CNewUIOptionWindow::HandleVolumeSlider(int& level, int yOffset)
{
    if (!CheckMouseIn(m_Pos.x + SLIDER_X_LOCAL - SLIDER_HIT_PADDING,
                      m_Pos.y + yOffset,
                      SLIDER_WIDTH + SLIDER_HIT_PADDING,
                      SLIDER_HIT_HEIGHT))
    {
        return false;
    }

    const int oldValue = level;

    if (MouseWheel > 0)
    {
        MouseWheel = 0;
        level++;
    }
    else if (MouseWheel < 0)
    {
        MouseWheel = 0;
        level--;
    }

    if (SEASON3B::IsRepeat(VK_LBUTTON))
    {
        int x = MouseX - (m_Pos.x + SLIDER_X_LOCAL);
        if (x < 0)
            level = 0;
        else
            level = (int)(((float)MAX_VOLUME * x) / (float)SLIDER_WIDTH + 0.5f);
    }

    // Clamp once after all adjustments
    level = std::clamp(level, 0, MAX_VOLUME);

    return (level != oldValue);
}

bool SEASON3B::CNewUIOptionWindow::HandleIntegerSlider(
    int& value,
    int minimum,
    int maximum,
    int xLocal,
    int yLocal,
    int width,
    int wheelStep)
{
    if (!CheckMouseIn(m_Pos.x + xLocal - SLIDER_HIT_PADDING,
                      m_Pos.y + yLocal,
                      width + SLIDER_HIT_PADDING,
                      SLIDER_HIT_HEIGHT))
    {
        return false;
    }

    const int oldValue = value;
    if (MouseWheel > 0)
    {
        MouseWheel = 0;
        value += wheelStep;
    }
    else if (MouseWheel < 0)
    {
        MouseWheel = 0;
        value -= wheelStep;
    }

    if (SEASON3B::IsRepeat(VK_LBUTTON))
    {
        const int mouseOffset = MouseX - (m_Pos.x + xLocal);
        const double fraction = std::clamp(mouseOffset / static_cast<double>(width), 0.0, 1.0);
        value = static_cast<int>(std::lround(minimum + fraction * (maximum - minimum)));
    }

    value = std::clamp(value, minimum, maximum);
    return value != oldValue;
}

void SEASON3B::CNewUIOptionWindow::HandleAdvancedInputs()
{
    bool frameSettingsChanged = false;
    bool gamepadSettingsChanged = false;
    bool hapticSettingsChanged = false;

    if (SEASON3B::IsPress(VK_LBUTTON))
    {
        struct Checkbox
        {
            int yLocal;
            bool* target;
            bool* changed;
        };
        const Checkbox boxes[] = {
            { VSYNC_CHECK_Y_LOCAL, &m_bVSync, &frameSettingsChanged },
            { GAMEPAD_CHECK_Y_LOCAL, &m_bGamepadEnabled, &gamepadSettingsChanged },
            { HAPTICS_CHECK_Y_LOCAL, &m_bHapticsEnabled, &hapticSettingsChanged },
            { COMBAT_HAPTICS_CHECK_Y_LOCAL, &m_bCombatHaptics, &hapticSettingsChanged },
            { UI_HAPTICS_CHECK_Y_LOCAL, &m_bUIHaptics, &hapticSettingsChanged },
            { TRANSACTION_HAPTICS_CHECK_Y_LOCAL, &m_bTransactionHaptics, &hapticSettingsChanged },
        };

        for (const Checkbox& checkbox : boxes)
        {
            if (!CheckMouseIn(
                    m_Pos.x + ADVANCED_CHECKBOX_X_LOCAL,
                    m_Pos.y + checkbox.yLocal,
                    ADVANCED_CHECKBOX_SIZE,
                    ADVANCED_CHECKBOX_SIZE))
            {
                continue;
            }

            *checkbox.target = !*checkbox.target;
            *checkbox.changed = true;
        }

        if (CheckMouseIn(
                m_Pos.x + MAPPING_CHECKBOX_X_LOCAL,
                m_Pos.y + INVERT_POINTER_CHECK_Y_LOCAL,
                ADVANCED_CHECKBOX_SIZE,
                ADVANCED_CHECKBOX_SIZE))
        {
            m_bInvertPointerY = !m_bInvertPointerY;
            gamepadSettingsChanged = true;
        }

        if (CheckMouseIn(
                m_Pos.x + RESET_BINDINGS_X_LOCAL,
                m_Pos.y + RESET_BINDINGS_Y_LOCAL,
                RESET_BINDINGS_WIDTH,
                RESET_BINDINGS_HEIGHT))
        {
            ResetGamepadBindings();
        }

        const double nowMs = static_cast<double>(SDL_GetTicks());
        if (CheckMouseIn(
                m_Pos.x + SHORT_TEST_X_LOCAL,
                m_Pos.y + TEST_BUTTON_Y_LOCAL,
                TEST_BUTTON_WIDTH,
                TEST_BUTTON_HEIGHT))
        {
            Core::Input::GamepadService::Instance().PublishHaptic(
                Core::Haptics::HapticEvent::ShortTest, nowMs);
        }
        else if (CheckMouseIn(
                     m_Pos.x + LONG_TEST_X_LOCAL,
                     m_Pos.y + TEST_BUTTON_Y_LOCAL,
                     TEST_BUTTON_WIDTH,
                     TEST_BUTTON_HEIGHT))
        {
            Core::Input::GamepadService::Instance().PublishHaptic(
                Core::Haptics::HapticEvent::LongTest, nowMs);
        }
    }

    gamepadSettingsChanged |= HandleIntegerSlider(
        m_iStickDeadZonePercent, 0, 40,
        ADVANCED_SLIDER_X_LOCAL, DEAD_ZONE_SLIDER_Y_LOCAL,
        ADVANCED_SLIDER_WIDTH, 1);
    gamepadSettingsChanged |= HandleIntegerSlider(
        m_iPointerSpeed, 100, 1000,
        ADVANCED_SLIDER_X_LOCAL, POINTER_SPEED_SLIDER_Y_LOCAL,
        ADVANCED_SLIDER_WIDTH, 25);
    gamepadSettingsChanged |= HandleIntegerSlider(
        m_iTriggerDeadZonePercent, 0, 50,
        MAPPING_X_LOCAL + 33, TRIGGER_DEAD_ZONE_SLIDER_Y_LOCAL,
        ADVANCED_SLIDER_WIDTH, 1);
    hapticSettingsChanged |= HandleIntegerSlider(
        m_iHapticIntensity, 0, 100,
        ADVANCED_SLIDER_X_LOCAL, HAPTIC_INTENSITY_SLIDER_Y_LOCAL,
        ADVANCED_SLIDER_WIDTH, 5);

    if (frameSettingsChanged)
    {
        auto settings = GameConfig::GetInstance().GetFrameTimingSettings();
        settings.verticalSync = m_bVSync;
        GameConfig::GetInstance().SetFrameTimingSettings(settings);
        GameConfig::GetInstance().Save();
        ApplyFrameTimingConfiguration();
        PublishSettingHaptic();
    }
    if (gamepadSettingsChanged)
    {
        ApplyGamepadSettings();
        PublishSettingHaptic();
    }
    if (hapticSettingsChanged)
    {
        ApplyHapticSettings();
        PublishSettingHaptic();
    }
}

void SEASON3B::CNewUIOptionWindow::OnSoundVolumeChanged()
{
    m_SoundOnOff = (m_iVolumeLevel > 0) ? 1 : 0;
    SetEffectVolumeLevel(m_iVolumeLevel);
    GameConfig::GetInstance().SetSoundVolume(m_iVolumeLevel);
    GameConfig::GetInstance().Save();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::OnMusicVolumeChanged()
{
    // Mute via volume only — do not stop the stream.  Once stopped, the
    // current track is gone and raising the slider back up leaves silence
    // until the next scene change triggers PlayMp3 for a different track.
    // Keeping the track alive at gain 0 means raising the slider becomes
    // audible immediately.
    m_MusicOnOff = (m_iMusicLevel > 0) ? 1 : 0;

    AudioPlayer::SetMusicVolume(m_iMusicLevel);

    GameConfig::GetInstance().SetMusicVolume(m_iMusicLevel);
    GameConfig::GetInstance().Save();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::HandleRenderLevelSlider()
{
    if (!CheckMouseIn(m_Pos.x + RENDER_SLIDER_X_LOCAL, m_Pos.y + RENDER_SLIDER_Y_LOCAL,
                      RENDER_SLIDER_WIDTH, RENDER_SLIDER_HEIGHT))
        return;

    if (!SEASON3B::IsRepeat(VK_LBUTTON))
        return;

    const int oldLevel = m_iRenderLevel;
    int x = MouseX - (m_Pos.x + RENDER_SLIDER_X_LOCAL);
    m_iRenderLevel = std::clamp(
        (int)((RENDER_LEVEL_MAX * x) / (float)RENDER_SLIDER_WIDTH + 0.5f),
        0,
        static_cast<int>(RENDER_LEVEL_MAX));
    if (m_iRenderLevel != oldLevel)
        PublishSettingHaptic();
}


bool SEASON3B::CNewUIOptionWindow::UpdateKeyEvent()
{
    if (g_pNewUISystem->IsVisible(SEASON3B::INTERFACE_OPTION) == true)
    {
        if (m_bDisplayChangePending)
        {
            if (SEASON3B::IsPress(VK_RETURN))
                AcceptDisplayChange();
            else if (SEASON3B::IsPress(VK_ESCAPE))
                RevertDisplayChange();
            return false;
        }

        if (SEASON3B::IsPress(VK_ESCAPE) == true)
        {
            if (CNewUIComboBox* openCombo = FindOpenCombo())
            {
                openCombo->CloseAndRestoreFocus();
                m_bSwallowClickHold = false;
                return false;
            }
            g_pNewUISystem->Hide(SEASON3B::INTERFACE_OPTION);
            PlayBuffer(SOUND_CLICK01);
            return false;
        }
    }

    return true;
}

bool SEASON3B::CNewUIOptionWindow::Update()
{
    UpdateDisplayChange();
    return true;
}

bool SEASON3B::CNewUIOptionWindow::Render()
{
    EnableAlphaTest();
    glColor4f(1.0f, 1.0f, 1.0f, 1.0f);
    RenderFrame();
    RenderContents();
    RenderButtons();
    RenderDisplayChangeConfirmation();
    DisableAlphaBlend();
    return true;
}

float SEASON3B::CNewUIOptionWindow::GetLayerDepth()	//. 10.5f
{
    return 10.5f;
}

float SEASON3B::CNewUIOptionWindow::GetKeyEventOrder()	// 10.f;
{
    return 10.0f;
}

void SEASON3B::CNewUIOptionWindow::OpenningProcess()
{
    // Resync state that may have been changed externally while the window was hidden.
    m_bSwallowClickHold = false;   // drop any stale combo click-swallow latch
    m_uPreviousFocusOwner = 0;
    m_uPreviousFocusId = 0;
    m_uActiveAdjustmentFocusId = 0;
    m_iHeldAdjustmentDirection = 0;
    m_uNextAdjustmentRepeatMs = 0;
    m_iResolutionIndex = FindCurrentResolutionIndex();
    m_ResolutionCombo.SetSelectedIndex(m_iResolutionIndex);
    m_ResolutionCombo.Close();
    m_iLanguageIndex = FindCurrentLanguageIndex();
    m_LanguageCombo.SetSelectedIndex(m_iLanguageIndex);
    m_LanguageCombo.Close();
    m_iFontIndex = FindCurrentFontIndex();
    m_FontCombo.SetSelectedIndex(m_iFontIndex);
    m_FontCombo.Close();
    m_iFrameRateIndex = FindCurrentFrameRateIndex();
    m_FrameRateCombo.SetSelectedIndex(m_iFrameRateIndex);
    m_FrameRateCombo.Close();
    m_bWindowedMode = (g_bUseWindowMode == TRUE);

    const auto& frameSettings = GameConfig::GetInstance().GetFrameTimingSettings();
    m_bVSync = frameSettings.verticalSync;
    const auto& gamepadSettings = GameConfig::GetInstance().GetGamepadSettings();
    m_bGamepadEnabled = gamepadSettings.enabled;
    m_iStickDeadZonePercent = static_cast<int>(gamepadSettings.stickDeadZone * 100.0f + 0.5f);
    m_iTriggerDeadZonePercent = static_cast<int>(gamepadSettings.triggerDeadZone * 100.0f + 0.5f);
    m_iPointerSpeed = static_cast<int>(gamepadSettings.pointerSpeed + 0.5f);
    m_bInvertPointerY = gamepadSettings.invertPointerY;
    if (m_iGamepadActionIndex < 0
        || m_iGamepadActionIndex >= static_cast<int>(Core::Input::RemappableGamepadAction::Count))
    {
        m_iGamepadActionIndex = 0;
    }
    m_iGamepadControlIndex = static_cast<int>(
        gamepadSettings.bindings[static_cast<std::size_t>(m_iGamepadActionIndex)]);
    InitGamepadMappingCombos();
    const auto& hapticSettings = GameConfig::GetInstance().GetHapticSettings();
    m_bHapticsEnabled = hapticSettings.enabled;
    m_iHapticIntensity = hapticSettings.intensityPercent;
    m_bCombatHaptics = hapticSettings.combatEnabled;
    m_bUIHaptics = hapticSettings.uiEnabled;
    m_bTransactionHaptics = hapticSettings.transactionEnabled;
}

void SEASON3B::CNewUIOptionWindow::ClosingProcess()
{
    if (m_bDisplayChangePending)
        RevertDisplayChange();

    m_ResolutionCombo.Close();
    m_LanguageCombo.Close();
    m_FontCombo.Close();
    m_FrameRateCombo.Close();
    m_GamepadActionCombo.Close();
    m_GamepadControlCombo.Close();
    m_uPreviousFocusOwner = 0;
    m_uPreviousFocusId = 0;
    m_uActiveAdjustmentFocusId = 0;
    m_iHeldAdjustmentDirection = 0;
    m_uNextAdjustmentRepeatMs = 0;
}

void SEASON3B::CNewUIOptionWindow::LoadImages()
{
    LoadBitmap(L"Interface\\newui_button_close.tga", IMAGE_OPTION_BTN_CLOSE, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_msgbox_back.jpg", IMAGE_OPTION_FRAME_BACK, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_item_back03.tga", IMAGE_OPTION_FRAME_DOWN, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_top.tga", IMAGE_OPTION_FRAME_UP, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_back06(L).tga", IMAGE_OPTION_FRAME_LEFT, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_back06(R).tga", IMAGE_OPTION_FRAME_RIGHT, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_line.jpg", IMAGE_OPTION_LINE, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_point.tga", IMAGE_OPTION_POINT, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_check.tga", IMAGE_OPTION_BTN_CHECK, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_effect03.tga", IMAGE_OPTION_EFFECT_BACK, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_effect04.tga", IMAGE_OPTION_EFFECT_COLOR, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_volume01.tga", IMAGE_OPTION_VOLUME_BACK, GL_LINEAR);
    LoadBitmap(L"Interface\\newui_option_volume02.tga", IMAGE_OPTION_VOLUME_COLOR, GL_LINEAR);
}

void SEASON3B::CNewUIOptionWindow::UnloadImages()
{
    DeleteBitmap(IMAGE_OPTION_BTN_CLOSE);
    DeleteBitmap(IMAGE_OPTION_FRAME_BACK);
    DeleteBitmap(IMAGE_OPTION_FRAME_DOWN);
    DeleteBitmap(IMAGE_OPTION_FRAME_UP);
    DeleteBitmap(IMAGE_OPTION_FRAME_LEFT);
    DeleteBitmap(IMAGE_OPTION_FRAME_RIGHT);
    DeleteBitmap(IMAGE_OPTION_LINE);
    DeleteBitmap(IMAGE_OPTION_POINT);
    DeleteBitmap(IMAGE_OPTION_BTN_CHECK);
    DeleteBitmap(IMAGE_OPTION_EFFECT_BACK);
    DeleteBitmap(IMAGE_OPTION_EFFECT_COLOR);
    DeleteBitmap(IMAGE_OPTION_VOLUME_BACK);
    DeleteBitmap(IMAGE_OPTION_VOLUME_COLOR);
}

void SEASON3B::CNewUIOptionWindow::RenderFrame()
{
    // All columns use the original option-window texture grammar. Keeping the
    // advanced controls in sibling panels avoids squeezing translated labels
    // into the legacy 190-pixel column.
    constexpr int SLAT_COUNT = 35;
    const auto drawPanel = [this](float x)
    {
        float y = static_cast<float>(m_Pos.y);
        RenderImage(IMAGE_OPTION_FRAME_BACK, x, y, WINDOW_PANEL_WIDTH, WINDOW_HEIGHT);
        RenderImage(IMAGE_OPTION_FRAME_UP, x, y, WINDOW_PANEL_WIDTH, 64.f);
        y += 64.f;
        for (int i = 0; i < SLAT_COUNT; ++i)
        {
            RenderImage(IMAGE_OPTION_FRAME_LEFT, x, y, 21.f, 10.f);
            RenderImage(IMAGE_OPTION_FRAME_RIGHT, x + WINDOW_PANEL_WIDTH - 21, y, 21.f, 10.f);
            y += 10.f;
        }
        RenderImage(IMAGE_OPTION_FRAME_DOWN, x, y, WINDOW_PANEL_WIDTH, 45.f);
    };

    const float x = static_cast<float>(m_Pos.x);
    drawPanel(x);
    drawPanel(x + ADVANCED_X_LOCAL);
    drawPanel(x + MAPPING_X_LOCAL);

    float y = m_Pos.y + 60.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after auto attack
    y += 22.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after whisper

    y = m_Pos.y + 150.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after music vol

    y += 22.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after slide help

    y += 39.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after render level

    y += 25.f;
    RenderImage(IMAGE_OPTION_LINE, x + 18, y, 154.f, 2.f);     // after render full effects

    const float advancedX = x + ADVANCED_X_LOCAL;
    RenderImage(IMAGE_OPTION_LINE, advancedX + 18, m_Pos.y + 174.f, 154.f, 2.f);
    RenderImage(IMAGE_OPTION_LINE, advancedX + 18, m_Pos.y + 280.f, 154.f, 2.f);

    const float mappingX = x + MAPPING_X_LOCAL;
    RenderImage(IMAGE_OPTION_LINE, mappingX + 18, m_Pos.y + 197.f, 154.f, 2.f);
    RenderImage(IMAGE_OPTION_LINE, mappingX + 18, m_Pos.y + 409.f, 154.f, 2.f);
}

void SEASON3B::CNewUIOptionWindow::RenderContents()
{
    float x, y;
    x = m_Pos.x + 20.f;
    y = m_Pos.y + 46.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Auto Attack
    y += 22.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Whisper Sound
    y += 22.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Sound Volume
    y += 28.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Music Volume
    y += 40.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Slide Help
    y += 22.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Render Level

    y += 39.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Render Full Effects

    g_pRenderText->SetFont(g_hFont);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->SetBgColor(0);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 48, I18N::Game::AutomaticAttack);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 70, I18N::Game::BeepSoundForWhispering);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 92, I18N::Game::SoundVolume);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 120, I18N::Game::MusicVolume);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 160, I18N::Game::SlideHelp);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 182, I18N::Game::EffectLimitation);
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 221, I18N::Game::RenderFullEffects);

    y += 25.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Font
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + FONT_LABEL_Y_LOCAL, I18N::Game::Font);

    y += 39.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Language
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + LANG_LABEL_Y_LOCAL, I18N::Game::Language);

    y += 39.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Resolution
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 322, I18N::Game::Resolution);

    y += 39.f;
    RenderImage(IMAGE_OPTION_POINT, x, y, 10.f, 10.f);       // Windowed Mode
    g_pRenderText->RenderText(m_Pos.x + 40, m_Pos.y + 361, I18N::Game::WindowedMode);

    const int advancedX = m_Pos.x + ADVANCED_X_LOCAL;
    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        advancedX, m_Pos.y + 34, I18N::Game::FrameRate,
        WINDOW_PANEL_WIDTH, 0, RT3_SORT_CENTER);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 82, I18N::Game::VerticalSync);

    const auto& policy = GetEffectiveFramePolicy();
    const FrameStatisticsSnapshot statistics = GetFrameStatistics();
    struct DiagnosticRow
    {
        const wchar_t* label;
        double value;
    };
    const DiagnosticRow rows[] = {
        { I18N::Game::RequestedFrameRate, policy.requestedFrameRate },
        { I18N::Game::EffectiveFrameRate, policy.effectiveFrameRate },
        { I18N::Game::DisplayRefreshRate, policy.displayRefreshRate.hertz },
        { I18N::Game::ActualFrameRate, statistics.actualFps },
        { I18N::Game::AverageFrameRate, statistics.averageFps },
        { I18N::Game::OnePercentLow, statistics.onePercentLowFps },
    };
    int diagnosticY = m_Pos.y + 98;
    wchar_t valueText[32] = {};
    for (const DiagnosticRow& row : rows)
    {
        g_pRenderText->SetTextColor(205, 205, 205, 255);
        g_pRenderText->RenderText(advancedX + 20, diagnosticY, row.label, 102, 0, RT3_SORT_LEFT);
        std::swprintf(valueText, sizeof(valueText) / sizeof(valueText[0]), L"%.2f", row.value);
        g_pRenderText->SetTextColor(255, 255, 255, 255);
        g_pRenderText->RenderText(advancedX + 120, diagnosticY, valueText, 50, 0, RT3_SORT_RIGHT);
        diagnosticY += 11;
    }

    const bool performanceOrExternalLimit =
        statistics.sampleCount >= MIN_PERFORMANCE_DIAGNOSTIC_SAMPLES
        && statistics.averageFps > 0.0
        && statistics.averageFps < policy.effectiveFrameRate * PERFORMANCE_DIAGNOSTIC_RATIO;
    const wchar_t* reason = performanceOrExternalLimit
        ? I18N::Game::FrameLimitPerformanceOrExternal
        : I18N::Game::FrameLimitFrameLimiter;
    if (!performanceOrExternalLimit)
    {
        switch (policy.reason)
        {
        case Core::Time::FrameLimitReason::VerticalSync:
            reason = I18N::Game::FrameLimitVerticalSync;
            break;
        case Core::Time::FrameLimitReason::DisplayRefreshFallback:
            reason = I18N::Game::FrameLimitDisplayFallback;
            break;
        case Core::Time::FrameLimitReason::Background:
            reason = I18N::Game::FrameLimitBackground;
            break;
        default:
            if (Core::Time::HasUnevenVSyncCadence(policy))
                reason = I18N::Game::FrameLimitUnevenVSync;
            break;
        }
    }
    g_pRenderText->SetTextColor(205, 205, 205, 255);
    g_pRenderText->RenderText(advancedX + 20, diagnosticY, I18N::Game::LimitReason, 42, 0, RT3_SORT_LEFT);
    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(advancedX + 62, diagnosticY, reason, 108, 0, RT3_SORT_RIGHT);

    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        advancedX, m_Pos.y + 180, I18N::Game::Gamepad,
        WINDOW_PANEL_WIDTH, 0, RT3_SORT_CENTER);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 199, I18N::Game::GamepadEnabled);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 214, I18N::Game::StickDeadZone);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 246, I18N::Game::PointerSpeed);

    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        advancedX, m_Pos.y + 286, I18N::Game::Haptics,
        WINDOW_PANEL_WIDTH, 0, RT3_SORT_CENTER);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 309, I18N::Game::Haptics);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 324, I18N::Game::HapticIntensity);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 359, I18N::Game::CombatHaptics);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 377, I18N::Game::UIHaptics);
    g_pRenderText->RenderText(advancedX + 40, m_Pos.y + 395, I18N::Game::TransactionHaptics);

    if (Core::Input::GamepadService::Instance().IsConnected()
        && !Core::Input::GamepadService::Instance().SupportsRumble())
    {
        g_pRenderText->SetTextColor(255, 120, 100, 255);
        g_pRenderText->RenderText(
            advancedX + 20, m_Pos.y + 436, I18N::Game::RumbleUnsupported,
            150, 0, RT3_SORT_CENTER);
    }

    const int mappingX = m_Pos.x + MAPPING_X_LOCAL;
    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        mappingX, m_Pos.y + 34,
        I18N::Game::ControllerMapping,
        WINDOW_PANEL_WIDTH, 0, RT3_SORT_CENTER);
    g_pRenderText->SetTextColor(205, 205, 205, 255);
    g_pRenderText->RenderText(
        mappingX + 20, m_Pos.y + 50,
        GetGamepadFamilyLabel(Core::Input::GamepadService::Instance().GetIconFamily()),
        150, 0, RT3_SORT_CENTER);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(
        mappingX + 22, m_Pos.y + 70,
        I18N::Game::GamepadAction);
    g_pRenderText->RenderText(
        mappingX + 22, m_Pos.y + 106,
        I18N::Game::PhysicalControl);
    g_pRenderText->RenderText(
        mappingX + 22, m_Pos.y + 144,
        I18N::Game::TriggerDeadZone);
    g_pRenderText->RenderText(
        mappingX + 22, m_Pos.y + 184,
        I18N::Game::InvertPointerY);
    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        mappingX, m_Pos.y + 199,
        I18N::Game::CurrentMapping,
        WINDOW_PANEL_WIDTH, 0, RT3_SORT_CENTER);

    const auto& bindings = GameConfig::GetInstance().GetGamepadSettings().bindings;
    const wchar_t* const* actionLabels = GetGamepadActionLabels();
    for (std::size_t index = 0; index < bindings.size(); ++index)
    {
        const int rowY = m_Pos.y + MAPPING_SUMMARY_Y_LOCAL
            + static_cast<int>(index) * MAPPING_SUMMARY_ROW_HEIGHT;
        g_pRenderText->SetTextColor(220, 220, 220, 255);
        g_pRenderText->RenderText(mappingX + 12, rowY, actionLabels[index], 105, 0, RT3_SORT_LEFT);
        g_pRenderText->SetTextColor(255, 255, 255, 255);
        g_pRenderText->RenderText(
            mappingX + 117, rowY,
            Core::Input::GamepadControlConfigName(bindings[index]),
            61, 0, RT3_SORT_RIGHT);
    }
}

void SEASON3B::CNewUIOptionWindow::RenderButtons()
{
    m_BtnClose.Render();

    if (m_bAutoAttack)
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 43, 15, 15, 0, 0);
    }
    else
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 43, 15, 15, 0, 15.f);
    }

    if (m_bWhisperSound)
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 65, 15, 15, 0, 0);
    }
    else
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 65, 15, 15, 0, 15.f);
    }

    if (m_bSlideHelp)
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 155, 15, 15, 0, 0);
    }
    else
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 155, 15, 15, 0, 15.f);
    }

    RenderImage(IMAGE_OPTION_VOLUME_BACK, m_Pos.x + 33, m_Pos.y + 104, 124.f, 16.f);
    if (m_iVolumeLevel > 0)
    {
        RenderImage(IMAGE_OPTION_VOLUME_COLOR, m_Pos.x + 33, m_Pos.y + 104, 124.f * 0.1f * (m_iVolumeLevel), 16.f);
    }

    // Music volume bar
    RenderImage(IMAGE_OPTION_VOLUME_BACK, m_Pos.x + 33, m_Pos.y + 132, 124.f, 16.f);
    if (m_iMusicLevel > 0)
    {
        RenderImage(IMAGE_OPTION_VOLUME_COLOR, m_Pos.x + 33, m_Pos.y + 132, 124.f * 0.1f * (m_iMusicLevel), 16.f);
    }

    RenderImageStretch(IMAGE_OPTION_EFFECT_BACK, m_Pos.x + RENDER_SLIDER_X_LOCAL, m_Pos.y + RENDER_SLIDER_Y_LOCAL,
                       (float)RENDER_SLIDER_WIDTH, (float)RENDER_SLIDER_HEIGHT,
                       0.f, 0.f, (float)EFFECT_BAR_SRC_WIDTH, (float)EFFECT_BAR_SRC_HEIGHT);
    if (m_iRenderLevel >= 0)
    {
        // Reveal proportionally to the level: shrink both the dest width and the
        // sampled source width by the same fraction so the squares stay aligned.
        const float fill = 0.2f * (m_iRenderLevel + 1);
        RenderImageStretch(IMAGE_OPTION_EFFECT_COLOR, m_Pos.x + RENDER_SLIDER_X_LOCAL, m_Pos.y + RENDER_SLIDER_Y_LOCAL,
                           (float)RENDER_SLIDER_WIDTH * fill, (float)RENDER_SLIDER_HEIGHT,
                           0.f, 0.f, (float)EFFECT_BAR_SRC_WIDTH * fill, (float)EFFECT_BAR_SRC_HEIGHT);
    }

    if (m_bRenderAllEffects)
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 217, 15, 15, 0, 0);
    }
    else
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 217, 15, 15, 0, 15.f);
    }

    if (m_bWindowedMode)
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 356, 15, 15, 0, 0);
    }
    else
    {
        RenderImage(IMAGE_OPTION_BTN_CHECK, m_Pos.x + 150, m_Pos.y + 356, 15, 15, 0, 15.f);
    }

    const auto renderAdvancedCheckbox = [this](bool checked, int yLocal)
    {
        RenderImage(
            IMAGE_OPTION_BTN_CHECK,
            m_Pos.x + ADVANCED_CHECKBOX_X_LOCAL,
            m_Pos.y + yLocal,
            ADVANCED_CHECKBOX_SIZE,
            ADVANCED_CHECKBOX_SIZE,
            0,
            checked ? 0.0f : 15.0f);
    };
    renderAdvancedCheckbox(m_bVSync, VSYNC_CHECK_Y_LOCAL);
    renderAdvancedCheckbox(m_bGamepadEnabled, GAMEPAD_CHECK_Y_LOCAL);
    renderAdvancedCheckbox(m_bHapticsEnabled, HAPTICS_CHECK_Y_LOCAL);
    renderAdvancedCheckbox(m_bCombatHaptics, COMBAT_HAPTICS_CHECK_Y_LOCAL);
    renderAdvancedCheckbox(m_bUIHaptics, UI_HAPTICS_CHECK_Y_LOCAL);
    renderAdvancedCheckbox(m_bTransactionHaptics, TRANSACTION_HAPTICS_CHECK_Y_LOCAL);
    RenderImage(
        IMAGE_OPTION_BTN_CHECK,
        m_Pos.x + MAPPING_CHECKBOX_X_LOCAL,
        m_Pos.y + INVERT_POINTER_CHECK_Y_LOCAL,
        ADVANCED_CHECKBOX_SIZE,
        ADVANCED_CHECKBOX_SIZE,
        0,
        m_bInvertPointerY ? 0.0f : 15.0f);

    const auto renderAdvancedSlider = [this](int value, int minimum, int maximum, int yLocal)
    {
        const float fraction = static_cast<float>(value - minimum) / static_cast<float>(maximum - minimum);
        RenderImage(
            IMAGE_OPTION_VOLUME_BACK,
            m_Pos.x + ADVANCED_SLIDER_X_LOCAL,
            m_Pos.y + yLocal,
            ADVANCED_SLIDER_WIDTH,
            16.f);
        if (fraction > 0.0f)
        {
            RenderImage(
                IMAGE_OPTION_VOLUME_COLOR,
                m_Pos.x + ADVANCED_SLIDER_X_LOCAL,
                m_Pos.y + yLocal,
                ADVANCED_SLIDER_WIDTH * fraction,
                16.f);
        }

        wchar_t text[24] = {};
        std::swprintf(text, sizeof(text) / sizeof(text[0]), L"%d", value);
        g_pRenderText->SetTextColor(255, 255, 255, 255);
        g_pRenderText->RenderText(
            m_Pos.x + ADVANCED_SLIDER_X_LOCAL,
            m_Pos.y + yLocal + 2,
            text,
            ADVANCED_SLIDER_WIDTH,
            0,
            RT3_SORT_CENTER);
    };
    renderAdvancedSlider(m_iStickDeadZonePercent, 0, 40, DEAD_ZONE_SLIDER_Y_LOCAL);
    renderAdvancedSlider(m_iPointerSpeed, 100, 1000, POINTER_SPEED_SLIDER_Y_LOCAL);
    renderAdvancedSlider(m_iHapticIntensity, 0, 100, HAPTIC_INTENSITY_SLIDER_Y_LOCAL);

    const auto renderMappingSlider = [this](int value, int minimum, int maximum, int yLocal)
    {
        const float fraction = static_cast<float>(value - minimum) / static_cast<float>(maximum - minimum);
        RenderImage(
            IMAGE_OPTION_VOLUME_BACK,
            m_Pos.x + MAPPING_X_LOCAL + 33,
            m_Pos.y + yLocal,
            ADVANCED_SLIDER_WIDTH,
            16.f);
        if (fraction > 0.0f)
        {
            RenderImage(
                IMAGE_OPTION_VOLUME_COLOR,
                m_Pos.x + MAPPING_X_LOCAL + 33,
                m_Pos.y + yLocal,
                ADVANCED_SLIDER_WIDTH * fraction,
                16.f);
        }
        wchar_t text[24] = {};
        std::swprintf(text, sizeof(text) / sizeof(text[0]), L"%d%%", value);
        g_pRenderText->SetTextColor(255, 255, 255, 255);
        g_pRenderText->RenderText(
            m_Pos.x + MAPPING_X_LOCAL + 33,
            m_Pos.y + yLocal + 2,
            text,
            ADVANCED_SLIDER_WIDTH,
            0,
            RT3_SORT_CENTER);
    };
    renderMappingSlider(m_iTriggerDeadZonePercent, 0, 50, TRIGGER_DEAD_ZONE_SLIDER_Y_LOCAL);

    RenderImage(
        IMAGE_OPTION_VOLUME_BACK,
        m_Pos.x + SHORT_TEST_X_LOCAL,
        m_Pos.y + TEST_BUTTON_Y_LOCAL,
        TEST_BUTTON_WIDTH,
        TEST_BUTTON_HEIGHT);
    RenderImage(
        IMAGE_OPTION_VOLUME_BACK,
        m_Pos.x + LONG_TEST_X_LOCAL,
        m_Pos.y + TEST_BUTTON_Y_LOCAL,
        TEST_BUTTON_WIDTH,
        TEST_BUTTON_HEIGHT);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(
        m_Pos.x + SHORT_TEST_X_LOCAL,
        m_Pos.y + TEST_BUTTON_Y_LOCAL + 2,
        I18N::Game::ShortRumbleTest,
        TEST_BUTTON_WIDTH,
        0,
        RT3_SORT_CENTER);
    g_pRenderText->RenderText(
        m_Pos.x + LONG_TEST_X_LOCAL,
        m_Pos.y + TEST_BUTTON_Y_LOCAL + 2,
        I18N::Game::LongRumbleTest,
        TEST_BUTTON_WIDTH,
        0,
        RT3_SORT_CENTER);

    RenderImage(
        IMAGE_OPTION_VOLUME_BACK,
        m_Pos.x + RESET_BINDINGS_X_LOCAL,
        m_Pos.y + RESET_BINDINGS_Y_LOCAL,
        RESET_BINDINGS_WIDTH,
        RESET_BINDINGS_HEIGHT);
    g_pRenderText->SetTextColor(255, 255, 255, 255);
    g_pRenderText->RenderText(
        m_Pos.x + RESET_BINDINGS_X_LOCAL,
        m_Pos.y + RESET_BINDINGS_Y_LOCAL + 2,
        I18N::Game::RestoreDefaultMapping,
        RESET_BINDINGS_WIDTH,
        0,
        RT3_SORT_CENTER);

    // Combo boxes drawn last so their expanded dropdowns sit on top of
    // anything else in the window. Within the combo pair, render the
    // closed one(s) first and any open dropdown last - otherwise a combo
    // physically below an open one would draw its closed field on top of
    // that open dropdown's list (since they overlap in screen space when
    // the upper one expands downward).
    CNewUIComboBox* combos[] = {
        &m_ResolutionCombo,
        &m_LanguageCombo,
        &m_FontCombo,
        &m_FrameRateCombo,
        &m_GamepadActionCombo,
        &m_GamepadControlCombo,
    };
    for (auto* c : combos) if (!c->IsOpen()) c->Render();
    for (auto* c : combos) if (c->IsOpen())  c->Render();
}

void SEASON3B::CNewUIOptionWindow::SetAutoAttack(bool bAuto)
{
    m_bAutoAttack = bAuto;
}

bool SEASON3B::CNewUIOptionWindow::IsAutoAttack()
{
    return m_bAutoAttack;
}

void SEASON3B::CNewUIOptionWindow::SetWhisperSound(bool bSound)
{
    m_bWhisperSound = bSound;
}

bool SEASON3B::CNewUIOptionWindow::IsWhisperSound()
{
    return m_bWhisperSound;
}

void SEASON3B::CNewUIOptionWindow::SetSlideHelp(bool bHelp)
{
    m_bSlideHelp = bHelp;
}

bool SEASON3B::CNewUIOptionWindow::IsSlideHelp()
{
    return m_bSlideHelp;
}

void SEASON3B::CNewUIOptionWindow::SetVolumeLevel(int iVolume)
{
    m_iVolumeLevel = iVolume;
}

int SEASON3B::CNewUIOptionWindow::GetVolumeLevel()
{
    return m_iVolumeLevel;
}

void SEASON3B::CNewUIOptionWindow::SetRenderLevel(int iRender)
{
    m_iRenderLevel = iRender;
}

int SEASON3B::CNewUIOptionWindow::GetRenderLevel()
{
    return m_iRenderLevel;
}

void SEASON3B::CNewUIOptionWindow::SetRenderAllEffects(bool bRenderAllEffects)
{
    m_bRenderAllEffects = bRenderAllEffects;
}

bool SEASON3B::CNewUIOptionWindow::GetRenderAllEffects()
{
    return m_bRenderAllEffects;
}

int SEASON3B::CNewUIOptionWindow::FindCurrentFrameRateIndex()
{
    const auto& settings = GameConfig::GetInstance().GetFrameTimingSettings();
    if (settings.mode == Core::Time::FrameRateMode::FollowDisplay)
        return 0;
    if (settings.mode == Core::Time::FrameRateMode::DisplayMaximum)
        return s_NumFrameRates - 1;

    for (int i = 1; i < s_NumFrameRates - 1; ++i)
    {
        if (std::abs(settings.fixedFrameRate - s_FrameRates[i].frameRate) < 0.01)
            return i;
    }

    return s_NumFrameRates - 1;
}

void SEASON3B::CNewUIOptionWindow::ApplyFrameRate()
{
    if (m_iFrameRateIndex < 0 || m_iFrameRateIndex >= s_NumFrameRates)
        return;

    auto settings = GameConfig::GetInstance().GetFrameTimingSettings();
    const FrameRateEntry& entry = s_FrameRates[m_iFrameRateIndex];
    if (entry.followDisplay)
    {
        settings.mode = Core::Time::FrameRateMode::FollowDisplay;
    }
    else if (entry.displayNative)
    {
        settings.mode = Core::Time::FrameRateMode::DisplayMaximum;
    }
    else
    {
        settings.mode = Core::Time::FrameRateMode::Fixed;
        settings.fixedFrameRate = entry.frameRate;
    }

    GameConfig::GetInstance().SetFrameTimingSettings(settings);
    GameConfig::GetInstance().Save();
    ApplyFrameTimingConfiguration();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::ApplyGamepadSettings()
{
    auto settings = GameConfig::GetInstance().GetGamepadSettings();
    settings.enabled = m_bGamepadEnabled;
    settings.stickDeadZone = m_iStickDeadZonePercent / 100.0f;
    settings.triggerDeadZone = m_iTriggerDeadZonePercent / 100.0f;
    settings.pointerSpeed = static_cast<float>(m_iPointerSpeed);
    settings.invertPointerY = m_bInvertPointerY;
    GameConfig::GetInstance().SetGamepadSettings(settings);
    GameConfig::GetInstance().Save();
    Core::Input::GamepadService::Instance().SetGamepadSettings(settings);
}

void SEASON3B::CNewUIOptionWindow::ApplyGamepadActionSelection()
{
    if (m_iGamepadActionIndex < 0
        || m_iGamepadActionIndex >= static_cast<int>(Core::Input::RemappableGamepadAction::Count))
    {
        return;
    }

    const auto& bindings = GameConfig::GetInstance().GetGamepadSettings().bindings;
    m_iGamepadControlIndex = static_cast<int>(
        bindings[static_cast<std::size_t>(m_iGamepadActionIndex)]);
    m_GamepadControlCombo.SetSelectedIndex(m_iGamepadControlIndex);
    m_GamepadControlCombo.Close();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::ApplyGamepadControlSelection()
{
    if (m_iGamepadActionIndex < 0
        || m_iGamepadActionIndex >= static_cast<int>(Core::Input::RemappableGamepadAction::Count)
        || m_iGamepadControlIndex < 0
        || m_iGamepadControlIndex >= static_cast<int>(Core::Input::GamepadControl::Count))
    {
        return;
    }

    auto settings = GameConfig::GetInstance().GetGamepadSettings();
    const auto action = static_cast<Core::Input::RemappableGamepadAction>(m_iGamepadActionIndex);
    const auto control = static_cast<Core::Input::GamepadControl>(m_iGamepadControlIndex);
    if (Core::Input::RebindGamepadAction(settings.bindings, action, control))
    {
        GameConfig::GetInstance().SetGamepadSettings(settings);
        GameConfig::GetInstance().Save();
        Core::Input::GamepadService::Instance().SetGamepadSettings(settings);
        PublishSettingHaptic();
    }

    m_iGamepadControlIndex = static_cast<int>(
        settings.bindings[static_cast<std::size_t>(m_iGamepadActionIndex)]);
    m_GamepadControlCombo.SetSelectedIndex(m_iGamepadControlIndex);
}

void SEASON3B::CNewUIOptionWindow::ResetGamepadBindings()
{
    auto settings = GameConfig::GetInstance().GetGamepadSettings();
    settings.bindings = Core::Input::DefaultGamepadBindings();
    GameConfig::GetInstance().SetGamepadSettings(settings);
    GameConfig::GetInstance().Save();
    Core::Input::GamepadService::Instance().SetGamepadSettings(settings);

    if (m_iGamepadActionIndex < 0
        || m_iGamepadActionIndex >= static_cast<int>(Core::Input::RemappableGamepadAction::Count))
    {
        m_iGamepadActionIndex = 0;
        m_GamepadActionCombo.SetSelectedIndex(m_iGamepadActionIndex);
    }
    m_iGamepadControlIndex = static_cast<int>(
        settings.bindings[static_cast<std::size_t>(m_iGamepadActionIndex)]);
    m_GamepadControlCombo.SetSelectedIndex(m_iGamepadControlIndex);
    m_GamepadControlCombo.Close();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::ApplyHapticSettings()
{
    auto settings = GameConfig::GetInstance().GetHapticSettings();
    settings.enabled = m_bHapticsEnabled;
    settings.intensityPercent = m_iHapticIntensity;
    settings.combatEnabled = m_bCombatHaptics;
    settings.uiEnabled = m_bUIHaptics;
    settings.transactionEnabled = m_bTransactionHaptics;
    GameConfig::GetInstance().SetHapticSettings(settings);
    GameConfig::GetInstance().Save();
    Core::Input::GamepadService::Instance().SetHapticSettings(settings);
}

void SEASON3B::CNewUIOptionWindow::PublishSettingHaptic()
{
    Core::Input::GamepadService::Instance().PublishHaptic(
        Core::Haptics::HapticEvent::SettingChanged,
        static_cast<double>(SDL_GetTicks()));
}

int SEASON3B::CNewUIOptionWindow::FindCurrentResolutionIndex()
{
    const int listed = FindListedResolutionIndex((int)WindowWidth, (int)WindowHeight);
    return listed >= 0 ? listed : s_DefaultResolutionIndex;
}

int SEASON3B::CNewUIOptionWindow::FindCurrentLanguageIndex()
{
    const char* current = I18N::GetCurrentLocale();
    if (current == nullptr) return 0;
    for (int i = 0; i < s_NumLanguages; ++i)
    {
        if (std::strcmp(s_Languages[i].code, current) == 0)
            return i;
    }
    return 0;  // default to English
}

void SEASON3B::CNewUIOptionWindow::ApplyLanguage()
{
    const char* code = s_Languages[m_iLanguageIndex].code;

    // Persist as wide string so it round-trips cleanly through the existing
    // GameConfig string-IO. Locale codes are ASCII so the conversion is safe.
    std::wstring wide(code, code + std::strlen(code));

    // Re-selecting the active language is a no-op; skip the relocalize and disk write.
    if (GameConfig::GetInstance().GetUILocale() == wide)
        return;

    I18N::SetLocale(code);
    GameConfig::GetInstance().SetUILocale(wide);
    GameConfig::GetInstance().Save();
    InitFontCombo();
    InitFrameRateCombo();
    InitGamepadMappingCombos();
    PublishSettingHaptic();
}

int SEASON3B::CNewUIOptionWindow::FindCurrentFontIndex()
{
    const std::wstring current = GameConfig::GetInstance().GetFontSelection();
    for (int i = 0; i < s_NumFonts; ++i)
    {
        if (current == s_Fonts[i].name)
            return i;
    }
    return 0;  // default ("")
}

void SEASON3B::CNewUIOptionWindow::ApplyFont()
{
    // Re-selecting the active font is a no-op; skip the font rebuild and disk write.
    if (GameConfig::GetInstance().GetFontSelection() == s_Fonts[m_iFontIndex].name)
        return;

    GameConfig::GetInstance().SetFontSelection(s_Fonts[m_iFontIndex].name);
    // Recreate the GDI fonts from config so the change takes effect live.
    ReinitializeFonts();
    GameConfig::GetInstance().Save();
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::ApplyResolution()
{
    const unsigned int newWidth  = s_Resolutions[m_iResolutionIndex].width;
    const unsigned int newHeight = s_Resolutions[m_iResolutionIndex].height;

    // SDL owns the window on every platform, so resize through SDL. The old
    // Windows path drove Win32 SetWindowPos/ChangeDisplaySettings on g_hWnd,
    // which SDL clamped straight back to the current size for a non-resizable
    // window — the resolution only "took" when a windowed/fullscreen toggle
    // reset the window style first (issue #462). MuApplyWindowResolution
    // resizes via SDL regardless of the resizable flag and updates
    // WindowWidth/Height synchronously through HandleWindowResize, so the
    // Save() below records the size the user actually got.
    BeginDisplayChange(newWidth, newHeight, g_bUseWindowMode != FALSE);
}

// Point the resolution combo at the mode the window really has. If the actual
// size is not a listed mode, keep the current selection - config still
// records the real size.
void SEASON3B::CNewUIOptionWindow::SyncResolutionComboToWindow()
{
    const int listed = FindListedResolutionIndex((int)WindowWidth, (int)WindowHeight);
    if (listed < 0)
        return;
    m_iResolutionIndex = listed;
    m_ResolutionCombo.SetSelectedIndex(listed);
}

// Windowed/fullscreen toggle. SDL owns the window, so switch modes through it
// (MuApplyWindowResolution -> SDL_SetWindowFullscreen / SDL_SetWindowSize)
// rather than driving the OS directly: the old Win32 ChangeDisplaySettings /
// SetWindowLongPtr path fought SDL and left its state inconsistent with a
// later resolution change. Keeps the current size and applies the new mode.
void SEASON3B::CNewUIOptionWindow::ApplyWindowModeToggle()
{
    BeginDisplayChange(WindowWidth, WindowHeight, m_bWindowedMode);

    // Consume the in-flight VK_LBUTTON press so the same click doesn't
    // toggle again next frame; the user must release and click again.
    g_pNewKeyInput->SetKeyState(VK_LBUTTON, SEASON3B::CNewKeyInput::KEY_NONE);
}

void SEASON3B::CNewUIOptionWindow::BeginDisplayChange(
    unsigned int width,
    unsigned int height,
    bool windowed)
{
    if (m_bDisplayChangePending || width == 0 || height == 0)
        return;

    m_bPreviousWindowedMode = (g_bUseWindowMode != FALSE);
    m_uPreviousWindowWidth = WindowWidth;
    m_uPreviousWindowHeight = WindowHeight;

    g_bUseWindowMode = windowed ? TRUE : FALSE;
    m_bWindowedMode = windowed;
    MuApplyWindowResolution(width, height, windowed);
    SyncResolutionComboToWindow();
    ApplyFrameTimingConfiguration();

    m_uDisplayChangeDeadlineMs = SDL_GetTicks() + DISPLAY_CONFIRMATION_DURATION_MS;
    m_bDisplayChangePending = true;
    PublishSettingHaptic();
}

void SEASON3B::CNewUIOptionWindow::AcceptDisplayChange()
{
    if (!m_bDisplayChangePending)
        return;

    m_bDisplayChangePending = false;
    PersistCurrentDisplaySettings();
    Core::Input::GamepadService::Instance().PublishHaptic(
        Core::Haptics::HapticEvent::Confirmed,
        static_cast<double>(SDL_GetTicks()));
}

void SEASON3B::CNewUIOptionWindow::RevertDisplayChange()
{
    if (!m_bDisplayChangePending)
        return;

    m_bDisplayChangePending = false;
    g_bUseWindowMode = m_bPreviousWindowedMode ? TRUE : FALSE;
    m_bWindowedMode = m_bPreviousWindowedMode;
    MuApplyWindowResolution(
        m_uPreviousWindowWidth,
        m_uPreviousWindowHeight,
        m_bPreviousWindowedMode);
    SyncResolutionComboToWindow();
    PersistCurrentDisplaySettings();
    Core::Input::GamepadService::Instance().PublishHaptic(
        Core::Haptics::HapticEvent::Cancelled,
        static_cast<double>(SDL_GetTicks()));
}

void SEASON3B::CNewUIOptionWindow::UpdateDisplayChange()
{
    if (!m_bDisplayChangePending)
        return;

    if (SDL_GetTicks() >= m_uDisplayChangeDeadlineMs)
        RevertDisplayChange();
}

void SEASON3B::CNewUIOptionWindow::UpdateDisplayChangeMouseEvent()
{
    if (!SEASON3B::IsPress(VK_LBUTTON))
        return;

    if (CheckMouseIn(
            m_Pos.x + KEEP_DISPLAY_X_LOCAL,
            m_Pos.y + DISPLAY_BUTTON_Y_LOCAL,
            DISPLAY_BUTTON_WIDTH,
            DISPLAY_BUTTON_HEIGHT))
    {
        AcceptDisplayChange();
        return;
    }

    if (CheckMouseIn(
            m_Pos.x + REVERT_DISPLAY_X_LOCAL,
            m_Pos.y + DISPLAY_BUTTON_Y_LOCAL,
            DISPLAY_BUTTON_WIDTH,
            DISPLAY_BUTTON_HEIGHT))
    {
        RevertDisplayChange();
    }
}

void SEASON3B::CNewUIOptionWindow::RenderDisplayChangeConfirmation()
{
    if (!m_bDisplayChangePending)
        return;

    RenderImage(
        IMAGE_OPTION_FRAME_BACK,
        m_Pos.x + DISPLAY_CONFIRMATION_X_LOCAL,
        m_Pos.y + DISPLAY_CONFIRMATION_Y_LOCAL,
        DISPLAY_CONFIRMATION_WIDTH,
        DISPLAY_CONFIRMATION_HEIGHT);

    const std::uint64_t nowMs = SDL_GetTicks();
    const std::uint64_t remainingMs = nowMs < m_uDisplayChangeDeadlineMs
        ? m_uDisplayChangeDeadlineMs - nowMs
        : 0;
    const unsigned int seconds = static_cast<unsigned int>((remainingMs + 999) / 1000);
    wchar_t confirmationText[192] = {};
    mu_swprintf_s(
        confirmationText,
        I18N::Game::DisplaySettingsConfirmation,
        seconds);

    g_pRenderText->SetTextColor(255, 230, 180, 255);
    g_pRenderText->RenderText(
        m_Pos.x + DISPLAY_CONFIRMATION_X_LOCAL + 15,
        m_Pos.y + DISPLAY_CONFIRMATION_Y_LOCAL + 24,
        confirmationText,
        DISPLAY_CONFIRMATION_WIDTH - 30,
        0,
        RT3_SORT_CENTER);

    const auto renderButton = [this](int xLocal, const wchar_t* label)
    {
        RenderImage(
            IMAGE_OPTION_VOLUME_BACK,
            m_Pos.x + xLocal,
            m_Pos.y + DISPLAY_BUTTON_Y_LOCAL,
            DISPLAY_BUTTON_WIDTH,
            DISPLAY_BUTTON_HEIGHT);
        g_pRenderText->SetTextColor(255, 255, 255, 255);
        g_pRenderText->RenderText(
            m_Pos.x + xLocal,
            m_Pos.y + DISPLAY_BUTTON_Y_LOCAL + 3,
            label,
            DISPLAY_BUTTON_WIDTH,
            0,
            RT3_SORT_CENTER);
    };
    renderButton(KEEP_DISPLAY_X_LOCAL, I18N::Game::KeepDisplaySettings);
    renderButton(REVERT_DISPLAY_X_LOCAL, I18N::Game::RevertDisplaySettings);
}

void SEASON3B::CNewUIOptionWindow::PersistCurrentDisplaySettings()
{
    GameConfig::GetInstance().SetWindowMode(m_bWindowedMode);
    GameConfig::GetInstance().SetWindowSize(WindowWidth, WindowHeight);
    GameConfig::GetInstance().Save();
    ApplyFrameTimingConfiguration();
}
