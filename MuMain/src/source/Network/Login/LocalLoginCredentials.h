#pragma once

#include <string>
#include <string_view>

namespace Network::Login
{
    // Launcher credentials are used only when no saved account was selected.
    class LocalLoginCredentials
    {
    public:
        static LocalLoginCredentials FromEnvironment();
        static LocalLoginCredentials Parse(std::string_view username, std::string_view password);

        bool IsValid() const { return !m_username.empty() && !m_password.empty(); }
        const std::wstring& Username() const { return m_username; }
        const std::wstring& Password() const { return m_password; }

    private:
        std::wstring m_username;
        std::wstring m_password;
    };
}
