# Manda un PDF a la app VEREX - Impresion (pestana "Cualquier PDF"). Uso: enviar_pdf.ps1 "C:\ruta\guia.pdf"
param([string]$Ruta)
try {
  if (-not (Test-Path -LiteralPath $Ruta)) { exit 2 }
  $bytes = [IO.File]::ReadAllBytes($Ruta)
  $json = @{ pdfBase64 = [Convert]::ToBase64String($bytes); nombre = [IO.Path]::GetFileName($Ruta) } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri 'http://127.0.0.1:7891/cargar-pdf' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 30 | Out-Null
  exit 0
} catch { exit 1 }
