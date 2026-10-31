# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence는 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)를 지속되는 작업 워크스페이스로 만들어 줍니다.
코드 작업을 계획하고, 서브에이전트가 작업을 수행하게 하며, 자체 체크를 실행하고, 결과를 Pi 터미널(`/cadence`)이나 브라우저 WebUI에서 검토하세요.
둘 다 같은 백그라운드 서비스에 연결됩니다.

## 왜 Cadence인가

- **작업은 창보다 오래 지속됩니다.**
  작업은 백그라운드 서비스에서 실행됩니다.
  터미널을 닫거나, Pi를 종료하거나, 브라우저 탭을 떠나도 단지 연결이 끊어지며, 어느 클라이언트든 같은 실행에 다시 연결할 수 있습니다.
- **승인하기 전에는 아무것도 수정되지 않습니다.**
  작업은 먼저 읽기 전용으로 분석하고 읽을 수 있는 계획을 제안합니다.
  파일은 정확히 그 계획을 확인한 후에만 수정됩니다.
- **신뢰할 수 있는 결과.**
  서브에이전트 출력, 실제 체크 실행, 그리고 본인의 검토는 서로 분리됩니다.
  모델의 글이나 "Done"은 체크 통과로 간주되지 않으며, 실패·취소·unknown 결과는 서로 구분됩니다.
- **완전한 역사.**
  모든 실행은 메시지, 도구 호출, 출력을 보관하며, 정확한 검색과 완전한 Markdown/NDJSON 내보내기를 지원합니다.
  알려진 비밀은 마스킹됩니다.
- **모든 것을 위한 하나의 링크.**
  WebUI(데스크톱과 전화, 영어와 간체 중국어)는 일반 Pi 대화도 호스트하며 프로젝트 간 전환이 가능하고, 각 프로젝트는 자체 owner와 역사를 가집니다.

Cadence는 신뢰할 수 있는 어시스턴트이며 **샌드박스가 아닙니다**.
그 에이전트는 호스트 도구로 작업 사본을 직접 편집하므로, 검토하고 복구할 수 있는 코드에서만 사용하세요.

## 설치

npm이 있는 Node `>=22.19.0`과 모델 제공자에 로그인되어 설치된 Pi가 필요합니다.
Cadence는 Pi의 로그인과 모델 설정을 재사용합니다.

```sh
npm install -g @abelxiaoxing/cadence
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install`은 백그라운드 서비스를 등록하고 시작합니다(Linux에서는 systemd, macOS에서는 LaunchAgent, Windows에서는 로그인 항목)하며, 개인 링크 `http://127.0.0.1:17423/?token=…`를 출력합니다.
마지막 명령은 Pi가 `/cadence`용으로 같은 사본을 로드하므로, npm 업그레이드 한 번으로 둘 다 업데이트됩니다.
포트와 토큰은 `~/.pi/agent/cadence/.env`에 있습니다.
토큰을 가진 사람은 누구나 워크스페이스를 사용할 수 있으므로 링크를 비공개로 유지하세요.

## 사용

### 브라우저에서

1. 출력된 링크를 한 번 엽니다.
   그 후 브라우저가 당신을 기억합니다.
   링크를 잃어버리면 `cadence token-link --reveal`이 다시 출력합니다.
2. 프로젝트 폴더를 선택하세요.
   전송 시 저장된 모델 설정을 재사용하며, 설정이 없을 때만 한 번 선택합니다.
3. `/cadence [목표]`를 한 번 전송하세요.
   이 대화는 Cadence 모드를 유지하며 이후에는 일반 메시지로 요구사항을 구체화합니다.
4. 전체 계획을 확인하고 **Implement this plan**을 누르세요.
   구현, 검사, 제한된 수정 및 합의한 로컬 전달을 자동으로 진행합니다.
