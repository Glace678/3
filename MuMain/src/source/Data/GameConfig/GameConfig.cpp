#include "stdafx.h"
#include "GameConfig.h"
#include <cstdlib>
#include <cstring>
#include <SDL3/SDL_stdinc.h>

#ifdef _WIN32
#include <imagehlp.h>
#endif

#include "GameConfigConstants.h"
#include "Core/Platform/WinCompat.h"
#include "Core/Platform/WinIni.h"  // private-profile (.ini) API
#include "Core/Platform/Dpapi.h"   // DPAPI credential crypto (no-op off Windows)
#include <algorithm>

namespace Data::Config
{
    constexpr const char* kConfigurationPathEnvironment = "MU_CONFIG_FILE";

    std::wstring ConfigurationPathOverride()
    {
        const char* path = SDL_getenv(kConfigurationPathEnvironment);
        if (!path || !path[0] || !std::filesystem::u8path(path).is_absolute())
            return {};
        const int size = MultiByteToWideChar(CP_UTF8, 0, path, -1, nullptr, 0);
        if (size <= 1)
            return {};
        std::wstring result(static_cast<size_t>(size), L'\0');
        if (MultiByteToWideChar(CP_UTF8, 0, path, -1, result.data(), size) != size)
            return {};
        result.resize(static_cast<size_t>(size - 1));
        return result;
    }
}

GameConfig& GameConfig::GetInstance()
{
    static GameConfig instance;
    return instance;
}

GameConfig::GameConfig()
{
    // Get executable directory and construct config path
    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(nullptr, exePath, MAX_PATH);

    // Find the last path separator to get the directory. GetModuleFileNameW
    // returns backslashes on Windows but forward slashes on Linux (issue #462),
    // so accept either; truncating on the wrong one leaves the whole exe path
    // glued to "config.ini", and the file is silently never found (every
    // setting then falls back to its default).
    wchar_t* lastBackslash = wcsrchr(exePath, L'\\');
    wchar_t* lastForwardSlash = wcsrchr(exePath, L'/');
    // Relational comparison of pointers into different arrays (or with null) is
    // undefined behavior, and on Linux one of these is always null, so pick the
    // later separator only when both exist.
    wchar_t* lastSlash = nullptr;
    if (lastBackslash && lastForwardSlash)
        lastSlash = (lastBackslash > lastForwardSlash) ? lastBackslash : lastForwardSlash;
    else
        lastSlash = lastBackslash ? lastBackslash : lastForwardSlash;
    if (lastSlash)
    {
        *(lastSlash + 1) = L'\0';  // Keep the trailing separator
    }

    m_configPath = exePath;
    m_configPath += L"config.ini";

    // Installed desktop bundles keep mutable settings in the user's data directory.
    const std::wstring configuredPath = Data::Config::ConfigurationPathOverride();
    if (!configuredPath.empty())
        m_configPath = configuredPath;

    Load();
}

