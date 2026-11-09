"""
Optic-AI Unified Backend Server & Central Voice Orchestrator
Combines CrewAI Multi-Agent intelligence, Edge-TTS Multilingual Voice Synthesis,
and Accessible PDF Navigation into a hands-free voice assistant for visually impaired users.
Supports continuous hands-free voice control, wake word routing, document reader navigation,
and dynamic Wi-Fi IP adaptation.
"""

import os
import re
import glob
import json
import uuid
import socket
import asyncio
from typing import Optional, Dict, Any, List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

# Import local engines
from crewai import Crew, default_llm
import agents
import Tasks
from tts_service import generate_edge_tts_audio, resolve_voice, VOICE_MAP
from pdf_utils import (
    extract_text_and_info,
    extract_structured_pdf_data,
    split_text_into_paragraphs,
)

load_dotenv()

app = FastAPI(
    title="Optic-AI Accessible Voice Assistant",
    description="Hands-free Voice-first AI Assistant with Edge-TTS, Document Reader, and CrewAI Agents",
    version="2.5.0",
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
        s.settimeout(0.3)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# In-memory document context store for continuous Q&A, Document Reading, and Mode Switching
DOCUMENT_STORE: Dict[str, Any] = {
    "default": {
        "text": "",
        "name": "None",
        "char_count": 0,
        "page_count": 0,
        "pages": [],
        "paragraphs": [],
        "current_page": 1,
        "current_paragraph_index": 0,
        "last_spoken_text": "Welcome to Optic AI. How can I help you today? You can say: read my document, quick summary, detailed summary, exam notes, or ask any question.",
        "cache": {},
    }
}

DOC_CACHE_FILE = os.path.join(STATIC_DIR, "document_cache.json")


def save_document_store():
    """Persists current document, reading positions, and mode caches to disk."""
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
                    # Ensure backward compatibility with older cache files
                    if "paragraphs" not in saved or not saved["paragraphs"]:
                        saved["paragraphs"] = split_text_into_paragraphs(saved["text"])
                    if "pages" not in saved or not saved["pages"]:
                        saved["pages"] = [saved["text"]]
                    if "current_page" not in saved:
                        saved["current_page"] = 1
                    if "current_paragraph_index" not in saved:
                        saved["current_paragraph_index"] = 0
                    if "last_spoken_text" not in saved:
                        saved["last_spoken_text"] = f"Document {saved.get('name')} is loaded."
                    DOCUMENT_STORE["default"] = saved
                    print(
                        f"[Optic-AI] Restored document '{saved.get('name')}' ({saved.get('char_count')} chars, "
                        f"{len(saved.get('paragraphs', []))} paragraphs) from disk cache."
                    )
        except Exception as e:
            print(f"[Optic-AI Cache Warning]: {e}")


load_document_store()


def build_resource_url(request: Optional[Request], filename: str) -> str:
    """Builds an accessible URL for generated static files."""
    if request:
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
        return "quick", agents.Quick_summarizer, Tasks.Quick_summarizer_task


# Word to number mapping for voice page navigation (e.g. "read from page five")
WORD_TO_NUM: Dict[str, int] = {
    "one": 1, "first": 1, "two": 2, "second": 2, "three": 3, "third": 3,
    "four": 4, "fourth": 4, "five": 5, "fifth": 5, "six": 6, "sixth": 6,
    "seven": 7, "seventh": 7, "eight": 8, "eighth": 8, "nine": 9, "ninth": 9,
    "ten": 10, "tenth": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17,
    "eighteen": 18, "nineteen": 19, "twenty": 20, "twenty-one": 21,
    "twenty-two": 22, "twenty-five": 25, "thirty": 30
}


def parse_page_number_from_text(text: str) -> Optional[int]:
    """Extracts a spoken page number from commands like 'read from page 5' or 'go to page five'."""
    m = re.search(r"\bpage\s+([a-zA-Z0-9\-]+)", text, re.IGNORECASE)
    if m:
        token = m.group(1).lower().strip()
        if token.isdigit():
            return int(token)
        if token in WORD_TO_NUM:
            return WORD_TO_NUM[token]
    # Check standalone digits
    m_num = re.search(r"\b(\d+)\b", text)
    if m_num:
        return int(m_num.group(1))
    return None


def extract_file_search_intent(text: str) -> Tuple[str, Optional[str]]:
    """
    Extracts the file search keyword and folder preference from spoken user statements.
    Examples:
      'take the document named as cryptography from my downloads folder' -> ('cryptography', 'Downloads')
      'take cryptography from downloads' -> ('cryptography', 'Downloads')
      'load unit 4 from documents' -> ('unit 4', 'Documents')
    """
    text_lower = text.lower().strip()
    folder_pref = None
    if "download" in text_lower:
        folder_pref = "Downloads"
    elif "document" in text_lower and ("folder" in text_lower or "directory" in text_lower or "my document" in text_lower):
        folder_pref = "Documents"
    elif "desktop" in text_lower:
        folder_pref = "Desktop"

    # Pattern: 'named as <name>', 'named <name>', 'called <name>', 'title <name>'
    m = re.search(r"(?:named\s+as|named|called|title)\s+([a-zA-Z0-9_\-\s]+?)(?:\s+from|\s+in|\s+folder|\.pdf|$)", text_lower)
    if m:
        kw = m.group(1).strip()
    else:
        cleaned = re.sub(
            r"\b(take|the|document|file|pdf|from|my|downloads?|documents?|desktop|folder|directory|named|as|called|upload|fetch|load|open|get|please|saved|in)\b",
            " ",
            text_lower,
        )
        kw = " ".join(cleaned.split()).strip()

    return kw, folder_pref


def search_and_load_local_file(query: str) -> Dict[str, Any]:
    """Searches user filesystem for a PDF matching query keywords and loads it into memory."""
    query = str(query).strip().strip('"').strip("'")
    if not query:
        raise HTTPException(status_code=400, detail="Please state the file name or location.")

    print(f"\n[Optic-AI Voice Fetch] Searching for local document matching: '{query}'")
    matched_file_path = None

    if os.path.isfile(query):
        matched_file_path = os.path.abspath(query)
    else:
        kw, folder_pref = extract_file_search_intent(query)
        effective_query = kw if kw else query.lower()
        raw_lower = query.lower()

        prefer_downloads = folder_pref == "Downloads" or "download" in raw_lower
        prefer_documents = folder_pref == "Documents" or "document" in raw_lower or "doc" in raw_lower
        prefer_project = "project" in raw_lower or "workspace" in raw_lower
        prefer_desktop = folder_pref == "Desktop" or "desktop" in raw_lower

        noise_words = {
            "in", "the", "file", "pdf", "open", "fetch", "load", "from", "my",
            "please", "find", "upload", "location", "folder", "directory", "saved",
            "named", "called", "it", "is", "where", "search", "get", "system",
            "take", "as", "bring", "select", "choose", "pick"
        }
        tokens = [t for t in re.split(r"[\s,._\-/\\:]+", effective_query.lower()) if t and t not in noise_words]
        if not tokens:
            tokens = [t for t in re.split(r"[\s,._\-/\\:]+", raw_lower) if t and t not in noise_words]

        # Prioritize candidate directories based on spoken folder preference
        candidate_dirs = []
        if prefer_downloads:
            candidate_dirs.extend([
                r"C:\Users\LH\Downloads",
                os.path.expanduser(r"~\Downloads"),
            ])
        elif prefer_documents:
            candidate_dirs.extend([
                r"C:\Users\LH\Documents",
                os.path.expanduser(r"~\Documents"),
            ])
        elif prefer_desktop:
            candidate_dirs.extend([
                os.path.expanduser(r"~\Desktop"),
                r"C:\Users\LH\Desktop",
            ])

        # Standard Windows & user directories
        candidate_dirs.extend([
            r"C:\Users\LH\Downloads",
            r"C:\Users\LH\Documents",
            os.path.expanduser(r"~\Downloads"),
            os.path.expanduser(r"~\Documents"),
            os.path.expanduser(r"~\Desktop"),
            r"e:\final_year_project",
            os.path.dirname(os.path.abspath(__file__)),
        ])

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

        best_candidate = None
        best_score = -1

        for pdf_path in found_pdfs:
            fname = os.path.basename(pdf_path).lower()
            fpath = pdf_path.lower()
            score = 0

            # Substring match on extracted keyword
            if effective_query and effective_query in fname:
                score += 60
            elif raw_lower.replace(".pdf", "") in fname:
                score += 50

            matched_tokens = 0
            for t in tokens:
                if t in fname:
                    score += 15
                    matched_tokens += 1
                elif t in fpath:
                    score += 4

            if prefer_downloads and "download" in fpath:
                score += 10
            if prefer_documents and "document" in fpath:
                score += 10
            if prefer_desktop and "desktop" in fpath:
                score += 10
            if prefer_project and "final_year_project" in fpath:
                score += 5

            if score > best_score and (matched_tokens > 0 or score >= 10):
                best_score = score
                best_candidate = pdf_path

        if best_candidate and best_score > 0:
            matched_file_path = best_candidate

    if not matched_file_path or not os.path.isfile(matched_file_path):
        raise HTTPException(
            status_code=404,
            detail=f"Could not find any PDF file matching '{query}'. Please specify the exact file name or folder."
        )

    with open(matched_file_path, "rb") as f:
        file_bytes = f.read()

    if not file_bytes:
        raise HTTPException(status_code=400, detail="The matching file is empty.")

    structured = extract_structured_pdf_data(file_bytes)
    doc_name = os.path.basename(matched_file_path)
    folder_display = "Downloads" if "download" in matched_file_path.lower() else ("Documents" if "document" in matched_file_path.lower() else "system")

    spoken_confirmation = (
        f"Successfully loaded {doc_name} from your {folder_display} folder. "
        f"It contains {structured['page_count']} pages and {len(structured['paragraphs'])} paragraphs. "
        f"What would you like to do? You can say: read my document, quick summary, detailed summary, exam notes, or ask any question."
    )

    DOCUMENT_STORE["default"] = {
        "text": structured["full_text"],
        "name": doc_name,
        "char_count": len(structured["full_text"]),
        "page_count": structured["page_count"],
        "pages": structured["pages"],
        "paragraphs": structured["paragraphs"],
        "current_page": 1,
        "current_paragraph_index": 0,
        "last_spoken_text": spoken_confirmation,
        "cache": {},
    }
    save_document_store()

    return {
        "document_name": doc_name,
        "folder_name": folder_display,
        "file_path": matched_file_path,
        "char_count": len(structured["full_text"]),
        "page_count": structured["page_count"],
        "paragraphs_count": len(structured["paragraphs"]),
        "spoken_text": spoken_confirmation,
        "preview": structured["full_text"][:200] + "...",
    }


# ============================================================================
# Core API Routes
# ============================================================================

@app.get("/")
async def root():
    return {
        "project": "Optic-AI",
        "status": "online",
        "description": "Accessible Gen-AI Voice Assistant for Visually Impaired Users",
        "features": ["hands_free_voice", "document_reader", "crewai_agents", "edge_tts"],
        "local_ip": get_local_ip(),
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
        "paragraphs_count": len(doc_info.get("paragraphs", [])),
        "current_page": doc_info.get("current_page", 1),
        "current_paragraph": doc_info.get("current_paragraph_index", 0) + 1,
        "local_ip": get_local_ip(),
    }


@app.get("/api/config")
async def get_config():
    """Provides client with the server's current IP and port for seamless mobile pairing."""
    port = int(os.getenv("PORT", 8000))
    local_ip = get_local_ip()
    return {
        "local_ip": local_ip,
        "port": port,
        "base_url": f"http://{local_ip}:{port}",
    }


@app.get("/voices")
async def list_supported_voices():
    """Lists supported languages and Edge-TTS neural voice identifiers."""
    return {"supported_languages": list(VOICE_MAP.keys()), "default_voice": resolve_voice("en")}


@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)):
    """Dedicated endpoint to upload and ingest a PDF document."""
    print(f"\n[Optic-AI] Ingesting document: {file.filename}")
    try:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        structured = extract_structured_pdf_data(file_bytes)
        doc_name = file.filename or "Uploaded_Document.pdf"

        DOCUMENT_STORE["default"] = {
            "text": structured["full_text"],
            "name": doc_name,
            "char_count": len(structured["full_text"]),
            "page_count": structured["page_count"],
            "pages": structured["pages"],
            "paragraphs": structured["paragraphs"],
            "current_page": 1,
            "current_paragraph_index": 0,
            "last_spoken_text": (
                f"Document {doc_name} uploaded successfully with {structured['page_count']} pages and "
                f"{len(structured['paragraphs'])} paragraphs."
            ),
            "cache": {},
        }
        save_document_store()

        print(
            f"[Optic-AI] Stored '{doc_name}': {len(structured['full_text'])} chars, "
            f"{structured['page_count']} pages, {len(structured['paragraphs'])} paragraphs."
        )
        return {
            "status": "success",
            "document_name": doc_name,
            "char_count": len(structured["full_text"]),
            "page_count": structured["page_count"],
            "paragraphs_count": len(structured["paragraphs"]),
            "preview": structured["full_text"][:200] + "...",
        }
    except Exception as e:
        print(f"[Optic-AI Upload Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")


