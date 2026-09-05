// <copyright file="LocalStackSettingsStoreTests.cs" company="MUnique">
// Licensed under the MIT License. See LICENSE file in the project root for full license information.
// </copyright>

namespace MUnique.OpenMU.LocalLauncher.Tests;

using System.Net;
using System.Net.Sockets;

/// <summary>
/// Tests the local settings validation and persistence.
/// </summary>
public class LocalStackSettingsStoreTests
{
    private string _directory = null!;

    /// <summary>Creates an isolated test directory.</summary>
    [SetUp]
    public void SetUp()
    {
        this._directory = Path.Combine(Path.GetTempPath(), $"openmu-settings-{Guid.NewGuid():N}");
        Directory.CreateDirectory(this._directory);
    }

    /// <summary>Removes the isolated test directory.</summary>
    [TearDown]
    public void TearDown()
    {
        Directory.Delete(this._directory, recursive: true);
    }

    /// <summary>Verifies defaults and round-trip serialization.</summary>
    [Test]
    public void SettingsRoundTrip()
    {
        var store = new LocalStackSettingsStore(Path.Combine(this._directory, "settings.json"));
        var settings = store.Load();
        Assert.Multiple(() =>
        {
            Assert.That(settings.DatabasePort, Is.EqualTo(55432));
            Assert.That(settings.AdminPanelPort, Is.EqualTo(5080));
            Assert.That(settings.ConnectServerPort, Is.EqualTo(44406));
            Assert.That(settings.BackupRetentionCount, Is.EqualTo(10));
            Assert.That(settings.AutomaticGameLogin, Is.True);
        });

        settings.StartWithWindows = true;
        settings.SoloCashShopVersion = 1;
        settings.AutomaticGameLogin = false;
        store.Save(settings);
        Assert.That(store.Load().StartWithWindows, Is.True);
        Assert.That(store.Load().SoloCashShopVersion, Is.EqualTo(1));
        Assert.That(store.Load().AutomaticGameLogin, Is.False);
    }

    /// <summary>Older local settings enable the reversible automatic-login option.</summary>
    [Test]
    public void ExistingSettingsEnableAutomaticGameLogin()
    {
        var path = Path.Combine(this._directory, "settings.json");
        File.WriteAllText(path, "{}");
        Assert.That(new LocalStackSettingsStore(path).Load().AutomaticGameLogin, Is.True);
    }

    /// <summary>The game inherits no administrator password through this feature.</summary>
    [TestCase(true, "1")]
    [TestCase(false, "0")]
    public void AutomaticLoginIsAProcessLocalFlag(bool enabled, string expectedValue)
    {
        var configuration = Path.Combine(this._directory, "game-config.ini");
        var environment = LocalStackManager.CreateGameEnvironment(configuration, enabled);
        Assert.That(environment, Has.Count.EqualTo(3));
        Assert.That(environment["MU_CONFIG_FILE"], Is.EqualTo(configuration));
        Assert.That(environment["MU_SOLO_BALANCE"], Is.EqualTo("1"));
        Assert.That(environment["MU_LOCAL_AUTO_LOGIN"], Is.EqualTo(expectedValue));
    }
    /// <summary>Verifies duplicate ports are rejected.</summary>
    [Test]
    public void DuplicatePortsAreRejected()
    {
        var store = new LocalStackSettingsStore(Path.Combine(this._directory, "settings.json"));
        var settings = new LocalStackSettings { AdminPanelPort = 55432 };
        Assert.Throws<InvalidDataException>(() => store.Save(settings));
    }

    /// <summary>Verifies invalid process timeouts are rejected before they reach process control.</summary>
    [Test]
    public void InvalidTimeoutIsRejected()
    {
        var store = new LocalStackSettingsStore(Path.Combine(this._directory, "settings.json"));
        var settings = new LocalStackSettings { ServerStartupTimeoutSeconds = -1 };
        Assert.Throws<InvalidDataException>(() => store.Save(settings));
    }

    /// <summary>Verifies launcher-owned ports cannot overlap fixed game-service ports.</summary>
    [Test]
    public void FixedGameServicePortConflictIsRejected()
    {
        var store = new LocalStackSettingsStore(Path.Combine(this._directory, "settings.json"));
        var settings = new LocalStackSettings { AdminPanelPort = 55902 };
        Assert.Throws<InvalidDataException>(() => store.Save(settings));
    }

    /// <summary>A wildcard or loopback listener must not be mistaken for a free local port.</summary>
    [TestCase("0.0.0.0")]
    [TestCase("127.0.0.1")]
    public void ExistingListenerIsRejectedWithoutStoppingIt(string address)
    {
        var listener = new TcpListener(IPAddress.Parse(address), 0) { ExclusiveAddressUse = false };
        try
        {
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            Assert.Throws<InvalidOperationException>(() => LocalStackManager.EnsurePortAvailable(port, "test"));
            Assert.That(listener.Server.IsBound, Is.True);
        }
        finally
        {
            listener.Stop();
        }
    }

    /// <summary>The availability check releases its temporary socket before returning.</summary>
    [Test]
    public void AvailablePortIsReleasedAfterCheck()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();

