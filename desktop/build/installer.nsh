; Registra o aplicativo como "Alto desempenho" em Configurações > Sistema > Tela > Gráficos.
; É o mesmo ajuste que o usuário faria manualmente no Windows 10/11: em notebooks com
; GPU integrada + dedicada (NVIDIA Optimus / AMD Switchable), o executável passa a abrir
; direto na placa dedicada. Vale só para o usuário atual (HKCU) e é removido na desinstalação.

!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\DirectX\UserGpuPreferences" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "GpuPreference=2;"
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\DirectX\UserGpuPreferences" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
!macroend
