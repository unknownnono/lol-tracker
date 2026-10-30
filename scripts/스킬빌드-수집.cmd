@echo off
chcp 65001 > nul
title 증강픽 스킬 빌드 수집
cd /d "C:\Users\Administrator\projects\lol-tracker"
echo.
echo  증강픽 스킬 빌드 수집
echo  -------------------------------------------
echo  일반 칼바람 경기에서 챔피언별 스킬 순서를 모아 서버에 쌓습니다.
echo  400판을 모으며 약 1시간 반 걸립니다. (Riot API 한도에 맞춰 천천히)
echo  중간에 멈추려면 Ctrl+C 를 누르세요. 모은 데까지는 저장됩니다.
echo  -------------------------------------------
echo.
set NPM_CONFIG_UPDATE_NOTIFIER=false
call npm run --silent collect:skills -- --max=400
echo.
echo  끝났습니다. 아무 키나 누르면 창이 닫힙니다.
pause > nul