void GameConfig::Load()
{
    using namespace CfgSections;
    using namespace CfgKeys;
    using namespace CfgDefaults;

    m_windowWidth  = ReadInt(CfgSectionWindow, CfgKeyWidth, CfgDefaultWindowWidth);
    m_windowHeight = ReadInt(CfgSectionWindow, CfgKeyHeight, CfgDefaultWindowHeight);
    m_windowMode   = ReadBool(CfgSectionWindow, CfgKeyWindowed, CfgDefaultWindowed);
    m_soloBalanceEnabled = ReadBool(L"Game", L"SoloBalance", false);
    if (const char* solo = std::getenv("MU_SOLO_BALANCE"))
        m_soloBalanceEnabled = std::strcmp(solo, "1") == 0;

    const std::wstring frameRateMode = ReadString(
        CfgSectionRender, CfgKeyFrameRateMode, CfgDefaultFrameRateMode);
    m_frameTimingSettings.mode = frameRateMode == L"Fixed"
        ? Core::Time::FrameRateMode::Fixed
        : frameRateMode == L"FollowDisplay"
            ? Core::Time::FrameRateMode::FollowDisplay
            : Core::Time::FrameRateMode::DisplayMaximum;
    const int frameRateMilliHz = ReadInt(
        CfgSectionRender, CfgKeyFrameRateLimitMilliHz, 0);
    m_frameTimingSettings.fixedFrameRate = frameRateMilliHz > 0
        ? std::clamp(frameRateMilliHz / 1000.0, 30.0, 1000.0)
        : std::clamp(
            ReadInt(CfgSectionRender, CfgKeyFrameRateLimit, CfgDefaultFrameRateLimit), 30, 1000);
    m_frameTimingSettings.backgroundFrameRate = std::clamp(
        ReadInt(CfgSectionRender, CfgKeyBackgroundFrameRate, CfgDefaultBackgroundFrameRate), 1, 240);
    m_frameTimingSettings.verticalSync = ReadBool(
        CfgSectionRender, CfgKeyVSync, CfgDefaultVSync);

    // Migrate the historical Graphics/FPSLimit key without discarding the
    // user's value. The source key is removed only after the new keys exist.
    const int legacyFrameRate = ReadInt(CfgSectionGraphics, L"FPSLimit", 0);
    if (legacyFrameRate > 0)
    {
        m_frameTimingSettings.mode = Core::Time::FrameRateMode::Fixed;
        m_frameTimingSettings.fixedFrameRate = std::clamp(legacyFrameRate, 30, 1000);
        WriteString(CfgSectionRender, CfgKeyFrameRateMode, L"Fixed");
        WriteInt(CfgSectionRender, CfgKeyFrameRateLimit,
            static_cast<int>(m_frameTimingSettings.fixedFrameRate));
        WriteInt(CfgSectionRender, CfgKeyFrameRateLimitMilliHz,
            static_cast<int>(m_frameTimingSettings.fixedFrameRate * 1000.0 + 0.5));
        RemoveObsoleteKey(CfgSectionGraphics, L"FPSLimit");
    }

    m_gamepadSettings.enabled = ReadBool(
        CfgSectionInput, CfgKeyGamepadEnabled, CfgDefaultGamepadEnabled);
    m_gamepadSettings.stickDeadZone = std::clamp(
        ReadInt(CfgSectionInput, CfgKeyStickDeadZonePercent, CfgDefaultStickDeadZonePercent), 0, 95) / 100.0f;
    m_gamepadSettings.triggerDeadZone = std::clamp(
        ReadInt(CfgSectionInput, CfgKeyTriggerDeadZonePercent, CfgDefaultTriggerDeadZonePercent), 0, 95) / 100.0f;
    m_gamepadSettings.pointerSpeed = static_cast<float>(std::clamp(
        ReadInt(CfgSectionInput, CfgKeyPointerSpeed, CfgDefaultPointerSpeed), 100, 2000));
    m_gamepadSettings.invertPointerY = ReadBool(
        CfgSectionInput, CfgKeyInvertPointerY, CfgDefaultInvertPointerY);
    const Core::Input::GamepadBindings defaultBindings = Core::Input::DefaultGamepadBindings();
    for (std::size_t i = 0; i < m_gamepadSettings.bindings.size(); ++i)
    {
        const auto action = static_cast<Core::Input::RemappableGamepadAction>(i);
        const std::wstring value = ReadString(
            CfgSectionInput,
            Core::Input::GamepadBindingConfigKey(action),
            Core::Input::GamepadControlConfigName(defaultBindings[i]));
        m_gamepadSettings.bindings[i] = Core::Input::ParseGamepadControl(value).value_or(defaultBindings[i]);
    }
    Core::Input::NormalizeGamepadBindings(m_gamepadSettings.bindings);

    m_hapticSettings.enabled = ReadBool(
        CfgSectionHaptics, CfgKeyHapticsEnabled, CfgDefaultHapticsEnabled);
    m_hapticSettings.intensityPercent = std::clamp(
        ReadInt(CfgSectionHaptics, CfgKeyHapticsIntensity, CfgDefaultHapticsIntensity), 0, 100);
    m_hapticSettings.combatEnabled = ReadBool(
        CfgSectionHaptics, CfgKeyHapticsCombat, CfgDefaultHapticsCombat);
    m_hapticSettings.uiEnabled = ReadBool(
        CfgSectionHaptics, CfgKeyHapticsUI, CfgDefaultHapticsUI);
    m_hapticSettings.transactionEnabled = ReadBool(
        CfgSectionHaptics, CfgKeyHapticsTransaction, CfgDefaultHapticsTransaction);

    m_soundVolume  = ReadInt(CfgSectionAudio, CfgKeySoundVolume, CfgDefaultSoundVolume);
    m_musicVolume  = ReadInt(CfgSectionAudio, CfgKeyMusicVolume, CfgDefaultMusicVolume);

    m_rememberMe        = ReadBool(CfgSectionLogin, CfgKeyRememberMe, CfgDefaultRememberMe);
    m_savePassword      = ReadBool(CfgSectionLogin, CfgKeySavePassword, CfgDefaultSavePassword);
    m_languageSelection = ReadString(CfgSectionLogin, CfgKeyLanguage, CfgDefaultLanguage);
    m_encryptedUsername = ReadString(CfgSectionLogin, CfgKeyEncryptedUsername, CfgDefaultEncryptedUsername);
    m_encryptedPassword = ReadString(CfgSectionLogin, CfgKeyEncryptedPassword, CfgDefaultEncryptedPassword);

    m_serverIP   = ReadString(CfgSectionConnectionSettings, CfgKeyServerIP, CfgDefaultServerIP);
    m_serverPort = ReadInt(CfgSectionConnectionSettings, CfgKeyServerPort, CfgDefaultServerPort);

    m_chatCommandFavourites = ReadStringList(L"ChatCommands", L"Favourite");
    m_chatCommandTemplates = ReadStringList(L"ChatCommands", L"Template");

    m_uiLocale = ReadString(CfgSectionUI, CfgKeyUILocale, CfgDefaultUILocale);
    m_fontSelection = ReadString(CfgSectionUI, CfgKeyFont, CfgDefaultFont);

    m_zoom = ReadInt(CfgSectionCamera, CfgKeyZoom, CfgDefaultZoom);

    // Strip keys/sections we used to write but no longer use, so user config
    // files don't accumulate orphans. Append one line per retired key — no
    // central registry of valid keys to keep in sync.
    RemoveObsoleteKey(CfgSectionGraphics, L"RenderTextType");
    RemoveObsoleteKey(CfgSectionGraphics, L"ColorDepth");      // 16/32bpp toggle, dead since fullscreen uses GetDesktopBitsPerPel
    RemoveObsoleteKey(CfgSectionAudio,    L"SoundEnabled");   // replaced by SoundVolume==0
    RemoveObsoleteKey(CfgSectionAudio,    L"MusicEnabled");   // replaced by MusicVolume==0
    RemoveObsoleteKey(CfgSectionAudio,    L"VolumeLevel");    // legacy single-volume key
    RemoveObsoleteKey(CfgSectionLogin,    L"Version");        // launcher metadata, never read by client
    RemoveObsoleteKey(CfgSectionLogin,    L"TestVersion");    // launcher metadata, never read by client
    RemoveObsoleteSection(CfgSectionGraphics);                // empty after RenderTextType + ColorDepth removal
    RemoveObsoleteSection(L"PARTITION");                      // launcher metadata, never read by client
}

