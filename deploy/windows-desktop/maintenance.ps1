# Windows PowerShell 5.1과 호환되는 설치·실행 확인 함수. UI·레지스트리와 분리해 실패 상황도 실행 검증한다.

function Test-IsumoaIdentity([string]$BaseUrl, [string]$TokenFile) {
  try {
    $uri = [Uri]$BaseUrl
    if (-not $uri.IsLoopback -or $uri.Scheme -ne 'http' -or -not (Test-Path -LiteralPath $TokenFile)) { return $false }
    $token = (Get-Content -LiteralPath $TokenFile -Raw -Encoding UTF8).Trim()
    if ($token -cnotmatch '^[a-f0-9]{48}$') { return $false }
    $nonce = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($nonce) } finally { $random.Dispose() }
    $challenge = [BitConverter]::ToString($nonce).Replace('-', '').ToLowerInvariant()
    $req = [System.Net.HttpWebRequest]::Create("$($BaseUrl.TrimEnd('/'))/api/health?challenge=$challenge")
    $req.Proxy = $null
    $req.AllowAutoRedirect = $false
    $req.Timeout = 2000
    $req.ReadWriteTimeout = 2000
    $res = $req.GetResponse()
    try {
      if ([int]$res.StatusCode -ne 200 -or $res.ContentType -notlike 'application/json*') { return $false }
      $stream = $res.GetResponseStream()
      $memory = New-Object System.IO.MemoryStream
      try {
        $buffer = New-Object byte[] 1024
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
          $memory.Write($buffer, 0, $read)
          if ($memory.Length -gt 8192) { return $false }
        }
        $body = [System.Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
      } finally { $memory.Dispose(); $stream.Dispose() }
    } finally { $res.Close() }
    if ($body.ok -isnot [bool] -or -not $body.ok -or $body.application -cne 'isumoa' -or $body.protocol -ne 1 -or
        [string]::IsNullOrWhiteSpace($body.version) -or $body.proof -cnotmatch '^[a-f0-9]{64}$') { return $false }
    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
      $hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($token)
      $digest = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("isumoa-instance-v1:$challenge"))
      $expected = [BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
      return $body.proof -ceq $expected
    } finally { $hmac.Dispose() }
  } catch { return $false }
}

function Test-LocalPortAvailable([int]$Port) {
  $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
  try { $listener.Start(); return $true } catch { return $false } finally { $listener.Stop() }
}

