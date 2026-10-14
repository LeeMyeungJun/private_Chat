# 모음 채팅 Android

Android Studio에서 이 `android/` 폴더를 Open하면 됩니다. Java 17, Android SDK 35, Gradle 8.13 / AGP 8.13.2를 사용합니다. Android 8.0 이상에서 설치할 수 있습니다.

## 사용

1. MainPC의 `모음 서버.lnk`로 서버를 실행합니다. PC에서도 대화하려면 별도 `모음 채팅.lnk`를 엽니다.
2. 서버 관리창의 **Android 앱 입장 가능** 상태를 확인합니다.
3. 휴대폰 앱에서 **서버 입장**을 누릅니다. 주소를 입력하거나 Tailscale에 로그인할 필요가 없습니다.
4. 기존 채팅의 닉네임과 초대 비밀번호로 입장합니다. MainPC와 같은 방·메시지·파일을 사용합니다.

서버가 닫혔거나 접속되지 않으면 입장 화면에 안내가 표시됩니다. 채팅 중에는 10초마다 실제 서버를 확인합니다. 서버를 재시작하면 이전 방의 내용이 삭제되며 앱에서 다시 서버 입장을 누르면 새 주소를 찾습니다.

앱 첫 화면에는 입장 버튼 하나만 있습니다. 채팅 화면은 Figma `q8Oqf80owMxEvdV1afHKh9`, `3004:385`의 배경·색상·첨부/전송 리소스를 적용한 WebView로, 기존 실시간 채팅을 그대로 연결합니다. 사진 촬영/파일 선택과 저장 위치를 선택하는 다운로드를 지원합니다. Android 시스템 WebView 업데이트를 권장합니다.

## 주소 자동 발견

MainPC가 검증한 Quick Tunnel 주소와 실행별 UUID만 GitHub 저장소의 별도 `connection` 브랜치에 등록합니다. 채팅·첨부·비밀번호·인증 토큰은 등록하지 않습니다. MainPC에는 Git과 기존 저장소 쓰기 인증이 필요하고, 휴대폰은 GitHub 인증이 필요하지 않습니다. 작업 브랜치와 스테이징 영역은 바꾸지 않습니다. 등록 실패 시 관리창에 표시하고 60초마다 재시도합니다.

앱은 GitHub의 현재 연결 정보와 HTTPS `/api/health`의 UUID가 모두 일치할 때만 입장합니다. 종료 후 남은 주소는 서버 확인에서 거부됩니다. GitHub 공개 API 호출 제한 또는 네트워크 차단이 있으면 주소 확인이 실패할 수 있습니다.

## 빌드

SDK 경로를 Android Studio에서 설정하거나 `local.properties`에 설정한 뒤:

```powershell
.\gradlew.bat assembleDebug testDebugUnitTest lintDebug
```

설치 가능한 개발용 APK: `app/build/outputs/apk/debug/app-debug.apk`. 스토어 배포용 서명은 별도로 필요합니다. `local.properties`, APK 출력, IDE/Gradle 캐시와 서명키는 Git에 저장하지 않습니다.

MainPC 서버를 열고 에뮬레이터/기기를 연결하면 `connectedDebugAndroidTest`로 단일 입장 버튼, 공개 주소 자동 발견, 실행 UUID 확인 및 실제 채팅 화면 로드를 검증합니다.