void GameConfig::Save()
{
    using namespace CfgSections;
    using namespace CfgKeys;

    WriteInt(CfgSectionWindow, CfgKeyWidth, m_windowWidth);
    WriteInt(CfgSectionWindow, CfgKeyHeight, m_windowHeight);
    WriteBool(CfgSectionWindow, CfgKeyWindowed, m_windowMode);

    WriteString(CfgSectionRender, CfgKeyFrameRateMode,
        m_frameTimingSettings.mode == Core::Time::FrameRateMode::Fixed ? L"Fixed"
        : m_frameTimingSettings.mode == Core::Time::FrameRateMode::FollowDisplay ? L"FollowDisplay"
        : L"DisplayMaximum");
    WriteInt(CfgSectionRender, CfgKeyFrameRateLimit,
        static_cast<int>(m_frameTimingSettings.fixedFrameRate));
    WriteInt(CfgSectionRender, CfgKeyFrameRateLimitMilliHz,
        static_cast<int>(m_frameTimingSettings.fixedFrameRate * 1000.0 + 0.5));
    WriteInt(CfgSectionRender, CfgKeyBackgroundFrameRate,
        static_cast<int>(m_frameTimingSettings.backgroundFrameRate));
    WriteBool(CfgSectionRender, CfgKeyVSync, m_frameTimingSettings.verticalSync);

    WriteBool(CfgSectionInput, CfgKeyGamepadEnabled, m_gamepadSettings.enabled);
    WriteInt(CfgSectionInput, CfgKeyStickDeadZonePercent,
        static_cast<int>(m_gamepadSettings.stickDeadZone * 100.0f + 0.5f));
    WriteInt(CfgSectionInput, CfgKeyTriggerDeadZonePercent,
        static_cast<int>(m_gamepadSettings.triggerDeadZone * 100.0f + 0.5f));
    WriteInt(CfgSectionInput, CfgKeyPointerSpeed, static_cast<int>(m_gamepadSettings.pointerSpeed));
    WriteBool(CfgSectionInput, CfgKeyInvertPointerY, m_gamepadSettings.invertPointerY);
    for (std::size_t i = 0; i < m_gamepadSettings.bindings.size(); ++i)
    {
        WriteString(
            CfgSectionInput,
            Core::Input::GamepadBindingConfigKey(static_cast<Core::Input::RemappableGamepadAction>(i)),
            Core::Input::GamepadControlConfigName(m_gamepadSettings.bindings[i]));
    }

    WriteBool(CfgSectionHaptics, CfgKeyHapticsEnabled, m_hapticSettings.enabled);
    WriteInt(CfgSectionHaptics, CfgKeyHapticsIntensity, m_hapticSettings.intensityPercent);
    WriteBool(CfgSectionHaptics, CfgKeyHapticsCombat, m_hapticSettings.combatEnabled);
    WriteBool(CfgSectionHaptics, CfgKeyHapticsUI, m_hapticSettings.uiEnabled);
    WriteBool(CfgSectionHaptics, CfgKeyHapticsTransaction, m_hapticSettings.transactionEnabled);

    WriteInt(CfgSectionAudio, CfgKeySoundVolume, m_soundVolume);
    WriteInt(CfgSectionAudio, CfgKeyMusicVolume, m_musicVolume);

    WriteBool(CfgSectionLogin, CfgKeyRememberMe, m_rememberMe);
    WriteBool(CfgSectionLogin, CfgKeySavePassword, m_savePassword);
    WriteString(CfgSectionLogin, CfgKeyLanguage, m_languageSelection);
    WriteString(CfgSectionLogin, CfgKeyEncryptedUsername, m_encryptedUsername);
    WriteString(CfgSectionLogin, CfgKeyEncryptedPassword, m_encryptedPassword);

    WriteString(CfgSectionConnectionSettings, CfgKeyServerIP, m_serverIP);
    WriteInt(CfgSectionConnectionSettings, CfgKeyServerPort, m_serverPort);

    WriteStringList(L"ChatCommands", L"Favourite", m_chatCommandFavourites);
    WriteStringList(L"ChatCommands", L"Template", m_chatCommandTemplates);

    WriteString(CfgSectionUI, CfgKeyUILocale, m_uiLocale);
    WriteString(CfgSectionUI, CfgKeyFont, m_fontSelection);

    WriteInt(CfgSectionCamera, CfgKeyZoom, m_zoom);
}

