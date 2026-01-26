# Breeze

강의를 편하게 녹음하고 요약해주는 크롬 익스텐션 + 서버

## 구조

- `extension/` - 크롬 익스텐션 (React + TypeScript)
- `server/` - Python 서버 (FastAPI + AI)

## 기능

- 화면 공유로 강의 녹음
- 슬라이드 변경 자동 감지
- AI로 슬라이드 분석 및 요약
- Notion에 자동 업로드

## 사용법

### Extension
```bash
cd extension
pnpm install
pnpm build
```
크롬에서 `chrome://extensions/` 로드

### Server
```bash
cd server
pipenv install
pipenv run python main.py
```
