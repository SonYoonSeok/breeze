# Breeze 项目 - Claude AI 协作指南

## 项目概述

**Breeze** 是一个在线课程自动摘要系统，通过屏幕共享录制课程，自动检测幻灯片变化，AI 分析后自动整理到 Notion。

- **Extension**: React + TypeScript (Chrome Extension Manifest V3)
- **Server**: Python + FastAPI + WebSocket
- **AI**: Gemini 2.0 Flash, GPT-4o Vision, OpenAI Whisper
- **Integration**: Notion API

---

## 架构说明

### 处理流程

```
1. Extension (content.tsx)
   - 屏幕共享录制
   - 每30秒检测幻灯片变化 (base64字符串比较)
   - WebSocket发送到服务器

2. Server (main.py)
   - SessionManager: 会话状态管理
   - VisionAgent: Gemini/GPT-4o Vision OCR分析
   - STTAgent: Whisper语音转文本
   - SummaryAgent: 综合摘要生成
   - NotionAgent: Notion API上传
```

### 关键技术点

**幻灯片变化检测** (`extension/src/content.tsx:152-209`)
```typescript
// Canvas捕获当前帧
const currentFrameData = canvas.toDataURL('image/jpeg', 0.8)

// 与上一帧比较
if (lastFrameData !== currentFrameData) {
  const lengthDiff = Math.abs(lastFrameData.length - currentFrameData.length)
  const first1000Diff = lastFrameData.substring(0, 1000) !== currentFrameData.substring(0, 1000)
  const last1000Diff = lastFrameData.slice(-1000) !== currentFrameData.slice(-1000)

  if (lengthDiff > 100 || first1000Diff || last1000Diff) {
    sendSlideToServer(sessionId, currentFrameData)
  }
}
```

**WebSocket 状态管理** (`extension/src/store/websocketStore.ts`)
- Popup → Background Service Worker (chrome.runtime.connect)
- Background → Server (WebSocket)
- 状态持久化: chrome.storage.local

**Notion API上传** (`server/main.py:303-384`)
- PATCH 方法 (不是 POST)
- Markdown → Notion blocks 转换
- 按讲座标题创建页面

---

## 常见问题排查

### 1. WebSocket 连接失败
```
问题: Popup直接连接 WebSocket 失败
原因: Chrome Extension中Popup生命周期限制
解决: 移到Background Service Worker (background.ts)
```

### 2. 幻灯片检测不工作
```
问题: 视频元素隐藏时不更新
原因: display: none的video不会更新帧
解决: 设置为1px可见 (opacity: 0.01)
```

### 3. Notion API 400错误
```
问题: blocks上传失败
原因: 使用了POST方法
解决: 改用PATCH方法
API版本: 2025-09-03
```

### 4. Popup关闭后状态丢失
```
问题: Zustand状态重置
解决: chrome.storage.local持久化
```

---

## 开发约定

### 代码风格
- Extension: TypeScript + ESLint
- Server: Python 3.13 + type hints
- 提交信息: conventional commits

### 环境变量
```bash
# .env (server/.env.example 참고)
VISION_MODEL=gemini-2.0-flash-exp
SUMMARY_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
NOTION_API_KEY=secret_...
NOTION_PARENT_PAGE_ID=...
```

### 目录结构
```
breeze/
├── extension/
│   └── src/
│       ├── background.ts       # Service Worker
│       ├── content.tsx         # 屏幕捕获
│       └── PopupComponent.tsx  # UI
└── server/
    └── main.py                # FastAPI服务器
```

---

## AI 协作提示

### 新功能开发
1. 先在 `extension/` 或 `server/` 目录实现核心功能
2. 更新此 CLAUDE.md 文档
3. 运行 `pnpm build` 测试Extension
4. 运行 `pipenv run python main.py` 测试Server

### Bug 修复
- 提供错误日志或截图
- 说明复现步骤
- 描述期望行为

### 代码审查要点
- WebSocket通信协议一致性
- Notion API使用正确方法
- 状态持久化完整性

---

## 快速链接

- GitHub: https://github.com/SonYoonSeok/breeze
- Chrome Extension: `extension/dist/`
- Server: `http://localhost:8000`
- Notion页: 按讲座标题创建
