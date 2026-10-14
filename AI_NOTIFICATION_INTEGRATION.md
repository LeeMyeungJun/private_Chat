# 모음 서버 알림 연동 — 다른 프로그램을 개발하는 AI용

## 목적과 구현 위치

주식 프로그램의 매수·매도 실행 결과, YouTube 업로드 완료, 스케줄 작업 시작·완료·실패 등 **이미 발생한 이벤트**를 모음 서버에 전달한다. 서버가 채팅방에 자세한 공지를 게시하고 연결된 Android 앱에 요약 푸시를 요청한다. 이 문서만 읽고 Python, Node.js, PowerShell 또는 다른 언어에서 연동할 수 있다.

- 서버 저장소: `C:\nowork\git_private_chat`
- 서버 실행: `모음 서버.lnk` 또는 `run-chat.bat`. PC 채팅 클라이언트를 열 필요는 없다.
- 외부 프로그램용 HTTP API: `server.js`, 인증/이벤트 변환: `notification-api.js`
- 바로 가져다 쓸 Python 함수/CLI: `examples/moeum_notify.py` — 추가 패키지 없이 표준 라이브러리만 사용한다.
- 발송 대상: 현재 서버 실행에 연결하여 해당 방의 푸시를 구독한 Android 앱. 별도의 수신자 지정 기능은 없다.

## AI가 따라야 할 연동 규칙

1. 실제 업무 프로그램에 아래 **HTTP API**를 연결한다. 채팅 로그인, 브라우저 자동화, Socket.IO 클라이언트, Electron IPC는 필요 없다.
2. 알림 연동 때문에 주문 실행·영상 업로드·스케줄 작업 자체를 다시 실행하지 않는다. 업무 성공/실패와 알림 성공/실패를 따로 기록한다.
3. 해당 업무 이벤트가 실제로 발생한 뒤 호출한다. 작업 시작/완료/실패는 서로 다른 이벤트 ID를 사용한다. 테스트는 별도 테스트 서버에서 한다.
4. 업무 처리 경로를 알림 네트워크 응답으로 막지 않는다. 기존 프로그램의 백그라운드 작업자/작업 큐에 알림 이벤트를 넣는다.
5. `eventId`는 이벤트를 처음 만들 때 한 번 정해 큐/작업 기록에 보관한다. 타임아웃·429·네트워크 오류 재시도는 **같은 source, eventId, 제목, 내용**을 사용한다. 재시도 때마다 UUID를 새로 만들지 않는다.
6. 응답의 `ok: true, posted: true`는 채팅 게시 성공이다. `pushSent: false`여도 이미 게시됐다. 공지를 다시 생성하지 말고 `warning`을 기록한다.
7. 서버는 자동으로 시작하거나 재시작하지 않는다. 서버가 닫혀 있으면 알림 큐에 남기거나 실패로 기록한다. 이 서버는 재시작할 때 모든 이전 채팅·첨부를 삭제한다.
8. 인증키는 실행 환경/서버의 키 파일에서 읽는다. 소스 코드, Git, 로그, 문서, APK에 실제 키를 넣지 않는다. 각 업무 프로그램에 Firebase 비공개 키를 전달할 필요는 없다.

## 접속 주소와 인증

### 같은 PC의 프로그램 — 기본 경로

```text
MOEUM_SERVER_URL=http://127.0.0.1:3000
MOEUM_NOTIFY_KEY_FILE=C:\nowork\git_private_chat\.data\notification-api-key.txt
```

알림 API 키 파일은 서버 시작 시 없으면 자동 생성한다. 서버를 재시작해도 유지한다. 채팅방 입장 비밀번호와는 별개인 **프로그램 발송용 키**다. Python 예제는 이 저장소 안에 두면 기본적으로 위 `.data` 파일을 찾아 읽는다. 다른 프로젝트에 파일을 복사했다면 `MOEUM_NOTIFY_KEY_FILE` 또는 `MOEUM_NOTIFY_KEY`를 설정한다.

서버 관리자가 `MOEUM_NOTIFICATION_API_KEY` 환경변수로 키를 지정한 경우, 서버는 파일 대신 그 키를 사용한다. 발송 프로그램의 `MOEUM_NOTIFY_KEY`에도 같은 값을 설정해야 한다. 기본 파일의 실제 키를 이 문서에 복사하지 않는다.

