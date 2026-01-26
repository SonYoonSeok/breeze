// Background Service Worker

console.log('Twelve background service worker loaded')

const SERVER_URL = 'ws://localhost:8000'
let ws: WebSocket | null = null
let currentSessionId: string = ''

// WebSocket 연결
function connectWebSocket(sessionId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close()
    }

    currentSessionId = sessionId
    const url = `${SERVER_URL}/ws/${sessionId}`

    console.log('Connecting to WebSocket:', url)

    try {
      ws = new WebSocket(url)

      ws.onopen = () => {
        console.log('WebSocket connected:', sessionId)
        notifyPopup({ type: 'connected', sessionId })
        resolve()
      }

      ws.onclose = () => {
        console.log('WebSocket disconnected')
        notifyPopup({ type: 'disconnected' })
      }

      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
        notifyPopup({ type: 'error', error: 'WebSocket 연결 실패' })
        reject(error)
      }

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('Server message:', message)
          notifyPopup({ type: 'server_message', data: message })
        } catch (error) {
          console.error('Failed to parse server message:', error)
        }
      }
    } catch (error) {
      reject(error)
    }
  })
}

// Popup에 상태 알림
function notifyPopup(message: any) {
  chrome.runtime.sendMessage({
    type: 'WS_STATUS',
    data: message
  }).catch(() => {
    // Popup이 닫혀있으면 무시
  })
}

// WebSocket 메시지 전송
function sendWebSocketMessage(message: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message))
  } else {
    console.error('WebSocket is not connected')
  }
}

// WebSocket 연결 종료
function disconnectWebSocket() {
  if (ws) {
    ws.close()
    ws = null
  }
  currentSessionId = ''
}

// 확장 프로그램 설치/업데이트 시
chrome.runtime.onInstalled.addListener(() => {
  console.log('Twelve extension installed/updated')
})

// Popup이 열릴 때 상태 전달을 위한 포트 리스너
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    // Popup이 열리면 현재 상태 전송
    const isConnected = ws !== null && ws.readyState === WebSocket.OPEN
    port.postMessage({
      type: 'WS_STATUS',
      data: {
        type: isConnected ? 'connected' : 'disconnected',
        sessionId: currentSessionId
      }
    })
  }
})

// 메시지 리스너
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message)

  if (message.type === 'WS_CONNECT') {
    connectWebSocket(message.sessionId)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: (error as Error).message }))
    return true
  }

  if (message.type === 'WS_DISCONNECT') {
    disconnectWebSocket()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'WS_SEND') {
    sendWebSocketMessage(message.data)
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'WS_STATUS') {
    const isConnected = ws !== null && ws.readyState === WebSocket.OPEN
    sendResponse({
      connected: isConnected,
      sessionId: currentSessionId,
      status: isConnected ? 'connected' : 'disconnected'
    })
    return true
  }

  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id })
    return true
  }

  if (message.type === 'OPEN_RECORDER_PAGE') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/recorder.html') })
    sendResponse({ success: true })
    return true
  }
})