@app.post("/fetch-local-file")
async def fetch_local_file(request: Request):
    """Voice-controlled document fetch from filesystem."""
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

    res = search_and_load_local_file(query)
    return {"status": "success", **res}


# ============================================================================
# Document Reader Endpoints (Hands-Free Narration)
# ============================================================================

@app.get("/document-reader/status")
async def document_reader_status():
    """Returns current document position and structure metrics."""
    stored = DOCUMENT_STORE["default"]
    paras = stored.get("paragraphs", [])
    curr_idx = stored.get("current_paragraph_index", 0)
    curr_page = stored.get("current_page", 1)
    total_pages = stored.get("page_count", 1)

    return {
        "status": "success",
        "document_name": stored["name"],
        "has_document": bool(stored["text"]),
        "total_pages": total_pages,
        "current_page": curr_page,
        "total_paragraphs": len(paras),
        "current_paragraph": curr_idx + 1 if paras else 0,
    }


@app.post("/document-reader/read")
async def document_reader_read(request: Request):
    """
    Reads the document starting from current paragraph or page 1.
    Synthesizes neural audio via Edge-TTS.
    """
    stored = DOCUMENT_STORE["default"]
    paras = stored.get("paragraphs", [])
    if not paras:
        raise HTTPException(status_code=400, detail="No readable document loaded.")

    curr_idx = stored.get("current_paragraph_index", 0)
    if curr_idx >= len(paras):
        curr_idx = 0
        stored["current_paragraph_index"] = 0

    target_para = paras[curr_idx]
    announcement = f"Reading paragraph {curr_idx + 1} of {len(paras)}. {target_para}"

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(text=announcement, output_path=audio_path, language="English")
    if success:
        audio_url = build_resource_url(request, audio_filename)

    stored["last_spoken_text"] = target_para
    save_document_store()

    return {
        "status": "success",
        "paragraph_index": curr_idx + 1,
        "total_paragraphs": len(paras),
        "current_page": stored.get("current_page", 1),
        "text": target_para,
        "spoken_text": announcement,
        "audio_url": audio_url,
    }


