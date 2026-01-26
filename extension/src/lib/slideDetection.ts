// 슬라이드 변경 감지 유틸리티

export interface SlideChangeOptions {
  threshold?: number  // 변경 임계값 (0-1), 기본값 0.05
  checkInterval?: number // 확인 간격 (ms), 기본값 1000
}

export class SlideDetector {
  private lastFrame: string | null = null
  private threshold: number
  private checkInterval: number
  private intervalId: number | null = null

  constructor(options: SlideChangeOptions = {}) {
    this.threshold = options.threshold ?? 0.05
    this.checkInterval = options.checkInterval ?? 1000
  }

  // 두 이미지 간의 차이 계산 (간단한 픽셀 비교)
  private async compareImages(frame1: string, frame2: string): Promise<number> {
    const img1 = await this.loadImage(frame1)
    const img2 = await this.loadImage(frame2)
    
    const canvas1 = this.createCanvas(img1)
    const canvas2 = this.createCanvas(img2)
    
    const ctx1 = canvas1.getContext('2d')!
    const ctx2 = canvas2.getContext('2d')!
    
    const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height).data
    const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height).data
    
    let diffPixels = 0
    const totalPixels = data1.length / 4
    
    for (let i = 0; i < data1.length; i += 4) {
      const rDiff = Math.abs(data1[i] - data2[i])
      const gDiff = Math.abs(data1[i + 1] - data2[i + 1])
      const bDiff = Math.abs(data1[i + 2] - data2[i + 2])
      
      // 픽셀 차이가 30 이상이면 변경된 것으로 간주
      if ((rDiff + gDiff + bDiff) / 3 > 30) {
        diffPixels++
      }
    }
    
    return diffPixels / totalPixels
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  private createCanvas(img: HTMLImageElement): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    return canvas
  }

  // 슬라이드 변경 확인
  async detectChange(currentFrame: string): Promise<boolean> {
    if (!this.lastFrame) {
      this.lastFrame = currentFrame
      return false
    }

    const diff = await this.compareImages(this.lastFrame, currentFrame)
    
    if (diff > this.threshold) {
      this.lastFrame = currentFrame
      return true
    }
    
    return false
  }

  // 주기적 검사 시작
  start(video: HTMLVideoElement, callback: (frame: string) => void) {
    this.intervalId = window.setInterval(() => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(video, 0, 0)
      
      const frame = canvas.toDataURL('image/jpeg', 0.8)
      
      this.detectChange(frame).then((changed) => {
        if (changed) {
          callback(frame)
        }
      })
    }, this.checkInterval)
  }

  stop() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  reset() {
    this.lastFrame = null
  }
}
