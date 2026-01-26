// 화면 캡처 유틸리티

export async function getDesktopCaptureId(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (streamId) => {
      if (streamId) {
        resolve(streamId)
      } else {
        reject(new Error('캡처가 취소되었습니다'))
      }
    })
  })
}

export async function getTabCaptureStream(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.capture({ video: true, audio: true }, (stream) => {
      if (stream) {
        resolve(stream)
      } else {
        reject(new Error('탭 캡처 실패'))
      }
    })
  })
}

export function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context를 가져올 수 없습니다')

  ctx.drawImage(video, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.8)
}
