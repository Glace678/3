// <copyright file="SoloBalance.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.GameLogic;

using MUnique.OpenMU.DataModel.Configuration;

/// <summary>
/// Shared rules for installations explicitly converted to the local solo profile.
/// </summary>
public static class SoloBalance
{
    /// <summary>Prices are expressed in smaller units, without changing item crafting valuations.</summary>
    public const int PriceDivisor = 1000;

    /// <summary>The persistent attribute which marks a completed profile conversion.</summary>
    public static readonly Guid ProfileAttributeId = new("9d0e5c83-794b-4bc1-9260-cc32888650a1");

    /// <summary>Returns whether the configuration has the solo profile installed.</summary>
    /// <param name="configuration">The active configuration.</param>
    /// <returns>Whether the profile is installed.</returns>
    public static bool IsEnabled(GameConfiguration configuration) =>
        configuration.GlobalBaseAttributeValues.Any(a => a.Definition.Id == ProfileAttributeId && a.Value >= 1);

    /// <summary>Scales a transaction once, preserving zero and a minimum positive price of one Zen.</summary>
    /// <param name="price">The original final price.</param>
    /// <param name="configuration">The active configuration.</param>
    /// <returns>The payable price.</returns>
    public static long ScalePrice(long price, GameConfiguration configuration) =>
        IsEnabled(configuration) ? ScalePrice(price) : price;

    /// <summary>Converts a positive legacy price to solo Zen.</summary>
    /// <param name="price">The original final price.</param>
    /// <returns>The converted price.</returns>
    public static long ScalePrice(long price) => price > 0 ? Math.Max(1, price / PriceDivisor) : price;
}
