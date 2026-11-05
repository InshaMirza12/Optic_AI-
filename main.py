"""
Optic-AI Unified Backend Server
Combines CrewAI Multi-Agent intelligence, Edge-TTS Multilingual Voice Synthesis,
and Accessible PDF Analysis into a unified FastAPI service.
Supports dynamic Wi-Fi IP adaptation, document caching, and multi-language exports.
"""

import os
import re
import glob
import json
import uuid
import socket
import asyncio
from typing import Optional, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Import local engines
from crewai import Crew, default_llm
import agents
import Tasks
from tts_service import generate_edge_tts_audio, resolve_voice, VOICE_MAP
from pdf_utils import extract_text_and_info

load_dotenv()

app = FastAPI(
    title="Optic-AI Accessible Document Assistant",
    description="Multilingual Agentic AI Backend with Edge-TTS, Screen Reader Support, and CrewAI Agents",
    version="2.1.0"
)

# Static files directory for generated audio and text file downloads
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Enable Cross-Origin Resource Sharing (CORS) for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_local_ip() -> str:
    """Detects the current host Wi-Fi / Local Area IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# In-memory document context store for continuous Q&A and mode switching without re-uploading
DOCUMENT_STORE: Dict[str, Any] = {
    "default": {
        "text": "",
        "name": "None",
        "char_count": 0,
        "page_count": 0,
        "cache": {}  # Stores {(mode, language): {"text": ..., "audio_url": ..., "text_url": ...}}
    }
}

DOC_CACHE_FILE = os.path.join(STATIC_DIR, "document_cache.json")

def save_document_store():
    """Persists current document and all mode caches to disk."""
    try:
        with open(DOC_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(DOCUMENT_STORE["default"], f, ensure_ascii=False)
    except Exception as e:
        print(f"[Optic-AI Cache Warning]: {e}")

def load_document_store():
    """Loads previously uploaded document and caches if available."""
    if os.path.exists(DOC_CACHE_FILE):
        try:
            with open(DOC_CACHE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if saved.get("text"):
                    DOCUMENT_STORE["default"] = saved
                    print(f"[Optic-AI] Restored document '{saved.get('name')}' ({saved.get('char_count')} chars) from disk cache.")
        except Exception as e:
            print(f"[Optic-AI Cache Warning]: {e}")

load_document_store()


def build_resource_url(request: Request, filename: str) -> str:
    """
    Builds an accessible URL for generated static files.
    Prefers the host from the incoming request or falls back to the detected Wi-Fi IP.
    """
    host_header = request.headers.get("host")
    if host_header:
        proto = "https" if request.url.scheme == "https" else "http"
        return f"{proto}://{host_header}/static/{filename}"
    
    local_ip = get_local_ip()
    port = int(os.getenv("PORT", 8000))
    return f"http://{local_ip}:{port}/static/{filename}"


def select_agent_and_task(mode: str):
    """Maps requested mode to the appropriate CrewAI Agent and Task."""
    normalized = (mode or "quick").lower().strip()
    
    if "detail" in normalized:
        return "detailed", agents.Detailed_summarizer, Tasks.Detailed_summarizer_task
    elif "exam" in normalized or "revision" in normalized or "note" in normalized:
        return "exam", agents.exam_summarizer, Tasks.exam_summarizer_task
    elif "qa" in normalized or "question" in normalized or "ask" in normalized:
        return "qa", agents.Question_answer_agent, Tasks.Question_answer_agent_task
    else:
        # Default to Quick Summary
        return "quick", agents.Quick_summarizer, Tasks.Quick_summarizer_task


@app.get("/")
async def root():
    return {
        "project": "Optic-AI",
        "status": "online",
        "description": "Accessible Gen-AI Assistant for Visually Impaired Students",
        "modes": ["quick", "detailed", "exam", "qa"],
        "tts_engine": "Microsoft Edge Neural TTS",
        "local_ip": get_local_ip()
    }


@app.get("/health")
async def health_check():
    has_gemini = bool(os.getenv("GEMINI_API_KEY"))
    doc_info = DOCUMENT_STORE["default"]
    return {
        "status": "healthy",
        "gemini_api_key_configured": has_gemini,
        "active_document": doc_info["name"],
        "char_count": doc_info["char_count"],
        "page_count": doc_info["page_count"],
        "local_ip": get_local_ip()
    }


@app.get("/api/config")
async def get_config():
    """Provides client with the server's current IP and port for seamless mobile pairing."""
    port = int(os.getenv("PORT", 8000))
    local_ip = get_local_ip()
    return {
        "local_ip": local_ip,
        "port": port,
        "base_url": f"http://{local_ip}:{port}"
    }