### 다른 PC의 프로그램

서버의 현재 HTTPS 외부 주소를 `MOEUM_SERVER_URL`에 설정하고, 발송 프로그램에 API 키를 별도로 제공한다. 로컬 주소 `127.0.0.1`은 **그 프로그램이 실행되는 PC 자신**이므로 다른 PC의 서버를 가리키지 않는다.

로그인 없는 Quick Tunnel 주소는 서버 외부 연결을 다시 만들 때 바뀐다. 고정 주소를 하드코딩하지 않는다. 주소 자동 발견이 필요하면:

1. 공개 GitHub API `https://api.github.com/repos/LeeMyeungJun/private_Chat/contents/connection.json?ref=connection`을 조회한다. 응답의 `content`를 Base64 디코딩하면 `{version: 1, url, instanceId, updatedAt}`가 나온다.
2. `url`이 `https://<이름>.trycloudflare.com` 형태의 HTTPS 원점인지 확인한다. 사용자 정보, 쿼리, fragment, 다른 경로가 있으면 거부한다.
3. 해당 URL의 `GET /api/health`에서 `ok: true`와 **같은 instanceId**를 확인한다. 등록 정보만 보고 서버가 열려 있다고 판단하지 않는다.
4. 발송 요청에 `expectedInstanceId`를 넣어 조회한 서버 실행을 지정한다. 키를 URL이나 GitHub 요청에 넣지 않는다. 키는 검증한 모음 서버의 `Authorization` 헤더에만 넣는다.
5. GitHub 조회 결과는 적절히 캐시하고 실패 시 지연 재시도한다. 마지막으로 주소를 등록한 서버가 새 접속 대상이다. 여러 서버가 있더라도 다른 서버를 임의로 선택하지 않는다.

## API 계약

### 서버 상태

`GET /api/health` — 인증 없음

```json
{"ok":true,"instanceId":"현재 서버 실행 UUID"}
```

`GET /api/notifications/status` — 아래 Bearer 인증 필요

```json
{"ok":true,"apiVersion":1,"instanceId":"현재 서버 실행 UUID","pushEnabled":false}
```

`pushEnabled`는 서버의 Firebase 발송 구성이 로드됐다는 뜻이다. 실제 발송 성공은 각 POST 응답으로 확인한다. `false`여도 채팅 공지는 게시할 수 있다. Firebase 서버 인증 설정은 서버 운영자가 완료해야 한다.

### 공지 + 푸시 요청

```http
POST /api/notifications
Content-Type: application/json
Authorization: Bearer <프로그램 발송용 API 키>
```

```json
{
  "source": "stock-bot",
  "eventId": "order-20261014-001-filled",
  "title": "매수 체결 완료",
  "body": "프로그램에서 실제로 확인한 종목·수량·가격·체결 시간을 여기에 작성합니다.\n여러 줄 내용을 지원합니다.",
  "expectedInstanceId": "현재 서버 실행 UUID"
}
```

| 필드 | 필수 | 규칙 |
|---|---|---|
| `source` | 예 | 발송 프로그램 이름, 1~40자. 같은 프로그램은 일관된 이름 사용. 제어문자 불가. |
| `eventId` | 예 | 업무 이벤트 고유 ID, 1~128자. 주문/업로드/작업 실행 ID에 이벤트 종류를 붙이거나 한 번 생성한 UUID 사용. 제어문자 불가. |
| `title` | 예 | 제목, 1~80자. |
| `body` | 예 | 자세한 내용, 1~5,000자. 줄바꿈 가능. HTML이 아닌 일반 텍스트. |
| `expectedInstanceId` | 아니요 | `/api/health`에서 확인한 서버 실행 UUID. 서버가 바뀌었다면 게시 전에 409로 거부. 원격 주소 자동 발견 시 사용 권장. |

공백을 제거한 길이를 검사하며 JavaScript 문자열 길이 기준이다. 요청 JSON 전체는 32 KiB 이하이다. 파일 첨부 API는 제공하지 않는다. 채팅에는 제목과 전체 내용을 **서버 공지 · source**로 게시하고, 모바일 푸시에는 제목과 내용 앞부분 최대 160개 Unicode 문자 및 생략 표시를 보낸다.

