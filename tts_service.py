"""
Edge-TTS Multilingual Voice Synthesis Service for Optic-AI.
Uses Microsoft Edge Neural voices with fallbacks and text sanitization for accessibility.
"""

import os
import re
import asyncio
from typing import Optional

try:
    import edge_tts
except ImportError:
    edge_tts = None

# Comprehensive map of ISO code & language name to natural Edge Neural voices
VOICE_MAP = {
    # English
    "en": "en-US-ChristopherNeural",
    "english": "en-US-ChristopherNeural",
    "en-us": "en-US-ChristopherNeural",
    "en-in": "en-IN-PrabhatNeural",
    
    # Hindi
    "hi": "hi-IN-SwaraNeural",
    "hindi": "hi-IN-SwaraNeural",
    "hi-in": "hi-IN-SwaraNeural",
    
    # Spanish
    "es": "es-ES-AlvaroNeural",
    "spanish": "es-ES-AlvaroNeural",
    "es-es": "es-ES-AlvaroNeural",
    
    # French
    "fr": "fr-FR-HenriNeural",
    "french": "fr-FR-HenriNeural",
    
    # German
    "de": "de-DE-ConradNeural",
    "german": "de-DE-ConradNeural",
    
    # Italian
    "it": "it-IT-DiegoNeural",
    "italian": "it-IT-DiegoNeural",
    
    # Portuguese
    "pt": "pt-BR-AntonioNeural",
    "portuguese": "pt-BR-AntonioNeural",
    
    # Indian Regional Languages
    "bn": "bn-IN-BashkarNeural",
    "bengali": "bn-IN-BashkarNeural",
    "ta": "ta-IN-ValluvarNeural",
    "tamil": "ta-IN-ValluvarNeural",
    "te": "te-IN-MohanNeural",
    "telugu": "te-IN-MohanNeural",
    "mr": "mr-IN-ManoharNeural",
    "marathi": "mr-IN-ManoharNeural",
    
    # Other Global Languages
    "ar": "ar-SA-HamedNeural",
    "arabic": "ar-SA-HamedNeural",
    "ja": "ja-JP-KeitaNeural",
    "japanese": "ja-JP-KeitaNeural",
    "zh": "zh-CN-YunxiNeural",
    "chinese": "zh-CN-YunxiNeural",
    "ru": "ru-RU-DmitryNeural",
    "russian": "ru-RU-DmitryNeural",
}

DEFAULT_VOICE = "en-US-ChristopherNeural"


def resolve_voice(language: Optional[str]) -> str:
    """Returns the most appropriate neural voice for the given language identifier."""
    if not language:
        return DEFAULT_VOICE
    
    clean_key = language.strip().lower()
    if clean_key in VOICE_MAP:
        return VOICE_MAP[clean_key]
    
    # Try prefix match (e.g., 'es-MX' -> 'es')
    prefix = clean_key.split("-")[0].split("_")[0]
    if prefix in VOICE_MAP:
        return VOICE_MAP[prefix]
        
    return DEFAULT_VOICE


def clean_text_for_speech(text: str) -> str:
    """
    Cleans markdown formatting, symbols, and artifacts so speech synthesis
    sounds natural and conversational for visually impaired listeners.
    """
    if not text:
        return ""
        
    # Remove markdown headers (# Title -> Title)
    cleaned = re.sub(r"#+\s*", "", text)
    # Remove bold/italic markup (**word** or *word*)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"\*([^*]+)\*", r"\1", cleaned)
    cleaned = re.sub(r"__([^_]+)__", r"\1", cleaned)
    cleaned = re.sub(r"_([^_]+)_", r"\1", cleaned)
    # Convert bullet points (- or *) to clean natural pauses
    cleaned = re.sub(r"^\s*[-*•]\s+", "", cleaned, flags=re.MULTILINE)
    # Remove code blocks
    cleaned = re.sub(r"```[\s\S]*?```", " [code section omitted for audio] ", cleaned)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    # Remove markdown links [text](url) -> text
    cleaned = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cleaned)
    # Normalize multiple line breaks and spaces
    cleaned = re.sub(r"\n{2,}", ". \n", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    
    return cleaned


async def generate_edge_tts_audio(
    text: str,
    output_path: str,
    language: str = "English",
    rate: str = "+0%",
    pitch: str = "+0Hz"
) -> bool:
    """
    Synthesizes speech using Microsoft Edge Neural TTS.
    Returns True on success, False otherwise.
    """
    speech_text = clean_text_for_speech(text)
    if not speech_text:
        return False

    # Cap speech synthesis to 3000 characters for snappy neural synthesis and to avoid WebSocket timeouts
    if len(speech_text) > 3000:
        speech_text = speech_text[:3000]
        last_pause = max(speech_text.rfind("।"), speech_text.rfind("."), speech_text.rfind("\n"))
        if last_pause > 2000:
            speech_text = speech_text[:last_pause + 1]
        
    voice = resolve_voice(language)
    print(f"[TTS] Synthesizing speech with Edge-TTS voice '{voice}' for language '{language}'")
    
    # Ensure destination directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    try:
        if edge_tts:
            communicate = edge_tts.Communicate(
                text=speech_text,
                voice=voice,
                rate=rate,
                pitch=pitch
            )
            await communicate.save(output_path)
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                return True
    except Exception as e:
        print(f"[TTS Error] Edge-TTS failed: {e}. Falling back to gTTS if available.")
        
    # Fallback to gTTS if Edge-TTS encounter any issue
    try:
        from gtts import gTTS
        lang_code = language.split("-")[0].lower() if language else "en"
        tts = gTTS(text=speech_text, lang=lang_code)
        tts.save(output_path)
        return True
    except Exception as e2:
        print(f"[TTS Error] Fallback gTTS also failed: {e2}")
        return False
