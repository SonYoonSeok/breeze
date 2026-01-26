"""
Chamomile - 온라인 강의 자동 요약 서버

크롬 익스텐션에서 실시간으로 수신한 화면/음성 데이터를 처리하여
슬라이드 변경 감지 -> OCR 분석 -> 음성 인식 -> 요약 -> 노션 업로드
"""

import base64
import io
import json
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import OpenAI
from google import genai
from google.genai import types
import httpx

# 환경 변수 로드
load_dotenv()

# =============================================================================
# 전역 상태 관리
# =============================================================================
class SessionManager:
    """세션 상태 관리"""

    def __init__(self):
        self.sessions = {}  # {session_id: SessionState}

    def create_session(self, session_id: str) -> dict:
        """새 세션 생성"""
        self.sessions[session_id] = {
            "session_id": session_id,
            "started_at": datetime.now().isoformat(),
            "title": "",  # 강의 제목
            "slides": [],  # 캡처된 슬라이드들
            "audio_chunks": [],  # 오디오 청크들
            "slide_analyses": [],  # AI 분석 결과
            "status": "recording"  # recording, processing, completed
        }
        return self.sessions[session_id]

    def get_session(self, session_id: str) -> Optional[dict]:
        """세션 조회"""
        return self.sessions.get(session_id)

    def add_slide(self, session_id: str, image_data: str, timestamp: str):
        """슬라이드 추가"""
        if session_id in self.sessions:
            self.sessions[session_id]["slides"].append({
                "image": image_data,
                "timestamp": timestamp,
                "slide_number": len(self.sessions[session_id]["slides"]) + 1
            })

    def add_audio_chunk(self, session_id: str, audio_data: str):
        """오디오 청크 추가"""
        if session_id in self.sessions:
            self.sessions[session_id]["audio_chunks"].append(audio_data)

    def update_status(self, session_id: str, status: str):
        """상태 업데이트"""
        if session_id in self.sessions:
            self.sessions[session_id]["status"] = status

    def set_title(self, session_id: str, title: str):
        """강의 제목 설정"""
        if session_id in self.sessions:
            self.sessions[session_id]["title"] = title


session_manager = SessionManager()


# =============================================================================
# Vision Agent: 이미지 분석 및 OCR
# =============================================================================
class VisionAgent:
    """이미지 분석 및 OCR"""

    def __init__(self):
        self.model = os.getenv("VISION_MODEL", "gemini-2.0-flash-exp")
        if self.model.startswith("gemini"):
            self.client = genai.Client()
        else:
            self.openai_client = OpenAI()

    async def analyze_slide(self, image_base64: str) -> dict:
        """
        슬라이드 이미지 분석

        Returns:
            {
                "text": "추출된 텍스트",
                "description": "슬라이드 설명",
                "has_chart": bool,
                "chart_description": "도표 설명"
            }
        """
        # base64 디코딩
        image_data = base64.b64decode(image_base64.split(",")[1])

        prompt = """
        이 강의 슬라이드를 분석해서 다음 정보를 JSON 형식으로 반환해주세요:
        1. text: 슬라이드의 모든 텍스트 내용
        2. description: 슬라이드 전체 내용을 2-3문장으로 요약
        3. has_chart: 도표, 그래프, 다이어그램이 있는지 여부 (true/false)
        4. chart_description: 도표가 있다면 그 내용을 설명
        """

        if self.model.startswith("gemini"):
            response = self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=image_data, mime_type="image/png"),
                    prompt
                ],
                config={"response_mime_type": "application/json"}
            )
            result = json.loads(response.text)
        else:
            # GPT-4o Vision
            base64_image = base64.b64encode(image_data).decode("utf-8")
            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}
                    ]
                }],
                response_format={"type": "json_object"}
            )
            result = json.loads(response.choices[0].message.content)

        return result


# =============================================================================
# STT Agent: 음성 텍스트 변환
# =============================================================================
class STTAgent:
    """음성을 텍스트로 변환 (Whisper)"""

    def __init__(self):
        self.client = OpenAI()

    async def transcribe_audio(self, audio_data: bytes) -> str:
        """
        오디오 데이터를 텍스트로 변환
        """
        try:
            audio_file = io.BytesIO(audio_data)
            audio_file.name = "audio.webm"  # Chrome에서 오디오 형식

            response = self.client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="ko"
            )
            return response.text if hasattr(response, 'text') else str(response)
        except Exception as e:
            print(f"STT error: {e}")
            return ""