5. 같은 대화에서 진행 상황을 확인하고, 서브에이전트 기록은 왼쪽 아래 **Subagents** 패널에서 여세요.
   새로고침이나 목표 완료로 모드가 꺼지지 않습니다.
   **Exit Cadence**는 모드만 종료하고, **Cancel workflow — request stop**은 작업 취소를 요청합니다.

No live Pi terminal is required for the browser conversation workflow.

### 터미널에서

`/cadence <목표>`를 한 번 입력한 다음 평소처럼 대화하세요.
Cadence가 프로젝트를 조사하고 결정 사항을 확인한 뒤 계획을 만듭니다.
명시적으로 계획을 승인하면 구현, 검증, 제한된 수정 및 합의한 로컬 통합을 자동으로 진행합니다.

목표가 완료되어도 이 대화는 Cadence 모드를 유지합니다.
`exit cadence`로 종료할 수 있으며, 종료는 이미 승인된 작업을 취소하지 않습니다.
모델 설정은 `~/.pi/agent/cadence/settings.json`에 저장되어 프로젝트 간 재사용됩니다.

로컬 owner는 필요할 때 시작됩니다.
시스템 서비스는 선택적인 WebUI 및 자동 시작용입니다.

`/cadence-history [run-id]`: readonly run details and retained history; no service startup or task execution.
See [History and diagnostics](docs/history.md).
[Conversation mode](docs/conversation-mode.md): native/browser approval, limits and worktree setup.
Browser authentication is not execution consent.

### 더 많은 프로젝트

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

각 프로젝트는 자체 owner, 포트, 역사를 가지며, 명령은 그 개인 링크를 출력합니다.
WebUI 폴더 선택기도 같은 방법으로 프로젝트를 엽니다.
다른 프로젝트를 열어도 이전 프로젝트의 작업은 멈추지 않습니다.

### 체크

기준 검사와 인수 검사의 명령은 명시적으로 승인하는 계획에 포함됩니다.
실제 검사 결과는 자동 Agent 검토와 별도로 기록됩니다.

## 서비스 관리

```sh
cadence server status
cadence server restart     # 업그레이드나 .env / models.json 변경 후
cadence server stop        # 등록은 유지되고 다음 부팅 또는 로그인 시 다시 시작
cadence server uninstall   # npm uninstall -g 전에 실행
```

`npm install -g @abelxiaoxing/cadence@latest`로 업그레이드하고, 그 후 `cadence server restart`. restart, stop, uninstall는 작업이 연결 끊긴 채로 남지 않도록 실행 중인 작업을 순서대로 멈춥니다. uninstall은 서비스 정의만 제거합니다.
프로젝트, 역사, Pi 설정은 유지됩니다.
Linux 루트 및 이름 지정 서비스, 원격 HTTPS 액세스, 복구에는 [서비스 관리](docs/service-management.md)와 [원격 액세스](docs/remote-access.md)를 참조하세요.

## 개발

Pi는 로컬 체크아웃이나 패킹된 tarball도 로드할 수 있습니다.
그 절대 또는 상대 경로를 Pi의 `packages`에 추가하거나, `pi -e ./cadence`를 시도하세요.
Cadence는 Pi 버전 범위를 강제하지 않습니다.
개발 고정 버전과 테스트된 런타임은 보편적인 호환성 약속이 아닙니다.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

엔지니어링 지침은 [engineering/](engineering/) 아래 영역별로 나뉘어 있습니다.
[AGENTS.md](AGENTS.md)의 프로젝트 인덱스가 어느 파일이 어느 코드를 다루는지 설명합니다.
`verify`에는 공식 Node 빌드, 개인 임시 디렉터리, 기존 Chromium도 필요합니다.
[검증](engineering/verification.md)을 참조하세요.

## 라이선스

Cadence는 MIT입니다.
번들된 적응 코드, 폰트, 벤더는 각각의 라이선스를 유지합니다.
[재사용 및 배포](docs/reuse-and-distribution.md)와 [서드파티 공지](THIRD_PARTY_NOTICES.md)를 참조하세요.
