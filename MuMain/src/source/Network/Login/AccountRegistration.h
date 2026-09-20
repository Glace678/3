#pragma once

#include <string>

namespace Network::Login
{
    // Result of a registration POST against the locally hosted admin panel.
    struct RegistrationResult
    {
        bool transportOk = false;  // false: the HTTP request itself failed (server down / timeout)
        bool success = false;      // server answered and created the account
        std::string code;          // server result code: ok / invalid_name / invalid_password /
                                   // password_mismatch / duplicate / error
    };

    // Posts the registration to http://<serverHost>:<adminPanelPort>/api/registration/create.
    // Synchronous (short timeouts); the caller runs it directly on a button click.
    RegistrationResult PostAccountRegistration(const wchar_t* serverHost,
        const std::wstring& loginName, const std::wstring& password);

    // Port the embedded admin panel listens on (LocalStackSettings default 5080).
    inline constexpr int AdminPanelPort = 5080;
}
