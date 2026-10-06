' Recibe la ruta de un PDF (desde "clic derecho > Enviar a > Imprimir guia VEREX") y lo carga en la app VEREX - Impresion.
' Si la app esta cerrada, la arranca y reintenta.
Dim sh, fso, carpeta, ps1, ruta, rc, electron, i
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = carpeta & "\enviar_pdf.ps1"
If WScript.Arguments.Count = 0 Then
  MsgBox "Usa clic derecho sobre un PDF > Enviar a > Imprimir guia VEREX.", vbInformation, "Imprimir guia VEREX"
  WScript.Quit
End If
ruta = WScript.Arguments(0)
rc = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ """ & ruta & """", 0, True)
If rc <> 0 Then
  electron = carpeta & "\node_modules\electron\dist\electron.exe"
  If fso.FileExists(electron) Then
    sh.CurrentDirectory = carpeta
    sh.Run """" & electron & """ """ & carpeta & """ --tab=3", 1, False
    For i = 1 To 6
      WScript.Sleep 2000
      rc = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ """ & ruta & """", 0, True)
      If rc = 0 Then Exit For
    Next
  End If
End If
If rc <> 0 Then
  MsgBox "No se pudo enviar el PDF a VEREX - Impresion." & vbCrLf & "Abre primero la app de Impresion (bandeja, junto al reloj) y vuelve a intentar.", vbExclamation, "Imprimir guia VEREX"
End If
