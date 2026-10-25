; PostgreSQL needs the Microsoft Visual C++ runtime. Install it quietly if it is missing (no effect when a newer one is already there).
!macro customInstall
  IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 +2
  ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0
!macroend
