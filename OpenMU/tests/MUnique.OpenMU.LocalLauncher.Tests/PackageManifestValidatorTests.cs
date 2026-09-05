// <copyright file="PackageManifestValidatorTests.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.LocalLauncher.Tests;

using System.Text.Json;

/// <summary>
/// Tests the portable-package trust boundary.
/// </summary>
public class PackageManifestValidatorTests
{
    private string _directory = null!;

    /// <summary>Creates an isolated package directory.</summary>
    [SetUp]
    public void SetUp()
    {
        this._directory = Path.Combine(Path.GetTempPath(), $"openmu-manifest-{Guid.NewGuid():N}");
        Directory.CreateDirectory(this._directory);
    }

    /// <summary>Removes the isolated package directory.</summary>
    [TearDown]
    public void TearDown()
    {
        Directory.Delete(this._directory, recursive: true);
    }

    /// <summary>Verifies paths cannot escape the portable package root.</summary>
    [Test]
    public void TraversalPathIsRejected()
    {
        var manifest = new
        {
            formatVersion = 1,
            version = "0.9.10-local.1",
            files = new[] { new { path = "../outside.exe", size = 0, sha256 = new string('0', 64) } },
        };
        File.WriteAllBytes(Path.Combine(this._directory, "manifest.json"), JsonSerializer.SerializeToUtf8Bytes(manifest));

        Assert.ThrowsAsync<InvalidDataException>(async () =>
            await new PackageManifestValidator().ValidateAsync(new LocalPaths(this._directory), CancellationToken.None));
    }

    /// <summary>Verifies a truncated manifest cannot omit required package executables.</summary>
    [Test]
    public void MissingRequiredFilesAreRejected()
    {
        var filePath = Path.Combine(this._directory, "placeholder.txt");
        File.WriteAllText(filePath, string.Empty);
        var manifest = new
        {
            formatVersion = 1,
            version = "0.9.10-local.1",
            files = new[] { new { path = "placeholder.txt", size = 0, sha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(Array.Empty<byte>())) } },
        };
        File.WriteAllBytes(Path.Combine(this._directory, "manifest.json"), JsonSerializer.SerializeToUtf8Bytes(manifest));

        Assert.ThrowsAsync<InvalidDataException>(async () =>
            await new PackageManifestValidator().ValidateAsync(new LocalPaths(this._directory), CancellationToken.None));
    }
}