### 성공 응답

처음 게시: HTTP **201**. 같은 이벤트 재요청: HTTP **200**.

```json
{
  "ok": true,
  "posted": true,
  "messageId": "게시된 공지 UUID",
  "instanceId": "현재 서버 실행 UUID",
  "pushSent": false,
  "warning": "모바일 알림 설정을 준비 중입니다.",
  "replayed": false
}
```

`pushSent: true`는 FCM이 발송 요청을 수락했다는 의미이며 휴대폰 수신·소리 재생 확인은 아니다. `warning`은 성공 시 빈 문자열이다. `replayed: true`면 기존 결과를 돌려준 것으로 공지를 추가하거나 푸시를 다시 보내지 않는다. 중복 판단 범위는 **현재 서버 실행에서 동일한 source + eventId**다. 서버 재시작 시 기존 공지와 중복 기록이 모두 초기화된다. 이전 실행에서 성공한 이벤트를 새 서버로 자동 재전송하지 않는다.

### 실패와 재시도

| 상태/코드 | 처리 |
|---|---|
| 400 / `INVALID_REQUEST` 또는 입력 오류 | 필드/JSON 수정. 같은 잘못된 요청을 반복하지 않는다. |
| 401 / `UNAUTHORIZED` | 서버 API 키 확인. 채팅 로그인 쿠키로 대체하지 않는다. |
| 409 / `IDEMPOTENCY_CONFLICT` | 같은 source + eventId를 다른 내용에 재사용했다. 동일 이벤트 재시도는 원래 내용을 보내고, 실제로 다른 이벤트면 새 ID를 만든다. |
| 409 / `SERVER_CHANGED` | 서버 실행이 달라졌다. 현재 서버를 다시 확인하고 미전송 이벤트 처리 방침에 따라 처리한다. 이전 서버의 성공 이벤트를 자동 재발송하지 않는다. |
| 429 / `RATE_LIMITED` | 게시되지 않았다. `Retry-After` 헤더의 초만큼 기다린 뒤 같은 이벤트를 재시도한다. |
| 413 | JSON 크기 제한 초과. 본문을 줄인다. |
| 500 / `SAVE_FAILED` | 같은 이벤트 ID로 지연 재시도한다. |
| 연결 거부·타임아웃·5xx·Cloudflare 오류 | 서버/외부 연결 상태 확인 후 같은 이벤트 ID로 지연 재시도한다. 타임아웃만으로 미게시라고 단정하지 않는다. |

공지 게시 간격은 **서버 전체에서 15초**다. 서버 프로그램의 수동 공지도 이 제한을 공유한다. 발송 프로그램이 여러 개면 각 프로그램의 큐에서 429를 처리해야 한다. 모바일 푸시는 채팅의 종 버튼과도 발송 제한을 공유하므로 채팅 게시 성공에 `pushSent: false`가 나올 수 있다. 이 경우 공지를 중복 게시하지 않는다.

## 복사해서 쓰는 예제

### Python — 권장 공통 함수

`examples/moeum_notify.py`를 업무 프로젝트로 복사하고 환경변수를 설정한다.

```python
from moeum_notify import send_notification, NotificationError

# event_id는 업무 이벤트/발송 큐에 저장한 값을 사용한다.
# 이 함수는 별도 알림 작업자에서 실행한다.
try:
    result = send_notification(
        "영상 업로드 완료",
        "제목: 실제 영상 제목\n영상: https://youtu.be/실제영상ID\n업로드 작업: 실제 작업 ID",
        source="youtube-uploader",
        event_id="upload-작업ID-completed",
    )
    # result['posted']가 True이면 발송 큐의 채팅 게시 완료로 처리한다.
    # pushSent가 False이면 warning을 따로 기록한다.
except NotificationError as error:
    # error.status == 429: error.retry_after초 후 같은 이벤트로 재시도.
    # NETWORK_ERROR/5xx: 지연 재시도. 400/401/409: 설정/이벤트 확인.
    # 키 자체는 로그에 쓰지 않는다.
    print(error.code, str(error))
```

