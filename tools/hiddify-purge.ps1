# hiddify-purge.ps1 - полное удаление Hiddify со всеми следами в системе
# Запуск от администратора:
#   powershell -ExecutionPolicy Bypass -File .\hiddify-purge.ps1
#
# ВНИМАНИЕ: удаляются профили и подписки. Сохрани ссылку подписки ДО запуска.
# Скрипт сначала показывает, что нашёл, и только потом спрашивает подтверждение.

$ErrorActionPreference = "SilentlyContinue"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Нужны права администратора. Закрой окно и запусти PowerShell от имени администратора." -ForegroundColor Red
    pause
    exit 1
}

function Head($t) { Write-Host ""; Write-Host ("=== " + $t + " ===") -ForegroundColor Cyan }
function Ok($t)   { Write-Host ("  [+] " + $t) -ForegroundColor Green }
function Info($t) { Write-Host ("  " + $t) }
function Warn($t) { Write-Host ("  [!] " + $t) -ForegroundColor Yellow }

Write-Host "#############################################" -ForegroundColor Magenta
Write-Host "#   ПОЛНОЕ УДАЛЕНИЕ HIDDIFY                 #" -ForegroundColor Magenta
Write-Host "#############################################" -ForegroundColor Magenta

# ============================ ПОИСК ============================
Head "1. Что найдено в системе"

$procs = Get-Process | Where-Object { $_.ProcessName -match "(?i)hiddify|sing-?box" }
Info ("Процессы            : " + $(if ($procs) { ($procs.ProcessName | Select-Object -Unique) -join ", " } else { "нет" }))

$services = Get-Service | Where-Object { $_.Name -match "(?i)hiddify|sing-?box" -or $_.DisplayName -match "(?i)hiddify|sing-?box" }
Info ("Службы              : " + $(if ($services) { ($services.Name) -join ", " } else { "нет" }))

$uninstallRoots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$installed = Get-ItemProperty $uninstallRoots | Where-Object { $_.DisplayName -match "(?i)hiddify" }
Info ("Установленная программа : " + $(if ($installed) { ($installed.DisplayName) -join ", " } else { "нет записи в 'Программы и компоненты'" }))

$appx = Get-AppxPackage | Where-Object { $_.Name -match "(?i)hiddify" }
Info ("Пакет MSIX          : " + $(if ($appx) { ($appx.Name) -join ", " } else { "нет" }))

$folders = @(
    (Join-Path $env:APPDATA      "hiddify"),
    (Join-Path $env:LOCALAPPDATA "hiddify"),
    (Join-Path $env:APPDATA      "app.hiddify.com"),
    (Join-Path $env:LOCALAPPDATA "app.hiddify.com"),
    (Join-Path $env:APPDATA      "com.hiddify.app"),
    (Join-Path $env:LOCALAPPDATA "com.hiddify.app"),
    (Join-Path $env:ProgramFiles "Hiddify"),
    (Join-Path ${env:ProgramFiles(x86)} "Hiddify"),
    (Join-Path $env:ProgramData  "Hiddify")
) | Where-Object { $_ -and (Test-Path $_) }
Info  "Папки               :"
if ($folders) { foreach ($f in $folders) { Info ("    " + $f) } } else { Info "    нет" }

$adapters = Get-PnpDevice -Class Net | Where-Object { $_.FriendlyName -match "(?i)wintun|hiddify|sing-?box" }
Info  "Сетевые адаптеры    :"
if ($adapters) {
    foreach ($a in $adapters) { Info ("    " + $a.FriendlyName + "  [" + $a.Status + "]") }
    Warn "Адаптеры wintun использует не только Hiddify - если стоит WireGuard,"
    Warn "его адаптер тоже попадёт под удаление (он пересоздаст его при подключении)."
} else { Info "    нет" }

$fwRules = Get-NetFirewallRule | Where-Object { $_.DisplayName -match "(?i)hiddify|sing-?box" }
Info ("Правила брандмауэра : " + $(if ($fwRules) { $fwRules.Count } else { "0" }))

$tasks = Get-ScheduledTask | Where-Object { $_.TaskName -match "(?i)hiddify" }
Info ("Задачи планировщика : " + $(if ($tasks) { ($tasks.TaskName) -join ", " } else { "нет" }))

# Плоский foreach, а не ForEach-Object: внутри конвейера += может потеряться из-за области видимости
$runKey  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runVals = @()
if (Test-Path $runKey) {
    $runProps = Get-ItemProperty -Path $runKey
    foreach ($name in (Get-Item $runKey).GetValueNames()) {
        if ($name -match "(?i)hiddify" -or ([string]$runProps.$name) -match "(?i)hiddify") { $runVals += $name }
    }
}
Info ("Автозапуск          : " + $(if ($runVals) { $runVals -join ", " } else { "нет" }))

