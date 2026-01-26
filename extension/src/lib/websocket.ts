// WebSocket 클라이언트

const SERVER_URL = 'ws://localhost:8000'

// 서버로 전송할 메시지 타입
export type ClientMessageType = 'slide' | 'audio' | 'complete'

// 서버로 전송할 메시지 형식
export interface ClientMessage {
  type: ClientMessageType
  image?: string      // slide 타입일 때
  audio?: string      // audio 타입일 때
  timestamp?: string
}

// 서버로부터 받을 메시지 타입
export type ServerMessageType = 'slide_analyzed' | 'completed' | 'status' | 'error'

// 서버로부터 받은 메시지 형식
export interface ServerMessage {
  type: ServerMessageType
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

export class WebSocketClient {
  private ws: WebSocket | null = null
  private sessionId: string = ''
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private onMessageCallback?: (message: ServerMessage) => void

  constructor() {}

  connect(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${SERVER_URL}/ws/${sessionId}`)

        this.ws.onopen = () => {
          console.log(`WebSocket 연결됨: ${sessionId}`)
          this.reconnectAttempts = 0
          resolve()
        }

        this.ws.onclose = () => {
          console.log('WebSocket 연결 종료')
          this.attemptReconnect()
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket 에러:', error)
          reject(error)
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`재연결 시도 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

      setTimeout(() => {
        this.connect(this.sessionId).catch(console.error)
      }, this.reconnectDelay * this.reconnectAttempts)
    }
  }

  private handleMessage(data: string) {
    try {
      const message: ServerMessage = JSON.parse(data)
      console.log('수신한 메시지:', message)

      // 콜백 함수가 있으면 호출
      if (this.onMessageCallback) {
        this.onMessageCallback(message)
      }
    } catch (error) {
      console.error('메시지 파싱 에러:', error)
    }
  }

  // 서버 메시지 수신 콜백 설정
  onMessage(callback: (message: ServerMessage) => void) {
    this.onMessageCallback = callback
  }

  // 슬라이드 전송
  sendSlide(imageData: string) {
    const message: ClientMessage = {
      type: 'slide',
      image: imageData,
      timestamp: new Date().toISOString()
    }
    this.send(message)
  }

  // 오디오 전송
  sendAudio(audioData: string) {
    const message: ClientMessage = {
      type: 'audio',
      audio: audioData
    }
    this.send(message)
  }

  // 완료 메시지 전송
  sendComplete() {
    const message: ClientMessage = {
      type: 'complete'
    }
    this.send(message)
  }

  private send(message: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.error('WebSocket이 연결되지 않음')
    }
  }

  close() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
