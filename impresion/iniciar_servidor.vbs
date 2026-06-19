Dim WshShell
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "python """ & WshShell.ExpandEnvironmentStrings("%USERPROFILE%") & "\Desktop\SISTEMA VEREX OFICIAL MAY2026\impresion\verex_server.py""", 0, False