std::vector<std::wstring> GameConfig::ReadStringList(const wchar_t* section, const wchar_t* keyPrefix)
{
    std::vector<std::wstring> result;
    const auto count = ReadInt(section, (std::wstring(keyPrefix) + L"Count").c_str(), 0);
    for (int i = 0; i < count; ++i)
    {
        auto entry = ReadString(section, (std::wstring(keyPrefix) + std::to_wstring(i)).c_str(), L"");
        if (!entry.empty())
        {
            result.push_back(std::move(entry));
        }
    }

    return result;
}

void GameConfig::WriteStringList(const wchar_t* section, const wchar_t* keyPrefix, const std::vector<std::wstring>& values)
{
    WriteInt(section, (std::wstring(keyPrefix) + L"Count").c_str(), static_cast<int>(values.size()));
    for (size_t i = 0; i < values.size(); ++i)
    {
        WriteString(section, (std::wstring(keyPrefix) + std::to_wstring(i)).c_str(), values[i]);
    }
}

void GameConfig::SetChatCommandFavourites(const std::vector<std::wstring>& favourites)
{
    m_chatCommandFavourites = favourites;
    Save();
}

void GameConfig::SetChatCommandTemplates(const std::vector<std::wstring>& templates)
{
    m_chatCommandTemplates = templates;
    Save();
}

void GameConfig::SetWindowSize(int width, int height)
{
    m_windowWidth = width;
    m_windowHeight = height;
}

void GameConfig::SetWindowMode(bool windowed)
{
    m_windowMode = windowed;
}

void GameConfig::SetFrameTimingSettings(const Core::Time::FrameTimingSettings& settings)
{
    m_frameTimingSettings = settings;
}

int64_t GameConfig::ScaleSoloPrice(int64_t price) const
{
    constexpr int64_t SoloPriceDivisor = 1000;
    return m_soloBalanceEnabled && price > 0
        ? std::max<int64_t>(1, price / SoloPriceDivisor) : price;
}

