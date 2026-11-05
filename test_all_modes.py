import os
import requests
import json

BASE_URL = "http://127.0.0.1:8000"
PDF_PATH = r"C:\Users\LH\Downloads\Post-Quantum Cryptography Preparing for the Quantum Era.pdf"

def test_pipeline():
    print("=== 1. Testing Document Upload ===")
    with open(PDF_PATH, "rb") as f:
        r = requests.post(f"{BASE_URL}/upload-document", files={"file": (os.path.basename(PDF_PATH), f, "application/pdf")})
    print(f"Status: {r.status_code}")
    res = r.json()
    print(f"Uploaded: {res.get('document_name')}, chars: {res.get('char_count')}, pages: {res.get('page_count')}")
    assert r.status_code == 200

    modes = ["quick", "detailed", "exam", "qa"]
    for mode in modes:
        print(f"\n=== Testing Mode: {mode.upper()} ===")
        r = requests.post(f"{BASE_URL}/process-document", json={"mode": mode, "language": "English"})
        print(f"Status: {r.status_code}")
        data = r.json()
        print(f"Mode returned: {data.get('mode')}")
        print(f"Cached: {data.get('cached')}")
        print(f"Audio URL: {data.get('audio_url')}")
        print(f"Text URL: {data.get('text_url')}")
        summary_preview = data.get("text", "")[:250].replace("\n", " ")
        print(f"Output Preview: {summary_preview}...")
        assert r.status_code == 200

    print("\n=== Testing Rapid Q&A Endpoint ===")
    r = requests.post(f"{BASE_URL}/ask-question", json={"question": "What are the NIST finalized standards for PQC?"})
    print(f"Status: {r.status_code}")
    qa_data = r.json()
    print(f"Q&A Answer Preview: {qa_data.get('answer', '')[:250].replace('\n', ' ')}...")
    print(f"Q&A Audio URL: {qa_data.get('audio_url')}")
    assert r.status_code == 200

    print("\n=== Testing Multilingual Export (Hindi) ===")
    r = requests.post(f"{BASE_URL}/generate-multilingual", json={"language": "Hindi"})
    print(f"Status: {r.status_code}")
    hi_data = r.json()
    print(f"Hindi Preview: {hi_data.get('translated_text', '')[:200].replace('\n', ' ')}...")
    print(f"Hindi Audio URL: {hi_data.get('audio_url')}")
    assert r.status_code == 200

    print("\n=== Testing Multilingual Export (French) ===")
    r = requests.post(f"{BASE_URL}/generate-multilingual", json={"language": "French"})
    print(f"Status: {r.status_code}")
    fr_data = r.json()
    print(f"French Preview: {fr_data.get('translated_text', '')[:200].replace('\n', ' ')}...")
    print(f"French Audio URL: {fr_data.get('audio_url')}")
    assert r.status_code == 200

    print("\n=== ALL TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    test_pipeline()
