' Acceso directo: abre la app "VEREX – Impresión" directamente en la pestaña "Cualquier PDF"
' (arrastras el PDF de la guía, eliges Guía y el grosor del texto, e imprimes).
' La app vive en la bandeja del sistema; este archivo le avisa que se muestre en esa pestaña.
Dim http, ok
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
  MsgBox "No se pudo abrir VEREX - Impresion." & vbCrLf & vbCrLf & _
         "La app no esta en marcha. Abrela primero (icono de la impresora en la bandeja, junto al reloj, o el acceso directo de VEREX Impresion) y vuelve a probar.", _
         vbExclamation, "Guias VEREX"
End If