void GameConfig::SetGamepadSettings(const Core::Input::GamepadSettings& settings)
{
    m_gamepadSettings = settings;
}

void GameConfig::SetHapticSettings(const Core::Haptics::HapticSettings& settings)
{
    m_hapticSettings = settings;
}

void GameConfig::SetSoundVolume(int level)
{
    m_soundVolume = level;
}

void GameConfig::SetMusicVolume(int level)
{
    m_musicVolume = level;
}

void GameConfig::SetRememberMe(bool remember)
{
    m_rememberMe = remember;
}

void GameConfig::SetSavePassword(bool save)
{
    m_savePassword = save;
}

void GameConfig::ClearCredentials()
{
    m_encryptedUsername.clear();
    m_encryptedPassword.clear();
    m_savePassword = false;
    Save();
}

void GameConfig::SetLanguageSelection(const std::wstring& lang)
{
    m_languageSelection = lang;
}

void GameConfig::SetUILocale(const std::wstring& locale)
{
    m_uiLocale = locale;
}

void GameConfig::SetFontSelection(const std::wstring& font)
{
    m_fontSelection = font;
}

void GameConfig::SetEncryptedUsername(const std::wstring& encryptedUsername)
{
    m_encryptedUsername = encryptedUsername;
}

void GameConfig::SetEncryptedPassword(const std::wstring& encryptedPassword)
{
    m_encryptedPassword = encryptedPassword;
}

void GameConfig::SetServerIP(const std::wstring& ip)
{
    m_serverIP = ip;
}

void GameConfig::SetServerPort(int port)
{
    m_serverPort = port;
}

void GameConfig::SetZoom(int zoom)
{
    m_zoom = zoom;
}

// Helper function to convert binary data to hex string
std::wstring GameConfig::BinaryToHex(const BYTE* data, DWORD size)
{
    std::wstring hex;
    hex.reserve(size * 2);

    const wchar_t hexChars[] = L"0123456789ABCDEF";
    for (DWORD i = 0; i < size; ++i)
    {
        hex += hexChars[(data[i] >> 4) & 0x0F];
        hex += hexChars[data[i] & 0x0F];
    }

    return hex;
}

// Helper function to convert hex string to binary data
std::vector<BYTE> GameConfig::HexToBinary(const std::wstring& hex)
{
    std::vector<BYTE> binary;

    if (hex.empty() || hex.length() % 2 != 0)
        return binary;

    binary.reserve(hex.length() / 2);

    auto hex_char_to_byte = [](wchar_t c) -> BYTE {
        if (c >= L'0' && c <= L'9') return (c - L'0');
        if (c >= L'a' && c <= L'f') return (c - L'a' + 10);
        return (c - L'A' + 10);
    };

    for (size_t i = 0; i < hex.length(); i += 2)
    {
        wchar_t high = hex[i];
        wchar_t low = hex[i + 1];

        if (!iswxdigit(high) || !iswxdigit(low))
        {
            // Invalid hex character detected, return empty vector
            return {};
        }

        binary.push_back((hex_char_to_byte(high) << 4) | hex_char_to_byte(low));
    }

    return binary;
}

void GameConfig::DecryptCredentials(wchar_t* outUser, wchar_t* outPass, size_t userBufSize, size_t passBufSize)
{
    // Start empty so a missing username/password never leaves stale text behind.
    if (outUser && userBufSize) outUser[0] = L'\0';
    if (outPass && passBufSize) outPass[0] = L'\0';

    // Decrypt Username
    std::wstring user = DecryptSetting(GetEncryptedUsername());
    if (!user.empty() && outUser && userBufSize) {
        wcsncpy_s(outUser, userBufSize, user.c_str(), _TRUNCATE);
    }

    // Decrypt Password only when the player consented to storing it; otherwise
    // only the username is remembered.
    if (m_savePassword) {
        std::wstring pass = DecryptSetting(GetEncryptedPassword());
        if (!pass.empty() && outPass && passBufSize) {
            wcsncpy_s(outPass, passBufSize, pass.c_str(), _TRUNCATE);
        }
    }
}

// Helper functions using Windows INI API
int GameConfig::ReadInt(const wchar_t* section, const wchar_t* key, int defaultValue)
{
    return GetPrivateProfileIntW(section, key, defaultValue, m_configPath.wstring().c_str());
}

