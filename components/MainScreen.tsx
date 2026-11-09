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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as DocumentPicker from "expo-document-picker";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RootStackParamList } from "../App";

// Current Wi-Fi IP of host PC: 192.168.1.39
const DEFAULT_HOST = "192.168.1.39:8000";
const INITIAL_BACKEND_BASE =
  Platform.OS === "web"
    ? typeof window !== "undefined" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1"
      ? `http://${window.location.hostname}:8000`
      : "http://localhost:8000"
    : `http://${DEFAULT_HOST}`;

export type SummaryMode = "quick" | "detailed" | "exam" | "qa" | "reader";
export type SupportedLanguage = "English" | "Hindi" | "French" | "Japanese" | "German" | "Spanish";

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

    if (Platform.OS === "web" && typeof window !== "undefined" && (window as any).speechSynthesis) {
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

  // Schedule automatic listening resume with acoustic safety buffer
  const scheduleListeningResume = () => {
    if (!continuousListeningRef.current) return;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);

    restartTimerRef.current = setTimeout(() => {
      if (continuousListeningRef.current && !isSpeakingRef.current && !activeSoundRef.current) {
        startListening();
      }
    }, 450);
  };

  // Safe voice output with guaranteed single-voice sequencing
  const speakVoiceFeedback = async (message: string) => {
    await stopAllAudio();
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    Speech.speak(message, {
      language: LANGUAGE_LOCALES[selectedLanguage] || "en-US",
      onDone: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        scheduleListeningResume();
      },
      onStopped: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      },
      onError: () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        scheduleListeningResume();
      },
    });
    console.log(`[Optic-AI Voice Feedback]: ${message}`);
  };

  // Startup Welcome Greeting: Welcomes user and immediately initiates hands-free listening loop
  useEffect(() => {
    if (!hasWelcomedRef.current) {
      hasWelcomedRef.current = true;
      const welcomeTimer = setTimeout(async () => {
        await stopAllAudio();
        const welcome =
          "Welcome to Optic AI. I am your hands-free voice assistant. Tell me the document you want to upload, or you can say: read my document, next paragraph, quick summary, detailed summary, exam notes, or ask any question. How can I help you today?";
        setSummary(welcome);
        setLastSpokenResponse(welcome);
        await speakVoiceFeedback(welcome);
      }, 1000);
      return () => clearTimeout(welcomeTimer);
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
    Speech.speak("Stopped.", { language: "en-US" });
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
  const executeDocumentReaderCommand = async (action: "read" | "next" | "previous", pageNum?: number) => {
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
          await FileSystem.writeAsStringAsync(path, summary, { encoding: FileSystem.EncodingType.UTF8 });
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
          const destination = `${FileSystem.documentDirectory || FileSystem.cacheDirectory}${filename}`;
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
  const startWebListening = () => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      speakVoiceFeedback("Speech recognition not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    if (isSpeakingRef.current || activeSoundRef.current) return;

    try {
      if (webRecognitionRef.current) {
        try {
          webRecognitionRef.current.abort();
        } catch (e) {}
      }

      const recognition = new SpeechRecognition();
      recognition.lang = LANGUAGE_LOCALES[selectedLanguage] || "en-US";
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let fullTranscript = "";
        for (let i = 0; i < event.results.length; i++) {
          fullTranscript += event.results[i][0].transcript + " ";
        }
        fullTranscript = fullTranscript.trim();
        if (fullTranscript) {
          handleIncomingSpeech(fullTranscript);
        }
      };

      recognition.onerror = (err: any) => {
        console.log("Web Speech error:", err?.error);
        if (err?.error === "no-speech") {
          // Normal silence, keep waiting for speech
          return;
        }
        setIsListening(false);
        if (err?.error !== "aborted" && !isProcessingCommandRef.current && !isSpeakingRef.current) {
          scheduleListeningResume();
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        if (continuousListeningRef.current && !isSpeakingRef.current && !activeSoundRef.current && !isProcessingCommandRef.current) {
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

  // Unified Speech Accumulator & Silence Debouncer:
  // Allows user to finish their full statement/question comfortably without getting cut off!
  const handleIncomingSpeech = (transcript: string) => {
    if (isProcessingCommandRef.current || isSpeakingRef.current) return;

    const trimmed = transcript.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();

    // Priority STOP commands execute immediately (0ms debounce)
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
      if (speechDebounceTimerRef.current) clearTimeout(speechDebounceTimerRef.current);
      speechAccumulatorRef.current = "";
      handleStopAll();
      return;
    }

    // Accumulate the spoken statement and display live transcription
    speechAccumulatorRef.current = trimmed;
    setRecognizedText(trimmed);

    // Reset silence timer on every new speech chunk
    if (speechDebounceTimerRef.current) {
      clearTimeout(speechDebounceTimerRef.current);
    }

    // Natural conversation pause: waits 1.8 seconds of complete silence before executing
    const SILENCE_TIMEOUT = 1800;
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
    // 2. Awaiting file name/path from previous voice query
    // ============================================================
    if (awaitingVoiceFilePath) {
      isProcessingCommandRef.current = false;
      await fetchLocalFile(command);
      return;
    }

    // ============================================================
    // 3. Central Intelligent Voice Coordinator (Backend Agent Router)
    // ============================================================
    await stopAllAudio();
    setLoading(true);
    setLoadingMessage(`Optic AI processing: "${command}"...`);

    // Strict 25s timeout safeguard prevents any hanging
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 25000);

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

      // Prompt for File Path
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

      // Handle UI Mode State Synchronization
      if (data.intent === "NAVIGATE_READER") {
        setActiveMode("reader");
      } else if (data.intent === "NAVIGATE_QA" || data.intent === "QA_ANSWER") {
        setActiveMode("qa");
      } else if (data.intent === "EXAM_SUMMARY" || data.intent === "NAVIGATE_NOTES") {
        setActiveMode("exam");
      } else if (data.intent === "QUICK_SUMMARY") {
        setActiveMode("quick");
      } else if (data.intent === "DETAILED_SUMMARY") {
        setActiveMode("detailed");
      } else if (data.intent === "NAVIGATE_HELP") {
        navigation.navigate("Help");
      } else if (data.intent === "NAVIGATE_HOME") {
        navigation.navigate("Main");
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

  const startListening = async () => {
    if (isSpeakingRef.current || activeSoundRef.current || isProcessingCommandRef.current) {
      return;
    }

    try {
      await stopAllAudio();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (Platform.OS === "web") {
        startWebListening();
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
    if (continuousListeningRef.current && !isSpeakingRef.current && !activeSoundRef.current && !isProcessingCommandRef.current) {
      scheduleListeningResume();
    }
  });

  return (
    <LinearGradient colors={["#014f86", "#001845"]} style={styles.gradient}>
      <ScrollView
        contentContainerStyle={styles.container}
        accessible={true}
        accessibilityLabel="Optic AI Hands-Free Voice Assistant Workspace"
      >
        <Text
          style={styles.header}
          accessible={true}
          accessibilityRole="header"
          accessibilityLabel="Optic AI. Hands-Free Voice Assistant for Visually Impaired Users."
        >
          Optic AI
        </Text>

        {/* Central Hands-Free Voice Status Banner */}
        <View
          style={[
            styles.voiceStatusBar,
            isListening ? styles.voiceStatusListening : styles.voiceStatusIdle,
          ]}
          accessible={true}
          accessibilityLiveRegion="polite"
          accessibilityLabel={
            isListening
              ? "Microphone is actively listening for your voice commands. Say 'Hey Optic' followed by your instruction."
              : "Voice assistant idle. Say 'Hey Optic' or tap to speak."
          }
        >
          <Text style={styles.voiceStatusTitle}>
            {isListening ? "🎙️ Continuously Listening" : "💤 Voice Standby"}
          </Text>
          <Text style={styles.voiceStatusSubtitle}>
            {wakeWordHeard
              ? "⚡ Wake Word Detected! Processing..."
              : isListening
              ? "Say 'Hey Optic' followed by: read my document, next paragraph, or exam notes"
              : "Continuous listening is paused. Say 'Hey Optic' or tap below to resume."}
          </Text>
        </View>

        {/* Server Status Header Bar */}
        <TouchableOpacity
          style={[styles.serverStatusBar, isServerConnected ? styles.serverOnline : styles.serverOffline]}
          onPress={() => setShowServerConfig(!showServerConfig)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Server status: ${isServerConnected ? "Online" : "Offline"}. Connected to ${serverUrl}. Tap to change IP.`}
        >
          <Text style={styles.serverStatusText}>
            {isServerConnected ? "🟢 Server Online" : "🔴 Server Offline (Tap to Configure IP)"}
          </Text>
          <Text style={styles.serverSubText}>
            Host: {serverUrl} (Phone Wi-Fi IP: 192.168.1.39:8000)
          </Text>
        </TouchableOpacity>

        {/* Collapsible IP Configuration */}
        {showServerConfig && (
          <View style={styles.serverConfigCard}>
            <Text style={styles.serverConfigLabel}>Backend Server URL (Phone Wi-Fi IP):</Text>
            <TextInput
              style={styles.serverInput}
              value={inputServerUrl}
              onChangeText={setInputServerUrl}
              placeholder="http://192.168.1.39:8000"
              placeholderTextColor="#90e0ef"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.serverConfigButtons}>
              <TouchableOpacity
                style={styles.testServerButton}
                onPress={async () => {
                  const target = inputServerUrl.trim();
                  speakVoiceFeedback(`Testing connection to ${target}`);
                  const ok = await checkServerHealth(target);
                  if (ok) {
                    setServerUrl(target);
                    speakVoiceFeedback("Connected to backend server successfully.");
                    Alert.alert("Connected", `Successfully reached ${target}`);
                  } else {
                    Alert.alert("Connection Failed", `Could not reach ${target}.\nVerify phone and PC are on the same Wi-Fi.`);
                  }
                }}
              >
                <Text style={styles.serverButtonText}>Test & Connect</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.resetServerButton}
                onPress={() => {
                  setInputServerUrl(`http://${DEFAULT_HOST}`);
                  setServerUrl(`http://${DEFAULT_HOST}`);
                  checkServerHealth(`http://${DEFAULT_HOST}`);
                }}
              >
                <Text style={styles.serverButtonText}>Reset to 192.168.1.39</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Document Ingestion & Status Banner */}
        <TouchableOpacity
          style={[styles.uploadBox, isDocUploaded && styles.uploadBoxReady]}
          onPress={handleUpload}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Document: ${fileName}. ${docStats || "Say 'upload document' to load a file."}`}
        >
          <Text style={styles.uploadTitle}>
            {isDocUploaded ? "📄 Active Study Material" : "📄 No Document Loaded"}
          </Text>
          <Text style={styles.uploadFile}>{fileName}</Text>
          {docStats ? <Text style={styles.uploadStats}>{docStats}</Text> : null}
        </TouchableOpacity>

        {/* Voice-based Document Search Card */}
        {awaitingVoiceFilePath && (
          <View
            style={styles.voicePromptCard}
            accessible={true}
            accessibilityLiveRegion="assertive"
            accessibilityLabel="Voice Search Active. Please speak the file name and location."
          >
            <Text style={styles.voicePromptTitle}>🎙️ Voice Document Fetch</Text>
            <Text style={styles.voicePromptSubtitle}>
              State the file name or location (e.g. "Post Quantum Cryptography in Downloads").
            </Text>
            <TouchableOpacity
              style={styles.voicePromptCancelBtn}
              onPress={handleStopAll}
            >
              <Text style={styles.voicePromptCancelText}>Cancel Voice Search</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Dedicated Document Reader Dashboard (Visible when reader mode is active) */}
        {activeMode === "reader" && (
          <View
            style={styles.readerDashboardCard}
            accessible={true}
            accessibilityRole="summary"
            accessibilityLabel={`Document Reader: Page ${readerPage} of ${readerTotalPages}, Paragraph ${readerParagraph} of ${readerTotalParagraphs}`}
          >
            <Text style={styles.readerDashboardTitle}>📖 Document Reader Navigation</Text>
            <View style={styles.readerMetricsRow}>
              <View style={styles.readerMetricBadge}>
                <Text style={styles.readerMetricLabel}>PAGE</Text>
                <Text style={styles.readerMetricValue}>
                  {readerPage} / {readerTotalPages}
                </Text>
              </View>
              <View style={styles.readerMetricBadge}>
                <Text style={styles.readerMetricLabel}>PARAGRAPH</Text>
                <Text style={styles.readerMetricValue}>
                  {readerParagraph} / {readerTotalParagraphs}
                </Text>
              </View>
            </View>
            <View style={styles.readerControlButtonsRow}>
              <TouchableOpacity
                style={styles.readerNavBtn}
                onPress={() => executeDocumentReaderCommand("previous")}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Read previous paragraph"
              >
                <Text style={styles.readerNavBtnText}>⏮ Previous</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.readerNavBtn, styles.readerNavBtnPrimary]}
                onPress={() => executeDocumentReaderCommand("read")}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Read current paragraph"
              >
                <Text style={styles.readerNavBtnText}>▶ Read</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.readerNavBtn}
                onPress={() => executeDocumentReaderCommand("next")}
                accessible={true}
                accessibilityRole="button"
                accessibilityLabel="Read next paragraph"
              >
                <Text style={styles.readerNavBtnText}>⏭ Next</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Mode Selector Tabs (Quick, Detailed, Exam, QA, Reader) */}
        <View
          style={styles.modeContainer}
          accessible={true}
          accessibilityRole="radiogroup"
          accessibilityLabel="Select Feature Mode"
        >
          {(["quick", "detailed", "exam", "qa", "reader"] as SummaryMode[]).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[styles.modeButton, activeMode === mode && styles.modeButtonActive]}
              onPress={() => handleModeSwitch(mode)}
              accessible={true}
              accessibilityRole="radio"
              accessibilityState={{ selected: activeMode === mode }}
              accessibilityLabel={`${MODE_LABELS[mode]} button`}
            >
              <Text style={[styles.modeButtonText, activeMode === mode && styles.modeButtonTextActive]}>
                {MODE_LABELS[mode]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Interactive Q&A Input Box (Appears when QA Mode is active) */}
        {activeMode === "qa" && (
          <View style={styles.qaInputContainer}>
            <TextInput
              style={styles.qaTextInput}
              value={customQuestion}
              onChangeText={setCustomQuestion}
              placeholder="Ask any question about this document..."
              placeholderTextColor="#90e0ef"
              accessible={true}
              accessibilityLabel="Question input"
              onSubmitEditing={handleAskCustomQuestion}
            />
            <TouchableOpacity
              style={styles.qaSubmitButton}
              onPress={handleAskCustomQuestion}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Submit question"
            >
              <Text style={styles.qaSubmitButtonText}>🔍 Ask</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Main Output Content Display Card */}
        <View
          style={styles.summaryBox}
          accessible={true}
          accessibilityLiveRegion="assertive"
          accessibilityLabel={`Output: ${summary}`}
        >
          <View style={styles.summaryHeaderRow}>
            <Text style={styles.summaryHeader}>{MODE_LABELS[activeMode]}</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={() => {
                if (activeMode === "reader") {
                  executeDocumentReaderCommand("read");
                } else {
                  executeModeAnalysis(activeMode, selectedLanguage);
                }
              }}
            >
              <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#48cae4" />
              <Text style={styles.loadingText}>{loadingMessage || "Agent analyzing document..."}</Text>
            </View>
          ) : (
            <View style={{ maxHeight: 340 }}>
              <ScrollView nestedScrollEnabled={true} contentContainerStyle={{ paddingBottom: 15 }}>
                <Text style={styles.summaryText}>{summary}</Text>
              </ScrollView>
            </View>
          )}
        </View>

        {/* Multilingual Audio & Text Export Section */}
        <View
          style={styles.multilingualSection}
          accessible={true}
          accessibilityRole="summary"
          accessibilityLabel="Multilingual Audio and Text Export Section"
        >
          <Text style={styles.multiSectionTitle}>
            🌐 Multilingual Edge Neural Speech
          </Text>
          <Text style={styles.multiSectionSubtitle}>
            Translate & synthesize speech in:
          </Text>

          {/* Language Selection Pills */}
          <View style={styles.languagePillsContainer}>
            {(["English", "Hindi", "French", "Japanese", "German", "Spanish"] as SupportedLanguage[]).map(
              (lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[
                    styles.langPill,
                    selectedLanguage === lang && styles.langPillActive,
                  ]}
                  onPress={() => handleGenerateMultilingual(lang)}
                  accessible={true}
                  accessibilityRole="button"
                  accessibilityLabel={`Generate output in ${lang}`}
                >
                  <Text
                    style={[
                      styles.langPillText,
                      selectedLanguage === lang && styles.langPillTextActive,
                    ]}
                  >
                    {LANGUAGE_FLAGS[lang]}
                  </Text>
                </TouchableOpacity>
              )
            )}
          </View>

          {translatingAudio && (
            <View style={styles.translatingIndicator}>
              <ActivityIndicator size="small" color="#48cae4" />
              <Text style={styles.translatingText}>
                Synthesizing Edge-TTS voice in {selectedLanguage}...
              </Text>
            </View>
          )}

          {/* Audio & Text Download Controls */}
          <View style={styles.actionButtonsGrid}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.playBtn]}
              onPress={handlePlaySummary}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={`Play audio in ${selectedLanguage}`}
            >
              <Text style={styles.actionBtnText}>
                {isSpeaking ? "🔊 Playing Audio" : "▶ Play Audio"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.downloadAudioBtn]}
              onPress={handleDownloadAudioFile}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Download Audio MP3 file"
            >
              <Text style={styles.actionBtnText}>💾 Download MP3</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.downloadTextBtn]}
              onPress={handleDownloadTextFile}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Download Text Report file"
            >
              <Text style={styles.actionBtnText}>📄 Download .TXT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Voice & Instant Stop Action Controls Bar */}
        <View style={styles.micControls}>
          <TouchableOpacity
            style={[styles.startButton, isListening && styles.listeningActive]}
            onPress={() => {
              setContinuousListening(true);
              continuousListeningRef.current = true;
              startListening();
            }}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel={isListening ? "Microphone active. Listening." : "Start Voice Command"}
          >
            <Text style={styles.micControlText}>
              🎤 {isListening ? "Listening..." : "Enable Voice"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stopButton}
            onPress={handleStopAll}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Instant stop: halts audio and listening"
          >
            <Text style={styles.micControlText}>⏹ Stop</Text>
          </TouchableOpacity>
        </View>

        {/* Spoken Voice Transcription Display */}
        {recognizedText ? (
          <Text
            style={styles.recognizedText}
            accessible={true}
            accessibilityLabel={`Voice recognized: ${recognizedText}`}
          >
            Heard: "{recognizedText}"
          </Text>
        ) : null}
      </ScrollView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flexGrow: 1,
    padding: 18,
    alignItems: "center",
  },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
    marginTop: 12,
    letterSpacing: 1,
  },
  voiceStatusBar: {
    width: "100%",
    padding: 14,
    borderRadius: 14,
    marginVertical: 10,
    alignItems: "center",
    borderWidth: 2,
  },
  voiceStatusListening: {
    backgroundColor: "rgba(0, 180, 216, 0.25)",
    borderColor: "#00b4d8",
  },
  voiceStatusIdle: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  voiceStatusTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#caf0f8",
    marginBottom: 4,
  },
  voiceStatusSubtitle: {
    fontSize: 13,
    color: "#e0f2fe",
    textAlign: "center",
    lineHeight: 18,
  },
  serverStatusBar: {
    width: "100%",
    padding: 10,
    borderRadius: 10,
    marginBottom: 12,
    alignItems: "center",
  },
  serverOnline: {
    backgroundColor: "#0077b6",
  },
  serverOffline: {
    backgroundColor: "#d90429",
  },
  serverStatusText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 14,
  },
  serverSubText: {
    color: "#caf0f8",
    fontSize: 11,
    marginTop: 2,
  },
  serverConfigCard: {
    width: "100%",
    backgroundColor: "#002855",
    padding: 14,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  serverConfigLabel: {
    color: "#caf0f8",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  serverInput: {
    backgroundColor: "#001845",
    color: "#ffffff",
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#0077b6",
    marginBottom: 10,
  },
  serverConfigButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  testServerButton: {
    backgroundColor: "#0077b6",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flex: 1,
    marginRight: 6,
    alignItems: "center",
  },
  resetServerButton: {
    backgroundColor: "#023e8a",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flex: 1,
    marginLeft: 6,
    alignItems: "center",
  },
  serverButtonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  uploadBox: {
    width: "100%",
    backgroundColor: "#002855",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#0077b6",
  },
  uploadBoxReady: {
    borderColor: "#48cae4",
    backgroundColor: "#023e8a",
  },
  uploadTitle: {
    color: "#caf0f8",
    fontSize: 16,
    fontWeight: "bold",
  },
  uploadFile: {
    color: "#ffffff",
    fontSize: 14,
    marginTop: 4,
    fontWeight: "600",
  },
  uploadStats: {
    color: "#90e0ef",
    fontSize: 12,
    marginTop: 4,
  },
  voicePromptCard: {
    width: "100%",
    backgroundColor: "#d90429",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#ff4d6d",
    alignItems: "center",
  },
  voicePromptTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 6,
  },
  voicePromptSubtitle: {
    color: "#fff0f3",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 10,
  },
  voicePromptCancelBtn: {
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  voicePromptCancelText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "bold",
  },
  readerDashboardCard: {
    width: "100%",
    backgroundColor: "#023e8a",
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#48cae4",
  },
  readerDashboardTitle: {
    color: "#caf0f8",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  readerMetricsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 12,
  },
  readerMetricBadge: {
    backgroundColor: "#001845",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  readerMetricLabel: {
    color: "#90e0ef",
    fontSize: 10,
    fontWeight: "bold",
  },
  readerMetricValue: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 2,
  },
  readerControlButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  readerNavBtn: {
    backgroundColor: "#0077b6",
    flex: 1,
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    alignItems: "center",
  },
  readerNavBtnPrimary: {
    backgroundColor: "#00b4d8",
  },
  readerNavBtnText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 13,
  },
  modeContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
    marginBottom: 12,
  },
  modeButton: {
    backgroundColor: "#002855",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginVertical: 4,
    width: "48%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  modeButtonActive: {
    backgroundColor: "#00b4d8",
    borderColor: "#caf0f8",
  },
  modeButtonText: {
    color: "#caf0f8",
    fontSize: 12,
    fontWeight: "600",
  },
  modeButtonTextActive: {
    color: "#001845",
    fontWeight: "bold",
  },
  qaInputContainer: {
    width: "100%",
    flexDirection: "row",
    marginBottom: 12,
  },
  qaTextInput: {
    flex: 1,
    backgroundColor: "#002855",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: "#ffffff",
    borderWidth: 1,
    borderColor: "#0077b6",
    marginRight: 8,
    fontSize: 14,
  },
  qaSubmitButton: {
    backgroundColor: "#00b4d8",
    paddingHorizontal: 18,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  qaSubmitButtonText: {
    color: "#001845",
    fontWeight: "bold",
    fontSize: 14,
  },
  summaryBox: {
    width: "100%",
    backgroundColor: "#001845",
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  summaryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#002855",
    paddingBottom: 6,
  },
  summaryHeader: {
    color: "#48cae4",
    fontSize: 16,
    fontWeight: "bold",
  },
  refreshButton: {
    backgroundColor: "#002855",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  refreshButtonText: {
    color: "#90e0ef",
    fontSize: 12,
  },
  summaryText: {
    color: "#ffffff",
    fontSize: 15,
    lineHeight: 22,
  },
  loadingContainer: {
    paddingVertical: 35,
    alignItems: "center",
  },
  loadingText: {
    color: "#caf0f8",
    marginTop: 12,
    fontSize: 14,
  },
  multilingualSection: {
    width: "100%",
    backgroundColor: "#002855",
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  multiSectionTitle: {
    color: "#caf0f8",
    fontSize: 16,
    fontWeight: "bold",
    textAlign: "center",
  },
  multiSectionSubtitle: {
    color: "#90e0ef",
    fontSize: 12,
    textAlign: "center",
    marginTop: 3,
    marginBottom: 12,
  },
  languagePillsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    marginBottom: 12,
  },
  langPill: {
    backgroundColor: "#001845",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    margin: 4,
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  langPillActive: {
    backgroundColor: "#00b4d8",
    borderColor: "#ffffff",
  },
  langPillText: {
    color: "#caf0f8",
    fontSize: 12,
    fontWeight: "600",
  },
  langPillTextActive: {
    color: "#001845",
    fontWeight: "bold",
  },
  translatingIndicator: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
  translatingText: {
    color: "#48cae4",
    fontSize: 12,
    marginLeft: 8,
  },
  actionButtonsGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    marginHorizontal: 3,
    alignItems: "center",
  },
  playBtn: {
    backgroundColor: "#00b4d8",
  },
  downloadAudioBtn: {
    backgroundColor: "#0077b6",
  },
  downloadTextBtn: {
    backgroundColor: "#023e8a",
  },
  actionBtnText: {
    color: "#ffffff",
    fontWeight: "bold",
    fontSize: 11,
  },
  micControls: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  startButton: {
    flex: 2,
    backgroundColor: "#0077b6",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    marginRight: 8,
  },
  listeningActive: {
    backgroundColor: "#d90429",
  },
  stopButton: {
    flex: 1,
    backgroundColor: "#d90429",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  micControlText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  recognizedText: {
    color: "#caf0f8",
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 14,
  },
});

export default MainScreen;
