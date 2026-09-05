#include "Network/Login/LocalLoginCredentials.h"

#include <algorithm>
#include <cstdlib>

namespace Network::Login
{
    LocalLoginCredentials LocalLoginCredentials::FromEnvironment()
    {
        const char* enabled = std::getenv("MU_LOCAL_AUTO_LOGIN");
        const char* username = std::getenv("MU_LOCAL_GAME_USERNAME");
        const char* password = std::getenv("MU_LOCAL_GAME_PASSWORD");
        if (!enabled || std::string_view(enabled) != "1" || !username || !password)
        {
            return {};
        }

        return Parse(username, password);
    }

    LocalLoginCredentials LocalLoginCredentials::Parse(std::string_view username, std::string_view password)
    {
        constexpr size_t MinimumUsernameLength = 3;
        constexpr size_t MaximumUsernameLength = 10;
        constexpr size_t MinimumPasswordLength = 12;
        constexpr size_t MaximumPasswordLength = 20;
        const auto isAlphanumeric = [](char c) {
            return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
        };
        if (username.size() < MinimumUsernameLength || username.size() > MaximumUsernameLength
            || password.size() < MinimumPasswordLength || password.size() > MaximumPasswordLength
            || !std::all_of(username.begin(), username.end(), isAlphanumeric)
            || !std::all_of(password.begin(), password.end(),
                [&](char c) { return isAlphanumeric(c) || c == '-' || c == '_'; }))
        {
            return {};
        }

        LocalLoginCredentials credentials;
        credentials.m_username.assign(username.begin(), username.end());
        credentials.m_password.assign(password.begin(), password.end());
        return credentials;
    }
}
