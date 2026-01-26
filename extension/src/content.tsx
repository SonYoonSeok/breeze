// Content Script - 페이지 내에서 실행됨

console.log('Twelve content script loaded')

const SERVER_URL = 'ws://localhost:8000'
const SLIDE_CHECK_INTERVAL = 30000 // 슬라이드 체크 간격 (ms) - 30초

// 메시지 리스너
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'START_RECORDING') {
    handleStartRecording(message.sessionId, message.lectureTitle || '강의')
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'STOP_RECORDING') {
    handleStopRecording()
    sendResponse({ success: true })
    return true
  }

  if (message.type === 'SEND_SLIDE') {
    sendSlideToServer(message.sessionId, message.imageData)
    sendResponse({ success: true })
    return true
  }
})

let mediaRecorder: MediaRecorder | null = null
let recordedChunks: Blob[] = []
let ws: WebSocket | null = null
let sessionId: string = ''
let lectureTitle: string = ''
let videoElement: HTMLVideoElement | null = null
let slideCheckInterval: number | null = null
let lastFrameData: string | null = null

async function handleStartRecording(newSessionId: string, title: string) {
  sessionId = newSessionId
  lectureTitle = title

  try {
    // WebSocket 연결
    ws = new WebSocket(`${SERVER_URL}/ws/${sessionId}`)

    ws.onopen = () => {
      console.log(`WebSocket connected: ${sessionId}`)
      // 시작 메시지와 함께 강의 제목 전송
      ws!.send(JSON.stringify({
        type: 'start',
        title: lectureTitle
      }))
    }

    ws.onmessage = (event) => {
      console.log('Server message:', event.data)
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
    }

    ws.onclose = () => {
      console.log('WebSocket closed')
    }

    // 현재 탭의 미디어 스트림 캡처
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true
    })

    // video element 생성 (실제로 보이게)
    videoElement = document.createElement('video')
    videoElement.autoplay = true
    videoElement.muted = true
    videoElement.srcObject = stream
    // 아주 작게 보이게 만들기 (브라우저가 업데이트하도록)
    videoElement.style.position = 'fixed'
    videoElement.style.top = '0'
    videoElement.style.left = '0'
    videoElement.style.width = '1px'
    videoElement.style.height = '1px'
    videoElement.style.opacity = '0.01'
    videoElement.style.zIndex = '999999'
    videoElement.style.pointerEvents = 'none'
    document.body.appendChild(videoElement)

    // video가 실제로 재생되도록 보장
    await videoElement.play()

    // video가 준비될 때까지 대기
    await new Promise<void>((resolve) => {
      if (videoElement!.readyState >= 2) {
        resolve()
      } else {
        videoElement!.onloadeddata = () => resolve()
      }
    })

    console.log(`Video ready: ${videoElement.videoWidth}x${videoElement.videoHeight}`)

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp9'
    })

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data)
      }
    }

    mediaRecorder.onstop = () => {
      // 완료 메시지 전송
      sendCompleteMessage()

      // 정리
      cleanup()
    }

    mediaRecorder.start(1000)
    console.log('Recording started')

    // 슬라이드 캡처 시작
    startSlideCapture()
  } catch (error) {
    console.error('Failed to start recording:', error)
  }
}

function handleStopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    console.log('Recording stopped')
  }
}

// 슬라이드 캡처 시작
function startSlideCapture() {
  // 첫 프레임 캡처
  setTimeout(() => {
    captureAndSendSlide()
  }, 1000)

  // 주기적 슬라이드 체크
  slideCheckInterval = window.setInterval(() => {
    captureAndSendSlide()
  }, SLIDE_CHECK_INTERVAL)
}

// 슬라이드 캡처 및 전송
function captureAndSendSlide() {
  if (!videoElement || !ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Skipping capture: video or ws not ready')
    return
  }

  // video 상태 확인
  if (videoElement.videoWidth === 0 || videoElement.videoHeight === 0) {
    console.log('Video not ready yet, skipping')
    return
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(videoElement, 0, 0)
    const currentFrameData = canvas.toDataURL('image/jpeg', 0.8)

    // 디버깅: 데이터 URL 앞부분 출력
    const dataPreview = currentFrameData.substring(0, 50) + '...' + currentFrameData.substring(currentFrameData.length - 50)

    // 이전 프레임이 없으면 첫 프레임으로 전송
    if (!lastFrameData) {
      sendSlideToServer(sessionId, currentFrameData)
      console.log(`First slide sent. Size: ${currentFrameData.length}, Data: ${dataPreview}`)
      lastFrameData = currentFrameData
      return
    }

    // 전체 문자열 비교
    if (lastFrameData !== currentFrameData) {
      // 길이가 다르면 무조건 변경
      const lengthDiff = Math.abs(lastFrameData.length - currentFrameData.length)

      // 첫 1000자와 마지막 1000자 비교
      const first1000Diff = lastFrameData.substring(0, 1000) !== currentFrameData.substring(0, 1000)
      const last1000Diff = lastFrameData.slice(-1000) !== currentFrameData.slice(-1000)

      // 길이 차이가 100 이상이거나, 앞뒤가 다르면 변경으로 간주
      if (lengthDiff > 100 || first1000Diff || last1000Diff) {
        sendSlideToServer(sessionId, currentFrameData)
        console.log(`Slide changed! lengthDiff: ${lengthDiff}, firstDiff: ${first1000Diff}, lastDiff: ${last1000Diff}`)
        lastFrameData = currentFrameData
      } else {
        console.log(`Frame similar (lengthDiff: ${lengthDiff}), skipping`)
      }
    } else {
      console.log('Frame identical, skipping')
    }
  } catch (error) {
    console.error('Failed to capture slide:', error)
  }
}

function cleanup() {
  if (slideCheckInterval !== null) {
    clearInterval(slideCheckInterval)
    slideCheckInterval = null
  }

  if (videoElement && videoElement.srcObject) {
    const stream = videoElement.srcObject as MediaStream
    stream.getTracks().forEach(track => track.stop())
    videoElement.remove()
    videoElement = null
  }

  recordedChunks = []
  lastFrameData = null
}

function sendSlideToServer(_sid: string, imageData: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not connected')
    return
  }

  const message = {
    type: 'slide',
    image: imageData,
    timestamp: new Date().toISOString()
  }

  ws.send(JSON.stringify(message))
  console.log('Slide sent to server')
}

function sendCompleteMessage() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not connected')
    return
  }

  const message = {
    type: 'complete'
  }

  ws.send(JSON.stringify(message))
  console.log('Complete message sent to server')

  // 연결 종료
  setTimeout(() => {
    ws?.close()
  }, 1000)
}

// 오디오 청크 전송 함수 (필요시 사용)
function sendAudioChunk(audioData: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.error('WebSocket is not connected')
    return
  }

  const message = {
    type: 'audio',
    audio: audioData
  }

  ws.send(JSON.stringify(message))
}

// 오디오 청크 전송 함수 사용하지 않음 경고 방지
void sendAudioChunk