        LocalStackManager.EnsurePortAvailable(port, "test");
        var replacement = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
        try
        {
            Assert.DoesNotThrow(() => replacement.Start());
        }
        finally
        {
            replacement.Stop();
        }
    }

    /// <summary>Older and unknown migration markers cannot silently disable backups.</summary>
    [TestCase(-1)]
    [TestCase(2)]
    public void UnsupportedShopVersionIsRejected(int version)
    {
        var store = new LocalStackSettingsStore(Path.Combine(this._directory, "settings.json"));
        Assert.Throws<InvalidDataException>(() => store.Save(new LocalStackSettings { SoloCashShopVersion = version }));
    }

    /// <summary>Read-only application payloads can keep saves outside their installation directory.</summary>
    [Test]
    public void SeparateDataDirectoryAndNativeExecutableNames()
    {
        var data = Path.Combine(this._directory, "user-save");
        var paths = new LocalPaths(Path.Combine(this._directory, "payload"), data);
        Assert.That(paths.PostgreSqlDataDirectory, Is.EqualTo(Path.Combine(data, "PostgreSQL")));
        Assert.That(paths.GameExecutable, Does.EndWith(LocalPlatform.ExecutableName("Main")));
        Assert.That(paths.SecretsFile, Does.StartWith(data + Path.DirectorySeparatorChar));
    }

    /// <summary>The same installation must have the same control channel for GUI and CLI paths.</summary>
    [TestCase(false)]
    [TestCase(true)]
    public void ControlChannelIgnoresTrailingDirectorySeparators(bool separateData)
    {
        var data = separateData ? Path.Combine(this._directory, "save") : null;
        var paths = new LocalPaths(this._directory, data);
        var alternate = new LocalPaths(
            this._directory + Path.DirectorySeparatorChar,
            data is null ? null : data + Path.DirectorySeparatorChar);
        var manager = new OpenMuServerManager(paths, new LocalStackSettings(), new ProcessRunner());
        var other = new OpenMuServerManager(alternate, new LocalStackSettings(), new ProcessRunner());
        Assert.That(other.PipeName, Is.EqualTo(manager.PipeName));
    }

    /// <summary>Player preferences never mutate the package template or get reset on restart.</summary>
    [Test]
    public void GameConfigurationIsPrivateAndPreserved()
    {
        var paths = new LocalPaths(this._directory);
        paths.EnsureDataDirectories();
        Directory.CreateDirectory(paths.GameDirectory);
        var template = Path.Combine(paths.GameDirectory, "config.ini");
        const string defaults = "[Window]\nWindowed=0\n";
        File.WriteAllText(template, defaults);
        var configuration = LocalStackManager.PrepareGameConfiguration(paths);
        Assert.That(configuration, Does.StartWith(paths.KeysDirectory + Path.DirectorySeparatorChar));
        Assert.That(File.ReadAllText(configuration), Is.EqualTo(defaults));
        File.WriteAllText(configuration, "[Window]\nWindowed=1\n");

        Assert.That(LocalStackManager.PrepareGameConfiguration(paths), Is.EqualTo(configuration));
        Assert.That(File.ReadAllText(configuration), Does.Contain("Windowed=1"));
        Assert.That(File.ReadAllText(template), Is.EqualTo(defaults));
        if (!OperatingSystem.IsWindows())
        {
            Assert.That(File.GetUnixFileMode(configuration), Is.EqualTo(UnixFileMode.UserRead | UnixFileMode.UserWrite));
        }
    }

    /// <summary>Desktop command parsing rejects ambiguous destructive commands.</summary>
    [TestCase("--start --stop")]
    [TestCase("--root")]
    [TestCase("--stop --stop")]
    [TestCase("--force")]
    public void InvalidDesktopArgumentsAreRejected(string arguments)
    {
        Assert.Throws<ArgumentException>(() => DesktopApplication.ParseArguments(arguments.Split(' ')));
    }

    /// <summary>Paths with spaces are parsed as structured arguments.</summary>
    [Test]
    public void DesktopArgumentsPreservePaths()
    {
        var root = Path.Combine(this._directory, "game with spaces");
        var parsed = DesktopApplication.ParseArguments(["--root", root, "--probe"]);
        Assert.That(parsed["--root"], Is.EqualTo(root));
        Assert.That(parsed.ContainsKey("--probe"), Is.True);
    }

    /// <summary>Non-ASCII Windows aliases are rejected before filesystem mutation.</summary>
    [Test]
    public void NonAsciiAliasRootIsRejected()
    {
        var paths = new LocalPaths(@"D:\OpenMU-中文包");
        Assert.Throws<InvalidOperationException>(() => PostgreSqlExecutionPaths.Create(paths, @"D:\别名"));
    }

    /// <summary>Redirected PostgreSQL aliases cannot point to another package.</summary>
    [Test]
    public void MismatchedResolvedTargetIsRejected()
    {
        Assert.Throws<InvalidDataException>(() => PostgreSqlExecutionPaths.ValidateResolvedTarget(
            @"C:\ProgramData\OpenMU-Local\Aliases\data",
            @"D:\OtherPackage\Data\PostgreSQL",
            @"D:\ExpectedPackage\Data\PostgreSQL"));
    }
}
