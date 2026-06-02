$ErrorActionPreference = "Stop"

$root = Join-Path $PSScriptRoot "BetTracker"
$port = 8080
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css" = "text/css; charset=utf-8"
    ".js" = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png" = "image/png"
    ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg" = "image/svg+xml"
    ".ico" = "image/x-icon"
}

function Write-Response {
    param(
        [System.Net.Sockets.TcpClient] $Client,
        [int] $Status,
        [string] $ContentType,
        [byte[]] $Body
    )

    $stream = $Client.GetStream()
    $statusText = if ($Status -eq 200) { "OK" } elseif ($Status -eq 404) { "Not Found" } else { "Error" }
    $header = "HTTP/1.1 $Status $statusText`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nAccess-Control-Allow-Origin: *`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($Body, 0, $Body.Length)
    $stream.Flush()
}

$listener.Start()
$localIp = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } |
    Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host "EdgeLedger is running."
Write-Host "Computer: http://localhost:$port"
Write-Host "Phone:    http://$localIp`:$port"
Write-Host "Press Ctrl+C to stop."

while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $reader = New-Object System.IO.StreamReader($client.GetStream())
        $requestLine = $reader.ReadLine()
        if (-not $requestLine) {
            $client.Close()
            continue
        }

        $parts = $requestLine.Split(" ")
        $requestPath = [System.Uri]::UnescapeDataString($parts[1].Split("?")[0])
        if ($requestPath -eq "/") {
            $requestPath = "/index.html"
        }

        $relativePath = $requestPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
        $filePath = Join-Path $root $relativePath
        $resolvedRoot = [System.IO.Path]::GetFullPath($root)
        $resolvedFile = [System.IO.Path]::GetFullPath($filePath)

        if ($resolvedFile.StartsWith($resolvedRoot) -and (Test-Path -LiteralPath $resolvedFile -PathType Leaf)) {
            $extension = [System.IO.Path]::GetExtension($resolvedFile).ToLowerInvariant()
            $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
            Write-Response -Client $client -Status 200 -ContentType $contentType -Body ([System.IO.File]::ReadAllBytes($resolvedFile))
        } else {
            Write-Response -Client $client -Status 404 -ContentType "text/plain; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes("Not found"))
        }
    } finally {
        $client.Close()
    }
}
