[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$mobileKey = 'A' * 43
$keyArgument = '-POPENMU_MOBILE_PACKAGE_KEY={0}' -f $mobileKey

Push-Location $projectRoot
try {
    & .\gradlew.bat :game-app:compileDebugUnitTestJavaWithJavac :gm-app:compileDebugUnitTestJavaWithJavac $keyArgument
    if ($LASTEXITCODE -ne 0) {
        throw "Test compilation failed with exit code $LASTEXITCODE"
    }

    $junit = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\junit\junit\4.13.2" `
        -Recurse -Filter 'junit-4.13.2.jar' | Select-Object -First 1 -ExpandProperty FullName
    $hamcrest = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\org.hamcrest\hamcrest-core\1.3" `
        -Recurse -Filter 'hamcrest-core-1.3.jar' | Select-Object -First 1 -ExpandProperty FullName
    if (!$junit -or !$hamcrest) {
        throw 'JUnit runtime was not resolved by Gradle'
    }

    $gameClasspath = @(
        "$projectRoot\game-app\build\intermediates\javac\debugUnitTest\classes"
        "$projectRoot\game-app\build\intermediates\javac\debug\classes"
        $junit
        $hamcrest
    ) -join [IO.Path]::PathSeparator
    & java -cp $gameClasspath org.junit.runner.JUnitCore net.munique.openmu.game.MobileIdentityTest
    if ($LASTEXITCODE -ne 0) {
        throw 'game-app mobile logic tests failed'
    }

    $gmClasspath = @(
        "$projectRoot\gm-app\build\intermediates\javac\debugUnitTest\classes"
        "$projectRoot\gm-app\build\intermediates\javac\debug\classes"
        $junit
        $hamcrest
    ) -join [IO.Path]::PathSeparator
    & java -cp $gmClasspath org.junit.runner.JUnitCore net.munique.openmu.gm.ServerAddressPolicyTest
    if ($LASTEXITCODE -ne 0) {
        throw 'gm-app mobile logic tests failed'
    }
} finally {
    Pop-Location
}
