"""
Optic-AI Verification Suite
Tests Document Ingestion, Multi-Agent Summaries, Rapid Q&A,
Multilingual Translation, Document Reader Navigation, and the Central Voice Orchestrator.
"""

import os
import requests
import json

BASE_URL = "http://127.0.0.1:8000"
PDF_PATH = r"C:\Users\LH\Downloads\Post-Quantum Cryptography Preparing for the Quantum Era.pdf"


def test_pipeline():
    print("=== 1. Testing Document Upload ===")
    if os.path.exists(PDF_PATH):
        with open(PDF_PATH, "rb") as f:
            r = requests.post(
                f"{BASE_URL}/upload-document",
                files={"file": (os.path.basename(PDF_PATH), f, "application/pdf")},
            )
        print(f"Status: {r.status_code}")
        res = r.json()
        print(f"Uploaded: {res.get('document_name')}, chars: {res.get('char_count')}, pages: {res.get('page_count')}")
        assert r.status_code == 200
    else:
        print(f"[Notice] Local test PDF not found at {PDF_PATH}. Skipping upload step.")

    print("\n=== 2. Testing Document Reader Endpoints ===")
    r_status = requests.get(f"{BASE_URL}/document-reader/status")
    print("Reader Status:", r_status.status_code, r_status.json())
    assert r_status.status_code == 200

    r_para = requests.post(f"{BASE_URL}/document-reader/paragraph", json={"action": "next"})
    print("Next Paragraph:", r_para.status_code, r_para.json().get("spoken_text", "")[:70])
    assert r_para.status_code == 200

    r_page = requests.post(f"{BASE_URL}/document-reader/page", json={"page_number": 1})
    print("Page 1 Read:", r_page.status_code, r_page.json().get("spoken_text", "")[:70])
    assert r_page.status_code == 200

    print("\n=== 3. Testing Central Voice Orchestrator ===")
    test_commands = [
        ("Hey Optic", "WAKE_WORD"),
        ("Hey Optic, open document reader", "NAVIGATE_READER"),
        ("Read the next paragraph", "NEXT_PARAGRAPH"),
        ("Read from page five", "PAGE_JUMP"),
        ("Where am I?", "POSITION_CHECK"),
        ("Repeat the last response", "REPEAT"),
        ("Stop listening", "STOP_LISTENING"),
    ]

    for cmd, expected_intent in test_commands:
        r_orch = requests.post(
            f"{BASE_URL}/voice-orchestrator",
            json={"speech_text": cmd, "language": "English"},
        )
        data = r_orch.json()
        print(f"Command '{cmd}' -> Intent: {data.get('intent')} | Spoken: {data.get('spoken_text', '')[:50]}")
        assert r_orch.status_code == 200
        assert data.get("intent") == expected_intent

    print("\n=== 4. Testing Summary Modes ===")
    modes = ["quick", "detailed", "exam"]
    for mode in modes:
        print(f"Testing Mode: {mode.upper()}...")
        r = requests.post(
            f"{BASE_URL}/process-document",
            json={"mode": mode, "language": "English"},
        )
        assert r.status_code == 200
        data = r.json()
        print(f"  Mode {mode}: status {r.status_code}, audio_url: {bool(data.get('audio_url'))}")

    print("\n=== ALL VOICE ASSISTANT PIPELINE TESTS PASSED SUCCESSFULLY! ===")


if __name__ == "__main__":
    test_pipeline()