@app.post("/document-reader/paragraph")
async def document_reader_paragraph(request: Request):
    """
    Navigates and narrates paragraph by paragraph (next, previous, or current).
    """
    content_type = request.headers.get("content-type", "")
    action = "next"
    if "application/json" in content_type:
        try:
            body = await request.json()
            action = body.get("action", "next").lower()
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            action = form.get("action", "next").lower()
        except Exception:
            pass

    stored = DOCUMENT_STORE["default"]
    paras = stored.get("paragraphs", [])
    if not paras:
        raise HTTPException(status_code=400, detail="No readable document loaded.")

    curr_idx = stored.get("current_paragraph_index", 0)

    if action == "next":
        if curr_idx + 1 < len(paras):
            curr_idx += 1
        else:
            return {
                "status": "end_of_document",
                "message": "You have reached the end of the document.",
                "paragraph_index": len(paras),
                "total_paragraphs": len(paras),
            }
    elif action == "previous" or action == "prev":
        if curr_idx > 0:
            curr_idx -= 1
        else:
            return {
                "status": "start_of_document",
                "message": "You are at the beginning of the document.",
                "paragraph_index": 1,
                "total_paragraphs": len(paras),
            }

    stored["current_paragraph_index"] = curr_idx
    target_para = paras[curr_idx]
    announcement = f"Paragraph {curr_idx + 1} of {len(paras)}. {target_para}"

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(text=announcement, output_path=audio_path, language="English")
    if success:
        audio_url = build_resource_url(request, audio_filename)

    stored["last_spoken_text"] = target_para
    save_document_store()

    return {
        "status": "success",
        "action": action,
        "paragraph_index": curr_idx + 1,
        "total_paragraphs": len(paras),
        "text": target_para,
        "spoken_text": announcement,
        "audio_url": audio_url,
    }


