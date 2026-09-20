//*****************************************************************************
// File: CharInfoBalloon.cpp
//*****************************************************************************

#include "stdafx.h"
#include "CharInfoBalloon.h"
#include "Render/Textures/ZzzOpenglUtil.h"
#include "Engine/Object/ZzzInterface.h"
#include "UI/Legacy/UIControls.h"
#include "CharacterManager.h"
#include "I18N/All.h"

#include <algorithm>
#include <array>
#include <cwchar>
#include <cmath>

#include "Camera/CameraProjection.h"

namespace
{
    template <std::size_t N>
    void CopyWideString(wchar_t (&destination)[N], const wchar_t* source)
    {
        if (source == nullptr)
        {
            destination[0] = L'\0';
            return;
        }

        std::wcsncpy(destination, source, N - 1);
        destination[N - 1] = L'\0';
    }

    struct GuildStatusText
    {
        std::uint8_t status;
        int textIndex;
    };

    constexpr std::array<GuildStatusText, 5> kGuildStatusTexts{ {
        {   0, 1330 },
        {  32, 1302 },
        {  64, 1301 },
        { 128, 1300 },
        { 255, 488 },
    } };

    DWORD ResolveNameColor(std::uint8_t controlCode)
    {
        if (controlCode & CTLCODE_01BLOCKCHAR)
            return ARGB(255, 0, 255, 255);
        if (controlCode & (CTLCODE_02BLOCKITEM | CTLCODE_10ACCOUNT_BLOCKITEM))
            return CLRDW_BR_ORANGE;
        if (controlCode & CTLCODE_04FORTV)
            return CLRDW_WHITE;
        if (controlCode & (CTLCODE_08OPERATOR | CTLCODE_20OPERATOR))
            return ARGB(255, 255, 0, 0);

        return CLRDW_WHITE;
    }

    int ResolveGuildTextIndex(std::uint8_t guildStatus)
    {
        const auto it = std::lower_bound(
            kGuildStatusTexts.begin(),
            kGuildStatusTexts.end(),
            guildStatus,
            [](const GuildStatusText& entry, std::uint8_t status) { return entry.status < status; });

        return (it != kGuildStatusTexts.end() && it->status == guildStatus) ? it->textIndex : 0;
    }
}

CCharInfoBalloon::CCharInfoBalloon() : m_pCharInfo(nullptr)
{
    I18N::RegisterLocaleObserver(&CCharInfoBalloon::OnLocaleChanged, this);
}

CCharInfoBalloon::~CCharInfoBalloon()
{
    I18N::UnregisterLocaleObserver(&CCharInfoBalloon::OnLocaleChanged, this);
}

void CCharInfoBalloon::OnLocaleChanged(void* ctx) noexcept
{
    auto* self = static_cast<CCharInfoBalloon*>(ctx);
    if (self->m_pCharInfo != nullptr)
    {
        self->SetInfo();
    }
}

void CCharInfoBalloon::Create(CHARACTER* pCharInfo)
{
    CSprite::Create(118, 54, BITMAP_LOG_IN + 7, 0, nullptr, 59, 54);

    m_pCharInfo = pCharInfo;
    m_dwNameColor = 0;
    std::fill(std::begin(m_szName), std::end(m_szName), L'\0');
    std::fill(std::begin(m_szGuild), std::end(m_szGuild), L'\0');
    std::fill(std::begin(m_szClass), std::end(m_szClass), L'\0');
}

void CCharInfoBalloon::Render()
{
    if (m_pCharInfo == nullptr || !CSprite::m_bShow)
        return;

    UpdateLayout();
    CSprite::Render();
    RenderLines();
}

void CCharInfoBalloon::UpdateLayout()
{
    constexpr int lineCount = 3;
    constexpr float baseWidth = 118.f;
    constexpr float padding = 6.f;
    constexpr float lineGap = 2.f;
    const int screenWidth = static_cast<int>(WindowWidth);
    const int screenHeight = static_cast<int>(WindowHeight);
    g_pRenderText->SetFont(g_hFixFont);
    SIZE textSize{};
    int maxWidth = 0;
    int maxHeight = 0;
    for (const auto* text : { m_szName, m_szGuild, m_szClass })
    {
        GetTextExtentPoint32(g_pRenderText->GetFontDC(), text, lstrlen(text), &textSize);
        maxWidth = std::max(maxWidth, static_cast<int>(textSize.cx));
        maxHeight = std::max(maxHeight, static_cast<int>(textSize.cy));
    }
    m_textTop = static_cast<int>(std::ceil(padding * g_fScreenRate_y));
    m_lineHeight = maxHeight + static_cast<int>(std::ceil(lineGap * g_fScreenRate_y));
    const int width = std::min(screenWidth, static_cast<int>(std::ceil(
        std::max(baseWidth * g_fScreenRate_x, maxWidth + padding * 2.f * g_fScreenRate_x))));
    const int height = lineCount * m_lineHeight + 2 * m_textTop;
    CSprite::SetSize(width, height);
    m_fScrHeight = static_cast<float>(WindowHeight);
    m_fDatumX = width / 2.f;
    m_fDatumY = static_cast<float>(height);
    vec3_t afPos;
    VectorCopy(m_pCharInfo->Object.Position, afPos);
    afPos[2] += 350.0f;

    int nPosX, nPosY;
    CameraProjection::WorldToScreen(g_Camera, afPos, &nPosX, &nPosY);

    CSprite::SetPosition(
        std::clamp(int(nPosX * g_fScreenRate_x), width / 2, screenWidth - (width + 1) / 2),
        std::clamp(int(nPosY * g_fScreenRate_y), height, std::max(height, screenHeight))
    );
}

void CCharInfoBalloon::RenderLines()
{
    g_pRenderText->SetFont(g_hFixFont);
    g_pRenderText->SetBgColor(0);

    const int spriteX = CSprite::GetXPos();
    const int spriteY = CSprite::GetYPos();
    const int spriteW = CSprite::GetWidth();

    const int nTextPosX = int(spriteX / g_fScreenRate_x);

    const wchar_t* lines[] = { m_szName, m_szGuild, m_szClass };
    const DWORD colors[] = { m_dwNameColor, CLRDW_WHITE, CLRDW_BR_ORANGE };
    constexpr int horizontalPadding = 6;
    for (size_t line = 0; line < std::size(lines); ++line)
    {
        g_pRenderText->SetTextColor(colors[line]);
        g_pRenderText->RenderText(nTextPosX + horizontalPadding,
            int((spriteY + m_textTop + line * m_lineHeight) / g_fScreenRate_y),
            lines[line], spriteW / g_fScreenRate_x - horizontalPadding * 2,
            m_lineHeight / g_fScreenRate_y, RT3_SORT_CENTER_FIT);
    }
}

void CCharInfoBalloon::SetInfo()
{
    if (m_pCharInfo == nullptr)
        return;

    if (!m_pCharInfo->Object.Live)
    {
        CSprite::m_bShow = false;
        return;
    }

    CSprite::m_bShow = true;

    m_dwNameColor = ResolveNameColor(m_pCharInfo->CtlCode);

    CopyWideString(m_szName, m_pCharInfo->ID);

    const int guildTextIndex = ResolveGuildTextIndex(m_pCharInfo->GuildStatus);
    mu_swprintf_s(m_szGuild, L"(%ls)", I18N::Game::Lookup(guildTextIndex));
    mu_swprintf_s(m_szClass, L"%ls %d",
        gCharacterManager.GetCharacterClassText(m_pCharInfo->Class),
        m_pCharInfo->Level);
}
