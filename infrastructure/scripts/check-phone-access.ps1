param(
  [Parameter(Mandatory = $true)]
  [string]$HostAddress,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($HostAddress, [ref]$parsedAddress) -or
    $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
  throw "HostAddress must be an IPv4 address, for example 192.168.1.25."
}

$baseUrl = "http://${HostAddress}:$Port"
$checks = @(
  @{ Name = "player app"; Path = "/"; Expected = 200 },
  @{ Name = "API readiness through web proxy"; Path = "/health/ready"; Expected = 200 },
  @{ Name = "unauthenticated auth boundary"; Path = "/api/v1/me"; Expected = 401 }
)

$failed = $false
foreach ($check in $checks) {
  try {
    $response = Invoke-WebRequest -Uri ($baseUrl + $check.Path) -UseBasicParsing -TimeoutSec 10 -SkipHttpErrorCheck
    $status = [int]$response.StatusCode
    $passed = $status -eq $check.Expected
    if (-not $passed) { $failed = $true }
    $mark = if ($passed) { "PASS" } else { "FAIL" }
    Write-Host ("[{0}] {1}: HTTP {2} (expected {3})" -f $mark, $check.Name, $status, $check.Expected)
  } catch {
    $failed = $true
    Write-Host ("[FAIL] {0}: {1}" -f $check.Name, $_.Exception.Message)
  }
}

if ($failed) {
  Write-Host "Phone access is not ready. Check Docker, the selected LAN address, and the Windows firewall."
  exit 1
}

Write-Host "Phone access is ready: $baseUrl"
Write-Host "Open that exact address on a phone connected to the same Wi-Fi. Do not use localhost or port 4000."
