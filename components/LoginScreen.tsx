import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  AccessibilityInfo,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Speech from "expo-speech";
import { RootStackParamList } from "../App";

type LoginScreenNavigationProp = NativeStackNavigationProp<RootStackParamList, "Login">;

const LoginScreen = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = () => {
    if (!email || !password) {
      const msg = "Please enter your email and password to proceed.";
      AccessibilityInfo.announceForAccessibility(msg);
      Speech.speak(msg);
      Alert.alert("Missing Fields", msg);
      return;
    }
    const welcomeMsg = `Welcome ${name || "User"} to Optic AI.`;
    AccessibilityInfo.announceForAccessibility(welcomeMsg);
    Speech.speak(welcomeMsg);
    navigation.navigate("Main");
  };

  const handleSignup = () => {
    const msg = "Continuing as guest to main screen.";
    AccessibilityInfo.announceForAccessibility(msg);
    Speech.speak(msg);
    navigation.navigate("Main");
  };

  return (
    <LinearGradient colors={["#004e92", "#000428"]} style={styles.gradient}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          accessible={true}
          accessibilityLabel="Optic AI Login and Welcome Screen"
        >
          <Text
            style={styles.header}
            accessible={true}
            accessibilityRole="header"
            accessibilityLabel="Optic AI"
          >
            Optic AI
          </Text>

          <View
            style={styles.introBox}
            accessible={true}
            accessibilityRole="summary"
            accessibilityLabel="The world is full of knowledge, but access is unequal. This application empowers visually impaired users by transforming lengthy content into accessible summaries and Q&A with Edge TTS audio and complete voice navigation."
          >
            <Text style={styles.introHeading}>
              THE WORLD IS FULL OF KNOWLEDGE, BUT ACCESS IS UNEQUAL
            </Text>
            <Text style={styles.introText}>
              This application empowers visually impaired users and enhances
              productivity by transforming study materials into accessible audio summaries.
              Use complete hands-free voice control or physical volume buttons to navigate.
            </Text>
          </View>

          <TextInput
            style={styles.input}
            placeholder="Name (Optional)"
            placeholderTextColor="#90e0ef"
            value={name}
            onChangeText={setName}
            accessible={true}
            accessibilityLabel="Name input"
            accessibilityHint="Optional. Enter your name."
          />
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#90e0ef"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            accessible={true}
            accessibilityLabel="Email address input"
            accessibilityHint="Enter your email address."
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#90e0ef"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            accessible={true}
            accessibilityLabel="Password input"
            accessibilityHint="Enter your password."
          />

          <TouchableOpacity
            style={styles.buttonPrimary}
            onPress={handleLogin}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Log In"
            accessibilityHint="Double tap to log into Optic AI"
          >
            <Text style={styles.buttonPrimaryText}>Log In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.buttonSecondary}
            onPress={handleSignup}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Continue as Guest or Sign Up"
            accessibilityHint="Double tap to skip and proceed to main assistant"
          >
            <Text style={styles.buttonSecondaryText}>Continue to Assistant</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  header: {
    fontSize: 38,
    color: "#fff",
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  introBox: {
    backgroundColor: "#00204a",
    borderRadius: 12,
    padding: 16,
    marginBottom: 25,
    width: "100%",
    borderWidth: 1,
    borderColor: "#0077b6",
  },
  introHeading: {
    color: "#90e0ef",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
    textTransform: "uppercase",
    textAlign: "center",
  },
  introText: {
    color: "#d0d0d0",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "justify",
  },
  input: {
    backgroundColor: "#001a35",
    color: "#fff",
    borderRadius: 8,
    padding: 15,
    width: "100%",
    marginVertical: 8,
    fontSize: 16,
    borderWidth: 1,
    borderColor: "#023e8a",
  },
  buttonPrimary: {
    backgroundColor: "#48cae4",
    borderRadius: 10,
    padding: 16,
    width: "100%",
    marginTop: 18,
    alignItems: "center",
  },
  buttonPrimaryText: {
    color: "#03045e",
    fontSize: 18,
    fontWeight: "bold",
  },
  buttonSecondary: {
    backgroundColor: "#0077b6",
    borderRadius: 10,
    padding: 16,
    width: "100%",
    marginTop: 10,
    alignItems: "center",
  },
  buttonSecondaryText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default LoginScreen;
