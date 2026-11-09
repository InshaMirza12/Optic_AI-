"""
PDF Extraction Utility for Optic-AI.
Extracts clean, accessible text from binary PDF data with page and character metrics.
Supports page-by-page and paragraph-level navigation for hands-free voice screen reading.
"""

import io
import re
from typing import Optional, Tuple, List, Dict, Any
from pypdf import PdfReader


def split_text_into_paragraphs(text: str) -> List[str]:
    """Splits document text into readable, narration-friendly paragraphs."""
    cleaned = re.sub(r"--- Page \d+ ---\n?", "", text)
    raw_paras = re.split(r"\n\s*\n", cleaned)
    paras = []
    for p in raw_paras:
        p_clean = " ".join(p.split()).strip()
        if len(p_clean) >= 35:
            paras.append(p_clean)
        elif paras and len(p_clean) > 0:
            paras[-1] = paras[-1] + " " + p_clean
    return paras if paras else ([cleaned.strip()[:1000]] if cleaned.strip() else ["Document has no readable text."])


def extract_text_from_pdf(pdf_bytes: bytes, max_pages: Optional[int] = 50) -> str:
    """Extracts text from PDF bytes."""
    text, _ = extract_text_and_info(pdf_bytes, max_pages)
    return text


def extract_structured_pdf_data(pdf_bytes: bytes, max_pages: Optional[int] = 50) -> Dict[str, Any]:
    """
    Extracts text, page breakdown, and paragraph chunks for voice navigation.
    Returns: {
        'full_text': str,
        'page_count': int,
        'pages': List[str],
        'paragraphs': List[str]
    }
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        total_pages = len(reader.pages)
        pages_to_extract = min(total_pages, max_pages) if max_pages else total_pages

        extracted_text_chunks = []
        pages_list = []
        for i in range(pages_to_extract):
            page = reader.pages[i]
            page_text = (page.extract_text() or "").strip()
            pages_list.append(page_text if page_text else f"Page {i + 1} has no text.")
            if page_text:
                extracted_text_chunks.append(f"--- Page {i + 1} ---\n{page_text}")

        full_text = "\n\n".join(extracted_text_chunks).strip()
        if not full_text:
            full_text = "Note: The PDF did not contain extractable text (it might be scanned images or empty)."

        paragraphs = split_text_into_paragraphs(full_text)

        return {
            "full_text": full_text,
            "page_count": total_pages,
            "pages": pages_list,
            "paragraphs": paragraphs,
        }
    except Exception as e:
        print(f"[PDF Extract Error] Failed to extract structured text: {e}")
        err_msg = f"Error reading PDF content: {str(e)}"
        return {
            "full_text": err_msg,
            "page_count": 0,
            "pages": [err_msg],
            "paragraphs": [err_msg],
        }


def extract_text_and_info(pdf_bytes: bytes, max_pages: Optional[int] = 50) -> Tuple[str, int]:
    """Extracts text and returns (extracted_text, total_pages)."""
    data = extract_structured_pdf_data(pdf_bytes, max_pages)
    return data["full_text"], data["page_count"]
