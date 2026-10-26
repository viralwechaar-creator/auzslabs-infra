; PostgreSQL needs the Microsoft Visual C++ runtime. Install it quietly if it is missing (no effect when a newer one is already there).
!macro customInstall
  IfFileExists "$INSTDIR\resources\vc_redist.x64.exe" 0 +2
  ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $0

  ; So a phone on the same WiFi can reach this computer to add product photos (Settings -> "Add photos from your
  ; phone"): the local server already listens on every network interface, but without this rule Windows Firewall
  ; silently blocks the inbound connection the first time something on the LAN tries it, with no prompt the owner
  ; would ever see to click "Allow". Rule is by program path, not a fixed port, since the app picks its own free
  ; port per computer. Silently continues if netsh is missing/blocked (e.g. a locked-down corporate machine) --
  ; the app itself still works fine on this computer either way, it just stays unreachable from other devices.
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="AUZsStyle" dir=in action=allow program="$INSTDIR\AUZsStyle.exe" enable=yes profile=private,domain'
  Pop $0
!macroend

!macro customUnInstall
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="AUZsStyle"'
  Pop $0
!macroend