@app.post("/document-reader/page")
async def document_reader_page(request: Request):
    """
    Jumps to and reads a specific page by number.
    """
    content_type = request.headers.get("content-type", "")
    page_num = 1
    if "application/json" in content_type:
        try:
            body = await request.json()
            page_num = int(body.get("page_number", 1))
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            page_num = int(form.get("page_number", 1))
        except Exception:
            pass

    stored = DOCUMENT_STORE["default"]
    pages = stored.get("pages", [])
    total_pages = stored.get("page_count", len(pages) or 1)

    if page_num < 1:
        page_num = 1
    elif page_num > total_pages:
        page_num = total_pages

    stored["current_page"] = page_num

    page_text = pages[page_num - 1] if page_num - 1 < len(pages) else stored.get("text", "")[:1000]
    announcement = f"Page {page_num} of {total_pages}. {page_text[:1200]}"

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(text=announcement, output_path=audio_path, language="English")
    if success:
        audio_url = build_resource_url(request, audio_filename)

    stored["last_spoken_text"] = page_text[:1200]
    save_document_store()

    return {
        "status": "success",
        "page_number": page_num,
        "total_pages": total_pages,
        "text": page_text,
        "spoken_text": announcement,
        "audio_url": audio_url,
    }


# ============================================================================
# Intelligent Central Voice Assistant & Orchestrator
# ============================================================================