# =============================================================================
# Summary Agent: 통합 요약 생성
# =============================================================================
class SummaryAgent:
    """시각+음성 데이터 통합 요약"""

    def __init__(self):
        self.model = os.getenv("SUMMARY_MODEL", "gpt-4o-mini")
        if self.model.startswith("gemini"):
            self.client = genai.Client()
        else:
            self.openai_client = OpenAI()

    async def create_summary(self, slide_analyses: list, audio_transcript: str) -> str:
        """
        슬라이드 분석과 음성 텍스트를 통합하여 요약 생성
        """
        # 슬라이드 정보 정리
        slides_content = ""
        for i, analysis in enumerate(slide_analyses, 1):
            slides_content += f"""
## 슬라이드 {i}

**텍스트:**
{analysis.get('text', 'N/A')}

**설명:**
{analysis.get('description', 'N/A')}
"""
            if analysis.get('has_chart'):
                slides_content += f"**도표:** {analysis.get('chart_description', 'N/A')}\n"

        prompt = f"""
다음은 온라인 강의에서 캡처한 슬라이드 정보와 음성 내용입니다:

=== 슬라이드 정보 ===
{slides_content}

=== 음성 내용 ===
{audio_transcript}

위 내용을 바탕으로 Markdown 형식으로 정리된 강의 요약본을 작성해주세요.
- 제목: 강의 주제를 추출
- 개요: 전체 흐름 요약 (3-5문장)
- 핵심 내용: 슬라이드별 중요 포인트
- 결론: 강의의 핵심 takeaways
"""

        if self.model.startswith("gemini"):
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt
            )
            return response.text
        else:
            # OpenAI GPT
            response = self.openai_client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 강의 내용을 요약하는 전문가입니다."},
                    {"role": "user", "content": prompt}
                ]
            )
            return response.choices[0].message.content


# =============================================================================
# Notion Agent: 노션 업로드
# =============================================================================
class NotionAgent:
    """노션에 요약본 업로드"""

    def __init__(self):
        self.api_key = os.getenv("NOTION_API_KEY")
        self.parent_page_id = os.getenv("NOTION_PARENT_PAGE_ID")
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Notion-Version": "2025-09-03"
        }

    def _markdown_to_blocks(self, markdown: str) -> list:
        """Markdown을 Notion 블록으로 변환"""
        blocks = []
        lines = markdown.split("\n")

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 블록 생성 헬퍼 함수
            def create_text_block(content: str, block_type: str) -> dict:
                """유효한 텍스트 블록 생성 (빈 내용 필터링)"""
                content = content.strip()
                if not content:
                    return None

                text_obj = {"type": "text", "text": {"content": content}}
                return {
                    "object": "block",
                    "type": block_type,
                    block_type: {
                        "rich_text": [text_obj]
                    }
                }

            if line.startswith("# "):
                block = create_text_block(line[2:], "heading_1")
                if block:
                    blocks.append(block)
            elif line.startswith("## "):
                block = create_text_block(line[3:], "heading_2")
                if block:
                    blocks.append(block)
            elif line.startswith("### "):
                block = create_text_block(line[4:], "heading_3")
                if block:
                    blocks.append(block)
            elif line.startswith("- "):
                block = create_text_block(line[2:], "bulleted_list_item")
                if block:
                    blocks.append(block)
            else:
                block = create_text_block(line, "paragraph")
                if block:
                    blocks.append(block)

        return blocks

    async def upload_summary(self, summary_markdown: str, slides: list, title: str = "강의") -> str:
        """요약본을 노션에 업로드"""
        if not self.api_key or not self.parent_page_id:
            print("Notion API key or parent_page_id missing")
            return ""

        try:
            print(f"Notion upload - Title: {title}")
            print(f"Summary length: {len(summary_markdown)}")
            print(f"Slides count: {len(slides)}")

            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

            async with httpx.AsyncClient() as client:
                # 1. 강의 제목 페이지 생성
                lecture_page_data = {
                    "parent": {"page_id": self.parent_page_id},
                    "properties": {
                        "title": {
                            "title": [{"text": {"content": title}}]
                        }
                    },
                    "children": [
                        {
                            "object": "block",
                        "type": "heading_2",
                        "heading_2": {
                            "rich_text": [{"type": "text", "text": {"content": f"요약 - {timestamp}"}}]
                        }
                        }
                    ]
                }

                print("Creating lecture page in Notion...")
                response = await client.post(
                    "https://api.notion.com/v1/pages",
                    headers=self.headers,
                    json=lecture_page_data
                )
                response.raise_for_status()
                lecture_result = response.json()
                lecture_page_id = lecture_result["id"]
                print(f"Lecture page created: {lecture_page_id}")

                # 2. 강의 페이지 하위에 요약 내용 추가
                summary_blocks = self._markdown_to_blocks(summary_markdown)
                print(f"Summary blocks count: {len(summary_blocks)}")

                # 요약 블록 추가 (각각 개별 추가가 아닌 한 번에)
                if summary_blocks:
                    print(f"Adding {len(summary_blocks)} summary blocks...")
                    # Debug: 첫 번째 블록 출력
                    if summary_blocks:
                        print(f"First block structure: {json.dumps(summary_blocks[0], ensure_ascii=False, indent=2)}")

                    blocks_response = await client.patch(
                        f"https://api.notion.com/v1/blocks/{lecture_page_id}/children",
                        headers=self.headers,
                        json={"children": summary_blocks}
                    )

                    # 에러 응답 내용 출력
                    if blocks_response.status_code != 200:
                        print(f"Error response: {blocks_response.text}")

                    blocks_response.raise_for_status()
                    print("Summary blocks added")

                # 3. 슬라이드 이미지 추가 (현재는 base64라 지원 안됨 - TODO: 이미지 호스팅 후 URL로 변경)
                print(f"Skipping {len(slides)} slide images (base64 not supported by Notion external type)")
                # TODO: 이미지를 S3 등에 업로드 후 공개 URL 사용 필요
                # for i, slide in enumerate(slides, 1):
                #     image_block = {
                #         "type": "image",
                #         "image": {
                #             "type": "external",
                #             "external": {"url": slide["image"]}
                #         }
                #     }
                #     await client.post(
                #         f"https://api.notion.com/v1/blocks/{lecture_page_id}/children",
                #         headers=self.headers,
                #         json={"children": [image_block]}
                #     )
                #     print(f"Slide {i} added")

            return f"https://notion.so/{lecture_page_id.replace('-', '')}"
        except Exception as e:
            print(f"Notion upload error: {e}")
            import traceback
            traceback.print_exc()
            return ""


