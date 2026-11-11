import React, { useState, useEffect, useRef } from "react";
import * as Haptics from "expo-haptics";
import KeyEvent from "react-native-keyevent";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library";
import { Audio as ExpoAudio } from "expo-av";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
  AccessibilityInfo,
  TextInput,
  Image,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../App";

const OPTIC_LOGO = require("../assets/optic_ai_logo.jpg");

// Current Wi-Fi IP of host PC: 192.168.1.39
const DEFAULT_HOST = "192.168.1.39:8000";
const INITIAL_BACKEND_BASE =
  Platform.OS === "web"
    ? typeof window !== "undefined" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
      ? `http://${window.location.hostname}:8000`
      : "http://localhost:8000"
    : `http://${DEFAULT_HOST}`;

export type SummaryMode = "quick" | "detailed" | "exam" | "qa" | "reader";
export type SupportedLanguage =
  | "English"
  | "Hindi"
  | "French"
  | "Japanese"
  | "German"
  | "Spanish";

export type NavTab = "home" | "agents" | "benefits" | "tech" | "about";

const LANGUAGE_LOCALES: Record<SupportedLanguage, string> = {
  English: "en-US",
  Hindi: "hi-IN",
  French: "fr-FR",
  Japanese: "ja-JP",
  German: "de-DE",
  Spanish: "es-ES",
};

const LANGUAGE_FLAGS: Record<SupportedLanguage, string> = {
  English: "🇬🇧 English",
  Hindi: "🇮🇳 Hindi",
  French: "🇫🇷 French",
  Japanese: "🇯🇵 Japanese",
  German: "🇩🇪 German",
  Spanish: "🇪🇸 Spanish",
};

