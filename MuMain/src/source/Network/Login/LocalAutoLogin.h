#pragma once

#include <string_view>

namespace Network::Login
{
    inline constexpr char LocalAutoLoginEnvironment[] = "MU_LOCAL_AUTO_LOGIN";

    // One startup attempt, restricted to the launcher's literal loopback endpoint.
    class LocalAutoLogin
    {
    public:
        static LocalAutoLogin& Instance();

        void Initialize(bool enabled, std::wstring_view host, bool hasSavedCredentials);
        bool CanSelectServer() const;
        void ServerSelected();
        void ServerAddressReceived(std::wstring_view host);
        bool TryBeginLogin();
        void Cancel();

    private:
        enum class Stage { Disabled, SelectingServer, WaitingForAddress, WaitingForHello, Finished };

        bool m_initialized = false;
        Stage m_stage = Stage::Disabled;
    };
}
