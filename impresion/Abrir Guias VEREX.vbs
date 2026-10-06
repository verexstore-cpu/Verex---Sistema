' Abre la app "VEREX - Impresion" directamente en la pestana "Cualquier PDF" (imprimir guias de envio en PDF).
' - Si la app ya esta en marcha (bandeja del sistema): la trae al frente en esa pestana.
' - Si esta cerrada: la arranca (electron.exe de esta misma carpeta) ya en esa pestana.
' Pensado para usarse desde el menu de VEREX HUB ("Imprimir PDF (Guias)") o desde un acceso directo del escritorio.
Dim http, ok, sh, fso, carpeta, electron
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
ok = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1500, 1500, 3000, 3000
http.Open "GET", "http://127.0.0.1:7891/abrir?tab=3", False
http.Send
If Err.Number = 0 Then
  If http.Status = 200 Then ok = True
End If
On Error GoTo 0
If Not ok Then
  electron = carpeta & "\node_modules\electron\dist\electron.exe"
  If fso.FileExists(electron) Then
    sh.CurrentDirectory = carpeta
    sh.Run """" & electron & """ """ & carpeta & """ --tab=3", 1, False
  Else
    MsgBox "No se pudo abrir VEREX - Impresion." & vbCrLf & vbCrLf & _
           "La app no esta en marcha y no se encontro electron.exe en:" & vbCrLf & electron & vbCrLf & vbCrLf & _
           "Abrela primero con el acceso directo habitual de VEREX Impresion y vuelve a probar.", _
           vbExclamation, "Guias VEREX"
  End If
End If
