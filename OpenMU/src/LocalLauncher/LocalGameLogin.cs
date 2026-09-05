// <copyright file="LocalGameLogin.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.LocalLauncher;

using System.Security.Cryptography;

/// <summary>Stable, installation-specific game credentials, separate from administrator credentials.</summary>
public sealed class LocalGameLogin
{
    private LocalGameLogin(string username, string password)
    {
        this.Username = username;
        this.Password = password;
    }

    /// <summary>Gets the ordinary game account name.</summary>
    public string Username { get; }

    /// <summary>Gets the game password, which must never be logged.</summary>
    public string Password { get; }

    /// <summary>Derives the same account after restart or a backup restore with the original keys.</summary>
    public static LocalGameLogin FromSecrets(LocalSecrets secrets)
    {
        DpapiSecretStore.Validate(secrets);
        var key = Encoding.UTF8.GetBytes(secrets.AccountPassword);
        try
        {
            var name = HMACSHA256.HashData(key, "OpenMU-Solo.LoginName.v1"u8);
            var password = HMACSHA256.HashData(key, "OpenMU-Solo.LoginPassword.v1"u8);
            return new LocalGameLogin("solo" + Convert.ToHexString(name)[..6],
                Convert.ToBase64String(password)[..20].Replace('+', '-').Replace('/', '_'));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(key);
        }
    }
}
