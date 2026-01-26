import { create } from 'zustand'

export interface RecordingState {
  isRecording: boolean
  isPaused: boolean
  serverUrl: string
  lectureTitle: string
  sessionId: string
  startTime: number | null
  error: string | null

  // Actions
  startRecording: () => void
  stopRecording: () => void
  pauseRecording: () => void
  resumeRecording: () => void
  setServerUrl: (url: string) => void
  setLectureTitle: (title: string) => void
  setSessionId: (sessionId: string) => void
  setError: (error: string | null) => void
  loadFromStorage: () => void
}

// 저장된 상태 타입 (savedAt 포함)
interface SavedRecordingState {
  isRecording: boolean
  isPaused?: boolean
  lectureTitle?: string
  sessionId?: string
  startTime?: number | null
  savedAt: number
}

// chrome.storage에서 상태 로드
async function loadRecordingState(): Promise<SavedRecordingState | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['recordingState'], (result: any) => {
      if (result.recordingState) {
        resolve(result.recordingState)
      } else {
        resolve(null)
      }
    })
  })
}

// chrome.storage에 상태 저장
function saveRecordingState(state: RecordingState) {
  const toSave = {
    isRecording: state.isRecording,
    isPaused: state.isPaused,
    lectureTitle: state.lectureTitle,
    sessionId: state.sessionId,
    startTime: state.startTime,
    savedAt: Date.now()
  }
  chrome.storage.local.set({ recordingState: toSave })
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  isRecording: false,
  isPaused: false,
  serverUrl: 'ws://localhost:8000',
  lectureTitle: '',
  sessionId: '',
  startTime: null,
  error: null,

  startRecording: () => {
    const state = { isRecording: true, isPaused: false, startTime: Date.now(), error: null }
    set(state)
    saveRecordingState({ ...get(), ...state })
  },

  stopRecording: () => {
    const state = { isRecording: false, isPaused: false, startTime: null }
    set(state)
    chrome.storage.local.remove(['recordingState'])
  },

  pauseRecording: () => {
    const state = { isPaused: true }
    set(state)
    saveRecordingState({ ...get(), ...state })
  },

  resumeRecording: () => {
    const state = { isPaused: false }
    set(state)
    saveRecordingState({ ...get(), ...state })
  },

  setServerUrl: (url) => {
    set({ serverUrl: url })
  },

  setLectureTitle: (title) => {
    const state = { lectureTitle: title }
    set(state)
    saveRecordingState({ ...get(), ...state })
  },

  setSessionId: (sessionId: string) => {
    const state = { sessionId }
    set(state)
    saveRecordingState({ ...get(), ...state })
  },

  setError: (error) => set({ error }),

  loadFromStorage: async () => {
    const saved = await loadRecordingState()
    if (saved && saved.isRecording) {
      // 저장 시점이 너무 오래됐으면 녹화가 종료된 것으로 간주 (1시간)
      const isExpired = saved.savedAt && (Date.now() - saved.savedAt > 60 * 60 * 1000)
      if (isExpired) {
        chrome.storage.local.remove(['recordingState'])
        return
      }

      set({
        isRecording: saved.isRecording,
        isPaused: saved.isPaused || false,
        lectureTitle: saved.lectureTitle || '',
        sessionId: saved.sessionId || '',
        startTime: saved.startTime || null
      })
    }
  },
}))
