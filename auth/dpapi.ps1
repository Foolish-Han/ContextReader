param([ValidateSet('protect','unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$taskValue = [Console]::In.ReadToEnd()
if ($Mode -eq 'protect') {
    $taskPlain = [Text.Encoding]::UTF8.GetBytes($taskValue)
    $taskCipher = [Security.Cryptography.ProtectedData]::Protect($taskPlain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($taskCipher))
} else {
    $taskCipher = [Convert]::FromBase64String($taskValue)
    $taskPlain = [Security.Cryptography.ProtectedData]::Unprotect($taskCipher, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($taskPlain))
}
