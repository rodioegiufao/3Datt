@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias...
call npm install || goto erro
echo Conferindo ajustes...
call npm test || goto erro
echo Gerando executaveis...
call npm run dist || goto erro
echo.
echo Pronto! Os arquivos estao em "%~dp0dist"
start "" "%~dp0dist"
pause
exit /b 0
:erro
echo.
echo Algo deu errado. Leia a mensagem acima.
pause
exit /b 1
