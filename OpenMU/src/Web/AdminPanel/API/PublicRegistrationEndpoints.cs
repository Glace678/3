// <copyright file="PublicRegistrationEndpoints.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.Web.AdminPanel.API;

using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using MUnique.OpenMU.DataModel.Configuration;
using MUnique.OpenMU.DataModel.Entities;
using MUnique.OpenMU.Persistence;

/// <summary>
/// Maps the account self-registration endpoint used by the game client.
/// It is intentionally anonymous: the game client talks to the locally hosted
/// admin panel (loopback, or a private LAN address when mobile access is on).
/// </summary>
public static class PublicRegistrationEndpoints
{
    // The classic login server only accepts 3-10 ASCII letters or digits.
    private static readonly Regex ValidLoginName = new("^[A-Za-z0-9]{3,10}$", RegexOptions.Compiled);

    /// <summary>Maps the public registration API without authorization.</summary>
    /// <param name="endpoints">The routes which will receive the registration API.</param>
    /// <returns>The supplied builder, to allow further endpoint mappings.</returns>
    public static IEndpointRouteBuilder MapPublicRegistrationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/api/registration").AllowAnonymous();

        group.MapPost("/create", CreateAccountAsync).DisableAntiforgery();

        return endpoints;
    }

    private static async Task<IResult> CreateAccountAsync(
        AccountRegistrationRequest? request,
        IPersistenceContextProvider persistenceContextProvider,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("MUnique.OpenMU.PublicRegistration");
        var loginName = (request?.LoginName ?? string.Empty).Trim();
        var password = request?.Password ?? string.Empty;
        var confirmedPassword = request?.ConfirmPassword ?? string.Empty;

        if (!ValidLoginName.IsMatch(loginName))
        {
            return Results.Ok(new AccountRegistrationResponse(false, "invalid_name", "账号名需为 3-10 位字母或数字。"));
        }

        if (password.Length is < 3 or > 20 || password.Any(c => c < 0x21 || c > 0x7e))
        {
            return Results.Ok(new AccountRegistrationResponse(false, "invalid_password", "密码需为 3-20 位，且不能包含空格。"));
        }

        if (password != confirmedPassword)
        {
            return Results.Ok(new AccountRegistrationResponse(false, "password_mismatch", "两次输入的密码不一致。"));
        }

        using var configurationContext = persistenceContextProvider.CreateNewConfigurationContext();
        var configurations = await configurationContext.GetAsync<GameConfiguration>().ConfigureAwait(false);
        var configuration = configurations.FirstOrDefault();
        if (configuration is null)
        {
            logger.LogError("Self-registration failed: no game configuration exists yet.");
            return Results.Ok(new AccountRegistrationResponse(false, "error", "服务器尚未初始化完成，请稍后再试。"));
        }

        using var context = persistenceContextProvider.CreateNewPlayerContext(configuration);
        Account? account = null;
        try
        {
            if (await context.GetAccountByLoginNameAsync(loginName).ConfigureAwait(false) is not null)
            {
                return Results.Ok(new AccountRegistrationResponse(false, "duplicate", "该账号名已存在，请换一个。"));
            }

            if (context.HasChanges && !await context.SaveChangesAsync().ConfigureAwait(false))
            {
                return Results.Ok(new AccountRegistrationResponse(false, "error", "服务器正忙，请稍后重试。"));
            }

            account = context.CreateNew<Account>();
            account.LoginName = loginName;
            account.PasswordHash = BCrypt.Net.BCrypt.HashPassword(password);
            account.State = AccountState.Normal;
            account.LanguageIsoCode = "zh";
            account.RegistrationDate = DateTime.UtcNow;

            if (!await context.SaveChangesAsync().ConfigureAwait(false))
            {
                throw new InvalidOperationException("The account context did not confirm the save.");
            }

            logger.LogInformation("Self-registered account {LoginName}.", loginName);
            return Results.Ok(new AccountRegistrationResponse(true, "ok", "注册成功，现在可以登录了。"));
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Self-registration for {LoginName} failed.", loginName);
            if (account is not null)
            {
                try
                {
                    context.Detach(account);
                }
                catch (Exception cleanupError)
                {
                    logger.LogError(cleanupError, "Could not detach the unsaved account.");
                }
            }

            return Results.Ok(new AccountRegistrationResponse(false, "error", "注册失败，请检查服务器是否已启动。"));
        }
    }
}