void GameConfig::WriteInt(const wchar_t* section, const wchar_t* key, int value)
{
    wchar_t buffer[32];
    swprintf_s(buffer, L"%d", value);

    WritePrivateProfileStringW(section, key, buffer, m_configPath.wstring().c_str());
}

bool GameConfig::ReadBool(const wchar_t* section, const wchar_t* key, bool defaultValue)
{
    return GetPrivateProfileIntW(section, key, defaultValue ? 1 : 0, m_configPath.wstring().c_str()) != 0;
}

void GameConfig::WriteBool(const wchar_t* section, const wchar_t* key, bool value)
{
    WritePrivateProfileStringW(section, key, value ? L"1" : L"0", m_configPath.wstring().c_str());
}

std::wstring GameConfig::ReadString(const wchar_t* section, const wchar_t* key, const std::wstring& defaultValue)
{
    std::vector<wchar_t> buffer(2048);
    while (true)
    {
        DWORD charsRead = GetPrivateProfileStringW(section, key, defaultValue.c_str(), buffer.data(), static_cast<DWORD>(buffer.size()), m_configPath.wstring().c_str());
        if (charsRead < buffer.size() - 1)
        {
            return std::wstring(buffer.data());
        }
        buffer.resize(buffer.size() * 2);
    }
}

void GameConfig::WriteString(const wchar_t* section, const wchar_t* key, const std::wstring& value)
{
    WritePrivateProfileStringW(section, key, value.c_str(), m_configPath.wstring().c_str());
}

void GameConfig::RemoveObsoleteKey(const wchar_t* section, const wchar_t* key)
{
    // Passing nullptr as the value deletes the key (Windows INI API).
    WritePrivateProfileStringW(section, key, nullptr, m_configPath.wstring().c_str());
}

void GameConfig::RemoveObsoleteSection(const wchar_t* section)
{
    // Passing nullptr as the key deletes the entire section.
    WritePrivateProfileStringW(section, nullptr, nullptr, m_configPath.wstring().c_str());
}

std::wstring GameConfig::DecryptSetting(const std::wstring& hexInput)
{
    if (hexInput.empty()) return L"";

    // Convert Hex String back to Binary Blob
    std::vector<BYTE> encryptedData = HexToBinary(hexInput);
    if (encryptedData.empty()) return L"";

    DATA_BLOB dataIn, dataOut;
    dataIn.pbData = encryptedData.data();
    dataIn.cbData = static_cast<DWORD>(encryptedData.size());

    // Decrypt using Windows DPAPI
    if (CryptUnprotectData(&dataIn, nullptr, nullptr, nullptr, nullptr, 0, &dataOut))
    {
        std::wstring result(reinterpret_cast<wchar_t*>(dataOut.pbData), dataOut.cbData / sizeof(wchar_t));
        LocalFree(dataOut.pbData); // Safety: Windows allocated this, we free it
        // The decrypted string might contain the null terminator, let's remove it if it exists.
        if (!result.empty() && result.back() == L'\0') {
            result.pop_back();
        }
        return result;
    }

    return L"";
}

std::wstring GameConfig::EncryptSetting(const wchar_t* input)
{
    if (!input || wcslen(input) == 0) return L"";

    DATA_BLOB dataIn, dataOut;
    dataIn.cbData = static_cast<DWORD>((wcslen(input) + 1) * sizeof(wchar_t));
    dataIn.pbData = reinterpret_cast<BYTE*>(const_cast<wchar_t*>(input));

    if (CryptProtectData(&dataIn, nullptr, nullptr, nullptr, nullptr, 0, &dataOut))
    {
        std::wstring hexResult = BinaryToHex(dataOut.pbData, dataOut.cbData);
        LocalFree(dataOut.pbData);
        return hexResult;
    }
    return L"";
}

void GameConfig::EncryptAndSaveCredentials(const wchar_t* user, const wchar_t* pass)
{
    std::wstring encUser = EncryptSetting(user);
    if (encUser.empty())
    {
        // No username to remember; leave any prior credentials untouched.
        return;
    }

    SetEncryptedUsername(encUser);

    // The password is persisted only with explicit consent. Without it, clear
    // any previously stored password so it never lingers in config.ini.
    if (m_savePassword)
    {
        SetEncryptedPassword(EncryptSetting(pass));
    }
    else
    {
        SetEncryptedPassword(L"");
    }

    Save(); // Actually write to the .ini file
}