function Test-PathInsideDirectory([string]$Path, [string]$Directory) {
  $full = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('/', '\'))
  $parent = [System.IO.Path]::GetFullPath($Directory).TrimEnd([char[]]@('/', '\'))
  return $full.Equals($parent, [StringComparison]::OrdinalIgnoreCase) -or
    $full.StartsWith($parent + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-PreservedDataPaths([string[]]$ConfigFiles, [string[]]$ProgramDirectories) {
  foreach ($configFile in $ConfigFiles) {
    if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { continue }
    $config = Get-Content -LiteralPath $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $base = Split-Path -Parent $configFile
    $defaults = @{ dataDir = 'data'; backupDir = 'backups'; logDir = $null }
    foreach ($name in @('dataDir', 'backupDir', 'logDir')) {
      $value = $config.$name
      if ($null -eq $value) { $value = $defaults[$name] }
      if ($name -eq 'logDir' -and [string]::IsNullOrWhiteSpace($value)) { continue }
      if ($value -isnot [string]) { throw "설정 파일의 $name 값은 경로 문자열이어야 합니다: $configFile" }
      $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($base, $value))
      foreach ($program in $ProgramDirectories) {
        if (Test-PathInsideDirectory $path $program) {
          throw "자료 저장 위치($name)가 교체할 프로그램 폴더 안에 있어 설치를 중단했습니다.`n저장 위치: $path`n설정 파일: $configFile`n기존 프로그램을 종료한 뒤 자료를 프로그램 폴더 밖으로 옮기고 이 설정을 고친 다음 다시 설치해 주세요."
        }
      }
    }
  }
}

function Move-LegacyDataHome([string]$OldDirectory, [string]$NewDirectory, [hashtable]$State, [string]$RecoveryDirectory) {
  $oldConfig = Join-Path $OldDirectory 'config.json'
  $State.LegacyConfigExisted = Test-Path -LiteralPath $oldConfig -PathType Leaf
  $State.LegacyConfigBytes = if ($State.LegacyConfigExisted) { [System.IO.File]::ReadAllBytes($oldConfig) } else { $null }
  $config = if ($State.LegacyConfigExisted) { Get-Content -LiteralPath $oldConfig -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
  $changed = $false
  if ($null -ne $config) {
    # 상대경로와 외부 디스크 경로는 유지하고, 옛 자료 폴더 안을 가리키는 절대경로만 옮긴다.
    $settings = @(@{ Object = $config; Names = @('dataDir', 'backupDir', 'logDir') })
    if ($null -ne $config.tls) { $settings += @{ Object = $config.tls; Names = @('certFile', 'keyFile', 'pfxFile') } }
    $oldRoot = [System.IO.Path]::GetFullPath($OldDirectory).TrimEnd([char[]]@('/', '\'))
    foreach ($group in $settings) {
      foreach ($name in $group.Names) {
        $value = $group.Object.$name
        if ($value -is [string] -and [System.IO.Path]::IsPathRooted($value) -and (Test-PathInsideDirectory $value $OldDirectory)) {
          $relative = [System.IO.Path]::GetFullPath($value).Substring($oldRoot.Length).TrimStart([char[]]@('/', '\'))
          $group.Object.$name = [System.IO.Path]::Combine($NewDirectory, $relative)
          $changed = $true
        }
      }
    }
    # 복구 자체가 막혀도 원래 설정 파일을 복구 자료에 남긴다.
    [System.IO.File]::WriteAllBytes((Join-Path $RecoveryDirectory 'legacy-config.original.json'), $State.LegacyConfigBytes)
  }
  [System.IO.Directory]::Move($OldDirectory, $NewDirectory)
  $State.Migrated = $true
  if ($changed) {
    [System.IO.File]::WriteAllText((Join-Path $NewDirectory 'config.json'), ($config | ConvertTo-Json -Depth 100), (New-Object System.Text.UTF8Encoding $false))
  }
}

function Restore-LegacyDataHome([string]$OldDirectory, [string]$NewDirectory, [hashtable]$State) {
  if (-not $State.Migrated) { return }
  $config = Join-Path $NewDirectory 'config.json'
  if ($State.LegacyConfigExisted) {
    $unchanged = (Test-Path -LiteralPath $config -PathType Leaf) -and
      [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($config)) -ceq [Convert]::ToBase64String($State.LegacyConfigBytes)
    if (-not $unchanged) { [System.IO.File]::WriteAllBytes($config, $State.LegacyConfigBytes) }
  }
  elseif (Test-Path -LiteralPath $config) { Remove-Item -LiteralPath $config -Force }
  [System.IO.Directory]::Move($NewDirectory, $OldDirectory)
  $State.Migrated = $false
}

function Assert-ProgramPayload([string]$Directory) {
  $manifestPath = Join-Path $Directory 'program-manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not $manifest.version -or -not $manifest.files -or @($manifest.files).Count -eq 0) { throw '설치 파일 목록이 올바르지 않습니다.' }
  $seen = @{}
  $base = [System.IO.Path]::GetFullPath($Directory).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ([string]::IsNullOrWhiteSpace($relative) -or [System.IO.Path]::IsPathRooted($relative) -or
        $relative.Contains('\') -or ($relative.Split('/') | Where-Object { $_ -in @('', '.', '..') }) -or $seen.ContainsKey($relative)) {
      throw '설치 파일 목록의 경로가 올바르지 않습니다.'
    }
    $seen[$relative] = $true
    $file = [System.IO.Path]::GetFullPath((Join-Path $Directory $relative))
    if (-not $file.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "설치 파일이 없습니다: $relative"
    }
    if ((Get-Item -LiteralPath $file -Force).Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $entry.sha256) {
      throw "설치 파일 검증에 실패했습니다: $relative. 설치 파일을 다시 받아 주세요."
    }
  }
  $actual = @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force | Where-Object { $_.FullName -ne $manifestPath })
  if ($actual.Count -ne $seen.Count) { throw '목록에 없는 설치 파일이 있습니다. 설치 파일을 다시 받아 주세요.' }
  if ((Get-Content -LiteralPath (Join-Path $Directory 'VERSION') -Raw).Trim() -ne $manifest.version) { throw '설치 파일의 버전이 일치하지 않습니다.' }
}

function Copy-ProgramPayload([string]$Source, [string]$Destination) {
  & robocopy.exe $Source $Destination /E /R:2 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "새 프로그램 파일을 준비하지 못했습니다 (복사 코드 $LASTEXITCODE). 기존 프로그램은 그대로 둡니다." }
}

function Move-ProgramDirectory([string]$Source, [string]$Destination) {
  # 대상이 이미 있으면 실패한다. Move-Item이 기존 폴더 안에 중첩 복사하는 동작을 피한다.
  [System.IO.Directory]::Move($Source, $Destination)
}

function Invoke-ProgramUpdate(
  [string]$Source, [string]$Target,
  [scriptblock]$BeforeSwitch = {}, [scriptblock]$AfterSwitch = {}, [scriptblock]$UndoRegistration = {}
) {
  # 같은 디스크의 별도 폴더에 준비하고 디렉터리 이름을 교체한다. 자료 폴더는 이 함수가 만지지 않는다.
  $parent = Split-Path -Parent $Target
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $work = Join-Path $parent ('.isumoa-update-' + [guid]::NewGuid().ToString('N'))
  $stage = Join-Path $work 'prepared'
  $previous = Join-Path $work 'previous'
  $switched = $false
  $registrationStarted = $false
  $keepRecovery = $false
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  try {
    Copy-ProgramPayload $Source $stage
    Assert-ProgramPayload $stage
    & $BeforeSwitch
    if (Test-Path -LiteralPath $Target) { Move-ProgramDirectory $Target $previous }
    Move-ProgramDirectory $stage $Target
    $switched = $true
    $registrationStarted = $true
    & $AfterSwitch $work
  } catch {
    $failure = $_.Exception.Message
    try {
      if ($switched -and (Test-Path -LiteralPath $Target)) {
        Move-ProgramDirectory $Target (Join-Path $work 'failed')
      }
      if (Test-Path -LiteralPath $previous) { Move-ProgramDirectory $previous $Target }
      if ($registrationStarted) { & $UndoRegistration }
    } catch {
      $keepRecovery = $true
      throw "설치 실패: $failure`n자동 복구를 마치지 못했습니다. 프로그램 위치: $Target`n복구 자료 보관 위치: $work`n복구 오류: $($_.Exception.Message)"
    }
    if ($switched) { throw "설치하지 못해 이전 상태로 되돌렸습니다. $failure" }
    throw $failure
  } finally {
    if (-not $keepRecovery) {
      # 설치/복구 성공 후 남은 임시 프로그램만 정리한다. 정리 실패로 성공한 설치를 되돌리지 않는다.
      try { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Stop }
      catch { Write-Warning "설치 임시 폴더가 남았습니다: $work" }
    }
  }
}