@app.post("/voice-orchestrator")
async def voice_orchestrator(request: Request):
    """
    Intelligent Central Voice Assistant:
    - Receives speech text from voice input.
    - Resolves wake word ('Hey Optic AI' / 'Hey Optic' / 'Optic').
    - Classifies intent using NLP / pattern analysis.
    - Routes to the appropriate Agent (Quick, Detailed, Exam, Q&A) or Document Reader.
    - Generates response with Edge-TTS neural speech.
    - Supports 'repeat last response', hands-free navigation, and continuous conversation.
    """
    content_type = request.headers.get("content-type", "")
    speech_text = ""
    language = "English"

    if "application/json" in content_type:
        try:
            body = await request.json()
            speech_text = body.get("speech_text") or body.get("command") or ""
            language = body.get("language") or language
        except Exception:
            pass
    else:
        try:
            form = await request.form()
            speech_text = form.get("speech_text") or form.get("command") or ""
            language = form.get("language") or language
        except Exception:
            pass

    speech_text = str(speech_text).strip()
    if not speech_text:
        return {
            "status": "ignored",
            "message": "No speech detected.",
            "continue_listening": True,
        }

    raw_lower = speech_text.lower().strip()
    print(f"\n[Optic-AI Voice Orchestrator] Incoming command: '{speech_text}'")

    # 1. Clean Wake Words ('Hey Optic AI', 'Hey Optic', 'Optic AI', 'Optic')
    cleaned_command = re.sub(r"^(hey\s+optic\s+ai|hey\s+optic|optic\s+ai|optic)[,\s]*", "", raw_lower).strip()

    # If the user solely said the wake word ("Hey Optic"), acknowledge and listen
    if not cleaned_command:
        ack_text = "Yes, I am listening. How can I help you?"
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=ack_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "wake_word_acknowledged",
            "intent": "WAKE_WORD",
            "text": ack_text,
            "spoken_text": ack_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    stored = DOCUMENT_STORE["default"]
    last_spoken = stored.get("last_spoken_text", "Welcome to Optic AI.")

    # 2. PRIORITY INTENT: Stop / Pause / Silence
    if re.search(r"\b(stop|pause|quiet|shut up|silence|halt|cancel)\b", cleaned_command):
        return {
            "status": "success",
            "intent": "STOP",
            "text": "Stopped.",
            "spoken_text": "Stopped.",
            "continue_listening": False,
        }

    # 3. Repeat Last Response
    if re.search(r"\b(repeat|say that again|what did you say|say again|repeat last|repeat response)\b", cleaned_command):
        repeat_text = f"Repeating: {last_spoken}"
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=repeat_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "REPEAT",
            "text": last_spoken,
            "spoken_text": repeat_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    # 4. Stop Listening
    if "stop listening" in cleaned_command or "pause listening" in cleaned_command:
        msg = "Voice listening stopped. Say Hey Optic to resume."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=msg, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "STOP_LISTENING",
            "text": msg,
            "spoken_text": msg,
            "audio_url": audio_url,
            "continue_listening": False,
        }

    # 5. Document Reader: Jump to Page
    if "page" in cleaned_command and re.search(r"\b(read|go to|jump|from|page)\b", cleaned_command):
        target_page = parse_page_number_from_text(cleaned_command)
        if target_page:
            pages = stored.get("pages", [])
            total_pages = stored.get("page_count", len(pages) or 1)
            target_page = max(1, min(target_page, total_pages))
            stored["current_page"] = target_page

            page_content = pages[target_page - 1] if target_page - 1 < len(pages) else stored.get("text", "")[:1000]
            read_text = f"Reading from page {target_page} of {total_pages}. {page_content[:1200]}"

            file_id = str(uuid.uuid4())
            audio_filename = f"{file_id}.mp3"
            audio_path = os.path.join(STATIC_DIR, audio_filename)
            audio_url = None
            if await generate_edge_tts_audio(text=read_text, output_path=audio_path, language=language):
                audio_url = build_resource_url(request, audio_filename)

            stored["last_spoken_text"] = page_content[:1200]
            save_document_store()
            return {
                "status": "success",
                "intent": "PAGE_JUMP",
                "page_number": target_page,
                "text": page_content,
                "spoken_text": read_text,
                "audio_url": audio_url,
                "continue_listening": True,
            }

    # 6. Document Reader: Next / Previous / Current Paragraph
    if "next paragraph" in cleaned_command or cleaned_command == "next":
        paras = stored.get("paragraphs", [])
        if not paras:
            msg = "No document loaded. Please state the file name to load."
        else:
            curr = stored.get("current_paragraph_index", 0)
            if curr + 1 < len(paras):
                curr += 1
                stored["current_paragraph_index"] = curr
                target_p = paras[curr]
                msg = f"Paragraph {curr + 1} of {len(paras)}. {target_p}"
                stored["last_spoken_text"] = target_p
                save_document_store()
            else:
                msg = "You have reached the end of the document."

        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=msg, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NEXT_PARAGRAPH",
            "text": msg,
            "spoken_text": msg,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    if "previous paragraph" in cleaned_command or "prev paragraph" in cleaned_command:
        paras = stored.get("paragraphs", [])
        if not paras:
            msg = "No document loaded. Please state the file name to load."
        else:
            curr = stored.get("current_paragraph_index", 0)
            if curr > 0:
                curr -= 1
                stored["current_paragraph_index"] = curr
                target_p = paras[curr]
                msg = f"Paragraph {curr + 1} of {len(paras)}. {target_p}"
                stored["last_spoken_text"] = target_p
                save_document_store()
            else:
                msg = "You are at the beginning of the document."

        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=msg, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "PREV_PARAGRAPH",
            "text": msg,
            "spoken_text": msg,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    # 7. Document Reader: Start / Read Document
    if re.search(r"\b(read my document|read document|start reading|begin reading|read)\b", cleaned_command):
        paras = stored.get("paragraphs", [])
        if not paras:
            msg = "No document is currently loaded. Please say upload document to find your study material."
        else:
            curr = stored.get("current_paragraph_index", 0)
            target_p = paras[curr]
            msg = f"Starting document reader. Paragraph {curr + 1} of {len(paras)}. {target_p}"
            stored["last_spoken_text"] = target_p
            save_document_store()

        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=msg, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "READ_DOCUMENT",
            "text": msg,
            "spoken_text": msg,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    # 8. Position & Status ("Where am I?")
    if "where am i" in cleaned_command or "current position" in cleaned_command or "status" in cleaned_command:
        paras = stored.get("paragraphs", [])
        p_idx = stored.get("current_paragraph_index", 0) + 1 if paras else 0
        total_p = len(paras)
        page = stored.get("current_page", 1)
        total_pages = stored.get("page_count", 1)
        doc_name = stored.get("name", "No document")

        pos_text = f"You are in document {doc_name}, reading page {page} of {total_pages}, paragraph {p_idx} of {total_p}."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=pos_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "POSITION_CHECK",
            "text": pos_text,
            "spoken_text": pos_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    # 9. Voice Navigation Commands
    if "open document reader" in cleaned_command or "go to document reader" in cleaned_command or cleaned_command == "document reader":
        nav_text = "Document reader opened. Say read my document, next paragraph, or jump to page."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=nav_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NAVIGATE_READER",
            "target": "reader",
            "text": nav_text,
            "spoken_text": nav_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    if "question answering" in cleaned_command or "open q and a" in cleaned_command:
        nav_text = "Question answering mode active. Ask any question about your document."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=nav_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NAVIGATE_QA",
            "target": "qa",
            "text": nav_text,
            "spoken_text": nav_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    if "start camera" in cleaned_command or "open camera" in cleaned_command:
        nav_text = "Camera vision module ready. Align document text in front of camera."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=nav_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NAVIGATE_CAMERA",
            "target": "camera",
            "text": nav_text,
            "spoken_text": nav_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    if "go back" in cleaned_command or "return to home" in cleaned_command or "home" in cleaned_command:
        nav_text = "Returned to home. How can I help you?"
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=nav_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NAVIGATE_HOME",
            "target": "home",
            "text": nav_text,
            "spoken_text": nav_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    if "settings" in cleaned_command or "help" in cleaned_command:
        nav_text = (
            "Voice Commands Guide: You can say read my document, next paragraph, read from page five, "
            "quick summary, detailed summary, exam notes, or ask any question."
        )
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=nav_text, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "success",
            "intent": "NAVIGATE_HELP",
            "target": "help",
            "text": nav_text,
            "spoken_text": nav_text,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    # 10. Voice-based File Search & Ingestion
    file_request_patterns = [
        "upload", "fetch file", "load file", "open file", "find file",
        "take document", "take the document", "take file", "take the file",
        "take ", "named as", "from my download", "from download", "from my document",
        "from document", "from desktop", "load ", "fetch ", "get document", "get file"
    ]
    if any(k in cleaned_command for k in file_request_patterns):
        kw, folder_pref = extract_file_search_intent(cleaned_command)
        query = kw if kw else cleaned_command
        if len(query) >= 2 or folder_pref:
            try:
                load_res = search_and_load_local_file(cleaned_command)
                success_text = load_res.get("spoken_text") or (
                    f"Successfully loaded {load_res['document_name']} from your {load_res.get('folder_name', 'system')} folder. "
                    f"It has {load_res['page_count']} pages and {load_res['paragraphs_count']} paragraphs. "
                    f"What would you like to do? You can say: read my document, quick summary, detailed summary, exam notes, or ask any question."
                )
                file_id = str(uuid.uuid4())
                audio_filename = f"{file_id}.mp3"
                audio_path = os.path.join(STATIC_DIR, audio_filename)
                audio_url = None
                if await generate_edge_tts_audio(text=success_text, output_path=audio_path, language=language):
                    audio_url = build_resource_url(request, audio_filename)

                stored["last_spoken_text"] = success_text
                return {
                    "status": "success",
                    "intent": "FETCH_FILE",
                    "text": success_text,
                    "spoken_text": success_text,
                    "audio_url": audio_url,
                    "document_name": load_res["document_name"],
                    "continue_listening": True,
                }
            except Exception as e:
                err_text = f"Could not find a file matching {query}. Please state the file name or location."
                return {
                    "status": "file_not_found",
                    "intent": "PROMPT_FILE",
                    "text": err_text,
                    "spoken_text": err_text,
                    "continue_listening": True,
                }
        else:
            prompt_text = "Please state the file name or where it is saved on your system."
            file_id = str(uuid.uuid4())
            audio_filename = f"{file_id}.mp3"
            audio_path = os.path.join(STATIC_DIR, audio_filename)
            audio_url = None
            if await generate_edge_tts_audio(text=prompt_text, output_path=audio_path, language=language):
                audio_url = build_resource_url(request, audio_filename)
            return {
                "status": "prompt_file_path",
                "intent": "PROMPT_FILE",
                "text": prompt_text,
                "spoken_text": prompt_text,
                "audio_url": audio_url,
                "continue_listening": True,
            }

    # 11. AI Summarization Routing (CrewAI Multi-Agent Execution)
    if any(k in cleaned_command for k in ["quick summary", "quick mode", "brief summary", "brief"]):
        mode = "quick"
    elif any(k in cleaned_command for k in ["detailed summary", "detailed mode", "comprehensive", "in depth"]):
        mode = "detailed"
    elif any(k in cleaned_command for k in ["exam notes", "exam mode", "revision", "prepare exam", "exam oriented", "open my notes"]):
        mode = "exam"
    else:
        # If not explicit summary, check if document is loaded for Q&A
        mode = "qa"

    document_text = stored.get("text", "")
    if not document_text or document_text.startswith("Error") or document_text.startswith("Note: The PDF"):
        no_doc_msg = "Please upload or name a document first before generating analysis."
        file_id = str(uuid.uuid4())
        audio_filename = f"{file_id}.mp3"
        audio_path = os.path.join(STATIC_DIR, audio_filename)
        audio_url = None
        if await generate_edge_tts_audio(text=no_doc_msg, output_path=audio_path, language=language):
            audio_url = build_resource_url(request, audio_filename)
        return {
            "status": "no_document",
            "intent": "NO_DOCUMENT",
            "text": no_doc_msg,
            "spoken_text": no_doc_msg,
            "audio_url": audio_url,
            "continue_listening": True,
        }

    resolved_mode, agent, task = select_agent_and_task(mode)
    print(f"[Optic-AI Voice Orchestrator] Routing to Agent '{agent.role}' (Mode: {resolved_mode})")

    # Check cache for standard mode
    cache_key = f"{resolved_mode}_{language}"
    user_q = cleaned_command if resolved_mode == "qa" else ""

    if not user_q and cache_key in stored.get("cache", {}):
        cached = stored["cache"][cache_key]
        stored["last_spoken_text"] = cached["text"]
        return {
            "status": "success",
            "intent": f"{resolved_mode.upper()}_SUMMARY",
            "mode": resolved_mode,
            "text": cached["text"],
            "spoken_text": cached["text"],
            "audio_url": cached["audio_url"],
            "cached": True,
            "continue_listening": True,
        }

    inputs = {
        "document": document_text,
        "doc_title": stored.get("name", "Document"),
        "user_question": user_q,
        "language": language,
    }

    try:
        crew = Crew(agents=[agent], tasks=[task], verbose=True)
        crew_output = await asyncio.wait_for(
            asyncio.to_thread(crew.kickoff, inputs=inputs),
            timeout=35.0
        )
        result_text = crew_output.raw.strip()
    except asyncio.TimeoutError:
        print(f"[Optic-AI Agent Timeout] Kickoff exceeded 35s.")
        result_text = "The analysis took longer than expected. Please ask for a quick summary or a more specific question."
    except Exception as e:
        print(f"[Agent Execution Error]: {e}")
        result_text = f"I encountered an error executing this request: {str(e)}"

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    if await generate_edge_tts_audio(text=result_text, output_path=audio_path, language=language):
        audio_url = build_resource_url(request, audio_filename)

    # Save to disk and cache
    stored["last_spoken_text"] = result_text
    if not user_q:
        stored.setdefault("cache", {})[cache_key] = {
            "text": result_text,
            "audio_url": audio_url,
            "text_url": None,
        }
    save_document_store()

    return {
        "status": "success",
        "intent": f"{resolved_mode.upper()}_SUMMARY" if resolved_mode != "qa" else "QA_ANSWER",
        "mode": resolved_mode,
        "text": result_text,
        "spoken_text": result_text,
        "audio_url": audio_url,
        "cached": False,
        "continue_listening": True,
    }