$regKeys = @("HKCU:\Software\Hiddify", "HKLM:\SOFTWARE\Hiddify", "HKCU:\Software\app.hiddify.com") | Where-Object { Test-Path $_ }
Info ("Ключи реестра       : " + $(if ($regKeys) { $regKeys -join ", " } else { "нет" }))

$ieReg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$ie = Get-ItemProperty -Path $ieReg
Info ("Системный прокси    : ProxyEnable=" + $ie.ProxyEnable + "  ProxyServer=" + $ie.ProxyServer)

# ======================= ПОДТВЕРЖДЕНИЕ =======================
Head "2. Подтверждение"
Warn "Всё перечисленное выше будет удалено, включая профили и подписки."
Warn "Убедись, что ссылка подписки сохранена в другом месте."
Write-Host ""
$answer = Read-Host "Удалять? Напиши УДАЛИТЬ (или DELETE / Y) и нажми Enter"
if ($answer -notmatch "^\s*(УДАЛИТЬ|DELETE|Y|ДА|YES)\s*$") {
    Write-Host ""
    Write-Host "Отменено. Ничего не тронуто." -ForegroundColor Yellow
    pause
    exit 0
}

# ========================== УДАЛЕНИЕ ==========================
Head "3. Останавливаю процессы и службы"
if ($procs) { $procs | Stop-Process -Force; Start-Sleep -Seconds 2; Ok "процессы закрыты" } else { Info "закрывать нечего" }
foreach ($s in $services) {
    Stop-Service -Name $s.Name -Force
    & sc.exe delete $s.Name | Out-Null
    Ok ("служба удалена: " + $s.Name)
}

Head "4. Удаляю приложение"
foreach ($app in $installed) {
    # QuietUninstallString - это готовая тихая команда, она надёжнее самодельных ключей
    $quiet = $app.QuietUninstallString
    $cmd   = $app.UninstallString
    if ($quiet) {
        Start-Process "cmd.exe" -ArgumentList ("/c " + $quiet) -Wait
        Ok ("удалено (тихий режим): " + $app.DisplayName)
    } elseif ($cmd -match "(?i)msiexec") {
        if ($cmd -match "(\{[0-9A-Fa-f\-]+\})") {
            Start-Process "msiexec.exe" -ArgumentList ("/x " + $matches[1] + " /qn /norestart") -Wait
            Ok ("удалено через msiexec: " + $app.DisplayName)
        }
    } elseif ($cmd) {
        $exe = $cmd.Trim('"')
        if (Test-Path $exe) {
            Start-Process $exe -ArgumentList "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART" -Wait
            Ok ("удалено штатным деинсталлятором: " + $app.DisplayName)
        }
    }
}
foreach ($p in $appx) { Remove-AppxPackage -Package $p.PackageFullName; Ok ("удалён пакет MSIX: " + $p.Name) }

Head "5. Убираю правила брандмауэра, задачи и автозапуск"
foreach ($r in $fwRules) { Remove-NetFirewallRule -Name $r.Name; Ok ("правило: " + $r.DisplayName) }
foreach ($t in $tasks)   { Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false; Ok ("задача: " + $t.TaskName) }
foreach ($v in $runVals) { Remove-ItemProperty -Path $runKey -Name $v; Ok ("автозапуск: " + $v) }

Head "6. Сбрасываю системный прокси"
Set-ItemProperty -Path $ieReg -Name ProxyEnable -Value 0
Remove-ItemProperty -Path $ieReg -Name ProxyServer
Remove-ItemProperty -Path $ieReg -Name AutoConfigURL
Ok "системный прокси выключен"

Head "7. Удаляю виртуальные сетевые адаптеры"
if ($adapters) {
    foreach ($a in $adapters) {
        & pnputil.exe /remove-device $a.InstanceId 2>&1 | Out-Null
        Ok ("адаптер удалён: " + $a.FriendlyName)
    }
} else { Info "удалять нечего" }

Head "8. Удаляю папки и ключи реестра"
foreach ($f in $folders) {
    Remove-Item -Path $f -Recurse -Force
    if (Test-Path $f) { Warn ("не удалось удалить (файл занят?): " + $f) } else { Ok ("папка: " + $f) }
}
foreach ($k in $regKeys) { Remove-Item -Path $k -Recurse -Force; Ok ("ключ: " + $k) }

# =========================== ИТОГ ===========================
Head "Готово"
Write-Host ""
Write-Host "  ОБЯЗАТЕЛЬНО ПЕРЕЗАГРУЗИ КОМПЬЮТЕР." -ForegroundColor Yellow
Write-Host "  Без перезагрузки остаются висеть маршруты и следы драйвера," -ForegroundColor Yellow
Write-Host "  и свежая установка наступит на те же грабли." -ForegroundColor Yellow
Write-Host ""
Write-Host "  После перезагрузки: скачай Hiddify 4.1.1 с"
Write-Host "  https://github.com/hiddify/hiddify-app/releases/latest"
Write-Host "  и запусти установщик от имени администратора."
Write-Host ""
pause
