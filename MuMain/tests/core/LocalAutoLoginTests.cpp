#include "doctest.h"
#include "Network/Login/LocalAutoLogin.h"

using Network::Login::LocalAutoLogin;

TEST_CASE("Local automatic login requires opt-in, saved credentials and literal loopback")
{
    LocalAutoLogin disabled;
    disabled.Initialize(false, L"127.0.0.1", true);
    CHECK_FALSE(disabled.CanSelectServer());

    LocalAutoLogin missingCredentials;
    missingCredentials.Initialize(true, L"127.0.0.1", false);
    CHECK_FALSE(missingCredentials.CanSelectServer());

    for (auto host : {L"192.168.1.2", L"example.com", L"localhost", L"127.0.0.1.example.com", L""})
    {
        LocalAutoLogin remote;
        remote.Initialize(true, host, true);
        CHECK_FALSE(remote.CanSelectServer());
        CHECK_FALSE(remote.TryBeginLogin());
    }
}

TEST_CASE("Local automatic login waits for selection and a loopback game server")
{
    LocalAutoLogin login;
    login.Initialize(true, L"127.0.0.1", true);
    CHECK(login.CanSelectServer());
    CHECK_FALSE(login.TryBeginLogin());
    login.ServerSelected();
    CHECK_FALSE(login.CanSelectServer());
    CHECK_FALSE(login.TryBeginLogin());
    login.ServerAddressReceived(L"127.0.0.1");
    CHECK(login.TryBeginLogin());
    CHECK_FALSE(login.TryBeginLogin());
    login.Initialize(true, L"127.0.0.1", true);
    CHECK_FALSE(login.CanSelectServer());
}

TEST_CASE("A remote or unsolicited game server address cannot receive automatic credentials")
{
    LocalAutoLogin remote;
    remote.Initialize(true, L"127.0.0.1", true);
    remote.ServerSelected();
    remote.ServerAddressReceived(L"192.168.1.2");
    CHECK_FALSE(remote.TryBeginLogin());
    remote.ServerAddressReceived(L"127.0.0.1");
    CHECK_FALSE(remote.TryBeginLogin());

    LocalAutoLogin unsolicited;
    unsolicited.Initialize(true, L"127.0.0.1", true);
    unsolicited.ServerAddressReceived(L"127.0.0.1");
    CHECK_FALSE(unsolicited.TryBeginLogin());
}

TEST_CASE("Cancellation and repeated server addresses do not restart automatic login")
{
    LocalAutoLogin cancelled;
    cancelled.Initialize(true, L"127.0.0.1", true);
    cancelled.Cancel();
    cancelled.Initialize(true, L"127.0.0.1", true);
    cancelled.ServerSelected();
    cancelled.ServerAddressReceived(L"127.0.0.1");
    CHECK_FALSE(cancelled.TryBeginLogin());

    LocalAutoLogin duplicate;
    duplicate.Initialize(true, L"127.0.0.1", true);
    duplicate.ServerSelected();
    duplicate.ServerAddressReceived(L"127.0.0.1");
    duplicate.ServerAddressReceived(L"192.168.1.2");
    CHECK_FALSE(duplicate.TryBeginLogin());
}
