import { create } from 'zustand'

type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// 서버 응답 메시지 타입
interface ServerMessage {
  type: 'slide_analyzed' | 'completed' | 'status' | 'error'
  analysis?: {
    text: string
    description: string
    has_chart: boolean
    chart_description?: string
  }
  slide_number?: number
  summary?: string
  notion_url?: string
  message?: string
}

interface WebSocketState {
  status: WebSocketStatus
  error: string | null
  sessionId: string

  // 서버 응답 데이터
  currentSlideNumber: number
  latestAnalysis: ServerMessage['analysis'] | null
  summary: string | null
  notionUrl: string | null

  // Actions
  initialize: () => void
  connect: (sessionId: string) => Promise<void>
  disconnect: () => void
  sendSlide: (imageData: string) => void
  sendAudio: (audioData: string) => void
  sendComplete: () => void
  setStatus: (status: WebSocketStatus) => void
  setError: (error: string | null) => void
  setSessionId: (sessionId: string) => void
  handleBackgroundMessage: (data: any) => void
}

// Background와 통신하는 헬퍼 함수
function sendMessageToBackground(type: string, data?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else {
        resolve(response)
      }
    })
  })
}

// Background와의 포트 연결
let backgroundPort: chrome.runtime.Port | null = null

// Background에서 오는 메시지 리스너
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'WS_STATUS') {
    const data = message.data
    useWebSocketStore.getState().handleBackgroundMessage(data)
  }
})

export const useWebSocketStore = create<WebSocketState>((set) => ({
  status: 'disconnected',
  error: null,
  sessionId: '',
  currentSlideNumber: 0,
  latestAnalysis: null,
  summary: null,
  notionUrl: null,

  setSessionId: (sessionId: string) => set({ sessionId }),

  // 초기화: background 상태 확인 및 포트 연결
  initialize: () => {
    // 매번 새로 포트 연결 (기존 포트는 정리)
    if (backgroundPort) {
      backgroundPort.disconnect()
      backgroundPort = null
    }

    backgroundPort = chrome.runtime.connect({ name: 'popup' })
    backgroundPort.onMessage.addListener((message) => {
      if (message.type === 'WS_STATUS') {
        useWebSocketStore.getState().handleBackgroundMessage(message.data)
      }
    })
    backgroundPort.onDisconnect.addListener(() => {
      backgroundPort = null
    })

    // 현재 상태 확인
    sendMessageToBackground('WS_STATUS')
      .then((response) => {
        console.log('Initial status from background:', response)
        if (response.connected) {
          set({ status: 'connected', sessionId: response.sessionId })
        }
      })
      .catch((error) => {
        console.error('Failed to initialize status:', error)
      })
  },

  connect: async (sessionId: string) => {
    set({ status: 'connecting', error: null, sessionId })

    try {
      const response = await sendMessageToBackground('WS_CONNECT', { sessionId })
      if (response.success) {
        set({ status: 'connected' })
      } else {
        set({ status: 'error', error: response.error })
      }
    } catch (error) {
      set({ status: 'error', error: (error as Error).message })
    }
  },

  disconnect: () => {
    sendMessageToBackground('WS_DISCONNECT').catch(console.error)
    set({ status: 'disconnected' })
  },

  sendSlide: (imageData: string) => {
    sendMessageToBackground('WS_SEND', {
      data: {
        type: 'slide',
        image: imageData,
        timestamp: new Date().toISOString()
      }
    }).catch(console.error)
  },

  sendAudio: (audioData: string) => {
    sendMessageToBackground('WS_SEND', {
      data: {
        type: 'audio',
        audio: audioData
      }
    }).catch(console.error)
  },

  sendComplete: () => {
    sendMessageToBackground('WS_SEND', {
      data: {
        type: 'complete'
      }
    }).catch(console.error)
  },

  // Background에서 온 메시지 처리
  handleBackgroundMessage: (data: any) => {
    switch (data.type) {
      case 'connected':
        set({ status: 'connected', error: null })
        console.log('WebSocket connected:', data.sessionId)
        break

      case 'disconnected':
        set({ status: 'disconnected' })
        console.log('WebSocket disconnected')
        break

      case 'error':
        set({ status: 'error', error: data.error })
        console.error('WebSocket error:', data.error)
        break

      case 'server_message':
        const message: ServerMessage = data.data
        switch (message.type) {
          case 'slide_analyzed':
            set({
              currentSlideNumber: message.slide_number || 0,
              latestAnalysis: message.analysis || null
            })
            console.log(`Slide ${message.slide_number} analyzed:`, message.analysis)
            break

          case 'completed':
            set({
              summary: message.summary || null,
              notionUrl: message.notion_url || null,
              status: 'disconnected'
            })
            console.log('Summary completed:', message.summary)
            console.log('Notion URL:', message.notion_url)
            break

          case 'status':
            console.log('Server status:', message.message)
            break

          case 'error':
            set({ error: message.message || 'Unknown error' })
            console.error('Server error:', message.message)
            break
        }
        break
    }
  },

  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
}))
