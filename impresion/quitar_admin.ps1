# Quita la marca "Ejecutar como administrador" (compatibilidad) de electron.exe / pythonw.exe / python.exe / wscript.exe en este equipo.
$claves = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers',
          'HKLM:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
$quitados = 0
foreach ($k in $claves) {
  if (-not (Test-Path $k)) { continue }
  $props = (Get-ItemProperty $k).PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }
  foreach ($p in $props) {
    if ($p.Name -match 'electron\.exe|pythonw\.exe|python\.exe|wscript\.exe|VEREX' -and "$($p.Value)" -match 'RUNASADMIN') {
      try { Remove-ItemProperty -Path $k -Name $p.Name -ErrorAction Stop; Write-Host ("  Quitado: " + $p.Name); $quitados++ } catch { Write-Host ("  No se pudo quitar: " + $p.Name) }
    }
  }
}
if ($quitados -eq 0) { Write-Host "  (No habia ninguna marca de 'Ejecutar como administrador' guardada para esos programas.)" }
