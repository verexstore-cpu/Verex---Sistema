Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\erama\Desktop\SISTEMA VEREX OFICIAL MAY2026\impresion"
WshShell.Run "cmd /c ""C:\Program Files\nodejs\npm.cmd"" start", 0, False
