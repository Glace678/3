// <copyright file="LocalGameLoginTests.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.LocalLauncher.Tests;

/// <summary>Verifies private and stable first-run game credentials.</summary>
public class LocalGameLoginTests
{
    /// <summary>Restart and backup restore keep the same account, without reusing admin credentials.</summary>
    [Test]
    public void CredentialsAreStableAndProtocolCompatible()
    {
        var secrets = DpapiSecretStore.Create("administrator-password");
        var login = LocalGameLogin.FromSecrets(secrets);
        var again = LocalGameLogin.FromSecrets(secrets);
        Assert.Multiple(() =>
        {
            Assert.That(login.Username, Is.EqualTo(again.Username));
            Assert.That(login.Password, Is.EqualTo(again.Password));
            Assert.That(login.Username, Does.Match("^solo[A-F0-9]{6}$"));
            Assert.That(login.Password, Does.Match("^[A-Za-z0-9_-]{20}$"));
            Assert.That(login.Password, Is.Not.EqualTo(secrets.AdminPanelPassword));
            Assert.That(login.Password, Is.Not.EqualTo(secrets.AccountPassword));
        });
        secrets.AdminPanelPassword = "changed-administrator-password";
        Assert.That(LocalGameLogin.FromSecrets(secrets).Password, Is.EqualTo(login.Password));
        Assert.That(LocalGameLogin.FromSecrets(DpapiSecretStore.Create("other-administrator-password")).Password,
            Is.Not.EqualTo(login.Password));
    }

    /// <summary>Disabling automatic login removes inherited credentials as well as the flag.</summary>
    [TestCase(true)]
    [TestCase(false)]
    public void OnlyAutomaticLoginReceivesGameCredentials(bool enabled)
    {
        var login = LocalGameLogin.FromSecrets(DpapiSecretStore.Create("administrator-password"));
        var environment = LocalStackManager.CreateGameEnvironment("game-config.ini", enabled, login);
        Assert.That(environment["MU_LOCAL_GAME_USERNAME"], Is.EqualTo(enabled ? login.Username : null));
        Assert.That(environment["MU_LOCAL_GAME_PASSWORD"], Is.EqualTo(enabled ? login.Password : null));
        Assert.That(environment.Keys, Does.Not.Contain("OPENMU_ADMIN_PASSWORD"));
    }

    /// <summary>The server provisions only the same local account offered to the client.</summary>
    [TestCase(true)]
    [TestCase(false)]
    public void ServerProvisioningUsesTheSameAccountAndStaysOnLoopback(bool enabled)
    {
        var secrets = DpapiSecretStore.Create("administrator-password");
        var login = LocalGameLogin.FromSecrets(secrets);
        var server = new OpenMuServerManager(new LocalPaths(Path.GetTempPath()),
            new LocalStackSettings { AutomaticGameLogin = enabled }, new ProcessRunner());
        var environment = server.CreateServerEnvironment(secrets);
        Assert.That(environment["OPENMU_LOCAL_GAME_USERNAME"], Is.EqualTo(enabled ? login.Username : null));
        Assert.That(environment["OPENMU_LOCAL_GAME_PASSWORD"], Is.EqualTo(enabled ? login.Password : null));
        Assert.That(environment["OPENMU_BIND_ADDRESS"], Is.EqualTo("127.0.0.1"));
        Assert.That(environment["OPENMU_CONTROL_PIPE"], Is.EqualTo(server.PipeName));
        Assert.That(environment["OPENMU_ADMIN_PASSWORD"], Is.EqualTo(secrets.AdminPanelPassword));
    }
}
