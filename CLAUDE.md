# Breeze 프로젝트 - Claude AI 협업 가이드

## 프로젝트 개요

**Breeze**는 화면 공유로 강의를 녹음하면 슬라이드 변경을 자동 감지하고, AI가 분석해서 Notion에 정리해주는 크롬 익스텐션 + 서버입니다.

- **Extension**: React + TypeScript (Chrome Extension Manifest V3)
- **Server**: Python + FastAPI + WebSocket
- **AI**: Gemini 2.0 Flash, GPT-4o Vision, OpenAI Whisper
- **Integration**: Notion API

---

## 아키텍처 설명

### 처리 흐름

```
1. Extension (content.tsx)
   - 화면 공유 녹음
   - 30초 간격 슬라이드 변경 감지 (base64 문자열 비교)
   - WebSocket으로 서버 전송

2. Server (main.py)
   - SessionManager: 세션 상태 관리
   - VisionAgent: Gemini/GPT-4o Vision OCR 분석
   - STTAgent: Whisper 음성 텍스트 변환
   - SummaryAgent: 종합 요약 생성
   - NotionAgent: Notion API 업로드
```

### 핵심 기술

**슬라이드 변경 감지** (`extension/src/content.tsx:152-209`)
```typescript
// Canvas로 현재 프레임 캡처
const currentFrameData = canvas.toDataURL('image/jpeg', 0.8)

// 이전 프레임과 비교
if (lastFrameData !== currentFrameData) {
  const lengthDiff = Math.abs(lastFrameData.length - currentFrameData.length)
  const first1000Diff = lastFrameData.substring(0, 1000) !== currentFrameData.substring(0, 1000)
  const last1000Diff = lastFrameData.slice(-1000) !== currentFrameData.slice(-1000)

  if (lengthDiff > 100 || first1000Diff || last1000Diff) {
    sendSlideToServer(sessionId, currentFrameData)
  }
}
```

**WebSocket 상태 관리** (`extension/src/store/websocketStore.ts`)
- Popup → Background Service Worker (chrome.runtime.connect)
- Background → Server (WebSocket)
- 상태 지속성: chrome.storage.local

**Notion API 업로드** (`server/main.py:303-384`)
- PATCH 메서드 (POST 아님)
- Markdown → Notion 블록 변환
- 강의 제목별 페이지 생성

---

## 문제 해결 가이드

### 1. WebSocket 연결 실패
```
문제: Popup에서 직접 WebSocket 연결 실패
원인: Chrome Extension Popup 생명주기 제한
해결: Background Service Worker로 이동 (background.ts)
```

### 2. 슬라이드 감지 안 됨
```
문제: 숨겨진 video element가 업데이트 안 됨
원인: display: none인 video는 프레임 업데이트 안 됨
해결: 1px visible로 설정 (opacity: 0.01)
```

### 3. Notion API 400 에러
```
문제: blocks 업로드 실패
원인: POST 메서드 사용
해결: PATCH 메서드로 변경
API 버전: 2025-09-03
```

### 4. Popup 닫으면 상태 소실
```
문제: Zustand 상태 리셋
해결: chrome.storage.local로 지속화
```

---

## 개발 컨벤션

### 코드 스타일
- Extension: TypeScript + ESLint
- Server: Python 3.13 + type hints
- 커밋 메시지: conventional commits

### 환경 변수
```bash
# server/.env.example 참고
VISION_MODEL=gemini-2.0-flash-exp
SUMMARY_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
NOTION_API_KEY=secret_...
NOTION_PARENT_PAGE_ID=...
```

### 디렉토리 구조
```
breeze/
├── extension/
│   └── src/
│       ├── background.ts       # Service Worker
│       ├── content.tsx         # 화면 캡처
│       └── PopupComponent.tsx  # UI
└── server/
    └── main.py                # FastAPI 서버
```

---

## AI 협업 팁

### 신규 기능 개발
1. `extension/` 또는 `server/`에서 핵심 기능 구현
2. 이 CLAUDE.md 문서 업데이트
3. `pnpm build`으로 Extension 빌드 테스트
4. `pipenv run python main.py`으로 서버 테스트

### 버그 수정
- 에러 로그나 스크린샷 제공
- 재현 단계 설명
- 기대 동작 설명

### 코드 리뷰 체크리스트
- WebSocket 통신 프로토콜 일관성
- Notion API 올바른 메서드 사용
- 상태 지속성 완전성

---

## 빠른 링크

- GitHub: https://github.com/SonYoonSeok/breeze
- Chrome Extension: `extension/dist/`
- Server: `http://localhost:8000`
- Notion 페이지: 강의 제목별 자동 생성