# ============================================================================
# Mode Processing & Multilingual Generation
# ============================================================================

@app.post("/process-document")
async def process_document(request: Request):
    """
    Standard processing endpoint for manual/form requests with CrewAI agents.
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

    if file:
        file_bytes = await file.read()
        structured = extract_structured_pdf_data(file_bytes)
        doc_name = file.filename or "Uploaded_Document.pdf"
        DOCUMENT_STORE["default"] = {
            "text": structured["full_text"],
            "name": doc_name,
            "char_count": len(structured["full_text"]),
            "page_count": structured["page_count"],
            "pages": structured["pages"],
            "paragraphs": structured["paragraphs"],
            "current_page": 1,
            "current_paragraph_index": 0,
            "last_spoken_text": f"Document {doc_name} uploaded.",
            "cache": {},
        }
        save_document_store()

    stored = DOCUMENT_STORE["default"]
    document_text = stored["text"]
    doc_name = stored["name"]

    if not document_text or document_text.startswith("Error") or document_text.startswith("Note: The PDF"):
        if prompt and not prompt.lower().startswith("execute"):
            document_text = prompt
            doc_name = "Text Input"
            DOCUMENT_STORE["default"]["text"] = document_text
            DOCUMENT_STORE["default"]["name"] = doc_name
            DOCUMENT_STORE["default"]["paragraphs"] = split_text_into_paragraphs(prompt)
        else:
            raise HTTPException(
                status_code=400,
                detail="No readable document found. Please upload a PDF study material first.",
            )

    resolved_mode, agent, task = select_agent_and_task(mode)
    effective_question = user_question or prompt or ""
    cache_key = f"{resolved_mode}_{language}"

    if not force_refresh and not effective_question and cache_key in stored.get("cache", {}):
        cached_data = stored["cache"][cache_key]
        stored["last_spoken_text"] = cached_data["text"]
        return {
            "status": "success",
            "mode": resolved_mode,
            "language": language,
            "document_name": doc_name,
            "summary": cached_data["text"],
            "text": cached_data["text"],
            "audio_url": cached_data["audio_url"],
            "text_url": cached_data["text_url"],
            "cached": True,
        }

    inputs = {
        "document": document_text,
        "doc_title": doc_name,
        "user_question": effective_question,
        "language": language,
    }

    try:
        crew = Crew(agents=[agent], tasks=[task], verbose=True)
        crew_output = await asyncio.to_thread(crew.kickoff, inputs=inputs)
        result_text = crew_output.raw.strip()
    except Exception as e:
        print(f"[Optic-AI Agent Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Agent analysis failed: {str(e)}")

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    try:
        success = await generate_edge_tts_audio(text=result_text, output_path=audio_path, language=language)
        if success:
            audio_url = build_resource_url(request, audio_filename)
    except Exception as e:
        print(f"[Optic-AI TTS Error]: {e}")

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
    except Exception:
        text_url = None

    stored["last_spoken_text"] = result_text
    if not effective_question:
        stored.setdefault("cache", {})[cache_key] = {
            "text": result_text,
            "audio_url": audio_url,
            "text_url": text_url,
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
        "cached": False,
    }


@app.post("/generate-multilingual")
async def generate_multilingual(request: Request):
    """Translates text/summary and synthesizes neural speech using Edge-TTS."""
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
    stored = DOCUMENT_STORE["default"]

    if not source_text:
        if stored.get("cache"):
            last_key = list(stored["cache"].keys())[-1]
            source_text = stored["cache"][last_key]["text"]
        elif stored.get("text"):
            source_text = stored["text"][:3000]
        else:
            raise HTTPException(status_code=400, detail="No content available to translate.")

    translated_text = source_text
    if target_lang.lower() not in ["english", "en"]:
        system_instruction = (
            f"You are a professional educational translator. Translate the provided text into natural, fluent {target_lang}. "
            f"Preserve technical terms and formatting. Make phrasing conversational for audio narration."
        )
        try:
            translated_text = await asyncio.to_thread(
                default_llm.generate,
                system_instruction=system_instruction,
                prompt=f"Please translate this content into {target_lang}:\n\n{source_text}",
            )
        except Exception as e:
            print(f"[Translation Error]: {e}")

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(text=translated_text, output_path=audio_path, language=target_lang)
    if success:
        audio_url = build_resource_url(request, audio_filename)

    text_filename = f"{file_id}.txt"
    text_path = os.path.join(STATIC_DIR, text_filename)
    try:
        with open(text_path, "w", encoding="utf-8") as tf:
            tf.write(f"Optic-AI Multilingual Export ({target_lang})\n")
            tf.write(f"Source Document: {stored.get('name')}\n")
            tf.write("=" * 60 + "\n\n")
            tf.write(translated_text)
        text_url = build_resource_url(request, text_filename)
    except Exception:
        text_url = None

    stored["last_spoken_text"] = translated_text
    return {
        "status": "success",
        "language": target_lang,
        "translated_text": translated_text,
        "text": translated_text,
        "audio_url": audio_url,
        "text_url": text_url,
    }


@app.post("/ask-question")
async def ask_question(request: Request):
    """Rapid document Q&A endpoint using Question_answer_agent."""
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

    stored = DOCUMENT_STORE["default"]
    document_text = stored["text"]
    if not document_text or document_text.startswith("No document uploaded"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a PDF document first before asking questions.",
        )

    inputs = {
        "document": document_text,
        "doc_title": stored["name"],
        "user_question": question,
        "language": language,
    }

    try:
        crew = Crew(
            agents=[agents.Question_answer_agent],
            tasks=[Tasks.Question_answer_agent_task],
            verbose=True,
        )
        output = await asyncio.to_thread(crew.kickoff, inputs=inputs)
        answer_text = output.raw.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Q&A Agent failed: {str(e)}")

    file_id = str(uuid.uuid4())
    audio_filename = f"{file_id}.mp3"
    audio_path = os.path.join(STATIC_DIR, audio_filename)
    audio_url = None

    success = await generate_edge_tts_audio(text=answer_text, output_path=audio_path, language=language)
    if success:
        audio_url = build_resource_url(request, audio_filename)

    stored["last_spoken_text"] = answer_text
    return {
        "status": "success",
        "question": question,
        "answer": answer_text,
        "summary": answer_text,
        "text": answer_text,
        "audio_url": audio_url,
        "language": language,
    }


# ============================================================================
# Main Entry Point with Port Conflict Protection
# ============================================================================

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    local_ip = get_local_ip()

    print(f"\n=======================================================")
    print(f" [Optic-AI] Voice Assistant Server Starting:")
    print(f"  - Local Access: http://127.0.0.1:{port}")
    print(f"  - Wi-Fi Device Access: http://{local_ip}:{port}")
    print(f"=======================================================\n")

    import uvicorn
    try:
        # Pass app directly instead of "main:app" string to prevent double execution
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
    except OSError as e:
        if getattr(e, "winerror", None) == 10048 or "10048" in str(e):
            print(f"\n[Optic-AI Error] Port {port} is occupied by an existing process.")
            print(f"[Optic-AI Solution] Run 'run_optic_ai.bat' to automatically free ports, or run:")
            print(f"   for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :{port}') do taskkill /F /PID %a\n")
        else:
            raise e
