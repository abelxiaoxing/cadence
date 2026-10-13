# Excluded wrapper. Existing pwsh/.NET only: in-memory library, no install/SDK/Job.
param([Parameter(Mandatory = $true)][string] $Config)
$ErrorActionPreference = 'Stop'
$started = [System.Diagnostics.Stopwatch]::StartNew()
$phase = 'powershell-compilation'
try {
    Add-Type -LiteralPath (Join-Path $PSScriptRoot 'task-shell-conpty.cs') -ErrorAction Stop 2>$null
    $phase = 'powershell-entry'
    $status = [Cadence.TerminalFixture.Fixture]::Run($Config, $started.Elapsed.TotalMilliseconds, $PSVersionTable.PSVersion.ToString())
    exit $status
}
catch {
    # Never print compiler/config exceptions, source, argv or environment values.
    try {
        if ((Get-Item -LiteralPath $Config).Length -gt 131072) { throw 'config-overflow' }
        $root = (Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json).root
        $receipt = @{
            transport = 'windows-conpty'; failure = 'conpty-setup-failed'
            failureStage = $phase; nativeWaitReturned = $false
            nativeWaitResult = $null; nativeWaitError = $null; exitCodeError = $null
            firstNativeFault = $null; firstWaitFailure = $null; firstExitFailure = $null
            exitCode = $null; cleanQuit = $false
            waitBeforeClose = $false; forced = $false; closePseudoConsoleCalled = $false
            closePseudoConsoleReturned = $false; physicalHuman = $false; nativeExecutor = $false
            paidProvider = $false; managerInstall = $false; outputEof = $false
            # Null means unobserved, never a claim that entry resources closed.
            resourcesRetained = $null; teardownFailure = $null
            diagnosticSnapshotMayAdvance = $null; pumps = $null; handleInheritance = $null; createProcessInheritHandles = $null
            smokePrerequisiteReached = $null; smokePumpInjection = $null
            controlCutoff = $null; lateControl = $null
            closeWorkerStarted = $null; closeWorkerJoined = $null
            pwsh = $PSVersionTable.PSVersion.ToString(); dotnet = [System.Environment]::Version.ToString()
            seconds = $started.Elapsed.TotalSeconds
        }
        [System.IO.File]::WriteAllText((Join-Path $root 'pty-receipt.json'), ($receipt | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
    }
    catch { [Console]::Error.WriteLine('conpty-diagnostics-unavailable') }
    exit 1
}
