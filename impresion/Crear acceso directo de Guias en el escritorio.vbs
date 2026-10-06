' Ejecuta este archivo UNA vez: crea en el escritorio el acceso directo "Guias VEREX" (abre la pestana "Cualquier PDF").
Dim sh, fso, carpeta, lnk
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set lnk = sh.CreateShortcut(sh.SpecialFolders("Desktop") & "\Guias VEREX.lnk")
lnk.TargetPath       = "wscript.exe"
lnk.Arguments        = """" & carpeta & "\Abrir Guias VEREX.vbs"""
lnk.WorkingDirectory = carpeta
lnk.IconLocation     = "shell32.dll,16"
lnk.Description      = "Abre VEREX Impresion en la pestana Cualquier PDF para imprimir guias"
lnk.Save
MsgBox "Listo: se creo el acceso directo ""Guias VEREX"" en el escritorio.", vbInformation, "VEREX"