같은 PC에서 CLI를 바로 사용할 수도 있다:

```powershell
$env:MOEUM_NOTIFY_KEY_FILE = 'C:\nowork\git_private_chat\.data\notification-api-key.txt'
python C:\nowork\git_private_chat\examples\moeum_notify.py --source scheduler --event-id '실행ID-started' --title '예약 작업 시작' --body '작업명과 실제 시작 시간을 작성합니다.'
```

함수/CLI는 **한 번만 요청**한다. CLI 종료코드 0은 채팅 게시 성공, 1은 요청 실패다. 재시도/큐 저장은 호출하는 프로그램에서 구현한다. 응답 타임아웃 기본값은 25초다.

### Node.js

```js
import fs from 'node:fs/promises';

const key = process.env.MOEUM_NOTIFY_KEY ||
  (await fs.readFile(process.env.MOEUM_NOTIFY_KEY_FILE ||
    'C:/nowork/git_private_chat/.data/notification-api-key.txt', 'utf8')).trim();
const base = process.env.MOEUM_SERVER_URL || 'http://127.0.0.1:3000';
const event = {
  source: 'scheduler', eventId: '저장된실행ID-completed',
  title: '예약 작업 완료', body: '작업 이름: 실제 작업명\n결과: 실제 결과',
};
const response = await fetch(base + '/api/notifications', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(25000),
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
  body: JSON.stringify(event),
});
const result = await response.json();
if (!response.ok) {
  // 429는 response.headers.get('retry-after')초 후 event를 그대로 재요청.
  // 네트워크 예외도 상위 발송 작업자에서 처리한다.
  throw new Error(result.code || result.error || 'Notification failed');
}
// result.posted / result.pushSent를 따로 기록한다.
```

### PowerShell

```powershell
$key = (Get-Content -LiteralPath 'C:\nowork\git_private_chat\.data\notification-api-key.txt' -Raw).Trim()
$payload = @{
    source = 'stock-bot'
    eventId = '저장된주문ID-sell-filled'
    title = '매도 체결 완료'
    body = "종목: 실제 종목`n수량: 실제 체결 수량`n체결가: 실제 체결가"
} | ConvertTo-Json -Compress
$result = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/api/notifications' `
    -Headers @{ Authorization = "Bearer $key" } -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 25 -MaximumRedirection 0
# HTTP 오류/타임아웃은 try/catch로 처리하고 원래 eventId를 유지한다.
```

## 이벤트 설계 예시

| 프로그램 | source 예 | eventId 예 | 발송 시점 |
|---|---|---|---|
| 주식 프로그램 | `stock-bot` | `주문ID-buy-filled`, `주문ID-sell-filled` | 거래 시스템에서 실제 체결을 확인한 뒤. 단순 신호 발생이면 제목을 '매수 신호' 등으로 구분한다. |
| YouTube 업로더 | `youtube-uploader` | `업로드작업ID-completed`, `업로드작업ID-failed` | 업로드 결과가 확정된 뒤. 성공 시 실제 영상 URL 포함. |
| 스케줄러 | `scheduler` | `작업실행ID-started`, `작업실행ID-completed`, `작업실행ID-failed` | 실제 시작/완료/실패 시. 정적 작업 이름만으로 ID를 만들지 않는다. |

## AI의 완료 확인 기준

- 이벤트 콜백에서 알림 큐로 전달하고 업무 처리 자체와 알림 실패를 분리했는가?
- 키를 코드에 넣지 않고 읽으며, 발송 요청·예외 로그에 키를 노출하지 않는가?
- 같은 이벤트 재시도에 동일한 ID/내용을 사용하며 429의 `Retry-After`를 처리하는가?
- HTTP 201/200의 `posted`와 `pushSent`를 구분하는가?
- 서버 종료/재시작, 네트워크 타임아웃, 잘못된 키, 제목/내용 오류를 처리하는가?
- 원격 자동 발견을 쓴다면 HTTPS 원점과 health 실행 UUID를 검증하는가?
- 채팅 게시만 검증했다면 실제 모바일 푸시 수신까지 완료했다고 보고하지 않는가?