@app.get("/voices")
async def list_supported_voices():
    """Lists supported languages and Edge-TTS neural voice identifiers."""
    return {"supported_languages": list(VOICE_MAP.keys()), "default_voice": resolve_voice("en")}


@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)):
    """
    Dedicated endpoint to upload and ingest a PDF document.
    Parses and caches the document text so all modes and Q&A can run instantaneously.
    """
    print(f"\n[Optic-AI] Ingesting document: {file.filename}")
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
            
        doc_text, page_count = extract_text_and_info(file_bytes)
        doc_name = file.filename or "Uploaded_Document.pdf"
        
        # Reset and populate document store
        DOCUMENT_STORE["default"] = {
            "text": doc_text,
            "name": doc_name,
            "char_count": len(doc_text),
            "page_count": page_count,
            "cache": {}
        }
        save_document_store()
        
        print(f"[Optic-AI] Successfully stored '{doc_name}': {len(doc_text)} chars across {page_count} pages.")
        return {
            "status": "success",
            "document_name": doc_name,
            "char_count": len(doc_text),
            "page_count": page_count,
            "preview": doc_text[:200] + "..."
        }
    except Exception as e:
        print(f"[Optic-AI Upload Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@app.post("/fetch-local-file")
async def fetch_local_file(request: Request):
    """
    Voice-controlled document fetch & ingestion endpoint:
    Searches the user's filesystem (Downloads, Documents, Desktop, Workspace)
    for a PDF matching the spoken name, path, or keywords.
    Extracts text, populates DOCUMENT_STORE, and saves to persistent disk cache.
    """
    content_type = request.headers.get("content-type", "")
    query = ""
    if "application/json" in content_type:
        try:
            body = await request.json()
            query = body.get("query") or body.get("path") or body.get("name") or ""
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            query = form.get("query") or form.get("path") or form.get("name") or ""
        except Exception:
            pass

    query = str(query).strip().strip('"').strip("'")
    if not query:
        raise HTTPException(status_code=400, detail="Please state the file name or location.")

    print(f"\n[Optic-AI Voice Fetch] Searching for local document matching: '{query}'")

    matched_file_path = None

    # 1. Exact path match
    if os.path.isfile(query):
        matched_file_path = os.path.abspath(query)
    else:
        raw_lower = query.lower()
        prefer_downloads = "download" in raw_lower
        prefer_documents = "document" in raw_lower or "doc" in raw_lower
        prefer_project = "project" in raw_lower or "workspace" in raw_lower

        # Filter noise words
        noise_words = {
            "in", "the", "file", "pdf", "open", "fetch", "load", "from", "my",
            "please", "find", "upload", "location", "folder", "directory", "saved",
            "named", "called", "it", "is", "where", "search", "get"
        }
        tokens = [t for t in re.split(r"[\s,._\-/\\:]+", raw_lower) if t and t not in noise_words]

        # Standard Windows & user directories
        candidate_dirs = [
            r"C:\Users\LH\Downloads",
            r"C:\Users\LH\Documents",
            os.path.expanduser(r"~\Downloads"),
            os.path.expanduser(r"~\Documents"),
            os.path.expanduser(r"~\Desktop"),
            r"e:\final_year_project",
            os.path.dirname(os.path.abspath(__file__)),
        ]

        valid_dirs = []
        for d in candidate_dirs:
            if d and os.path.isdir(d) and os.path.abspath(d) not in valid_dirs:
                valid_dirs.append(os.path.abspath(d))

        found_pdfs = []
        for s_dir in valid_dirs:
            try:
                for root, _, files in os.walk(s_dir):
                    depth = root[len(s_dir):].count(os.sep)
                    if depth > 2:
                        continue
                    for f in files:
                        if f.lower().endswith(".pdf"):
                            found_pdfs.append(os.path.join(root, f))
            except Exception:
                continue

        # Score matching PDFs
        best_candidate = None
        best_score = -1

        for pdf_path in found_pdfs:
            fname = os.path.basename(pdf_path).lower()
            fpath = pdf_path.lower()
            score = 0

            # Direct substring match
            if raw_lower.replace(".pdf", "") in fname:
                score += 50

            # Keyword matching
            matched_tokens = 0
            for t in tokens:
                if t in fname:
                    score += 10
                    matched_tokens += 1
                elif t in fpath:
                    score += 3

            # Location preference bonuses
            if prefer_downloads and "download" in fpath:
                score += 5
            if prefer_documents and "document" in fpath:
                score += 5
            if prefer_project and "final_year_project" in fpath:
                score += 5

            if score > best_score and (matched_tokens > 0 or score >= 10):
                best_score = score
                best_candidate = pdf_path

        if best_candidate and best_score > 0:
            matched_file_path = best_candidate

    if not matched_file_path or not os.path.isfile(matched_file_path):
        print(f"[Optic-AI Voice Fetch Error] No matching PDF found for: '{query}'")
        raise HTTPException(
            status_code=404,
            detail=f"Could not find any PDF file matching '{query}'. Please specify the exact file name or folder."
        )

    # Ingest found PDF into memory & disk cache
    try:
        with open(matched_file_path, "rb") as f:
            file_bytes = f.read()

        if not file_bytes:
            raise HTTPException(status_code=400, detail="The matching file is empty.")

        doc_text, page_count = extract_text_and_info(file_bytes)
        doc_name = os.path.basename(matched_file_path)

        DOCUMENT_STORE["default"] = {
            "text": doc_text,
            "name": doc_name,
            "char_count": len(doc_text),
            "page_count": page_count,
            "cache": {}
        }
        save_document_store()

        print(f"[Optic-AI Voice Fetch Success] Ingested '{doc_name}' ({len(doc_text)} chars, {page_count} pages)")

        return {
            "status": "success",
            "document_name": doc_name,
            "file_path": matched_file_path,
            "char_count": len(doc_text),
            "page_count": page_count,
            "preview": doc_text[:200] + "..."
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Optic-AI Voice Fetch Processing Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to extract text from file: {str(e)}")


@app.post("/process-document")
async def process_document(request: Request):
    """
    Main processing endpoint:
    - Ingests uploaded PDF if provided, or uses existing stored document.
    - Routes to the appropriate Agent (Quick, Detailed, Exam, or Q&A).
    - Generates localized Text-to-Speech audio using Microsoft Edge Neural TTS.
    - Generates downloadable text file.
    """
    content_type = request.headers.get("content-type", "")
    mode = "quick"
    language = "English"
    user_question = ""
    prompt = ""
    force_refresh = False
    file = None

    if "application/json" in content_type:
        try:
            body = await request.json()
            if isinstance(body, dict):
                mode = body.get("mode") or mode
                language = body.get("language") or language
                user_question = body.get("user_question") or ""
                prompt = body.get("prompt") or ""
                force_refresh = bool(body.get("force_refresh", False))
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            mode = form.get("mode") or mode
            language = form.get("language") or language
            user_question = form.get("user_question") or ""
            prompt = form.get("prompt") or ""
            force_refresh = str(form.get("force_refresh", "")).lower() in ("true", "1")
            if "file" in form and form["file"]:
                file = form["file"]
        except Exception:
            pass

    print(f"\n[Optic-AI] Processing request - Mode: '{mode}', Language: '{language}'")

    # 1. Ingest document if sent with request
    if file:
        file_bytes = await file.read()
        doc_text, page_count = extract_text_and_info(file_bytes)
        doc_name = file.filename or "Uploaded_Document.pdf"
        DOCUMENT_STORE["default"] = {
            "text": doc_text,
            "name": doc_name,
            "char_count": len(doc_text),
            "page_count": page_count,
            "cache": {}
        }
        print(f"[Optic-AI] Ingested document '{doc_name}' ({len(doc_text)} chars)")

    stored = DOCUMENT_STORE["default"]
    document_text = stored["text"]
    doc_name = stored["name"]

    # If no document is in memory, check prompt fallback
    if not document_text or document_text.startswith("Error") or document_text.startswith("Note: The PDF"):
        if prompt and not prompt.lower().startswith("execute"):
            document_text = prompt
            doc_name = "Text Input"
            DOCUMENT_STORE["default"]["text"] = document_text
            DOCUMENT_STORE["default"]["name"] = doc_name
        else:
            raise HTTPException(
                status_code=400,
                detail="No readable document found. Please upload a PDF study material first."
            )

    resolved_mode, agent, task = select_agent_and_task(mode)
    print(f"[Optic-AI] Selected Agent: '{agent.role}' (Mode: {resolved_mode})")

    effective_question = user_question or prompt or ""
    cache_key = f"{resolved_mode}_{language}"

    # 2. Check cache for quick return if same mode and language are re-selected
    if not force_refresh and not effective_question and cache_key in stored["cache"]:
        print(f"[Optic-AI] Serving mode '{resolved_mode}' in '{language}' from cache.")
        cached_data = stored["cache"][cache_key]
        return {
            "status": "success",
            "mode": resolved_mode,
            "language": language,
            "document_name": doc_name,
            "summary": cached_data["text"],
            "text": cached_data["text"],
            "audio_url": cached_data["audio_url"],
            "text_url": cached_data["text_url"],
            "cached": True
        }

    inputs = {
        "document": document_text,
        "doc_title": doc_name,
        "user_question": effective_question,
        "language": language
    }

    # 3. Execute CrewAI Agent Task in non-blocking thread
    try:
        crew = Crew(agents=[agent], tasks=[task], verbose=True)
        crew_output = await asyncio.to_thread(crew.kickoff, inputs=inputs)
        result_text = crew_output.raw.strip()
    except Exception as e:
        print(f"[Optic-AI Agent Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Agent analysis failed: {str(e)}")

    # 4. Generate Edge-TTS Audio
    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    try:
        success = await generate_edge_tts_audio(
            text=result_text,
            output_path=audio_path,
            language=language
        )
        if success:
            audio_url = build_resource_url(request, audio_filename)
    except Exception as e:
        print(f"[Optic-AI TTS Error]: {e}")

    # 5. Generate Downloadable Text File (.txt)
    text_filename = f"{file_id}.txt"
    text_path = os.path.join(STATIC_DIR, text_filename)
    try:
        with open(text_path, "w", encoding="utf-8") as tf:
            tf.write(f"Optic-AI Analysis Report\n")
            tf.write(f"Document: {doc_name}\n")
            tf.write(f"Mode: {resolved_mode.upper()}\n")
            tf.write(f"Language: {language}\n")
            tf.write("=" * 60 + "\n\n")
            tf.write(result_text)
        text_url = build_resource_url(request, text_filename)
    except Exception as e:
        print(f"[Optic-AI Text Export Error]: {e}")
        text_url = None

    # Cache result if this was a standard mode request
    if not effective_question:
        stored["cache"][cache_key] = {
            "text": result_text,
            "audio_url": audio_url,
            "text_url": text_url
        }
        save_document_store()

    return {
        "status": "success",
        "mode": resolved_mode,
        "language": language,
        "document_name": doc_name,
        "summary": result_text,
        "text": result_text,
        "audio_url": audio_url,
        "text_url": text_url,
        "cached": False
    }


@app.post("/generate-multilingual")
async def generate_multilingual(request: Request):
    """
    Dedicated endpoint to translate current text / summary into any language
    and synthesize neural speech using Microsoft Edge Neural TTS.
    Supported: English, Hindi, French, Japanese, German, Spanish, etc.
    """
    content_type = request.headers.get("content-type", "")
    language = None
    source_text = None

    if "application/json" in content_type:
        try:
            body = await request.json()
            if isinstance(body, dict):
                language = body.get("language")
                source_text = body.get("text")
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            language = form.get("language")
            source_text = form.get("text")
        except Exception:
            pass

    if not language:
        raise HTTPException(status_code=400, detail="Language parameter is required.")

    target_lang = str(language).strip()

    # If no text provided, use the last generated content from cache
    stored = DOCUMENT_STORE["default"]
    if not source_text:
        # Grab any cached content or default document text
        if stored["cache"]:
            last_key = list(stored["cache"].keys())[-1]
            source_text = stored["cache"][last_key]["text"]
        elif stored["text"]:
            source_text = stored["text"][:3000]
        else:
            raise HTTPException(status_code=400, detail="No content available to translate.")

    print(f"[Optic-AI] Multilingual translation requested for language: '{target_lang}'")

    # If target language is not English, translate via LLM
    translated_text = source_text
    if target_lang.lower() not in ["english", "en"]:
        system_instruction = (
            f"You are a professional educational translator. Translate the provided text into natural, fluent {target_lang}. "
            f"Preserve technical terms, formatting, and clear headings. "
            f"Make the phrasing conversational and optimal for speech synthesis."
        )
        try:
            translated_text = await asyncio.to_thread(
                default_llm.generate,
                system_instruction=system_instruction,
                prompt=f"Please translate this educational content into {target_lang}:\n\n{source_text}"
            )
        except Exception as e:
            print(f"[Translation Error]: {e}")

    # Synthesize Edge-TTS audio in target language
    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(
        text=translated_text,
        output_path=audio_path,
        language=target_lang
    )
    if success:
        audio_url = build_resource_url(request, audio_filename)

    # Generate text export file
    text_filename = f"{file_id}.txt"
    text_path = os.path.join(STATIC_DIR, text_filename)
    try:
        with open(text_path, "w", encoding="utf-8") as tf:
            tf.write(f"Optic-AI Multilingual Export ({target_lang})\n")
            tf.write(f"Source Document: {stored['name']}\n")
            tf.write("=" * 60 + "\n\n")
            tf.write(translated_text)
        text_url = build_resource_url(request, text_filename)
    except Exception:
        text_url = None

    return {
        "status": "success",
        "language": target_lang,
        "translated_text": translated_text,
        "text": translated_text,
        "audio_url": audio_url,
        "text_url": text_url
    }


@app.post("/ask-question")
async def ask_question(request: Request):
    """
    Dedicated rapid Q&A endpoint for the currently loaded document.
    """
    content_type = request.headers.get("content-type", "")
    question = None
    language = "English"

    if "application/json" in content_type:
        try:
            body = await request.json()
            if isinstance(body, dict):
                question = body.get("question")
                language = body.get("language") or language
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            question = form.get("question")
            language = form.get("language") or language
        except Exception:
            pass

    if not question:
        raise HTTPException(status_code=400, detail="Question parameter is required.")

    language = language or "English"
    stored = DOCUMENT_STORE["default"]
    document_text = stored["text"]
    if not document_text or document_text.startswith("No document uploaded"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF document first before asking questions."
        )

    inputs = {
        "document": document_text,
        "doc_title": stored["name"],
        "user_question": question,
        "language": language
    }

    try:
        crew = Crew(
            agents=[agents.Question_answer_agent],
            tasks=[Tasks.Question_answer_agent_task],
            verbose=True
        )
        output = await asyncio.to_thread(crew.kickoff, inputs=inputs)
        answer_text = output.raw.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Q&A Agent failed: {str(e)}")

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(
        text=answer_text,
        output_path=audio_path,
        language=language
    )
    if success:
        audio_url = build_resource_url(request, audio_filename)

    text_filename = f"{file_id}.txt"
    text_path = os.path.join(STATIC_DIR, text_filename)
    try:
        with open(text_path, "w", encoding="utf-8") as tf:
            tf.write(f"Optic-AI Q&A Response\n")
            tf.write(f"Document: {stored['name']}\n")
            tf.write(f"Question: {question}\n\n")
            tf.write(answer_text)
        text_url = build_resource_url(request, text_filename)
    except Exception:
        text_url = None

    return {
        "status": "success",
        "question": question,
        "answer": answer_text,
        "summary": answer_text,
        "text": answer_text,
        "audio_url": audio_url,
        "text_url": text_url,
        "language": language
    }


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    local_ip = get_local_ip()
    print(f"\n=======================================================")
    print(f" [Optic-AI] Server starting on:")
    print(f"  - Localhost: http://127.0.0.1:{port}")
    print(f"  - Phone Wi-Fi Network: http://{local_ip}:{port}")
    print(f"=======================================================\n")
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
