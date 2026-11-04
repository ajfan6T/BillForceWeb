; BILLFORCE additions to the Windows installer and uninstaller (electron-builder picks up
; build-resources/installer.nsh by itself; see electron-builder.yml).
;
; Uninstalling keeps the business data (%APPDATA%\BILLFORCE) and the backups (Documents\BILLFORCE
; Backups), so reinstalling or updating finds everything again. When a person uninstalls, BILLFORCE
; asks whether to delete them too (No is the default). Nothing is asked when the uninstaller runs
; silently (/S) or as part of an update; then data is deleted only on request:
;   "Uninstall BILLFORCE.exe" /S --delete-app-data [--delete-backups]

!ifdef BUILD_UNINSTALLER

Var bfDeleteData
Var bfDeleteBackups

!macro customUnInit
  StrCpy $bfDeleteData "0"
  StrCpy $bfDeleteBackups "0"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "--delete-app-data" $R1
  ${IfNot} ${Errors}
    StrCpy $bfDeleteData "1"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "--delete-backups" $R1
  ${IfNot} ${Errors}
    StrCpy $bfDeleteBackups "1"
  ${EndIf}

  ${IfNot} ${isUpdated}
    ClearErrors
    ${GetOptions} $R0 "/S" $R1
    ${If} ${Errors}
      ; A person is uninstalling (the one-click uninstaller has turned itself silent by now): ask.
      SetSilent normal
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Do you also want to delete all your BILLFORCE data?$\r$\n$\r$\nThis permanently deletes every business on this computer: bills, customers, items, accounts and logins ($APPDATA\BILLFORCE). It cannot be undone.$\r$\n$\r$\nChoose No to keep your data: it is still there if you install BILLFORCE again." IDYES bf_delete_data
      Goto bf_asked
      bf_delete_data:
        StrCpy $bfDeleteData "1"
        MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Also delete the backups in $DOCUMENTS\BILLFORCE Backups?$\r$\n$\r$\nChoose No to keep them, so the data can be restored later. Backups saved in another folder (a pen drive, OneDrive ...) are not touched." IDYES bf_delete_backups
        Goto bf_asked
      bf_delete_backups:
        StrCpy $bfDeleteBackups "1"
      bf_asked:
      !ifdef ONE_CLICK
        SetSilent silent
      !endif
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
    ${If} $bfDeleteData == "1"
      DetailPrint "Deleting the BILLFORCE data"
      RMDir /r "$APPDATA\BILLFORCE"
    ${EndIf}
    ${If} $bfDeleteBackups == "1"
      DetailPrint "Deleting the BILLFORCE backups"
      RMDir /r "$DOCUMENTS\BILLFORCE Backups"
    ${EndIf}
  ${EndIf}
!macroend

!endif
