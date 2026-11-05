"""
PDF Extraction Utility for Optic-AI.
Extracts clean, accessible text from binary PDF data with page and character metrics.
"""

import io
from typing import Optional, Tuple
from pypdf import PdfReader


def extract_text_from_pdf(pdf_bytes: bytes, max_pages: Optional[int] = 50) -> str:
    """
    Extracts text from PDF bytes.
    Limits to max_pages to keep document analysis responsive.
    """
    text, _ = extract_text_and_info(pdf_bytes, max_pages)
    return text


def extract_text_and_info(pdf_bytes: bytes, max_pages: Optional[int] = 50) -> Tuple[str, int]:
    """
    Extracts text and returns (extracted_text, total_pages).
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        total_pages = len(reader.pages)
        pages_to_extract = min(total_pages, max_pages) if max_pages else total_pages
        
        extracted_text_chunks = []
        for i in range(pages_to_extract):
            page = reader.pages[i]
            page_text = page.extract_text()
            if page_text and page_text.strip():
                extracted_text_chunks.append(f"--- Page {i + 1} ---\n{page_text.strip()}")
                
        full_text = "\n\n".join(extracted_text_chunks).strip()
        if not full_text:
            return "Note: The PDF did not contain extractable text (it might be scanned images or empty).", total_pages
            
        return full_text, total_pages
    except Exception as e:
        print(f"[PDF Extract Error] Failed to extract text: {e}")
        return f"Error reading PDF content: {str(e)}", 0
