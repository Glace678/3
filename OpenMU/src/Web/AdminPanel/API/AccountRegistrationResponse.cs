// <copyright file="AccountRegistrationResponse.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.Web.AdminPanel.API;

/// <summary>
/// Response of <c>POST /api/registration/create</c>: always HTTP 200, the result is in
/// <see cref="Success"/> so the game client can map <see cref="Code"/> to a localized
/// message without parsing Chinese JSON text.
/// </summary>
/// <param name="Success">If set to <c>true</c>, the account was created.</param>
/// <param name="Code">Stable result code: ok, invalid_name, invalid_password,
/// password_mismatch, duplicate or error.</param>
/// <param name="Message">A human readable status message (Chinese).</param>
public sealed record AccountRegistrationResponse(bool Success, string Code, string Message);
