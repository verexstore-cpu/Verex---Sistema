' Ejecutalo UNA vez: agrega "Imprimir guia VEREX" al menu clic derecho > Enviar a (sirve para cualquier archivo PDF).
Dim sh, fso, carpeta, lnk
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set lnk = sh.CreateShortcut(sh.SpecialFolders("SendTo") & "\Imprimir guia VEREX.lnk")
lnk.TargetPath   = "wscript.exe"
lnk.Arguments    = """" & carpeta & "\Enviar PDF a Impresion VEREX.vbs"""
lnk.IconLocation = "shell32.dll,16"
lnk.Save
MsgBox "Listo. Ahora: clic derecho sobre un PDF > Enviar a > Imprimir guia VEREX.", vbInformation, "VEREX"