# =============================================================================
# FastAPI 앱
# =============================================================================
app = FastAPI(title="Chamomile Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 개발용 - 운영시 특정 도메인으로 제한
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 에이전트 초기화
vision_agent = VisionAgent()
stt_agent = STTAgent()
summary_agent = SummaryAgent()
notion_agent = NotionAgent()


@app.get("/")
async def root():
    """헬스 체크"""
    return {"status": "healthy", "service": "chamomile"}


@app.get("/health")
async def health():
    """헬스 체크"""
    return {"status": "ok"}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """
    WebSocket 엔드포인트
    크롬 익스텐션과 실시간 통신
    """
    await websocket.accept()

    # 세션 생성
    session = session_manager.create_session(session_id)

    try:
        while True:
            # 클라이언트로부터 메시지 수신
            data = await websocket.receive_json()
            message_type = data.get("type")

            if message_type == "start":
                # 녹화 시작 - 강의 제목 저장
                title = data.get("title", "강의")
                session_manager.set_title(session_id, title)
                await websocket.send_json({"type": "status", "message": f"녹화 시작: {title}"})

            elif message_type == "slide":
                # 슬라이드 이미지 수신
                await websocket.send_json({"type": "status", "message": "슬라이드 수신됨"})

                # Vision AI 분석
                analysis = await vision_agent.analyze_slide(data["image"])
                session["slide_analyses"].append(analysis)
                session_manager.add_slide(session_id, data["image"], data.get("timestamp", ""))

                # 분석 결과 전송
                await websocket.send_json({
                    "type": "slide_analyzed",
                    "analysis": analysis,
                    "slide_number": len(session["slides"])
                })

            elif message_type == "audio":
                # 오디오 청크 수신
                session_manager.add_audio_chunk(session_id, data["audio"])

            elif message_type == "complete":
                # 녹음 완료 -> 요약 생성 시작
                await websocket.send_json({"type": "status", "message": "요약 생성 중..."})
                session_manager.update_status(session_id, "processing")

                print(f"Complete - Slide analyses count: {len(session['slide_analyses'])}")

                # 오디오 텍스트 변환 (실제 구현 시 audio 데이터 결합 필요)
                audio_transcript = ""  # TODO: audio_chunks 결합 후 STT

                # 요약 생성
                print("Generating summary...")
                summary = await summary_agent.create_summary(
                    session["slide_analyses"],
                    audio_transcript
                )
                print(f"Summary generated. Length: {len(summary)}")

                # 노션 업로드 (강의 제목 포함)
                lecture_title = session.get("title", "강의")
                print(f"Uploading to Notion - Title: {lecture_title}")
                notion_url = await notion_agent.upload_summary(summary, session["slides"], lecture_title)

                session_manager.update_status(session_id, "completed")

                await websocket.send_json({
                    "type": "completed",
                    "summary": summary,
                    "notion_url": notion_url
                })

    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        await websocket.send_json({"type": "error", "message": str(e)})


@app.post("/api/session/{session_id}/complete")
async def complete_session(session_id: str):
    """
    세션 완료 및 요약 생성 (REST API 버전)
    """
    session = session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_manager.update_status(session_id, "processing")

    # 요약 생성
    audio_transcript = ""  # TODO: STT 처리
    summary = await summary_agent.create_summary(
        session["slide_analyses"],
        audio_transcript
    )

    # 노션 업로드
    notion_url = await notion_agent.upload_summary(summary, session["slides"])

    session_manager.update_status(session_id, "completed")

    return JSONResponse({
        "summary": summary,
        "notion_url": notion_url,
        "slide_count": len(session["slides"])
    })


@app.post("/api/session/{session_id}/slide")
async def add_slide(session_id: str, data: dict):
    """
    슬라이드 추가 (REST API 버전)
    """
    session = session_manager.get_session(session_id)
    if not session:
        session = session_manager.create_session(session_id)

    # Vision AI 분석
    analysis = await vision_agent.analyze_slide(data["image"])
    session["slide_analyses"].append(analysis)
    session_manager.add_slide(session_id, data["image"], data.get("timestamp", ""))

    return JSONResponse({
        "slide_number": len(session["slides"]),
        "analysis": analysis
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
