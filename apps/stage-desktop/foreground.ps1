$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# Top-level foreground window metadata only. No UI tree, input text or clipboard.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AislingForeground {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@

$foregroundHandle = [AislingForeground]::GetForegroundWindow()
$windowTitle = [System.Text.StringBuilder]::new(301)
[void][AislingForeground]::GetWindowTextW($foregroundHandle, $windowTitle, $windowTitle.Capacity)
$foregroundProcessId = [uint32]0
[void][AislingForeground]::GetWindowThreadProcessId($foregroundHandle, [ref]$foregroundProcessId)
$appName = ''
if ($foregroundProcessId -ne 0) {
    $foregroundProcess = Get-Process -Id $foregroundProcessId -ErrorAction SilentlyContinue
    if ($foregroundProcess) { $appName = $foregroundProcess.ProcessName }
}
@{ app = $appName; title = $windowTitle.ToString() } | ConvertTo-Json -Compress
