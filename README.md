# 모음 · 채팅과 프로그램 알림

Windows PC에서 서버를 열고 PC·웹·Android에서 같은 채팅방을 사용하는 개인용 프로그램입니다. 서버 프로그램에서 공지를 보내거나, 주식 프로그램·YouTube 업로더·스케줄러가 HTTP API로 이벤트를 보내 채팅 공지와 모바일 푸시로 알릴 수 있습니다.

**서버를 시작할 때마다 이전 대화와 첨부파일은 모두 삭제됩니다.** 서버 프로그램과 PC 채팅 클라이언트는 따로 실행합니다. 모바일 푸시를 사용하려면 아래 Firebase 발송 설정을 완료해야 합니다.

- [서버 처음 실행하기](#1-서버-처음-실행하기)
- [Android APK 설치와 입장](#2-android-apk-설치와-입장)
- [서버 프로그램에서 공지 보내기](#3-서버-프로그램에서-공지-보내기)
- [다른 프로그램에서 알림 보내기](#4-다른-프로그램에서-알림-보내기)
- **AI에게 연동 작업을 맡길 때:** [AI_NOTIFICATION_INTEGRATION.md](AI_NOTIFICATION_INTEGRATION.md)

## 실행 파일과 역할

| 실행 방법 | 역할 |
|---|---|
| `run-chat.bat` | 필요한 패키지를 설치하고 **서버 관리창** 실행 |
| `모음 서버.lnk` 또는 `npm start` | 서버 관리창 실행. 주소 확인·초대 주소 복사·공지 발송·서버 종료 |
| `모음 채팅.lnk` 또는 `npm run client` | 별도 **PC 채팅창** 실행. 열려 있는 로컬 서버에 MainPC 닉네임으로 입장 |
| Android APK | **서버 입장**을 눌러 현재 서버를 찾고 닉네임으로 입장 |
| 웹브라우저 | 서버 관리창에서 복사한 HTTPS 초대 주소로 입장 |
| `POST /api/notifications` | 다른 프로그램에서 공지·푸시 요청. 채팅 로그인 없이 프로그램 발송용 API 키 사용 |

`.lnk` 바로가기는 각 PC에서 생성하는 파일이라 Git에 포함되지 않습니다. 저장소를 처음 복제하면 아래 명령으로 만들 수 있습니다. 서버를 열어도 PC 채팅창이 함께 열리지는 않습니다. PC 채팅창을 닫아도 서버는 계속 실행되고, **서버 관리창을 닫으면 서버와 외부 연결이 종료됩니다.**

## 1. 서버 처음 실행하기

준비: **Windows, Node.js 22 이상, Git, 인터넷 연결**. Android 앱의 주소 자동 등록까지 사용하려면 이 GitHub 저장소에 쓸 수 있는 Git 인증도 서버 PC에 설정해야 합니다. 휴대폰에는 GitHub 로그인이 필요 없습니다.

배포 APK의 주소 발견 대상은 `LeeMyeungJun/private_Chat`입니다. 이 저장소의 쓰기 권한이 없는 계정은 앱 주소를 등록할 수 없습니다. Git의 커밋 이름·이메일(`user.name`, `user.email`)도 설정되어 있어야 합니다. GitHub 인증은 서버를 열기 전에 완료하세요. 주소 등록 과정에서는 로그인 창을 띄우지 않습니다.

PowerShell에서:

```powershell
git clone https://github.com/LeeMyeungJun/private_Chat.git git_private_chat
cd git_private_chat
.\run-chat.bat
```

`run-chat.bat`가 처음 필요한 패키지를 설치하고 서버 관리창을 엽니다. 수동으로 설치·실행하려면:

```powershell
npm ci
npm start
```

서버·채팅 바로가기를 만들려면 저장소 폴더에서:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-shortcut.ps1
```

이후에는 **모음 서버.lnk**만 열면 됩니다. 실행 중에 서버 바로가기를 다시 누르면 관리창이 앞으로 표시됩니다. PC에서도 대화하려면 **모음 채팅.lnk**를 별도로 엽니다.

### 외부 접속 준비

1. 서버 관리창이 열린 뒤 **접속 가능** 상태를 기다립니다.
2. 웹 사용자는 **초대 주소 복사**로 받은 주소를 브라우저에서 엽니다.
3. Android 사용자는 관리창에 **Android 앱 입장 가능**까지 표시된 뒤 앱으로 입장합니다.
4. 참가자는 닉네임만 입력합니다. 채팅 입장 비밀번호는 없습니다.

Cloudflare Quick Tunnel이 `https://무작위이름.trycloudflare.com` 주소를 자동 생성합니다. Tailscale·Cloudflare 계정 로그인·공유기 포트포워딩은 필요 없습니다. 연결 모듈은 처음 필요할 때 공식 배포 파일을 다운로드하고 SHA-256을 확인합니다.

**외부 주소는 서버 외부 연결을 다시 생성하면 바뀝니다.** 현재 주소는 `공유주소.txt`에도 기록됩니다. Android 앱용 주소와 서버 실행 UUID는 이 저장소의 별도 `connection` 브랜치에 등록합니다. 등록에는 서버 PC의 GitHub 쓰기 인증이 필요하며 채팅·파일·인증키는 등록하지 않습니다. Quick Tunnel은 가동률 보장이 없는 임시 외부 연결입니다.

## 2. Android APK 설치와 입장

1. 휴대폰에서 **[최신 APK 다운로드](https://github.com/LeeMyeungJun/private_Chat/releases/latest)**를 열고 릴리스의 `moeum-chat-*.apk` 파일을 설치합니다. Android 8.0 이상을 지원합니다.
2. 앱을 한 번 열고 **알림 권한을 허용**합니다.
3. 서버 PC에서 **모음 서버.lnk**를 열고 **Android 앱 입장 가능**을 확인합니다.
4. 앱의 **서버 입장**을 누르고 닉네임을 입력합니다. 서버 주소를 직접 입력하지 않아도 됩니다.

입장 후에는 별도의 Android 연결 유지 서비스가 서버 연결을 유지합니다. 홈·뒤로 가기·다른 앱 사용으로 채팅 화면을 내려도 연결을 종료하지 않습니다. 상태 알림의 **연결 끊기** 또는 채팅 메뉴의 **서버 연결 끊기**로 직접 나갈 수 있습니다. 명시적인 서버 종료 또는 실행 UUID 변경을 확인하면 연결을 종료하며, 새 서버가 열린 뒤 **서버 입장**을 다시 누르면 새 주소를 찾습니다. 일시적인 인터넷 단절·Cloudflare 오류·반복된 서버 확인 실패는 재연결하며 알림 구독을 유지합니다. 푸시는 채팅 소켓과 별도로 수신합니다. 서버 강제 종료인지 일시적인 장애인지 판단할 수 없으면 구독을 유지하지만, 종료된 서버는 발송할 수 없고 다음 실행은 다른 방으로 분리됩니다. 앱 강제 중지·기기 종료 시에는 연결과 알림 수신을 유지할 수 없습니다. 제조사 절전 기능으로 알림이 제한되면 앱 배터리 설정을 **제한 없음**으로 설정합니다.

여러 PC에서 서버를 열면 마지막으로 주소를 등록한 서버가 새 입장 대상입니다. 이미 입장한 기기는 기존 서버에 연결되어 있으며, 마지막 서버가 닫혀도 다른 서버를 자동 선택하지 않습니다.

Android Studio 빌드, Figma 리소스, 상세 동작은 [Android 안내](android/README.md)를 참고하세요.

## 3. 서버 프로그램에서 공지 보내기

**모음 서버** 관리창의 **공지 · 모바일 알림**에서 제목과 자세한 내용을 입력하고 **공지 · 알림 보내기**를 누릅니다. 채팅 클라이언트를 열거나 닉네임으로 입장할 필요가 없습니다.

- 제목: 1~80자, 자세한 내용: 1~5,000자. 줄바꿈을 지원합니다.
- 채팅방: 제목과 전체 내용을 **서버 공지**로 게시합니다.
- 모바일: 연결된 방을 구독한 앱에 제목과 최대 160개 Unicode 문자의 요약을 발송합니다.
- 공지 게시 간격: 서버 전체에서 15초. 다른 프로그램의 알림 요청과 공유합니다.
- 모바일 발송이 준비되지 않았거나 실패해도 채팅 공지는 게시하고 결과에 따로 안내합니다.

채팅창의 종 모양 **모바일 알림 울리기** 버튼은 서버에 호출 알림을 요청합니다. Firebase 발송 구성이 없으면 이 버튼은 비활성화됩니다.

### 모바일 푸시를 켜려면

채팅과 공지 게시만 사용하면 Firebase 설정 없이 실행할 수 있습니다. **실제 Android 푸시 발송**에는 배포 APK와 같은 Firebase 프로젝트의 FCM 발송 권한을 가진 서비스 계정 인증 파일이 필요합니다.

1. 서버 PC의 `.data/firebase-service-account.json`에 발송용 서비스 계정 JSON을 둡니다. 이 파일은 Git이나 APK에 넣지 않습니다.
2. 서버를 다시 실행합니다. 서버 재시작은 기존 대화·첨부를 초기화합니다.
3. 휴대폰 앱을 열어 서버에 입장하고 알림 권한을 허용합니다.
4. 서버 공지를 보내고 결과의 모바일 발송 상태를 확인합니다. 소리·진동은 휴대폰의 무음·방해금지·알림 채널 설정을 따릅니다.

직접 Android 앱을 빌드한다면 같은 Firebase 프로젝트의 Android 구성 파일을 `android/app/google-services.json`에 둡니다. 이 파일도 Git에서 제외됩니다. 다른 PC로 서버를 옮기면 그 PC에도 서버 발송 인증을 설정해야 합니다. 서버 인증 파일 경로는 `MOEUM_FIREBASE_CREDENTIALS` 환경변수로 지정할 수도 있습니다.

## 4. 다른 프로그램에서 알림 보내기

주식 프로그램의 매수·매도 체결, YouTube 업로드 완료, 예약 작업 시작·완료·실패를 **서버에 한 번 요청**하면 채팅 공지와 모바일 푸시로 전달할 수 있습니다. 각 프로그램이 Firebase에 직접 연결할 필요는 없습니다.

| 항목 | 같은 서버 PC에서 사용할 값 |
|---|---|
| 서버 주소 | `http://127.0.0.1:3000` |
| 발송 경로 | `POST /api/notifications` |
| 인증 헤더 | `Authorization: Bearer <프로그램 발송용 API 키>` |
| 키 파일 | `.data/notification-api-key.txt` — 서버가 처음 생성하고 재시작해도 유지 |
| 바로 쓸 공통 함수 | [examples/moeum_notify.py](examples/moeum_notify.py) — Python 표준 라이브러리만 사용 |
| AI용 전체 계약·예제 | [AI_NOTIFICATION_INTEGRATION.md](AI_NOTIFICATION_INTEGRATION.md) |

프로그램 발송용 API 키와 Firebase 서비스 계정 파일은 서로 다른 것입니다. 발송 프로그램에는 API 키만 제공하면 됩니다.

### 가장 빠른 실행 예제

Python 3이 설치된 PC에서 저장소 폴더를 열고, 실행 중인 로컬 서버로 다음 명령을 보냅니다. 실제 채팅 공지를 게시하는 명령입니다.

```powershell
python .\examples\moeum_notify.py --source scheduler --event-id 'run-001-started' --title '예약 작업 시작' --body '작업명: 영상 처리. 상태: 시작됨.'
```

예제 함수는 기본적으로 이 저장소의 `.data/notification-api-key.txt`를 읽습니다. 다른 프로젝트로 복사하면 키 파일 경로를 지정합니다:

```powershell
$env:MOEUM_SERVER_URL = 'http://127.0.0.1:3000'
$env:MOEUM_NOTIFY_KEY_FILE = 'C:\nowork\git_private_chat\.data\notification-api-key.txt'
```

HTTP로 직접 호출할 때의 JSON:

```json
{
  "source": "youtube-uploader",
  "eventId": "upload-작업ID-completed",
  "title": "영상 업로드 완료",
  "body": "영상 제목: 실제 제목\n영상 주소: 실제 URL"
}
```

`source`는 프로그램 이름, `eventId`는 실제 업무 이벤트 고유 ID입니다. 처음 게시는 HTTP **201**, 같은 이벤트 재시도는 기존 결과를 HTTP **200**으로 돌려줍니다. **같은 이벤트를 재시도할 때 source·eventId·제목·내용을 그대로 유지**해야 합니다. 새 이벤트에는 새 ID를 사용합니다. 서버 재시작 후에는 이전 실행의 중복 기록도 초기화됩니다.

`ok: true, posted: true`는 채팅 게시 성공입니다. `pushSent: false`여도 공지가 이미 게시되었으므로 다시 생성하지 말고 `warning`을 기록합니다. 429이면 `Retry-After` 헤더의 초만큼 기다린 뒤 같은 이벤트를 재시도합니다. 업무 처리와 알림 실패를 분리하고, 알림 재시도 때문에 주문·업로드·예약 작업 자체를 다시 실행하지 않습니다.

다른 PC에서 호출한다면 `127.0.0.1` 대신 현재 서버의 HTTPS 주소를 사용합니다. 주소는 바뀌므로 하드코딩하지 않고, 주소 자동 발견과 서버 실행 UUID 확인 방법은 [AI용 연동 안내](AI_NOTIFICATION_INTEGRATION.md#접속-주소와-인증)를 따릅니다. 키는 소스 코드·Git·로그에 넣지 않습니다.

### 다른 프로그램의 개발 AI에게 줄 요청

```text
C:\nowork\git_private_chat\AI_NOTIFICATION_INTEGRATION.md를 먼저 읽어라.
현재 프로그램에서 실제 발생한 [체결/업로드 완료/작업 시작 등] 이벤트를
모음 서버의 POST /api/notifications로 보내도록 연동해라.
별도의 알림 작업자에서 보내고 동일 이벤트 재시도의 ID를 유지해라.
채팅 게시 성공과 모바일 푸시 성공을 구분해서 처리해라.
```

## 채팅과 파일 사용법

- 닉네임만 입력해 입장합니다. 서버 주소로 입장한 참가자는 현재 방의 대화와 공유파일을 볼 수 있습니다.
- PC: Enter 전송, Shift+Enter 줄바꿈. 모바일: 전송 버튼으로 보내고 Enter는 줄바꿈합니다.
- `+`, 드래그 앤 드롭, 이미지 붙여넣기로 첨부합니다. 모바일은 사진 선택·카메라 촬영·파일 선택을 지원합니다.
- 파일당 최대 **50MB**, 한 번에 **10개**. 이미지 미리보기·확대·다운로드를 제공합니다.
- MP3·MP4 등은 실제 길이가 **10분 이하**이면 채팅에서 재생·탐색·다운로드합니다. 더 길거나 길이를 확인하지 못하면 일반 첨부로 다운로드합니다.
- 멤버 목록, 입력 중 표시, 공유 파일 패널, 불러온 대화 검색, 이전 대화 더 불러오기를 지원합니다.
- 외부 연결은 HTTPS를 사용합니다. 현재 방의 내용은 서버 PC에 저장하며 종단간 암호화 메신저는 아닙니다.

## 데이터와 설정 파일

`.data/`와 다음 개인 설정 파일은 Git에서 제외됩니다.

| 파일 | 용도와 유지 여부 |
|---|---|
| `.data/settings.json` | 방 이름, 서버 재시작 후 유지 |
| `.data/messages.jsonl` | 현재 방의 채팅·공지, 다음 서버 시작 시 삭제 |
| `.data/uploads/`, `.data/uploads.json` | 현재 방의 첨부·목록, 다음 서버 시작 시 삭제 |
| `.data/notification-api-key.txt` | 다른 프로그램의 API 발송 인증, 서버 재시작 후 유지 |
| `.data/firebase-service-account.json` | 서버의 FCM 발송 인증, 서버 재시작 후 유지 |
| `.data/desktop.log` | 서버·외부 연결·주소 등록 로그 |
| `공유주소.txt` | 현재 외부 주소, 정상 종료 시 삭제하고 다음 시작 시 새로 생성 |
| `android/app/google-services.json` | Android 앱 빌드용 Firebase 구성 |

서버 종료 시 참가자는 연결이 끝나고, 다음 실행은 새 채팅방입니다. 채팅 클라이언트만 닫았다 다시 열면 같은 서버의 현재 방을 유지합니다.

## 문제가 생겼을 때

| 증상 | 확인할 것 |
|---|---|
| `.lnk`가 없다 | 바로가기는 Git에 포함되지 않음. `scripts/create-shortcut.ps1`로 생성 |
| 서버가 실행되지 않는다 | Node.js 22 이상, `npm ci`, 로컬 3000 포트 사용 여부 |
| 외부 주소가 준비되지 않는다 | 인터넷 연결 확인 후 관리창의 **외부 연결 다시 시도** |
| 웹 접속은 되지만 Android 입장이 안 된다 | 관리창의 **Android 앱 입장 가능** 여부. GitHub 저장소 쓰기 인증과 주소 등록 로그 확인 |
| APK에 이전 주소의 Cloudflare 1033 오류가 보인다 | 최신 APK로 업데이트. **서버 입장**으로 현재 주소를 다시 찾기. 서버 외부 연결 상태 확인 |
| 서버 재시작 뒤 이전 방이 사라졌다 | 정상 동작. 매 실행 새 방이며 이전 대화·첨부를 삭제함 |
| API 401 | 프로그램 발송용 키 확인. 채팅 로그인 쿠키나 Firebase JSON으로 대체하지 않기 |
| API 429 | `Retry-After`만큼 대기 후 같은 이벤트로 재시도 |
| 채팅 공지는 뜨지만 모바일 알림이 없다 | 서버 FCM 인증, `pushSent`/`warning`, 앱 입장·알림 권한·무음 설정 확인 |

## 코드 업데이트와 개발 검증

서버를 종료한 뒤 저장소 폴더에서:

```powershell
git pull
npm ci
npm start
```

서버 재시작은 기존 방을 초기화합니다. 웹 코드 변경은 서버에 반영되며 Android 네이티브 동작 변경은 새 APK를 설치해야 합니다.

```powershell
npm run check
npm test
npm run test:desktop
```

API 통합 테스트는 인증, 한글 공지와 실시간 전달, 중복·충돌·발송 간격, 서버 실행 UUID, 재시작 시 키 유지, 실제 Python 호출을 검증합니다. 데스크톱 테스트는 서버·클라이언트 분리와 종료 동작을 검증합니다. `npm test`의 Python 연동 검증에는 Python 3도 필요합니다.

외부 HTTPS·WebSocket까지 검증하려면 `$env:CHAT_TEST_TUNNEL='1'; npm run test:desktop`를 사용합니다. 테스트는 별도 데이터와 임시 주소를 사용합니다. Android 빌드·기기 검증은 [android/README.md](android/README.md)에 있습니다.

`npm run server`는 개발용 Node 서버 실행입니다. 일반 사용은 서버 관리창을 제공하는 `run-chat.bat` 또는 `npm start`로 시작하세요.
