import { useRecordingStore } from './store/recordingStore'
import { useWebSocketStore } from './store/websocketStore'
import { useState, useEffect } from 'react'

// 세션 ID 생성 함수
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// 경과 시간 포맷
function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function Popup() {
  const {
    isRecording,
    isPaused,
    lectureTitle,
    sessionId,
    startTime,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    setSessionId,
    setLectureTitle,
    loadFromStorage
  } = useRecordingStore()

  const {
    status,
    initialize,
    connect,
    currentSlideNumber,
    summary,
    notionUrl
  } = useWebSocketStore()

  const [showResult, setShowResult] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)

  // 팝업이 열릴 때 저장된 상태 복원 및 background 연결 (한 번만 실행)
  useEffect(() => {
    const initPopup = async () => {
      // 저장된 녹음 상태 복원
      await loadFromStorage()
      // WebSocket 상태 확인
      initialize()
    }
    initPopup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 녹화 시간 타이머
  useEffect(() => {
    let interval: number | null = null

    if (isRecording && !isPaused && startTime) {
      interval = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000)
        setElapsedTime(elapsed)
      }, 1000)
    } else {
      setElapsedTime(0)
    }

    return () => {
      if (interval !== null) {
        clearInterval(interval)
      }
    }
  }, [isRecording, isPaused, startTime])

  const handleStart = async () => {
    // 새 세션 ID 생성
    const newSessionId = generateSessionId()
    setSessionId(newSessionId)

    // WebSocket 연결
    await connect(newSessionId)
    startRecording()

    // content script에 녹화 시작 메시지 전송 (강의 제목 포함)
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'START_RECORDING',
          sessionId: newSessionId,
          lectureTitle: lectureTitle || '강의'
        })
      }
    })
  }

  const handleStop = () => {
    // content script에 녹화 중지 메시지 전송
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_RECORDING' })
      }
    })

    stopRecording()

    // 완료 메시지 전송은 content script에서 처리됨
    // 결과 표시
    setTimeout(() => {
      setShowResult(true)
    }, 2000)
  }

  const getStatusColor = () => {
    if (status === 'connected') return 'bg-green-500'
    if (status === 'connecting') return 'bg-yellow-500'
    if (status === 'error') return 'bg-red-500'
    return 'bg-gray-500'
  }

  const getStatusText = () => {
    if (status === 'connected') return '연결됨'
    if (status === 'connecting') return '연결 중...'
    if (status === 'error') return '연결 실패'
    return '연결 안됨'
  }

  // 요약 결과가 있으면 결과 화면 표시
  if (showResult && summary) {
    return (
      <div className="w-96 max-h-96 overflow-y-auto p-4">
        <div className="mb-4">
          <h1 className="text-xl font-bold">요약 완료</h1>
        </div>

        {notionUrl && (
          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">Notion에 저장되었습니다</p>
            <a
              href={notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 text-sm hover:underline"
            >
              Notion에서 보기
            </a>
          </div>
        )}

        <div className="mb-4 p-3 bg-gray-50 rounded-lg max-h-48 overflow-y-auto">
          <h2 className="text-sm font-semibold mb-2">요약 내용</h2>
          <pre className="text-xs whitespace-pre-wrap">{summary}</pre>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowResult(false)}
            className="flex-1 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
          >
            닫기
          </button>
          {notionUrl && (
            <button
              onClick={() => window.open(notionUrl, '_blank')}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              Notion 열기
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-80 p-4">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Twelve</h1>
        <p className="text-sm text-gray-600">강의 녹음/요약</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <div className={'w-2 h-2 rounded-full ' + getStatusColor()} />
        <span className="text-sm">{getStatusText()}</span>
        {currentSlideNumber > 0 && (
          <span className="text-xs text-gray-500 ml-auto">
            슬라이드 {currentSlideNumber}
          </span>
        )}
      </div>

      {!isRecording && (
        <div className="mb-4">
          <input
            type="text"
            value={lectureTitle}
            onChange={(e) => setLectureTitle(e.target.value)}
            placeholder="강의 제목 입력..."
            className="w-full px-3 py-2 border rounded-lg mb-2"
          />
        </div>
      )}

      <div className="space-y-2">
        {!isRecording ? (
          <button
            onClick={handleStart}
            className="w-full py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2"
          >
            <span className="w-3 h-3 bg-white rounded-full" />
            녹화 시작
          </button>
        ) : (
          <div className="space-y-2">
            {/* 타이머 표시 */}
            <div className="text-center py-2 bg-gray-100 rounded-lg">
              <span className="text-2xl font-mono font-bold text-gray-800">
                {formatElapsed(elapsedTime)}
              </span>
            </div>

            <div className="flex gap-2">
              {isPaused ? (
                <button
                  onClick={resumeRecording}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  재개
                </button>
              ) : (
                <button
                  onClick={pauseRecording}
                  className="flex-1 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
                >
                  일시정지
                </button>
              )}
              <button
                onClick={handleStop}
                className="flex-1 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                중지
              </button>
            </div>
            <div className="text-center text-sm text-red-600 animate-pulse">
              녹화 중 {currentSlideNumber > 0 && `(슬라이드 ${currentSlideNumber})`}
            </div>
          </div>
        )}
      </div>

      {sessionId && (
        <div className="mt-4 text-xs text-gray-500">
          세션: {sessionId}
        </div>
      )}
    </div>
  )
}
