#include "Network/Login/LocalAutoLogin.h"

namespace Network::Login
{
    namespace
    {
        constexpr std::wstring_view LocalHost = L"127.0.0.1";
    }

    LocalAutoLogin& LocalAutoLogin::Instance()
    {
        static LocalAutoLogin instance;
        return instance;
    }

    void LocalAutoLogin::Initialize(bool enabled, std::wstring_view host, bool hasSavedCredentials)
    {
        if (m_initialized)
        {
            return;
        }

        m_initialized = true;
        if (enabled && host == LocalHost && hasSavedCredentials)
        {
            m_stage = Stage::SelectingServer;
        }
    }

    bool LocalAutoLogin::CanSelectServer() const
    {
        return m_stage == Stage::SelectingServer;
    }

    void LocalAutoLogin::ServerSelected()
    {
        if (CanSelectServer())
        {
            m_stage = Stage::WaitingForAddress;
        }
    }

    void LocalAutoLogin::ServerAddressReceived(std::wstring_view host)
    {
        if (m_stage == Stage::WaitingForAddress)
        {
            m_stage = host == LocalHost ? Stage::WaitingForHello : Stage::Finished;
        }
        else
        {
            Cancel();
        }
    }

    bool LocalAutoLogin::TryBeginLogin()
    {
        if (m_stage != Stage::WaitingForHello)
        {
            return false;
        }

        m_stage = Stage::Finished;
        return true;
    }

    void LocalAutoLogin::Cancel()
    {
        m_stage = Stage::Finished;
    }
}