const MODE_LABELS: Record<SummaryMode, string> = {
  quick: "⚡ Quick Summary",
  detailed: "📚 Detailed Summary",
  exam: "🎓 Exam Notes & Revision",
  qa: "💬 Document Q&A",
  reader: "📖 Document Reader",
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList, "Main">;

const MainScreen = () => {
  const navigation = useNavigation<NavigationProp>();

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>("home");

  // Backend Connectivity Configuration
  const [serverUrl, setServerUrl] = useState<string>(INITIAL_BACKEND_BASE);
  const [inputServerUrl, setInputServerUrl] = useState<string>(INITIAL_BACKEND_BASE);
  const [isServerConnected, setIsServerConnected] = useState<boolean | null>(null);
  const [showServerConfig, setShowServerConfig] = useState<boolean>(false);

  // Document State
  const [fileName, setFileName] = useState<string>("No document uploaded");
  const [docStats, setDocStats] = useState<string>("");
  const [isDocUploaded, setIsDocUploaded] = useState<boolean>(false);
  const [pdfFile, setPdfFile] = useState<any>(null);

  // Output State
  const [summary, setSummary] = useState<string>(
    "Welcome to Optic AI. State your command or say 'Hey Optic, read my document' to begin."
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [textUrl, setTextUrl] = useState<string | null>(null);
  const [activeSound, setActiveSound] = useState<ExpoAudio.Sound | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [greetingPlayed, setGreetingPlayed] = useState<boolean>(false);

  // Hands-free continuous listening state
  const [continuousListening, setContinuousListening] = useState<boolean>(true);
  const [awaitingVoiceFilePath, setAwaitingVoiceFilePath] = useState<boolean>(false);
  const [lastSpokenResponse, setLastSpokenResponse] = useState<string>(
    "Welcome to Optic AI. How can I help you today?"
  );

  // Mode & Multilingual Settings
  const [activeMode, setActiveMode] = useState<SummaryMode>("quick");
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>("English");
  const [translatingAudio, setTranslatingAudio] = useState<boolean>(false);

  // Custom Q&A Input State
  const [customQuestion, setCustomQuestion] = useState<string>("");

  // Voice Recognition State
  const [recognizedText, setRecognizedText] = useState<string>("");
  const [isListening, setIsListening] = useState<boolean>(false);
  const [wakeWordHeard, setWakeWordHeard] = useState<boolean>(false);

  // Document Reader specific metrics
  const [readerPage, setReaderPage] = useState<number>(1);
  const [readerTotalPages, setReaderTotalPages] = useState<number>(1);
  const [readerParagraph, setReaderParagraph] = useState<number>(1);
  const [readerTotalParagraphs, setReaderTotalParagraphs] = useState<number>(1);

  // Synchronous State References to prevent race conditions during continuous audio loops
  const activeSoundRef = useRef<ExpoAudio.Sound | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const continuousListeningRef = useRef<boolean>(true);
  const hasWelcomedRef = useRef<boolean>(false);
  const greetingPlayedRef = useRef<boolean>(false);
  const webRecognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);
  const speechDebounceTimerRef = useRef<any>(null);
  const speechAccumulatorRef = useRef<string>("");
  const isProcessingCommandRef = useRef<boolean>(false);

  useEffect(() => {
    continuousListeningRef.current = continuousListening;
  }, [continuousListening]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  // Voice Announcement Helper for Screen Readers (JAWS / TalkBack / VoiceOver)
  const announceAccessibility = (message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
    console.log(`[ScreenReader] ${message}`);
  };

  // Comprehensive Audio Cleanup: Guarantees zero voice overlap & resets sound state
  const stopAllAudio = async () => {
    isSpeakingRef.current = false;
    setIsSpeaking(false);

    try {
      Speech.stop();
    } catch (e) {}

    if (
      Platform.OS === "web" &&
      typeof window !== "undefined" &&
      (window as any).speechSynthesis
    ) {
      try {
        (window as any).speechSynthesis.cancel();
      } catch (e) {}
    }

    if (activeSoundRef.current) {
      try {
        const sound = activeSoundRef.current;
        activeSoundRef.current = null;
        await sound.stopAsync();
        await sound.unloadAsync();
      } catch (e) {}
    }
    setActiveSound(null);
  };

  // Instant Web Audio Wake Chime (0ms latency, synthesized locally like Siri/Alexa)
  const playWakeChime = () => {
    try {
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const now = ctx.currentTime;

          // First chime tone (587.33 Hz - D5)
          const osc1 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          osc1.type = "sine";
          osc1.frequency.setValueAtTime(587.33, now);
          gain1.gain.setValueAtTime(0.18, now);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
          osc1.connect(gain1);
          gain1.connect(ctx.destination);
          osc1.start(now);
          osc1.stop(now + 0.16);

          // Second harmonic chime tone (880 Hz - A5)
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.type = "sine";
          osc2.frequency.setValueAtTime(880, now + 0.08);
          gain2.gain.setValueAtTime(0.22, now + 0.08);
          gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.start(now + 0.08);
          osc2.stop(now + 0.32);
        }
      }
    } catch (e) {
      console.log("[Wake Chime error]:", e);
    }
  };

  // Schedule automatic listening resume with acoustic safety buffer
  const scheduleListeningResume = () => {
    if (!continuousListeningRef.current) return;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

    restartTimerRef.current = setTimeout(() => {
      if (
        continuousListeningRef.current &&
        !isSpeakingRef.current &&
        !activeSoundRef.current &&
        !isProcessingCommandRef.current
      ) {
        startListening();
      }
    }, 450);
  };

  // Safe voice output with guaranteed single-voice sequencing & Chrome speech watchdog
  const speakVoiceFeedback = async (message: string) => {
    await stopAllAudio();
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    // Watchdog timer: Chrome speech synthesis occasionally stalls without firing onDone or onError.
    // Reset state automatically after message duration to prevent locking the interface.
    const wordCount = message.split(/\s+/).length;
    const estimatedDurationMs = Math.max(3500, wordCount * 500);
    const watchdog = setTimeout(() => {
      if (isSpeakingRef.current) {
        console.log("[Optic-AI Voice Watchdog] Resetting speech lock after safety timeout.");
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        scheduleListeningResume();
      }
    }, estimatedDurationMs);

    try {
      if (Platform.OS === "web" && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      Speech.speak(message, {
        language: LANGUAGE_LOCALES[selectedLanguage] || "en-US",
        onDone: () => {
          clearTimeout(watchdog);
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          scheduleListeningResume();
        },
        onStopped: () => {
          clearTimeout(watchdog);
          isSpeakingRef.current = false;
          setIsSpeaking(false);
        },
        onError: (err) => {
          clearTimeout(watchdog);
          console.log("[Optic-AI Speech Error]:", err);
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          scheduleListeningResume();
        },
      });
    } catch (e) {
      clearTimeout(watchdog);
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      scheduleListeningResume();
    }
    console.log(`[Optic-AI Voice Feedback]: ${message}`);
  };

  // Welcome Greeting Trigger: Welcomes user and immediately initiates hands-free listening loop
  const playWelcomeGreeting = async () => {
    setGreetingPlayed(true);
    greetingPlayedRef.current = true;
    hasWelcomedRef.current = true;

    await stopAllAudio();
    const welcome = isDocUploaded
      ? `Welcome to Optic AI. Document ${fileName} is ready. Say 'Hey Optic AI' followed by your command, such as: read my document, next paragraph, quick summary, detailed summary, exam notes, or ask any question.`
      : `Welcome to Optic AI. I am your hands-free voice assistant. Tell me the document you want to upload, such as 'take cryptography from my downloads folder', or say 'upload document' or 'list my files'. You can also say 'Hey Optic AI' at any time. How can I help you today?`;
    setSummary(welcome);
    setLastSpokenResponse(welcome);
    await speakVoiceFeedback(welcome);
  };

  // Web First-Interaction Audio Unlocker: Browsers require a user click/touch/key to start audio
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleFirstInteraction = () => {
        if (!hasWelcomedRef.current) {
          playWelcomeGreeting();
        }
        window.removeEventListener("click", handleFirstInteraction);
        window.removeEventListener("keydown", handleFirstInteraction);
        window.removeEventListener("touchstart", handleFirstInteraction);
      };

      window.addEventListener("click", handleFirstInteraction, { once: true });
      window.addEventListener("keydown", handleFirstInteraction, { once: true });
      window.addEventListener("touchstart", handleFirstInteraction, { once: true });

      return () => {
        window.removeEventListener("click", handleFirstInteraction);
        window.removeEventListener("keydown", handleFirstInteraction);
        window.removeEventListener("touchstart", handleFirstInteraction);
      };
    }
  }, []);

  // Web Keyboard Escape Shortcut for Instant Stop
  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          handleStopAll();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, []);

  // Check backend server health and sync document state
  const checkServerHealth = async (target?: string) => {
    const url = (target || serverUrl).trim().replace(/\/+$/, "");
    try {
      const resp = await fetch(`${url}/health`, { method: "GET" });
      if (resp.ok) {
        const data = await resp.json();
        setIsServerConnected(true);
        if (data.active_document && data.active_document !== "None" && data.char_count > 0) {
          setIsDocUploaded(true);
          setFileName(data.active_document);
          setDocStats(
            `${data.char_count.toLocaleString()} characters, ${data.page_count || 1} pages, ${
              data.paragraphs_count || 1
            } paragraphs`
          );
          setReaderPage(data.current_page || 1);
          setReaderTotalPages(data.page_count || 1);
          setReaderParagraph(data.current_paragraph || 1);
          setReaderTotalParagraphs(data.paragraphs_count || 1);
        }
        return true;
      }
    } catch (err) {
      console.log(`[Health Check Failed for ${url}]:`, err);
    }
    setIsServerConnected(false);
    return false;
  };

  useEffect(() => {
    checkServerHealth(serverUrl);
  }, [serverUrl]);

  // Priority Instant Stop Action: Runs immediately and stops all speech, mic, and audio
  const handleStopAll = async () => {
    console.log("[PRIORITY COMMAND] Instant STOP requested.");
    setAwaitingVoiceFilePath(false);
    setLoading(false);
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (speechDebounceTimerRef.current) clearTimeout(speechDebounceTimerRef.current);
    speechAccumulatorRef.current = "";
    isProcessingCommandRef.current = false;

    try {
      if (Platform.OS === "web" && webRecognitionRef.current) {
        webRecognitionRef.current.abort();
      } else {
        ExpoSpeechRecognitionModule.stop();
      }
    } catch (e) {}

    setIsListening(false);
    await stopAllAudio();
    Speech.speak("Stopped.", {
      language: "en-US",
      onDone: () => {
        if (continuousListeningRef.current) {
          scheduleListeningResume();
        }
      },
    });
  };

  // Hardware volume button interception for push-to-talk / instant stop
  const handlePhysicalButtonPress = async () => {
    const speaking = await Speech.isSpeakingAsync();
    if (speaking || activeSoundRef.current || isSpeaking) {
      await handleStopAll();
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    const listener = KeyEvent.onKeyDownListener((keyEvent: any) => {
      if (keyEvent.keyCode === 24 || keyEvent.keyCode === 25) {
        handlePhysicalButtonPress();
      }
    });

    return () => {
      KeyEvent.removeKeyDownListener();
    };
  }, [isListening, isSpeaking, activeSound]);

  // Fetch local file from filesystem based on spoken name/location
  const fetchLocalFile = async (query: string) => {
    setAwaitingVoiceFilePath(false);
    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Searching system for "${query}"...`);

    try {
      const cleanBase = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${cleanBase}/fetch-local-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || `File not found on system.`);
      }

      const data = await resp.json();
      setIsDocUploaded(true);
      setFileName(data.document_name);
      setDocStats(
        `${data.char_count.toLocaleString()} characters, ${data.page_count} pages, ${
          data.paragraphs_count || 1
        } paragraphs`
      );
      setReaderPage(1);
      setReaderTotalPages(data.page_count || 1);
      setReaderParagraph(1);
      setReaderTotalParagraphs(data.paragraphs_count || 1);

      const successMsg = `Successfully loaded ${data.document_name}. What would you like to do? You can say: read my document, quick summary, detailed summary, exam notes, or ask any question.`;
      setSummary(successMsg);
      setLastSpokenResponse(successMsg);
      speakVoiceFeedback(successMsg);
    } catch (err: any) {
      console.error("Local file fetch error:", err);
      const errVoice = `Could not find a file matching ${query}. Please state the file name or location again, or say cancel.`;
      speakVoiceFeedback(errVoice);
      Alert.alert("File Not Found", err?.message || `Could not find '${query}' on system.`);
    } finally {
      setLoading(false);
    }
  };

  // Prompt user by voice for file name and location
  const handleVoiceUploadPrompt = async () => {
    await stopAllAudio();
    setAwaitingVoiceFilePath(true);
    const promptMsg = "Please state the file name or where it is saved on your system.";
    await speakVoiceFeedback(promptMsg);
  };

  // Play neural Edge-TTS audio with guaranteed single-voice sequencing and continuous loop resume
  const playAudioFromUrl = async (url: string) => {
    try {
      await stopAllAudio();
      isSpeakingRef.current = true;
      setIsSpeaking(true);

      const { sound } = await ExpoAudio.Sound.createAsync(
        { uri: url },
        { shouldPlay: true }
      );
      activeSoundRef.current = sound;
      setActiveSound(sound);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          activeSoundRef.current = null;
          setActiveSound(null);
          isSpeakingRef.current = false;
          setIsSpeaking(false);
          announceAccessibility("Audio playback finished.");
          scheduleListeningResume();
        }
      });
    } catch (err) {
      console.log("Audio playback error, falling back to device speech:", err);
      if (summary) {
        speakVoiceFeedback(summary);
      }
    }
  };

  // Execute Agent Analysis for a given mode
  const executeModeAnalysis = async (
    mode: SummaryMode,
    lang: SupportedLanguage,
    customQ?: string
  ) => {
    if (mode === "reader") {
      executeDocumentReaderCommand("read");
      return;
    }

    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Generating ${MODE_LABELS[mode]} in ${lang}...`);

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const processEndpoint = `${cleanBase}/process-document`;

    const formData = new FormData();
    formData.append("mode", mode);
    formData.append("language", lang);
    formData.append("user_question", customQ || "");
    formData.append("prompt", customQ || "");

    try {
      const response = await fetch(processEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error ${response.status}`);
      }

      const data = await response.json();
      const outputText = data.text || data.summary || "Analysis completed.";
      setSummary(outputText);
      setLastSpokenResponse(outputText);
      setAudioUrl(data.audio_url);
      setTextUrl(data.text_url);

      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(outputText);
      }
    } catch (err: any) {
      console.error("Analysis Error:", err);
      speakVoiceFeedback("Error generating output. Please verify server connection.");
      Alert.alert("Analysis Error", err?.message || "Failed to process request.");
    } finally {
      setLoading(false);
    }
  };

  // Execute dedicated Document Reader navigation (Next, Prev, Read, Jump)
  const executeDocumentReaderCommand = async (
    action: "read" | "next" | "previous",
    pageNum?: number
  ) => {
    await stopAllAudio();
    setLoading(true);
    const cleanBase = serverUrl.trim().replace(/\/+$/, "");

    try {
      let endpoint = `${cleanBase}/document-reader/read`;
      let body: any = {};

      if (pageNum !== undefined) {
        endpoint = `${cleanBase}/document-reader/page`;
        body = { page_number: pageNum };
      } else if (action === "next" || action === "previous") {
        endpoint = `${cleanBase}/document-reader/paragraph`;
        body = { action };
      }

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || "Document reader failed.");
      }

      const data = await resp.json();
      setActiveMode("reader");

      if (data.status === "end_of_document" || data.status === "start_of_document") {
        speakVoiceFeedback(data.message);
        setSummary(data.message);
        return;
      }

      const displayText = data.text || data.spoken_text;
      setSummary(displayText);
      setLastSpokenResponse(displayText);
      if (data.current_page) setReaderPage(data.current_page);
      if (data.page_number) setReaderPage(data.page_number);
      if (data.total_pages) setReaderTotalPages(data.total_pages);
      if (data.paragraph_index) setReaderParagraph(data.paragraph_index);
      if (data.total_paragraphs) setReaderTotalParagraphs(data.total_paragraphs);

      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(data.spoken_text || displayText);
      }
    } catch (err: any) {
      console.error("Reader Error:", err);
      speakVoiceFeedback(err?.message || "Could not read document.");
    } finally {
      setLoading(false);
    }
  };

  // Mode Switch Handler
  const handleModeSwitch = (mode: SummaryMode) => {
    setActiveMode(mode);
    speakVoiceFeedback(`Switched to ${MODE_LABELS[mode]}.`);
    if (isDocUploaded) {
      executeModeAnalysis(mode, selectedLanguage);
    } else {
      speakVoiceFeedback("Please load a document first.");
    }
  };

  // Multilingual Translator & Audio Synthesizer Handler
  const handleGenerateMultilingual = async (lang: SupportedLanguage) => {
    setSelectedLanguage(lang);
    if (!summary || summary.startsWith("Welcome to Optic AI")) {
      speakVoiceFeedback("Please upload a document and generate an analysis first.");
      return;
    }

    await stopAllAudio();
    setTranslatingAudio(true);

    const cleanBase = serverUrl.trim().replace(/\/+$/, "");
    const multiEndpoint = `${cleanBase}/generate-multilingual`;

    const formData = new FormData();
    formData.append("language", lang);
    formData.append("text", summary);

    try {
      const response = await fetch(multiEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Translation returned status ${response.status}`);
      }

      const data = await response.json();
      const translated = data.translated_text || data.text;
      setSummary(translated);
      setLastSpokenResponse(translated);
      setAudioUrl(data.audio_url);
      setTextUrl(data.text_url);

      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(translated);
      }
    } catch (err: any) {
      console.error("Multilingual Error:", err);
      speakVoiceFeedback(`Could not generate audio in ${lang}.`);
      Alert.alert("Translation Error", err?.message || "Failed to generate multilingual audio.");
    } finally {
      setTranslatingAudio(false);
    }
  };

  // Manual File Upload Handler (Optional fallback)
  const handleUpload = async () => {
    try {
      await stopAllAudio();
      speakVoiceFeedback("Opening document picker. Please select a PDF file.");

      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.length) {
        const selected = result.assets[0];
        setPdfFile(selected);
        const name = selected.name || "Uploaded_Document.pdf";
        setFileName(name);

        setLoading(true);
        setLoadingMessage(`Ingesting ${name}...`);

        const cleanBase = serverUrl.trim().replace(/\/+$/, "");
        const uploadEndpoint = `${cleanBase}/upload-document`;
        const formData = new FormData();

        if (Platform.OS === "web") {
          if ((selected as any).file) {
            formData.append("file", (selected as any).file, name);
          } else if (selected.uri) {
            const res = await fetch(selected.uri);
            const blob = await res.blob();
            formData.append("file", blob, name);
          }
        } else {
          formData.append("file", {
            uri: selected.uri,
            name: name,
            type: selected.mimeType || "application/pdf",
          } as any);
        }

        const uploadResp = await fetch(uploadEndpoint, {
          method: "POST",
          body: formData,
        });

        if (!uploadResp.ok) {
          const errData = await uploadResp.json().catch(() => ({}));
          throw new Error(errData.detail || `Upload returned status ${uploadResp.status}`);
        }

        const uploadData = await uploadResp.json();
        setIsDocUploaded(true);
        setDocStats(
          `${uploadData.char_count.toLocaleString()} characters, ${uploadData.page_count} pages, ${
            uploadData.paragraphs_count || 1
          } paragraphs`
        );
        setReaderPage(1);
        setReaderTotalPages(uploadData.page_count || 1);
        setReaderParagraph(1);
        setReaderTotalParagraphs(uploadData.paragraphs_count || 1);

        const successMsg = `Document ${name} uploaded successfully. Generating ${MODE_LABELS[activeMode]}...`;
        speakVoiceFeedback(successMsg);
        await executeModeAnalysis(activeMode, selectedLanguage);
      }
    } catch (err: any) {
      console.error("Document picker error:", err);
      speakVoiceFeedback("Failed to upload document.");
      setLoading(false);
    }
  };

  // Play / Pause summary button handler
  const handlePlaySummary = () => {
    if (audioUrl) {
      playAudioFromUrl(audioUrl);
    } else if (summary) {
      speakVoiceFeedback(summary);
    } else {
      speakVoiceFeedback("No analysis available to play.");
    }
  };

  // Download Text File (.txt) Handler
  const handleDownloadTextFile = () => {
    if (!summary) {
      speakVoiceFeedback("No text available to download.");
      return;
    }

    const cleanDocName = (fileName || "Optic_AI_Report").replace(/\.[^/.]+$/, "");
    const filename = `${cleanDocName}_${activeMode}_${selectedLanguage}.txt`;

    if (Platform.OS === "web") {
      try {
        const element = document.createElement("a");
        const file = new Blob([summary], { type: "text/plain;charset=utf-8" });
        element.href = URL.createObjectURL(file);
        element.download = filename;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        speakVoiceFeedback(`Downloaded text file ${filename}`);
      } catch (e) {
        console.error("Web download error:", e);
      }
    } else {
      (async () => {
        try {
          const path = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
          await FileSystem.writeAsStringAsync(path, summary, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          speakVoiceFeedback("Text file saved.");
          await Sharing.shareAsync(path);
        } catch (err) {
          Alert.alert("Save Error", "Could not save text file.");
        }
      })();
    }
  };

  // Download Audio File (.mp3) Handler
  const handleDownloadAudioFile = () => {
    if (!audioUrl) {
      speakVoiceFeedback("Please generate audio first before downloading.");
      return;
    }

    const cleanDocName = (fileName || "Optic_AI_Audio").replace(/\.[^/.]+$/, "");
    const filename = `${cleanDocName}_${activeMode}_${selectedLanguage}.mp3`;

    if (Platform.OS === "web") {
      try {
        const element = document.createElement("a");
        element.href = audioUrl;
        element.download = filename;
        element.target = "_blank";
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
        speakVoiceFeedback(`Downloading audio file ${filename}`);
      } catch (e) {
        console.error("Web audio download error:", e);
      }
    } else {
      (async () => {
        try {
          const { status } = await MediaLibrary.requestPermissionsAsync();
          if (status !== "granted") {
            speakVoiceFeedback("Storage permission denied.");
            return;
          }
          const destination = `${
            FileSystem.documentDirectory || FileSystem.cacheDirectory
          }${filename}`;
          const downloadRes = await FileSystem.downloadAsync(audioUrl, destination);
          if (downloadRes?.uri) {
            await MediaLibrary.createAssetAsync(downloadRes.uri);
            speakVoiceFeedback("Audio saved to your media library.");
            await Sharing.shareAsync(downloadRes.uri);
          }
        } catch (err) {
          Alert.alert("Save Error", "Could not download audio.");
        }
      })();
    }
  };

  // Custom Q&A submission
  const handleAskCustomQuestion = () => {
    if (!customQuestion.trim()) {
      speakVoiceFeedback("Please enter a question.");
      return;
    }
    executeModeAnalysis("qa", selectedLanguage, customQuestion.trim());
    setCustomQuestion("");
  };

  // Web Speech Recognition for Desktop Browsers (Chrome / Edge)
  const startWebListening = (force: boolean = false) => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speakVoiceFeedback(
        "Speech recognition not supported in this browser. Please use Chrome or Edge."
      );
      return;
    }

    if (!force && (isSpeakingRef.current || activeSoundRef.current || isProcessingCommandRef.current)) {
      return;
    }

    try {
      if (webRecognitionRef.current) {
        try {
          webRecognitionRef.current.abort();
        } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = LANGUAGE_LOCALES[selectedLanguage] || "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let interimText = "";
        let finalText = "";
        const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
        for (let i = startIndex; i < event.results.length; i++) {
          const item = event.results[i];
          if (item && item[0]) {
            if (item.isFinal) {
              finalText += item[0].transcript + " ";
            } else {
              interimText += item[0].transcript + " ";
            }
          }
        }
        const textToProcess = (finalText || interimText).trim();
        if (textToProcess) {
          handleIncomingSpeech(textToProcess, !!finalText);
        }
      };

      recognition.onerror = (err: any) => {
        console.log("Web Speech error:", err?.error);
        if (err?.error === "no-speech") {
          return;
        }
        setIsListening(false);
        if (err?.error !== "aborted" && !isProcessingCommandRef.current && !isSpeakingRef.current) {
          scheduleListeningResume();
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (
          continuousListeningRef.current &&
          !isSpeakingRef.current &&
          !activeSoundRef.current &&
          !isProcessingCommandRef.current
        ) {
          scheduleListeningResume();
        }
      };

      webRecognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error("Web recognition start error:", e);
      setIsListening(false);
    }
  };

  // Unified Speech Accumulator & Real-time Wake-Word / Interruption Debouncer
  const handleIncomingSpeech = (transcript: string, isFinal: boolean = true) => {
    const trimmed = transcript.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();

    // ============================================================
    // 1. HIGHEST PRIORITY STOP COMMAND: Runs even while speaking!
    // ============================================================
    if (
      lower === "stop" ||
      lower.startsWith("stop") ||
      lower.includes("stop") ||
      lower.includes("pause") ||
      lower.includes("quiet") ||
      lower.includes("shut up") ||
      lower.includes("silence") ||
      lower.includes("cancel") ||
      lower.includes("halt")
    ) {
      console.log("[INTERRUPTION DETECTED] Immediate STOP requested!");
      if (speechDebounceTimerRef.current) clearTimeout(speechDebounceTimerRef.current);
      speechAccumulatorRef.current = "";
      handleStopAll();
      return;
    }

    // If assistant is actively speaking and the user didn't say stop, ignore acoustic playback
    if (isSpeakingRef.current || isProcessingCommandRef.current) {
      return;
    }

    // ============================================================
    // 2. SMART WAKE-WORD DETECTION ("Hey Optic AI" / "Hey Optic")
    // ============================================================
    const WAKE_WORD_CHECK = /\b(hey\s+optic\s+ai|hey\s+optic|optic\s+ai|optic|hey\s+optics|ok\s+optic|hello\s+optic)\b/i;
    if (WAKE_WORD_CHECK.test(lower)) {
      if (!wakeWordHeard) {
        console.log("[Optic-AI Wake Word Triggered]: Playing chime");
        playWakeChime();
        setWakeWordHeard(true);
        setTimeout(() => setWakeWordHeard(false), 4000);
      }

      // Check if user spoke ONLY the wake word (e.g. "Hey Optic AI")
      const cleanedAfterWake = lower
        .replace(/^(hey|hi|hello|ok|okay)?\s*(optic\s*ai|optics\s*ai|optic\s*eye|optics|optic|optik)[,.!?\s]*/i, "")
        .trim();

      if (!cleanedAfterWake && isFinal) {
        if (speechDebounceTimerRef.current) clearTimeout(speechDebounceTimerRef.current);
        speechAccumulatorRef.current = "";
        processCommand("hey optic");
        return;
      }
    }

    // Accumulate the spoken statement and display live transcription
    speechAccumulatorRef.current = trimmed;
    setRecognizedText(trimmed);

    // Reset silence timer on every new speech chunk
    if (speechDebounceTimerRef.current) {
      clearTimeout(speechDebounceTimerRef.current);
    }

    // Natural conversation pause: waits 1.6 seconds of complete silence before executing
    const SILENCE_TIMEOUT = 1600;
    speechDebounceTimerRef.current = setTimeout(() => {
      const fullUtterance = speechAccumulatorRef.current.trim();
      speechAccumulatorRef.current = "";
      if (fullUtterance && !isProcessingCommandRef.current && !isSpeakingRef.current) {
        processCommand(fullUtterance);
      }
    }, SILENCE_TIMEOUT);
  };

  // Central Voice Command Processor: Communicates with backend Voice Orchestrator
  const processCommand = async (command: string) => {
    if (isProcessingCommandRef.current) return;
    isProcessingCommandRef.current = true;

    const lower = command.toLowerCase().trim();
    setRecognizedText(command);
    console.log("[Optic-AI Voice Command]:", lower);

    // ============================================================
    // 1. HIGHEST PRIORITY: Instant STOP / PAUSE Command
    // ============================================================
    if (
      lower === "stop" ||
      lower.startsWith("stop") ||
      lower.includes("stop") ||
      lower.includes("pause") ||
      lower.includes("quiet") ||
      lower.includes("shut up") ||
      lower.includes("silence") ||
      lower.includes("cancel") ||
      lower.includes("halt")
    ) {
      isProcessingCommandRef.current = false;
      await handleStopAll();
      return;
    }

    // ============================================================
    // 2. Navigation Tab Voice Switching
    // ============================================================
    if (
      lower.includes("our agents") ||
      lower.includes("meet agents") ||
      lower.includes("show agents") ||
      lower.includes("agent section")
    ) {
      setActiveTab("agents");
      isProcessingCommandRef.current = false;
      speakVoiceFeedback(
        "Meet Our AI Agents: Optic AI features four specialized CrewAI agents: Quick Summarizer, Detailed Summarizer, Exam Notes Specialist, and Document Q&A Specialist, coordinated by our central Voice Assistant."
      );
      return;
    }

    if (
      lower.includes("benefits") ||
      lower.includes("why optic") ||
      lower.includes("show benefits") ||
      lower.includes("advantages")
    ) {
      setActiveTab("benefits");
      isProcessingCommandRef.current = false;
      speakVoiceFeedback(
        "Why Optic AI: We provide 100% hands-free voice control, JAWS and screen reader compliance, grounded anti-hallucination analysis, and multi-language neural audio."
      );
      return;
    }

    if (
      lower.includes("technology") ||
      lower.includes("tech stack") ||
      lower.includes("powered by") ||
      lower.includes("technologies")
    ) {
      setActiveTab("tech");
      isProcessingCommandRef.current = false;
      speakVoiceFeedback(
        "Powered By Technology: Built with React Native, FastAPI, CrewAI Multi-Agent Framework, Google Gemini, and Microsoft Edge Neural Speech."
      );
      return;
    }

    if (
      lower.includes("about optic") ||
      lower.includes("about us") ||
      lower.includes("who made this") ||
      lower.includes("project details")
    ) {
      setActiveTab("about");
      isProcessingCommandRef.current = false;
      speakVoiceFeedback(
        "About Optic AI: An accessible Gen-AI platform designed to empower blind and visually impaired students to comprehend and navigate complex study materials hands-free."
      );
      return;
    }

    if (
      lower.includes("go home") ||
      lower.includes("return to home") ||
      lower.includes("open dashboard") ||
      lower.includes("main dashboard") ||
      lower === "home"
    ) {
      setActiveTab("home");
      isProcessingCommandRef.current = false;
      speakVoiceFeedback("Returned to home dashboard. What would you like to do?");
      return;
    }

    // ============================================================
    // 3. Awaiting file name/path from previous voice query
    // ============================================================
    if (awaitingVoiceFilePath) {
      isProcessingCommandRef.current = false;
      await fetchLocalFile(command);
      return;
    }

    // ============================================================
    // 4. Central Intelligent Voice Coordinator (Backend Agent Router)
    // ============================================================
    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Optic AI processing: "${command}"...`);

    // 90s timeout safeguard allows full generation of extensive, in-depth summaries
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 90000);

    try {
      const cleanBase = serverUrl.trim().replace(/\/+$/, "");
      const resp = await fetch(`${cleanBase}/voice-orchestrator`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          speech_text: command,
          language: selectedLanguage,
        }),
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`Voice orchestrator error: ${resp.status}`);
      }

      const data = await resp.json();
      console.log("[Optic-AI Orchestrator Result]:", data);

      if (data.status === "ignored") {
        isProcessingCommandRef.current = false;
        scheduleListeningResume();
        return;
      }

      // Check Wake Word Detection
      if (data.intent === "WAKE_WORD") {
        setWakeWordHeard(true);
        setTimeout(() => setWakeWordHeard(false), 3000);
      }

      // Handle Stop Listening Intent
      if (data.intent === "STOP_LISTENING") {
        setContinuousListening(false);
        continuousListeningRef.current = false;
        isProcessingCommandRef.current = false;
        speakVoiceFeedback(data.spoken_text || "Listening stopped. Say Hey Optic to resume.");
        return;
      }

      // Prompt for File Path (Voice-Guided Upload)
      if (data.intent === "PROMPT_FILE") {
        setAwaitingVoiceFilePath(true);
        setSummary(data.text);
        if (data.audio_url) {
          playAudioFromUrl(data.audio_url);
        } else {
          speakVoiceFeedback(data.spoken_text || data.text);
        }
        return;
      }

      // Hands-Free Document Picker Trigger
      if (data.intent === "OPEN_FILE_PICKER") {
        setAwaitingVoiceFilePath(false);
        setSummary(data.text);
        if (data.audio_url) {
          playAudioFromUrl(data.audio_url);
        } else {
          speakVoiceFeedback(data.spoken_text || data.text);
        }
        setTimeout(() => {
          handleUpload();
        }, 1200);
        return;
      }

      // Handle UI Mode State Synchronization
      if (data.intent === "NAVIGATE_READER") {
        setActiveTab("home");
        setActiveMode("reader");
      } else if (data.intent === "NAVIGATE_QA" || data.intent === "QA_ANSWER") {
        setActiveTab("home");
        setActiveMode("qa");
      } else if (data.intent === "EXAM_SUMMARY" || data.intent === "NAVIGATE_NOTES") {
        setActiveTab("home");
        setActiveMode("exam");
      } else if (data.intent === "QUICK_SUMMARY") {
        setActiveTab("home");
        setActiveMode("quick");
      } else if (data.intent === "DETAILED_SUMMARY") {
        setActiveTab("home");
        setActiveMode("detailed");
      } else if (data.intent === "NAVIGATE_HELP") {
        navigation.navigate("Help");
      } else if (data.intent === "NAVIGATE_HOME") {
        setActiveTab("home");
      }

      // Document metrics sync
      if (data.document_name) {
        setIsDocUploaded(true);
        setFileName(data.document_name);
      }
      if (data.page_number) setReaderPage(data.page_number);
      if (data.paragraph_index) setReaderParagraph(data.paragraph_index);

      // Display and narrate output
      const resultText = data.text || data.spoken_text || "Task executed.";
      setSummary(resultText);
      setLastSpokenResponse(resultText);
      setAudioUrl(data.audio_url);

      if (data.audio_url) {
        playAudioFromUrl(data.audio_url);
      } else {
        speakVoiceFeedback(data.spoken_text || resultText);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Orchestrator request failed:", err);
      if (err.name === "AbortError") {
        speakVoiceFeedback("The request took too long. Please ask again or try a shorter question.");
      } else {
        speakVoiceFeedback("Could not reach backend assistant. Checking connection.");
      }
      scheduleListeningResume();
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      isProcessingCommandRef.current = false;
    }
  };

  const startListening = async (force: boolean = false) => {
    if (!force && (isSpeakingRef.current || activeSoundRef.current || isProcessingCommandRef.current)) {
      return;
    }

    try {
      if (force) {
        await stopAllAudio();
        isSpeakingRef.current = false;
        isProcessingCommandRef.current = false;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (Platform.OS === "web") {
        startWebListening(force);
        return;
      }

      const { status } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (status !== "granted") {
        speakVoiceFeedback("Microphone permission denied.");
        return;
      }

      setIsListening(true);
      ExpoSpeechRecognitionModule.start({
        lang: LANGUAGE_LOCALES[selectedLanguage] || "en-US",
        continuous: true,
        interimResults: false,
      });
    } catch (err) {
      console.error("Mic Start Error:", err);
      setIsListening(false);
    }
  };

  const stopListening = async () => {
    if (speechDebounceTimerRef.current) clearTimeout(speechDebounceTimerRef.current);
    speechAccumulatorRef.current = "";
    isProcessingCommandRef.current = false;
    setContinuousListening(false);
    continuousListeningRef.current = false;
    await handleStopAll();
  };

  // Native Speech Recognition Event Handlers with full statement accumulation
  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results[0]?.transcript || "";
    if (text.trim()) {
      handleIncomingSpeech(text.trim());
    }
  });

  useSpeechRecognitionEvent("end", () => {
    setIsListening(false);
    if (
      continuousListeningRef.current &&
      !isSpeakingRef.current &&
      !activeSoundRef.current &&
      !isProcessingCommandRef.current
    ) {
      scheduleListeningResume();
    }
  });

  return (
    <View style={styles.appRoot}>
      {/* ============================================================ */}
      {/* 1. TOP PROTOTYPE ANNOUNCEMENT BAR (Slim, Professional, Charcoal) */}
      {/* ============================================================ */}
      <View
        style={styles.announcementBar}
        accessible={true}
        accessibilityRole="header"
        accessibilityLabel="Optic AI Prototype Version Announcement"
      >
        <View style={styles.announcementContent}>
          <View style={styles.announcementIndicator} />
          <Text style={styles.announcementText}>
            <Text style={styles.announcementBrand}>OPTIC AI</Text>
            <Text style={styles.announcementDivider}> | </Text>
            <Text style={styles.announcementVersion}>PROTOTYPE VERSION</Text>
            <Text style={styles.announcementDesc}>
              {" "}
              — An AI-powered voice-based accessibility assistant.
            </Text>
          </Text>
        </View>
        <View style={styles.announcementTag}>
          <Text style={styles.announcementTagText}>Research Build</Text>
        </View>
      </View>

      {/* ============================================================ */}
      {/* 2. PROFESSIONAL TOP NAVIGATION BAR                           */}
      {/* ============================================================ */}
      <View
        style={styles.navBar}
        accessible={true}
        accessibilityRole="header"
        accessibilityLabel="Top Navigation Bar"
      >
        <View style={styles.navBrandContainer}>
          <View style={styles.navLogoGlowContainer}>
            <Image
              source={OPTIC_LOGO}
              style={styles.navLogoImage}
              resizeMode="contain"
              accessible={true}
              accessibilityLabel="Optic AI Emblem"
            />
          </View>
          <View style={styles.navBrandTextGroup}>
            <View style={styles.navBrandRow}>
              <Text style={styles.navLogo}>OPTIC</Text>
              <Text style={styles.navLogoAI}>AI</Text>
            </View>
            <Text style={styles.navTagline}>ADVANCING VISION THROUGH INTELLIGENCE</Text>
          </View>
          <View style={styles.navVoiceBadge}>
            <Text style={styles.navVoiceBadgeText}>Voice Agentic</Text>
          </View>
        </View>

        <ScrollView
          horizontal={true}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.navLinksScroll}
        >
          <TouchableOpacity
            style={[styles.navItem, activeTab === "home" && styles.navItemActive]}
            onPress={() => setActiveTab("home")}
            accessible={true}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "home" }}
            accessibilityLabel="Home Dashboard tab"
          >
            <Text
              style={[
                styles.navItemText,
                activeTab === "home" && styles.navItemTextActive,
              ]}
            >
              🏠 Home
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === "agents" && styles.navItemActive]}
            onPress={() => setActiveTab("agents")}
            accessible={true}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "agents" }}
            accessibilityLabel="Meet Our AI Agents tab"
          >
            <Text
              style={[
                styles.navItemText,
                activeTab === "agents" && styles.navItemTextActive,
              ]}
            >
              🤖 Our Agents
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === "benefits" && styles.navItemActive]}
            onPress={() => setActiveTab("benefits")}
            accessible={true}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "benefits" }}
            accessibilityLabel="Why Optic AI Benefits tab"
          >
            <Text
              style={[
                styles.navItemText,
                activeTab === "benefits" && styles.navItemTextActive,
              ]}
            >
              ✨ Benefits
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === "tech" && styles.navItemActive]}
            onPress={() => setActiveTab("tech")}
            accessible={true}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "tech" }}
            accessibilityLabel="Technology Stack tab"
          >
            <Text
              style={[
                styles.navItemText,
                activeTab === "tech" && styles.navItemTextActive,
              ]}
            >
              ⚙️ Tech Stack
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, activeTab === "about" && styles.navItemActive]}
            onPress={() => setActiveTab("about")}
            accessible={true}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "about" }}
            accessibilityLabel="About Optic AI tab"
          >
            <Text
              style={[
                styles.navItemText,
                activeTab === "about" && styles.navItemTextActive,
              ]}
            >
              ℹ️ About Optic AI
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <TouchableOpacity
          style={[
            styles.serverStatusPill,
            isServerConnected ? styles.serverPillOnline : styles.serverPillOffline,
          ]}
          onPress={() => setShowServerConfig(!showServerConfig)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Server ${isServerConnected ? "Online" : "Offline"}. Tap to configure.`}
        >
          <View
            style={[
              styles.serverDot,
              isServerConnected ? styles.serverDotOnline : styles.serverDotOffline,
            ]}
          />
          <Text style={styles.serverPillText}>
            {isServerConnected ? "API Connected" : "API Offline"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Scrollable Viewport */}
      <ScrollView
        contentContainerStyle={styles.mainScrollContent}
        accessible={true}
        accessibilityLabel="Optic AI Main Interface"
      >
        <View style={styles.centerContainer}>
          {/* ============================================================ */}
          {/* COLLAPSIBLE SERVER IP CONFIGURATION CARD                    */}
          {/* ============================================================ */}
          {showServerConfig && (
            <View style={styles.serverConfigCard}>
              <View style={styles.serverConfigHeader}>
                <Text style={styles.serverConfigTitle}>Backend Connectivity</Text>
                <TouchableOpacity onPress={() => setShowServerConfig(false)}>
                  <Text style={styles.serverConfigClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.serverConfigLabel}>FastAPI Server URL:</Text>
              <TextInput
                style={styles.serverInput}
                value={inputServerUrl}
                onChangeText={setInputServerUrl}
                placeholder="http://192.168.1.39:8000"
                placeholderTextColor="#B8BEC5"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.serverConfigButtons}>
                <TouchableOpacity
                  style={styles.btnPrimary}
                  onPress={async () => {
                    const target = inputServerUrl.trim();
                    speakVoiceFeedback(`Testing connection to ${target}`);
                    const ok = await checkServerHealth(target);
                    if (ok) {
                      setServerUrl(target);
                      speakVoiceFeedback("Connected to backend server successfully.");
                      Alert.alert("Connected", `Successfully reached ${target}`);
                    } else {
                      Alert.alert(
                        "Connection Failed",
                        `Could not reach ${target}.\nVerify phone and PC are on the same Wi-Fi.`
                      );
                    }
                  }}
                >
                  <Text style={styles.btnPrimaryText}>Test & Connect</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.btnSecondary}
                  onPress={() => {
                    setInputServerUrl(`http://${DEFAULT_HOST}`);
                    setServerUrl(`http://${DEFAULT_HOST}`);
                    checkServerHealth(`http://${DEFAULT_HOST}`);
                  }}
                >
                  <Text style={styles.btnSecondaryText}>Reset Default</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* TAB 1: MAIN DASHBOARD (HOME)                                 */}
          {/* ============================================================ */}
          {activeTab === "home" && (
            <View style={styles.tabContentBlock}>
              {/* Hero Presentation Header */}
              <View style={styles.heroSection}>
                <View style={styles.heroBadgeRow}>
                  <View style={styles.heroBrandPill}>
                    <Image
                      source={OPTIC_LOGO}
                      style={styles.heroBrandPillLogo}
                      resizeMode="contain"
                      accessible={true}
                      accessibilityLabel="Optic AI Emblem"
                    />
                    <Text style={styles.heroBrandPillText}>OPTIC AI</Text>
                  </View>
                  <View style={styles.heroPill}>
                    <Text style={styles.heroPillText}>🎙️ 100% Hands-Free Voice Assistant</Text>
                  </View>
                  <View style={styles.heroModelPill}>
                    <Text style={styles.heroModelPillText}>Gemini 2.5 + CrewAI</Text>
                  </View>
                </View>

                <Text style={styles.heroTitle}>
                  Intelligent Accessibility for <Text style={styles.textSand}>Every Learner</Text>
                </Text>
                <Text style={styles.heroSubtitle}>
                  Transform lengthy academic PDFs into structured multi-agent audio summaries,
                  page-by-page document narration, and grounded Q&A with natural Microsoft Edge Neural speech.
                </Text>
              </View>

              {/* Central Voice Interaction Command Center (The Visual Centerpiece) */}
              <View style={styles.voiceCommandCenterCard}>
                <View style={styles.voiceStatusHeader}>
                  <View style={styles.voiceStatusIndicatorGroup}>
                    <View
                      style={[
                        styles.voicePulseDot,
                        isListening && styles.voicePulseDotActive,
                      ]}
                    />
                    <Text style={styles.voiceStatusHeaderTitle}>
                      {isListening
                        ? "VOICE INTERACTION ACTIVE"
                        : "VOICE INTERACTION STANDBY"}
                    </Text>
                  </View>
                  <Text style={styles.wakeWordNotice}>Wake Word: "Hey Optic"</Text>
                </View>

                {wakeWordHeard && (
                  <View style={styles.wakeWordBanner}>
                    <Text style={styles.wakeWordBannerText}>
                      ⚡ Wake Word Detected! Listening for your command...
                    </Text>
                  </View>
                )}

                {/* Primary Voice Action Button (Electric Blue Centerpiece) */}
                <View style={styles.voiceButtonContainer}>
                  <TouchableOpacity
                    style={[
                      styles.voiceMainButton,
                      isListening && styles.voiceMainButtonListening,
                    ]}
                    onPress={async () => {
                      if (isListening) {
                        await stopListening();
                      } else {
                        if (!greetingPlayed) {
                          await playWelcomeGreeting();
                        } else {
                          setContinuousListening(true);
                          continuousListeningRef.current = true;
                          await startListening(true);
                        }
                      }
                    }}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isListening
                        ? "Microphone is listening. Tap to pause listening."
                        : "Start hands-free voice interaction."
                    }
                  >
                    <Text style={styles.voiceMainButtonIcon}>
                      {isListening ? "🎙️" : "🎤"}
                    </Text>
                    <Text style={styles.voiceMainButtonText}>
                      {isListening ? "Listening... (Tap to Pause)" : "Start Voice Assistant"}
                    </Text>
                    <Text style={styles.voiceMainButtonSubtext}>
                      {isListening
                        ? "Speak naturally. Say 'Hey Optic' anytime."
                        : "Tap to activate hands-free voice assistant"}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.voiceAuxButtonsRow}>
                    <TouchableOpacity
                      style={styles.greetingButton}
                      onPress={playWelcomeGreeting}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Play Optic AI Welcome Greeting"
                    >
                      <Text style={styles.greetingButtonText}>🔊 Play Greeting</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.stopAudioButton}
                      onPress={handleStopAll}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Instant priority stop: halts all speech and audio playback"
                    >
                      <Text style={styles.stopAudioButtonText}>⏹ Stop Speech</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Live Speech Feedback Stream */}
                <View style={styles.liveTranscriptBox}>
                  <Text style={styles.liveTranscriptLabel}>LIVE VOICE INPUT:</Text>
                  <Text style={styles.liveTranscriptText}>
                    {recognizedText
                      ? `"${recognizedText}"`
                      : isListening
                      ? "Listening for your voice... Say 'read my document', 'exam notes', or 'quick summary'..."
                      : "Voice standby. Press button above or say 'Hey Optic' to speak."}
                  </Text>
                </View>

                {/* Quick Voice Command Chips */}
                <View style={styles.quickChipsRow}>
                  <TouchableOpacity
                    style={styles.chipButton}
                    onPress={() => processCommand("Read my document")}
                  >
                    <Text style={styles.chipText}>"Read my document"</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.chipButton}
                    onPress={() => processCommand("Give me a quick summary")}
                  >
                    <Text style={styles.chipText}>"Quick summary"</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.chipButton}
                    onPress={() => processCommand("Prepare exam-oriented notes")}
                  >
                    <Text style={styles.chipText}>"Exam notes"</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.chipButton}
                    onPress={() => processCommand("Repeat the last response")}
                  >
                    <Text style={styles.chipText}>"Repeat last"</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Active Study Material Document Hub */}
              <View style={styles.documentHubCard}>
                <View style={styles.documentHubHeader}>
                  <View style={styles.docIconPill}>
                    <Text style={styles.docIconText}>📄</Text>
                  </View>
                  <View style={styles.docTitleGroup}>
                    <Text style={styles.docCardLabel}>ACTIVE STUDY DOCUMENT</Text>
                    <Text style={styles.docFileName} numberOfLines={1}>
                      {fileName}
                    </Text>
                    {docStats ? (
                      <Text style={styles.docStatsText}>{docStats}</Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.btnSecondarySmall}
                    onPress={handleUpload}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Browse device to upload PDF file"
                  >
                    <Text style={styles.btnSecondarySmallText}>Browse PDF</Text>
                  </TouchableOpacity>
                </View>

                {/* Voice File Search Notification */}
                {awaitingVoiceFilePath && (
                  <View style={styles.voiceSearchNoticeCard}>
                    <Text style={styles.voiceSearchNoticeTitle}>
                      🎙️ Spoken Document Search Active
                    </Text>
                    <Text style={styles.voiceSearchNoticeDesc}>
                      Say the file name and location (e.g. "Take cryptography from downloads folder").
                    </Text>
                    <TouchableOpacity
                      style={styles.btnCancelSearch}
                      onPress={handleStopAll}
                    >
                      <Text style={styles.btnCancelSearchText}>Cancel Search</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Feature Mode Selector (Sand & Electric Blue Controls) */}
              <View style={styles.modeSelectorCard}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Agent Mode Selection</Text>
                  <Text style={styles.sectionSubtitle}>
                    Active: <Text style={styles.textBlue}>{MODE_LABELS[activeMode]}</Text>
                  </Text>
                </View>

                <View style={styles.modesGrid}>
                  {(["quick", "detailed", "exam", "qa", "reader"] as SummaryMode[]).map(
                    (mode) => {
                      const isSelected = activeMode === mode;
                      return (
                        <TouchableOpacity
                          key={mode}
                          style={[
                            styles.modeCardBtn,
                            isSelected && styles.modeCardBtnActive,
                          ]}
                          onPress={() => handleModeSwitch(mode)}
                          accessible={true}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          accessibilityLabel={`${MODE_LABELS[mode]} button`}
                        >
                          <Text
                            style={[
                              styles.modeCardBtnText,
                              isSelected && styles.modeCardBtnTextActive,
                            ]}
                          >
                            {MODE_LABELS[mode]}
                          </Text>
                        </TouchableOpacity>
                      );
                    }
                  )}
                </View>
              </View>

              {/* Dedicated Document Reader Dashboard (Shows when Reader Mode is Active) */}
              {activeMode === "reader" && (
                <View style={styles.readerDashboardCard}>
                  <View style={styles.readerHeaderRow}>
                    <Text style={styles.readerTitle}>📖 Hands-Free Document Reader</Text>
                    <Text style={styles.readerSub}>
                      Say: "Next paragraph", "Previous", or "Read from page five"
                    </Text>
                  </View>

                  <View style={styles.readerMetricsGrid}>
                    <View style={styles.readerMetricBox}>
                      <Text style={styles.readerMetricLabel}>CURRENT PAGE</Text>
                      <Text style={styles.readerMetricNumber}>
                        {readerPage} <Text style={styles.readerMetricTotal}>/ {readerTotalPages}</Text>
                      </Text>
                    </View>

                    <View style={styles.readerMetricBox}>
                      <Text style={styles.readerMetricLabel}>PARAGRAPH</Text>
                      <Text style={styles.readerMetricNumber}>
                        {readerParagraph}{" "}
                        <Text style={styles.readerMetricTotal}>/ {readerTotalParagraphs}</Text>
                      </Text>
                    </View>
                  </View>

                  <View style={styles.readerControlsRow}>
                    <TouchableOpacity
                      style={styles.btnSecondary}
                      onPress={() => executeDocumentReaderCommand("previous")}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Read previous paragraph"
                    >
                      <Text style={styles.btnSecondaryText}>⏮ Previous</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.btnPrimary}
                      onPress={() => executeDocumentReaderCommand("read")}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Read current paragraph aloud"
                    >
                      <Text style={styles.btnPrimaryText}>▶ Read Paragraph</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.btnSecondary}
                      onPress={() => executeDocumentReaderCommand("next")}
                      accessible={true}
                      accessibilityRole="button"
                      accessibilityLabel="Read next paragraph"
                    >
                      <Text style={styles.btnSecondaryText}>⏭ Next Paragraph</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Interactive Q&A Input Box (Shows when QA Mode is Active) */}
              {activeMode === "qa" && (
                <View style={styles.qaCard}>
                  <Text style={styles.qaCardTitle}>Ask Question via Voice or Text</Text>
                  <View style={styles.qaInputRow}>
                    <TextInput
                      style={styles.qaInput}
                      value={customQuestion}
                      onChangeText={setCustomQuestion}
                      placeholder="Ask anything about your document..."
                      placeholderTextColor="#B8BEC5"
                      accessible={true}
                      accessibilityLabel="Document question input"
                      onSubmitEditing={handleAskCustomQuestion}
                    />
                    <TouchableOpacity
                      style={styles.btnPrimary}
                      onPress={handleAskCustomQuestion}
                    >
                      <Text style={styles.btnPrimaryText}>Ask Agent</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Main Analysis Output & Neural Speech Studio */}
              <View style={styles.outputStudioCard}>
                <View style={styles.outputStudioHeader}>
                  <View style={styles.outputHeaderTitleGroup}>
                    <Text style={styles.outputStudioTitle}>
                      {MODE_LABELS[activeMode]}
                    </Text>
                    <Text style={styles.outputStudioLanguageBadge}>
                      Language: {selectedLanguage}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.btnSecondarySmall}
                    onPress={() => {
                      if (activeMode === "reader") {
                        executeDocumentReaderCommand("read");
                      } else {
                        executeModeAnalysis(activeMode, selectedLanguage);
                      }
                    }}
                  >
                    <Text style={styles.btnSecondarySmallText}>🔄 Regenerate</Text>
                  </TouchableOpacity>
                </View>

                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#2563EB" />
                    <Text style={styles.loadingText}>
                      {loadingMessage || "Agent analyzing document..."}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.outputScrollViewContainer}>
                    <ScrollView
                      nestedScrollEnabled={true}
                      contentContainerStyle={styles.outputScrollContent}
                    >
                      <Text style={styles.outputBodyText}>{summary}</Text>
                    </ScrollView>
                  </View>
                )}

                {/* Multilingual Voice Translation Pills */}
                <View style={styles.multilingualStudioRow}>
                  <Text style={styles.multilingualStudioLabel}>
                    Edge Neural Speech Language:
                  </Text>
                  <View style={styles.languagePillContainer}>
                    {(
                      [
                        "English",
                        "Hindi",
                        "French",
                        "Japanese",
                        "German",
                        "Spanish",
                      ] as SupportedLanguage[]
                    ).map((lang) => {
                      const isSelected = selectedLanguage === lang;
                      return (
                        <TouchableOpacity
                          key={lang}
                          style={[
                            styles.langPill,
                            isSelected && styles.langPillActive,
                          ]}
                          onPress={() => handleGenerateMultilingual(lang)}
                        >
                          <Text
                            style={[
                              styles.langPillText,
                              isSelected && styles.langPillTextActive,
                            ]}
                          >
                            {LANGUAGE_FLAGS[lang]}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {translatingAudio && (
                    <View style={styles.translatingIndicator}>
                      <ActivityIndicator size="small" color="#2563EB" />
                      <Text style={styles.translatingText}>
                        Synthesizing Edge-TTS in {selectedLanguage}...
                      </Text>
                    </View>
                  )}
                </View>

                {/* Audio & File Action Controls */}
                <View style={styles.outputActionsRow}>
                  <TouchableOpacity
                    style={[styles.btnPrimary, styles.flex2]}
                    onPress={handlePlaySummary}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel={`Play neural audio summary in ${selectedLanguage}`}
                  >
                    <Text style={styles.btnPrimaryText}>
                      {isSpeaking ? "🔊 Playing Audio..." : "▶ Play Audio"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btnSecondary, styles.flex1]}
                    onPress={handleDownloadAudioFile}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Download audio MP3 file"
                  >
                    <Text style={styles.btnSecondaryText}>💾 MP3</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btnSecondary, styles.flex1]}
                    onPress={handleDownloadTextFile}
                    accessible={true}
                    accessibilityRole="button"
                    accessibilityLabel="Download text report file"
                  >
                    <Text style={styles.btnSecondaryText}>📄 .TXT</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* TAB 2: MEET OUR AI AGENTS SECTION                            */}
          {/* ============================================================ */}
          {activeTab === "agents" && (
            <View style={styles.tabContentBlock}>
              <View style={styles.sectionHeaderHero}>
                <View style={styles.aboutLogoBanner}>
                  <Image
                    source={OPTIC_LOGO}
                    style={styles.aboutLogoImage}
                    resizeMode="contain"
                    accessible={true}
                    accessibilityLabel="Optic AI Agents Emblem"
                  />
                </View>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>🤖 Multi-Agent Architecture</Text>
                </View>
                <Text style={styles.sectionHeroTitle}>Meet Our AI Agents</Text>
                <Text style={styles.sectionHeroSubtitle}>
                  Optic AI deploys specialized, autonomous AI agents powered by the CrewAI
                  framework and Google Gemini. Each agent handles a distinct cognitive task to make
                  educational materials fully accessible.
                </Text>
              </View>

              <View style={styles.agentsGrid}>
                {/* Agent 1 */}
                <View style={styles.agentCard}>
                  <View style={styles.agentCardHeader}>
                    <View style={styles.agentBadge}>
                      <Text style={styles.agentBadgeText}>CONCISE SUMMARIZATION</Text>
                    </View>
                    <Text style={styles.agentTitle}>⚡ Quick Summary Specialist</Text>
                  </View>
                  <Text style={styles.agentRoleLabel}>Primary Responsibility:</Text>
                  <Text style={styles.agentRoleDesc}>
                    Rapid, high-impact cognitive distillation of lengthy documents into core ideas.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Task Executed:</Text>
                  <Text style={styles.agentTaskDesc}>
                    Analyzes the full document, strips repetitive filler, extracts the primary thesis,
                    and outputs 4 to 6 critical takeaways followed by an executive bottom-line.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Accessibility Contribution:</Text>
                  <Text style={styles.agentContributionDesc}>
                    Prevents listening fatigue for visually impaired users by converting 40-page papers
                    into 2-minute crystal-clear audio overviews.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPrimarySmall}
                    onPress={() => {
                      setActiveTab("home");
                      handleModeSwitch("quick");
                    }}
                  >
                    <Text style={styles.btnPrimarySmallText}>Try Quick Summary ›</Text>
                  </TouchableOpacity>
                </View>

                {/* Agent 2 */}
                <View style={styles.agentCard}>
                  <View style={styles.agentCardHeader}>
                    <View style={styles.agentBadge}>
                      <Text style={styles.agentBadgeText}>IN-DEPTH ANALYSIS</Text>
                    </View>
                    <Text style={styles.agentTitle}>📚 Detailed Document Summarizer</Text>
                  </View>
                  <Text style={styles.agentRoleLabel}>Primary Responsibility:</Text>
                  <Text style={styles.agentRoleDesc}>
                    Exhaustive chapter-by-chapter and section-by-section analytical breakdown.
                  </Text>
                  <Text style={styles.agentTaskDesc}>
                    Creates structured sectional notes explaining technical definitions, methodologies,
                    protocols, mathematical relationships, and real-world trade-offs in clear prose.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Accessibility Contribution:</Text>
                  <Text style={styles.agentContributionDesc}>
                    Enables visually impaired researchers to digest heavy academic literature without
                    missing subtle technical nuances or core equations.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPrimarySmall}
                    onPress={() => {
                      setActiveTab("home");
                      handleModeSwitch("detailed");
                    }}
                  >
                    <Text style={styles.btnPrimarySmallText}>Try Detailed Summary ›</Text>
                  </TouchableOpacity>
                </View>

                {/* Agent 3 */}
                <View style={styles.agentCard}>
                  <View style={styles.agentCardHeader}>
                    <View style={styles.agentBadge}>
                      <Text style={styles.agentBadgeText}>EXAM REVISION</Text>
                    </View>
                    <Text style={styles.agentTitle}>🎓 Exam Notes & Revision Specialist</Text>
                  </View>
                  <Text style={styles.agentRoleLabel}>Primary Responsibility:</Text>
                  <Text style={styles.agentRoleDesc}>
                    Academic examination preparation and high-yield structured revision tools.
                  </Text>
                  <Text style={styles.agentTaskDesc}>
                    Extracts high-probability exam concepts, key definitions, formulas, and generates
                    self-testing practice questions with fully grounded model answers.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Accessibility Contribution:</Text>
                  <Text style={styles.agentContributionDesc}>
                    Provides blind university students with self-paced revision materials so they can
                    review and test their knowledge independently.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPrimarySmall}
                    onPress={() => {
                      setActiveTab("home");
                      handleModeSwitch("exam");
                    }}
                  >
                    <Text style={styles.btnPrimarySmallText}>Prepare Exam Notes ›</Text>
                  </TouchableOpacity>
                </View>

                {/* Agent 4 */}
                <View style={styles.agentCard}>
                  <View style={styles.agentCardHeader}>
                    <View style={styles.agentBadge}>
                      <Text style={styles.agentBadgeText}>GROUNDED INQUIRY</Text>
                    </View>
                    <Text style={styles.agentTitle}>💬 Document Q&A Specialist</Text>
                  </View>
                  <Text style={styles.agentRoleLabel}>Primary Responsibility:</Text>
                  <Text style={styles.agentRoleDesc}>
                    Direct natural-language inquiry with strict anti-hallucination factual grounding.
                  </Text>
                  <Text style={styles.agentTaskDesc}>
                    Retrieves exact factual context from the loaded document and formulates conversational
                    answers. Explicitly informs the user if a topic is absent rather than inventing facts.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Accessibility Contribution:</Text>
                  <Text style={styles.agentContributionDesc}>
                    Replaces tedious manual searching with instant spoken conversational inquiry across
                    entire textbooks.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPrimarySmall}
                    onPress={() => {
                      setActiveTab("home");
                      handleModeSwitch("qa");
                    }}
                  >
                    <Text style={styles.btnPrimarySmallText}>Ask Questions ›</Text>
                  </TouchableOpacity>
                </View>

                {/* Agent 5: Central Orchestrator */}
                <View style={[styles.agentCard, styles.agentCardHighlight]}>
                  <View style={styles.agentCardHeader}>
                    <View style={[styles.agentBadge, styles.agentBadgeBlue]}>
                      <Text style={styles.agentBadgeText}>CENTRAL COORDINATOR</Text>
                    </View>
                    <Text style={styles.agentTitle}>🧠 Central Voice Orchestrator Agent</Text>
                  </View>
                  <Text style={styles.agentRoleLabel}>Primary Responsibility:</Text>
                  <Text style={styles.agentRoleDesc}>
                    Central coordinator managing voice input, NLP intent classification, and Edge-TTS synthesis.
                  </Text>
                  <Text style={styles.agentTaskDesc}>
                    Listens continuously for wake words, resolves commands ("next paragraph", "quick summary"),
                    routes tasks to the appropriate CrewAI agent, and speaks results back hands-free.
                  </Text>
                  <Text style={styles.agentRoleLabel}>Accessibility Contribution:</Text>
                  <Text style={styles.agentContributionDesc}>
                    Delivers a genuine zero-touch, screenless user experience where blind users can navigate,
                    listen, and study completely by voice.
                  </Text>
                  <TouchableOpacity
                    style={styles.btnPrimarySmall}
                    onPress={() => {
                      setActiveTab("home");
                      startListening();
                    }}
                  >
                    <Text style={styles.btnPrimarySmallText}>Engage Voice Orchestrator ›</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* TAB 3: WHY OPTIC AI? (BENEFITS)                              */}
          {/* ============================================================ */}
          {activeTab === "benefits" && (
            <View style={styles.tabContentBlock}>
              <View style={styles.sectionHeaderHero}>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>✨ Accessibility Impact</Text>
                </View>
                <Text style={styles.sectionHeroTitle}>Why Optic AI?</Text>
                <Text style={styles.sectionHeroSubtitle}>
                  Traditional screen readers read entire documents monotonically without understanding
                  pedagogical importance. Optic AI combines agentic AI reasoning with hands-free neural speech.
                </Text>
              </View>

              <View style={styles.benefitsGrid}>
                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>🎙️</Text>
                  <Text style={styles.benefitCardTitle}>100% Hands-Free Voice Control</Text>
                  <Text style={styles.benefitCardDesc}>
                    Eliminates the requirement for mice, typing, or screen tapping. Wake words, speech debouncing,
                    and acoustic safety allow seamless, uninterrupted conversation.
                  </Text>
                </View>

                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>♿</Text>
                  <Text style={styles.benefitCardTitle}>JAWS & Screen Reader Compliant</Text>
                  <Text style={styles.benefitCardDesc}>
                    Every interactive element incorporates ARIA accessibility standards, polite live announcements,
                    and volume rocker button interception for push-to-talk.
                  </Text>
                </View>

                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>🛡️</Text>
                  <Text style={styles.benefitCardTitle}>Strict Anti-Hallucination Guard</Text>
                  <Text style={styles.benefitCardDesc}>
                    Powered by specialized CrewAI prompt contracts. Agents strictly ground every fact in the
                    provided PDF and honestly state when information is absent.
                  </Text>
                </View>

                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>📖</Text>
                  <Text style={styles.benefitCardTitle}>Paragraph & Page-Level Reader</Text>
                  <Text style={styles.benefitCardDesc}>
                    Jump directly to any page ("read from page five") or advance paragraph-by-paragraph with natural
                    narration, giving users total control over their reading pace.
                  </Text>
                </View>

                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>🌐</Text>
                  <Text style={styles.benefitCardTitle}>Multilingual Neural Speech</Text>
                  <Text style={styles.benefitCardDesc}>
                    Leverages Microsoft Edge Neural TTS across English, Hindi, French, Spanish, German, and
                    Japanese, providing lifelike pronunciation of complex educational concepts.
                  </Text>
                </View>

                <View style={styles.benefitCard}>
                  <Text style={styles.benefitIcon}>💾</Text>
                  <Text style={styles.benefitCardTitle}>Audio & Report Offline Exports</Text>
                  <Text style={styles.benefitCardDesc}>
                    Download synthesized MP3 audio tracks directly to device storage for offline study on mobile
                    players or export structured text reports for braille displays.
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* TAB 4: POWERED BY TECHNOLOGY (TECH STACK)                    */}
          {/* ============================================================ */}
          {activeTab === "tech" && (
            <View style={styles.tabContentBlock}>
              <View style={styles.sectionHeaderHero}>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>⚙️ Technical Architecture</Text>
                </View>
                <Text style={styles.sectionHeroTitle}>Powered By Technology</Text>
                <Text style={styles.sectionHeroSubtitle}>
                  Optic AI integrates modern frontend, backend, agentic AI, and speech synthesis
                  technologies verified in the existing codebase.
                </Text>
              </View>

              <View style={styles.techStackGrid}>
                {/* Tech 1 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>FRONTEND CLIENT</Text>
                    <Text style={styles.techTitle}>React Native & Expo SDK 54</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    Cross-platform mobile and web client written in TypeScript, featuring Expo AV for neural audio
                    playback and react-native-keyevent for physical volume button listening.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>React Native</Text>
                    <Text style={styles.techTag}>Expo SDK</Text>
                    <Text style={styles.techTag}>TypeScript</Text>
                    <Text style={styles.techTag}>Expo AV</Text>
                  </View>
                </View>

                {/* Tech 2 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>BACKEND SERVER</Text>
                    <Text style={styles.techTitle}>FastAPI & Uvicorn ASGI</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    High-performance asynchronous Python API server with dynamic Wi-Fi IP adaptation, persistent
                    JSON caching, and non-blocking background task execution.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>FastAPI</Text>
                    <Text style={styles.techTag}>Python 3.10+</Text>
                    <Text style={styles.techTag}>Uvicorn</Text>
                    <Text style={styles.techTag}>Asyncio</Text>
                  </View>
                </View>

                {/* Tech 3 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>AGENTIC AI FRAMEWORK</Text>
                    <Text style={styles.techTitle}>CrewAI Multi-Agent System</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    Autonomous multi-agent orchestration framework assigning distinct roles, backstories, memory
                    constraints, and task contracts to specialized AI specialists.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>CrewAI</Text>
                    <Text style={styles.techTag}>Agent Personas</Text>
                    <Text style={styles.techTag}>Task Contracts</Text>
                  </View>
                </View>

                {/* Tech 4 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>FOUNDATION LLM</Text>
                    <Text style={styles.techTitle}>Google Gemini 2.5 Flash</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    State-of-the-art multimodal reasoning engine providing high-speed token generation, long-context
                    document comprehension, and accurate multilingual translation.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>Gemini 2.5 Flash</Text>
                    <Text style={styles.techTag}>Google GenAI</Text>
                    <Text style={styles.techTag}>1M Context</Text>
                  </View>
                </View>

                {/* Tech 5 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>VOICE & SPEECH</Text>
                    <Text style={styles.techTitle}>Microsoft Edge Neural TTS</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    Neural speech synthesis service providing realistic voices across 40+ languages (Christopher,
                    Swara, Alvaro, Henri, Conrad, Keita) with fallback to gTTS and Web Speech API recognition.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>Edge-TTS</Text>
                    <Text style={styles.techTag}>Web Speech API</Text>
                    <Text style={styles.techTag}>Expo Speech</Text>
                  </View>
                </View>

                {/* Tech 6 */}
                <View style={styles.techCard}>
                  <View style={styles.techCardHeader}>
                    <Text style={styles.techCategoryBadge}>DOCUMENT INTELLIGENCE</Text>
                    <Text style={styles.techTitle}>PyPDF Document Parser</Text>
                  </View>
                  <Text style={styles.techDesc}>
                    Accessible binary PDF extraction engine segmenting raw files into page chunks and
                    narration-friendly paragraphs, supporting voice-driven filesystem search.
                  </Text>
                  <View style={styles.techTagsRow}>
                    <Text style={styles.techTag}>PyPDF</Text>
                    <Text style={styles.techTag}>Chunking Engine</Text>
                    <Text style={styles.techTag}>Vector Cache</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* TAB 5: ABOUT OPTIC AI (PURPOSE, VISION & CAPSTONE)           */}
          {/* ============================================================ */}
          {activeTab === "about" && (
            <View style={styles.tabContentBlock}>
              <View style={styles.sectionHeaderHero}>
                <View style={styles.heroPill}>
                  <Text style={styles.heroPillText}>ℹ️ Project Overview</Text>
                </View>
                <Text style={styles.sectionHeroTitle}>About Optic AI</Text>
                <Text style={styles.sectionHeroSubtitle}>
                  Equalizing access to educational knowledge through hands-free conversational AI.
                </Text>
              </View>

              <View style={styles.aboutCard}>
                <View style={styles.aboutLogoBanner}>
                  <Image
                    source={OPTIC_LOGO}
                    style={styles.aboutLogoImage}
                    resizeMode="contain"
                    accessible={true}
                    accessibilityLabel="Optic AI Personalized Logo"
                  />
                </View>
                <Text style={styles.aboutCardTitle}>Our Purpose & Vision</Text>
                <Text style={styles.aboutCardText}>
                  The world is full of knowledge, but access is unequal. Visually impaired students and researchers
                  face tremendous barriers when attempting to read lengthy technical documents, textbooks, and
                  academic research. Traditional screen readers lack semantic comprehension and cannot summarize,
                  prioritize exam content, or answer ad-hoc questions.
                </Text>
                <Text style={styles.aboutCardText}>
                  Optic AI bridges this gap by marrying agentic AI intelligence with lifelike neural speech and
                  a 100% hands-free voice interface. Users can upload study materials by simply saying the file name,
                  listen to paragraph-by-paragraph narrations, generate exam revision guides, and engage in continuous
                  conversational inquiry without ever touching a keyboard.
                </Text>

                <View style={styles.aboutDivider} />

                <Text style={styles.aboutCardTitle}>Core Target Users</Text>
                <View style={styles.aboutAudienceGrid}>
                  <View style={styles.audienceItem}>
                    <Text style={styles.audienceBullet}>•</Text>
                    <Text style={styles.audienceText}>
                      <Text style={styles.textSandBold}>Blind & Low-Vision Students:</Text> Independent study,
                      exam preparation, and hands-free textbook comprehension.
                    </Text>
                  </View>
                  <View style={styles.audienceItem}>
                    <Text style={styles.audienceBullet}>•</Text>
                    <Text style={styles.audienceText}>
                      <Text style={styles.textSandBold}>Auditory & Multitasking Learners:</Text> Listening to
                      summaries on the move via high-quality neural voice synthesis.
                    </Text>
                  </View>
                  <View style={styles.audienceItem}>
                    <Text style={styles.audienceBullet}>•</Text>
                    <Text style={styles.audienceText}>
                      <Text style={styles.textSandBold}>Academic Researchers:</Text> Rapidly extracting key
                      takeaways from dense, multi-page scientific papers.
                    </Text>
                  </View>
                </View>

                <View style={styles.aboutDivider} />

                <View style={styles.aboutFooterRow}>
                  <Text style={styles.aboutFooterBadge}>Final Year Capstone Project</Text>
                  <Text style={styles.aboutFooterText}>Engineered for Accessibility & Real-World Impact</Text>
                </View>
              </View>
            </View>
          )}

          {/* ============================================================ */}
          {/* PROFESSIONAL FOOTER (65% Charcoal, 25% Sand, 10% Blue)      */}
          {/* ============================================================ */}
          <View style={styles.appFooter}>
            <View style={styles.footerTopRow}>
              <View>
                <Text style={styles.footerLogo}>
                  OPTIC <Text style={styles.textBlue}>AI</Text>
                </Text>
                <Text style={styles.footerTagline}>
                  Accessible Agentic Knowledge & Voice Synthesis Platform
                </Text>
              </View>

              <View style={styles.footerLinksRow}>
                <TouchableOpacity onPress={() => setActiveTab("home")}>
                  <Text style={styles.footerLink}>Dashboard</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTab("agents")}>
                  <Text style={styles.footerLink}>AI Agents</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTab("benefits")}>
                  <Text style={styles.footerLink}>Benefits</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTab("tech")}>
                  <Text style={styles.footerLink}>Tech Stack</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setActiveTab("about")}>
                  <Text style={styles.footerLink}>About</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.footerDivider} />

            <View style={styles.footerBottomRow}>
              <Text style={styles.footerCopyright}>
                © 2026 Optic AI Project. Dedicated to Accessible Education for Visually Impaired Learners.
              </Text>
              <Text style={styles.footerVersion}>Prototype v2.5 • CrewAI + Edge-TTS</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  // Root and Layout Containers (65% Charcoal Theme: #252A30)
  appRoot: {
    flex: 1,
    backgroundColor: "#252A30",
  },
  mainScrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  centerContainer: {
    width: "100%",
    maxWidth: 1100,
    alignSelf: "center",
    paddingHorizontal: 16,
  },
  tabContentBlock: {
    width: "100%",
    marginTop: 10,
  },

  // Color Utility Helpers
  textSand: {
    color: "#D8C7A5",
  },
  textSandBold: {
    color: "#D8C7A5",
    fontWeight: "bold",
  },
  textBlue: {
    color: "#2563EB",
  },
  flex1: {
    flex: 1,
  },
  flex2: {
    flex: 2,
  },

  // 1. Top Prototype Announcement Bar
  announcementBar: {
    backgroundColor: "#202428",
    paddingVertical: 7,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(216, 199, 165, 0.2)",
  },
  announcementContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  announcementIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#2563EB",
    marginRight: 10,
  },
  announcementText: {
    fontSize: 12,
    color: "#B8BEC5",
  },
  announcementBrand: {
    color: "#D8C7A5",
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  announcementDivider: {
    color: "rgba(216, 199, 165, 0.4)",
  },
  announcementVersion: {
    color: "#F8F8F5",
    fontWeight: "600",
  },
  announcementDesc: {
    color: "#B8BEC5",
  },
  announcementTag: {
    backgroundColor: "rgba(216, 199, 165, 0.12)",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
  },
  announcementTagText: {
    color: "#D8C7A5",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },

  // 2. Professional Top Navigation Bar
  navBar: {
    backgroundColor: "#252A30",
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(216, 199, 165, 0.25)",
  },
  navBrandContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
  },
  navLogoGlowContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "#2563EB",
    backgroundColor: "#1E2227",
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  navLogoImage: {
    width: 38,
    height: 38,
  },
  navBrandTextGroup: {
    marginRight: 10,
  },
  navBrandRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  navTagline: {
    fontSize: 9,
    color: "#D8C7A5",
    fontWeight: "600",
    letterSpacing: 0.3,
    marginTop: 1,
  },
  navLogo: {
    fontSize: 18,
    fontWeight: "900",
    color: "#F8F8F5",
    letterSpacing: 1,
  },
  navLogoAI: {
    fontSize: 18,
    fontWeight: "900",
    color: "#2563EB",
    letterSpacing: 1,
    marginLeft: 3,
  },
  navVoiceBadge: {
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 12,
    marginLeft: 4,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.3)",
  },
  navVoiceBadgeText: {
    color: "#60A5FA",
    fontSize: 10,
    fontWeight: "bold",
  },
  navLinksScroll: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
  },
  navItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginHorizontal: 3,
  },
  navItemActive: {
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    borderBottomWidth: 2,
    borderBottomColor: "#2563EB",
  },
  navItemText: {
    color: "#D8C7A5",
    fontSize: 13,
    fontWeight: "600",
  },
  navItemTextActive: {
    color: "#F8F8F5",
    fontWeight: "bold",
  },
  serverStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  serverPillOnline: {
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    borderColor: "#2563EB",
  },
  serverPillOffline: {
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    borderColor: "#EF4444",
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  serverDotOnline: {
    backgroundColor: "#3B82F6",
  },
  serverDotOffline: {
    backgroundColor: "#EF4444",
  },
  serverPillText: {
    color: "#F8F8F5",
    fontSize: 11,
    fontWeight: "600",
  },

  // Hero Section
  heroSection: {
    alignItems: "center",
    paddingVertical: 18,
    marginBottom: 10,
  },
  heroBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  heroBrandPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.4)",
  },
  heroBrandPillLogo: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 6,
  },
  heroBrandPillText: {
    color: "#60A5FA",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.8,
  },
  heroPill: {
    backgroundColor: "rgba(216, 199, 165, 0.12)",
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginRight: 8,
  },
  heroPillText: {
    color: "#D8C7A5",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 0.3,
  },
  heroModelPill: {
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  heroModelPillText: {
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "600",
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: "#F8F8F5",
    textAlign: "center",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 15,
    color: "#B8BEC5",
    textAlign: "center",
    maxWidth: 720,
    lineHeight: 22,
  },

  // Central Voice Command Center Card (Visual Centerpiece: 10% Blue, 25% Sand, 65% Charcoal)
  voiceCommandCenterCard: {
    backgroundColor: "#343A40",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: "#D8C7A5",
    marginBottom: 18,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  voiceStatusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(216, 199, 165, 0.2)",
    paddingBottom: 8,
  },
  voiceStatusIndicatorGroup: {
    flexDirection: "row",
    alignItems: "center",
  },
  voicePulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#B8BEC5",
    marginRight: 8,
  },
  voicePulseDotActive: {
    backgroundColor: "#2563EB",
    shadowColor: "#3B82F6",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
  },
  voiceStatusHeaderTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#D8C7A5",
    letterSpacing: 0.8,
  },
  wakeWordNotice: {
    fontSize: 11,
    color: "#B8BEC5",
    fontStyle: "italic",
  },
  wakeWordBanner: {
    backgroundColor: "rgba(37, 99, 235, 0.2)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2563EB",
    marginBottom: 14,
    alignItems: "center",
  },
  wakeWordBannerText: {
    color: "#F8F8F5",
    fontSize: 13,
    fontWeight: "bold",
  },
  voiceButtonContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  voiceMainButton: {
    flex: 3,
    backgroundColor: "#2563EB",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    marginRight: 10,
    borderWidth: 1,
    borderColor: "#3B82F6",
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  voiceMainButtonListening: {
    backgroundColor: "#1D4ED8",
    borderColor: "#60A5FA",
  },
  voiceMainButtonIcon: {
    fontSize: 26,
    marginBottom: 4,
  },
  voiceMainButtonText: {
    color: "#F8F8F5",
    fontSize: 17,
    fontWeight: "bold",
    letterSpacing: 0.3,
  },
  voiceMainButtonSubtext: {
    color: "#E8DDC8",
    fontSize: 11,
    marginTop: 3,
  },
  stopAudioButton: {
    backgroundColor: "#252A30",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.4)",
  },
  stopAudioButtonText: {
    color: "#D8C7A5",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },
  voiceAuxButtonsRow: {
    flex: 1,
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 8,
  },
  greetingButton: {
    backgroundColor: "#343A40",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D8C7A5",
  },
  greetingButtonText: {
    color: "#E8DDC8",
    fontSize: 13,
    fontWeight: "bold",
    textAlign: "center",
  },
  liveTranscriptBox: {
    backgroundColor: "#252A30",
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
    marginBottom: 12,
  },
  liveTranscriptLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#D8C7A5",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  liveTranscriptText: {
    fontSize: 14,
    color: "#F8F8F5",
    fontStyle: "italic",
    lineHeight: 20,
  },
  quickChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  chipButton: {
    backgroundColor: "rgba(216, 199, 165, 0.08)",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: {
    color: "#D8C7A5",
    fontSize: 11,
    fontWeight: "600",
  },

  // Document Hub Card
  documentHubCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginBottom: 16,
  },
  documentHubHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  docIconPill: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(216, 199, 165, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginRight: 12,
  },
  docIconText: {
    fontSize: 22,
  },
  docTitleGroup: {
    flex: 1,
    marginRight: 10,
  },
  docCardLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#D8C7A5",
    letterSpacing: 0.8,
  },
  docFileName: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginTop: 2,
  },
  docStatsText: {
    fontSize: 12,
    color: "#B8BEC5",
    marginTop: 2,
  },
  voiceSearchNoticeCard: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    borderWidth: 1,
    borderColor: "#2563EB",
  },
  voiceSearchNoticeTitle: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginBottom: 2,
  },
  voiceSearchNoticeDesc: {
    fontSize: 12,
    color: "#E8DDC8",
    marginBottom: 8,
  },
  btnCancelSearch: {
    alignSelf: "flex-start",
    backgroundColor: "#252A30",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#D8C7A5",
  },
  btnCancelSearchText: {
    color: "#D8C7A5",
    fontSize: 11,
    fontWeight: "bold",
  },

  // Mode Selector Card
  modeSelectorCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginBottom: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#F8F8F5",
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#B8BEC5",
  },
  modesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  modeCardBtn: {
    width: "48%",
    backgroundColor: "#252A30",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
    alignItems: "center",
  },
  modeCardBtnActive: {
    backgroundColor: "#252A30",
    borderColor: "#2563EB",
    borderWidth: 2,
  },
  modeCardBtnText: {
    color: "#D8C7A5",
    fontSize: 13,
    fontWeight: "600",
  },
  modeCardBtnTextActive: {
    color: "#F8F8F5",
    fontWeight: "bold",
  },

  // Document Reader Dashboard
  readerDashboardCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#D8C7A5",
    marginBottom: 16,
  },
  readerHeaderRow: {
    marginBottom: 12,
  },
  readerTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#F8F8F5",
  },
  readerSub: {
    fontSize: 12,
    color: "#B8BEC5",
    marginTop: 2,
  },
  readerMetricsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  readerMetricBox: {
    flex: 1,
    backgroundColor: "#252A30",
    padding: 12,
    borderRadius: 8,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
    alignItems: "center",
  },
  readerMetricLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#D8C7A5",
    letterSpacing: 0.8,
  },
  readerMetricNumber: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginTop: 4,
  },
  readerMetricTotal: {
    fontSize: 13,
    color: "#B8BEC5",
  },
  readerControlsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  // Q&A Card
  qaCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#D8C7A5",
    marginBottom: 16,
  },
  qaCardTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginBottom: 8,
  },
  qaInputRow: {
    flexDirection: "row",
  },
  qaInput: {
    flex: 1,
    backgroundColor: "#252A30",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#F8F8F5",
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginRight: 8,
    fontSize: 14,
  },

  // Output Studio Card
  outputStudioCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#D8C7A5",
    marginBottom: 20,
  },
  outputStudioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(216, 199, 165, 0.2)",
    paddingBottom: 8,
  },
  outputHeaderTitleGroup: {
    flex: 1,
  },
  outputStudioTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#F8F8F5",
  },
  outputStudioLanguageBadge: {
    fontSize: 11,
    color: "#D8C7A5",
    marginTop: 2,
  },
  outputScrollViewContainer: {
    maxHeight: 340,
    backgroundColor: "#252A30",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
  },
  outputScrollContent: {
    paddingBottom: 12,
  },
  outputBodyText: {
    color: "#F8F8F5",
    fontSize: 15,
    lineHeight: 24,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    color: "#D8C7A5",
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
  },
  multilingualStudioRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(216, 199, 165, 0.2)",
  },
  multilingualStudioLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#D8C7A5",
    marginBottom: 8,
  },
  languagePillContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  langPill: {
    backgroundColor: "#252A30",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginRight: 6,
    marginBottom: 6,
  },
  langPillActive: {
    backgroundColor: "rgba(37, 99, 235, 0.2)",
    borderColor: "#2563EB",
  },
  langPillText: {
    color: "#D8C7A5",
    fontSize: 12,
    fontWeight: "600",
  },
  langPillTextActive: {
    color: "#F8F8F5",
    fontWeight: "bold",
  },
  translatingIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  translatingText: {
    color: "#60A5FA",
    fontSize: 12,
    marginLeft: 6,
  },
  outputActionsRow: {
    flexDirection: "row",
    marginTop: 14,
  },

  // Standard Button Hierarchy (10% Blue, 25% Sand, 65% Charcoal)
  btnPrimary: {
    backgroundColor: "#2563EB",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#3B82F6",
  },
  btnPrimaryText: {
    color: "#F8F8F5",
    fontSize: 13,
    fontWeight: "bold",
  },
  btnPrimarySmall: {
    backgroundColor: "#2563EB",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginTop: 10,
  },
  btnPrimarySmallText: {
    color: "#F8F8F5",
    fontSize: 12,
    fontWeight: "bold",
  },
  btnSecondary: {
    backgroundColor: "#252A30",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.4)",
    marginHorizontal: 4,
  },
  btnSecondaryText: {
    color: "#D8C7A5",
    fontSize: 13,
    fontWeight: "600",
  },
  btnSecondarySmall: {
    backgroundColor: "#252A30",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.35)",
  },
  btnSecondarySmallText: {
    color: "#D8C7A5",
    fontSize: 11,
    fontWeight: "bold",
  },

  // Section Hero Presentation Layout (For Agents, Benefits, Tech, About tabs)
  sectionHeaderHero: {
    alignItems: "center",
    textAlign: "center",
    paddingVertical: 20,
    marginBottom: 10,
  },
  sectionHeroTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#F8F8F5",
    marginTop: 8,
    textAlign: "center",
  },
  sectionHeroSubtitle: {
    fontSize: 14,
    color: "#B8BEC5",
    textAlign: "center",
    maxWidth: 680,
    marginTop: 6,
    lineHeight: 21,
  },

  // Section 4: Our Agents Grid
  agentsGrid: {
    flexDirection: "column",
  },
  agentCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "rgba(216, 199, 165, 0.35)",
  },
  agentCardHighlight: {
    borderColor: "#2563EB",
    backgroundColor: "#2B3037",
  },
  agentCardHeader: {
    marginBottom: 10,
  },
  agentBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(216, 199, 165, 0.12)",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginBottom: 6,
  },
  agentBadgeBlue: {
    backgroundColor: "rgba(37, 99, 235, 0.2)",
    borderColor: "#2563EB",
  },
  agentBadgeText: {
    color: "#D8C7A5",
    fontSize: 10,
    fontWeight: "bold",
    letterSpacing: 0.5,
  },
  agentTitle: {
    fontSize: 19,
    fontWeight: "bold",
    color: "#F8F8F5",
  },
  agentRoleLabel: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#D8C7A5",
    marginTop: 8,
    letterSpacing: 0.5,
  },
  agentRoleDesc: {
    fontSize: 13,
    color: "#F8F8F5",
    marginTop: 2,
    lineHeight: 18,
  },
  agentTaskDesc: {
    fontSize: 13,
    color: "#B8BEC5",
    marginTop: 2,
    lineHeight: 18,
  },
  agentContributionDesc: {
    fontSize: 13,
    color: "#E8DDC8",
    marginTop: 2,
    lineHeight: 18,
    fontStyle: "italic",
  },

  // Section 5: Benefits Grid
  benefitsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  benefitCard: {
    width: "48%",
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
  },
  benefitIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  benefitCardTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginBottom: 6,
  },
  benefitCardDesc: {
    fontSize: 12,
    color: "#B8BEC5",
    lineHeight: 18,
  },

  // Section 6: Technology Stack Grid
  techStackGrid: {
    flexDirection: "column",
  },
  techCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
  },
  techCardHeader: {
    marginBottom: 6,
  },
  techCategoryBadge: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#D8C7A5",
    letterSpacing: 0.8,
  },
  techTitle: {
    fontSize: 17,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginTop: 2,
  },
  techDesc: {
    fontSize: 13,
    color: "#B8BEC5",
    lineHeight: 19,
    marginVertical: 8,
  },
  techTagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  techTag: {
    backgroundColor: "#252A30",
    color: "#D8C7A5",
    fontSize: 11,
    fontWeight: "600",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
    marginRight: 6,
    marginTop: 4,
  },

  // Section 7: About Optic AI
  aboutLogoBanner: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#1E2227",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.25)",
  },
  aboutLogoImage: {
    width: "100%",
    maxWidth: 380,
    height: 110,
  },
  aboutCard: {
    backgroundColor: "#343A40",
    borderRadius: 14,
    padding: 24,
    borderWidth: 1.5,
    borderColor: "#D8C7A5",
    marginBottom: 20,
  },
  aboutCardTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#F8F8F5",
    marginBottom: 10,
  },
  aboutCardText: {
    fontSize: 14,
    color: "#B8BEC5",
    lineHeight: 22,
    marginBottom: 12,
  },
  aboutDivider: {
    height: 1,
    backgroundColor: "rgba(216, 199, 165, 0.2)",
    marginVertical: 16,
  },
  aboutAudienceGrid: {
    marginTop: 6,
  },
  audienceItem: {
    flexDirection: "row",
    marginBottom: 10,
  },
  audienceBullet: {
    color: "#2563EB",
    fontSize: 16,
    marginRight: 8,
  },
  audienceText: {
    flex: 1,
    color: "#B8BEC5",
    fontSize: 13,
    lineHeight: 19,
  },
  aboutFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  aboutFooterBadge: {
    backgroundColor: "rgba(37, 99, 235, 0.15)",
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "bold",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.3)",
  },
  aboutFooterText: {
    color: "#D8C7A5",
    fontSize: 12,
    fontStyle: "italic",
  },

  // Collapsible Server Configuration Card
  serverConfigCard: {
    backgroundColor: "#343A40",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#2563EB",
    marginVertical: 10,
  },
  serverConfigHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  serverConfigTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#F8F8F5",
  },
  serverConfigClose: {
    fontSize: 16,
    color: "#B8BEC5",
    padding: 4,
  },
  serverConfigLabel: {
    fontSize: 12,
    color: "#D8C7A5",
    marginBottom: 6,
  },
  serverInput: {
    backgroundColor: "#252A30",
    color: "#F8F8F5",
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.3)",
    marginBottom: 10,
  },
  serverConfigButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },

  // Application Footer
  appFooter: {
    backgroundColor: "#202428",
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(216, 199, 165, 0.2)",
    marginTop: 20,
  },
  footerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    marginBottom: 16,
  },
  footerLogo: {
    fontSize: 18,
    fontWeight: "900",
    color: "#F8F8F5",
    letterSpacing: 0.5,
  },
  footerTagline: {
    fontSize: 12,
    color: "#B8BEC5",
    marginTop: 2,
  },
  footerLinksRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  footerLink: {
    color: "#D8C7A5",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 14,
  },
  footerDivider: {
    height: 1,
    backgroundColor: "rgba(216, 199, 165, 0.15)",
    marginBottom: 14,
  },
  footerBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
  },
  footerCopyright: {
    color: "#B8BEC5",
    fontSize: 11,
  },
  footerVersion: {
    color: "#D8C7A5",
    fontSize: 11,
    fontWeight: "600",
  },
});

export default MainScreen;
