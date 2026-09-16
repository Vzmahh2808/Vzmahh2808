# hiddify-diag.ps1 - диагностика Hiddify на Windows 11
# Запуск:  powershell -ExecutionPolicy Bypass -File .\hiddify-diag.ps1
# Скрипт НИЧЕГО не удаляет из настроек Hiddify. Он только собирает информацию,
# закрывает зависший процесс и снимает залипший системный прокси.

$ErrorActionPreference = "SilentlyContinue"
$lines = New-Object System.Collections.ArrayList

function Say($text) {
    Write-Host $text
    [void]$lines.Add([string]$text)
}

function Section($text) {
    Say ""
    Say ("=== " + $text + " ===")
}

# Маскируем секреты, чтобы отчёт можно было безопасно кому-то отправить
function Mask($text) {
    if ($null -eq $text) { return "" }
    $t = [string]$text
    $t = $t -replace "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", "<UUID-СКРЫТ>"
    $t = $t -replace "(?i)(token|password|pass|secret|key)=[^\s&""']+", "`$1=<СКРЫТО>"
    $t = $t -replace "(?i)(vless|vmess|trojan|ss|hy2|hysteria2|tuic)://[^\s""']+", "`$1://<ССЫЛКА-СКРЫТА>"
    return $t
}

Say "############################################"
Say "#   ДИАГНОСТИКА HIDDIFY                    #"
Say "############################################"
Say ("Дата запуска: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))

# ---------------------------------------------------------------- 1. Система
Section "1. Система"
try {
    $os  = Get-CimInstance Win32_OperatingSystem
    $ubr = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").UBR
    $dv  = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").DisplayVersion
    Say ("ОС      : " + $os.Caption + " (" + $dv + ")")
    Say ("Сборка  : " + [System.Environment]::OSVersion.Version.Build + "." + $ubr)
} catch { Say "Не удалось определить версию Windows" }

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say ("Права администратора у этого окна: " + $(if ($isAdmin) { "ДА" } else { "НЕТ  <-- для режима TUN нужны права!" }))

Section "2. Последние обновления Windows"
try {
    Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 5 | ForEach-Object {
        Say ("  " + $_.HotFixID + "   установлено " + $_.InstalledOn)
    }
} catch { Say "  не удалось получить список" }

# ------------------------------------------------------------- 3. Процессы
Section "3. Процессы Hiddify"
$procs = Get-Process | Where-Object { $_.ProcessName -match "(?i)hiddify|sing-box|HiddifyCli" }
if ($procs) {
    foreach ($p in $procs) {
        Say ("  " + $p.ProcessName + "  PID=" + $p.Id + "  память=" + [math]::Round($p.WorkingSet64/1MB) + " МБ  запущен " + $p.StartTime)
    }
} else {
    Say "  процессы Hiddify не найдены (приложение закрыто)"
}

# ---------------------------------------------------------------- 4. Порты
Section "4. Локальные порты Hiddify"
foreach ($port in 2334, 12334, 6450, 16450, 6756, 16756) {
    $c = Get-NetTCPConnection -LocalPort $port -State Listen
    if ($c) {
        $owner = (Get-Process -Id $c[0].OwningProcess).ProcessName
        Say ("  порт " + $port + " : СЛУШАЕТ, процесс = " + $owner + " (PID " + $c[0].OwningProcess + ")")
    } else {
        Say ("  порт " + $port + " : свободен")
    }
}

# ------------------------------------------------------------- 5. Адаптеры
Section "5. Виртуальные сетевые адаптеры"
$ad = Get-NetAdapter -IncludeHidden | Where-Object { $_.InterfaceDescription -match "(?i)wintun|tap|hiddify|singbox|sing-box" }
if ($ad) {
    foreach ($a in $ad) {
        Say ("  " + $a.Name + " | " + $a.InterfaceDescription + " | статус: " + $a.Status)
    }
} else {
    Say "  адаптеров wintun/TAP не найдено"
    Say "  (если Hiddify сейчас 'подключается' в режиме TUN - это и есть проблема)"
}

# --------------------------------------------------------- 6. Системный прокси
Section "6. Системный прокси Windows"
$reg = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
$ie  = Get-ItemProperty -Path $reg
Say ("  ProxyEnable = " + $ie.ProxyEnable + $(if ($ie.ProxyEnable -eq 1) { "   <-- включён" } else { "   (выключен)" }))
Say ("  ProxyServer = " + $ie.ProxyServer)

# ----------------------------------------------------------------- 7. Время
Section "7. Время (расхождение ломает TLS и VMess)"
Say ("  Локальное : " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Say ("  UTC       : " + (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss"))
$skew = & w32tm /stripchart /computer:time.windows.com /samples:1 /dataonly 2>&1
Say ("  Сверка с NTP: " + (($skew | Select-Object -Last 1) -join " "))

# --------------------------------------------------------------- 8. Интернет
Section "8. Доступ в сеть без прокси"
foreach ($target in "1.1.1.1", "github.com") {
    $ok = Test-NetConnection -ComputerName $target -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
    Say ("  " + $target + ":443 -> " + $(if ($ok) { "доступен" } else { "НЕДОСТУПЕН" }))
}

# ------------------------------------------------------------------ 9. Логи
Section "9. Последние ошибки из лога Hiddify"
$roots = @(
    (Join-Path $env:APPDATA "hiddify"),
    (Join-Path $env:LOCALAPPDATA "hiddify"),
    (Join-Path $env:APPDATA "app.hiddify.com"),
    (Join-Path $env:LOCALAPPDATA "app.hiddify.com")
)
$log = $null
foreach ($r in $roots) {
    if (Test-Path $r) {
        Say ("  найден каталог: " + $r)
        $cand = Get-ChildItem -Path $r -Recurse -Include *.log, *.txt -File |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($cand -and -not $log) { $log = $cand }
    }
}
if ($log) {
    Say ("  свежий лог: " + $log.FullName + "  (изменён " + $log.LastWriteTime + ")")
    Say "  --- последние 40 строк (секреты замаскированы) ---"
    Get-Content $log.FullName -Tail 40 | ForEach-Object { Say ("  | " + (Mask $_)) }
} else {
    Say "  лог-файл не найден - запусти Hiddify, дождись зависания, потом перезапусти скрипт"
}

# -------------------------------------------------- 10. Безопасный сброс
Section "10. Безопасный сброс"
if ($procs) {
    Say "  Закрываю зависшие процессы Hiddify..."
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
    Say "  готово"
} else {
    Say "  закрывать нечего"
}

if ($ie.ProxyEnable -eq 1) {
    Say "  Снимаю залипший системный прокси..."
    Set-ItemProperty -Path $reg -Name ProxyEnable -Value 0
    Remove-ItemProperty -Path $reg -Name ProxyServer -ErrorAction SilentlyContinue
    Say "  готово - системный прокси выключен"
} else {
    Say "  системный прокси и так выключен"
}

# ----------------------------------------------------------------- Отчёт
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "hiddify-diag.txt"
$lines | Out-File -FilePath $out -Encoding UTF8
Say ""
Say "############################################"
Say ("Отчёт сохранён на рабочий стол: " + $out)
Say "Секреты в нём замаскированы, но перед отправкой всё равно просмотри глазами."
Say "############################################"
