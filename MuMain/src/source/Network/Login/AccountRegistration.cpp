// Self-service account registration: WinINet POST to the embedded admin panel
// (/api/registration/create). Desktop Windows only; other platforms get a stub
// (their builds auto-login and never show the register button).

#include "stdafx.h"
#include "Network/Login/AccountRegistration.h"

#if defined(_WIN32)

#include <wininet.h>
#include <string>

#pragma comment(lib, "wininet.lib")

namespace
{
    // UTF-16 -> UTF-8 for the JSON body.
    std::string ToUtf8(const std::wstring& value)
    {
        if (value.empty())
            return {};

        const int length = WideCharToMultiByte(CP_UTF8, 0, value.c_str(),
            static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
        std::string result(length, '\0');
        if (length > 0)
        {
            WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()),
                result.data(), length, nullptr, nullptr);
        }

        return result;
    }

    // Minimal JSON string escaper. Inputs are restricted to printable ASCII,
    // but quote/backslash/newline are handled defensively anyway.
    std::string JsonEscape(const std::string& value)
    {
        std::string result;
        result.reserve(value.size() + 4);
        for (const unsigned char ch : value)
        {
            switch (ch)
            {
            case '"':  result += "\\\""; break;
            case '\\': result += "\\\\"; break;
            case '\b': result += "\\b"; break;
            case '\f': result += "\\f"; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default:
                if (ch < 0x20)
                {
                    char buffer[8];
                    sprintf_s(buffer, "\\u%04x", static_cast<unsigned int>(ch));
                    result += buffer;
                }
                else
                {
                    result += static_cast<char>(ch);
                }
                break;
            }
        }

        return result;
    }

    // Extracts the string value of "code":"xxx" from a small JSON response.
    std::string ExtractJsonCode(const std::string& body)
    {
        const std::string key = "\"code\":\"";
        const size_t start = body.find(key);
        if (start == std::string::npos)
            return {};

        const size_t valueStart = start + key.size();
        const size_t end = body.find('"', valueStart);
        if (end == std::string::npos)
            return {};

        return body.substr(valueStart, end - valueStart);
    }
}

namespace Network::Login
{
    RegistrationResult PostAccountRegistration(const wchar_t* serverHost,
        const std::wstring& loginName, const std::wstring& password)
    {
        RegistrationResult result;

        if (serverHost == nullptr || serverHost[0] == L'\0')
            return result;

        wchar_t portText[16] = {};
        swprintf_s(portText, L"%d", AdminPanelPort);

        HINTERNET hInternet = InternetOpenW(L"OpenMUClient/1.0",
            INTERNET_OPEN_TYPE_PRECONFIG, nullptr, nullptr, 0);
        if (hInternet == nullptr)
            return result;

        HINTERNET hConnect = InternetConnectW(hInternet, serverHost,
            static_cast<INTERNET_PORT>(AdminPanelPort), nullptr, nullptr,
            INTERNET_SERVICE_HTTP, 0, 0);
        if (hConnect != nullptr)
        {
            HINTERNET hRequest = HttpOpenRequestW(hConnect, L"POST",
                L"/api/registration/create", nullptr, nullptr, nullptr, 0, 0);
            if (hRequest != nullptr)
            {
                // Keep a dead server from freezing the game for longer than a few seconds.
                const DWORD timeoutMs = 6000;
                InternetSetOptionW(hRequest, INTERNET_OPTION_CONNECT_TIMEOUT,
                    const_cast<DWORD*>(&timeoutMs), sizeof(timeoutMs));
                InternetSetOptionW(hRequest, INTERNET_OPTION_SEND_TIMEOUT,
                    const_cast<DWORD*>(&timeoutMs), sizeof(timeoutMs));
                InternetSetOptionW(hRequest, INTERNET_OPTION_RECEIVE_TIMEOUT,
                    const_cast<DWORD*>(&timeoutMs), sizeof(timeoutMs));

                const std::string bodyName = JsonEscape(ToUtf8(loginName));
                const std::string bodyPassword = JsonEscape(ToUtf8(password));
                const std::string body =
                    "{\"loginName\":\"" + bodyName
                    + "\",\"password\":\"" + bodyPassword
                    + "\",\"confirmPassword\":\"" + bodyPassword + "\"}";

                static const wchar_t kHeaders[] = L"Content-Type: application/json; charset=utf-8";
                const BOOL sent = HttpSendRequestW(hRequest, kHeaders,
                    static_cast<DWORD>(wcslen(kHeaders)),
                    const_cast<char*>(body.data()), static_cast<DWORD>(body.size()));

                if (sent)
                {
                    DWORD statusCode = 0;
                    DWORD statusSize = sizeof(statusCode);
                    if (HttpQueryInfoW(hRequest,
                        HTTP_QUERY_STATUS_CODE | HTTP_QUERY_FLAG_NUMBER,
                        &statusCode, &statusSize, nullptr) && statusCode == 200)
                    {
                        std::string response;
                        char readBuffer[1024];
                        DWORD bytesRead = 0;
                        for (;;)
                        {
                            bytesRead = 0;
                            if (!InternetReadFile(hRequest, readBuffer,
                                static_cast<DWORD>(sizeof(readBuffer)), &bytesRead)
                                || bytesRead == 0)
                            {
                                break;
                            }

                            response.append(readBuffer, bytesRead);
                        }

                        result.transportOk = true;
                        result.success = response.find("\"success\":true") != std::string::npos;
                        result.code = ExtractJsonCode(response);
                    }
                }

                InternetCloseHandle(hRequest);
            }

            InternetCloseHandle(hConnect);
        }

        InternetCloseHandle(hInternet);
        return result;
    }
}

#else

namespace Network::Login
{
    RegistrationResult PostAccountRegistration(const wchar_t* /*serverHost*/,
        const std::wstring& /*loginName*/, const std::wstring& /*password*/)
    {
        return RegistrationResult {};
    }
}

#endif
