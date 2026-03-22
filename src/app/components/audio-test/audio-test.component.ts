// src/app/components/audio-test/audio-test.component.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

// Speech Recognition interface
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

@Component({
  selector: 'app-audio-test',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './audio-test.component.html',
  styleUrls: ['./audio-test.component.css']
})
export class AudioTestComponent implements OnInit, OnDestroy {
  
  // Test states
  currentStep: number = 1;
  totalSteps: number = 4;
  
  // Audio test results
  speakerTestPassed: boolean = false;
  microphoneTestPassed: boolean = false;
  speechRecognitionTestPassed: boolean = false;
  allTestsPassed: boolean = false;
  
  // Audio objects
  speechSynthesis: SpeechSynthesis;
  speechRecognition: any;
  
  // Test states
  isSpeaking: boolean = false;
  isListening: boolean = false;
  isProcessing: boolean = false;
  
  // Debug mode
  debugMode: boolean = false;
  
  // Test data
  testPhrase: string = "Hello, this is a microphone test. Can you hear me clearly?";
  capturedSpeech: string = '';
  selectedLanguage: string = 'en-US';
  
  // Available languages for testing
  availableLanguages = [
    { code: 'en-US', name: 'English (US)', testPhrase: 'Hello, this is a microphone test' },
    { code: 'de-DE', name: 'German (Germany)', testPhrase: 'Hallo, das ist ein Mikrofon-Test' },
    { code: 'es-ES', name: 'Spanish (Spain)', testPhrase: 'Hola, esta es una prueba de micrófono' },
    { code: 'fr-FR', name: 'French (France)', testPhrase: 'Bonjour, ceci est un test de microphone' }
  ];
  
  // Test messages
  testMessages: string[] = [];
  
  constructor(private router: Router) {
    this.speechSynthesis = window.speechSynthesis;
  }

  ngOnInit(): void {
    this.initializeSpeechRecognition();
    this.updateTestPhrase();
    
    // Enable debug mode if URL contains debug parameter
    const urlParams = new URLSearchParams(window.location.search);
    this.debugMode = urlParams.has('debug');
    
    if (this.debugMode) {
      this.addTestMessage('🔧 Debug mode enabled');
      this.addTestMessage(`🌐 User Agent: ${navigator.userAgent}`);
      this.addTestMessage(`🎤 Speech Recognition: ${this.speechRecognition ? 'Available' : 'Not Available'}`);
    }
  }

  ngOnDestroy(): void {
    this.stopAllTests();
  }

  // Initialize speech recognition
  initializeSpeechRecognition(): void {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.speechRecognition = new SpeechRecognition();
      
      this.speechRecognition.continuous = false;
      this.speechRecognition.interimResults = false;
      this.speechRecognition.lang = this.selectedLanguage;
      
      this.speechRecognition.onstart = () => {
        this.isListening = true;
        this.addTestMessage('🎤 Listening for your voice...');
        this.addTestMessage('💡 Speak clearly and loudly');
      };
      
      this.speechRecognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        const confidence = event.results[0][0].confidence || 0.8; // Default confidence if not provided
        
        this.capturedSpeech = transcript;
        this.isListening = false;
        this.isProcessing = true;
        
        this.addTestMessage(`🎤 Captured: "${transcript}"`);
        this.addTestMessage(`📊 Confidence: ${Math.round(confidence * 100)}%`);
        
        // More lenient confidence check
        if (confidence > 0.5 || transcript.trim().length > 0) {
          this.speechRecognitionTestPassed = true;
          this.addTestMessage('✅ Speech recognition test passed!');
          this.speakConfirmation(`Great! I heard you say: ${transcript}. Your microphone is working perfectly!`);
        } else {
          this.addTestMessage('⚠️ Speech recognition confidence is low. Please try speaking more clearly.');
          this.addTestMessage('🔄 You can try again or proceed manually below');
        }
        
        this.isProcessing = false;
        this.checkAllTests();
      };
      
      this.speechRecognition.onerror = (event: any) => {
        this.isListening = false;
        this.isProcessing = false;
        
        let errorMessage = '';
        let suggestion = '';
        
        switch (event.error) {
          case 'no-speech':
            errorMessage = 'No speech detected';
            suggestion = 'Try speaking louder or closer to the microphone';
            break;
          case 'audio-capture':
            errorMessage = 'Microphone not accessible';
            suggestion = 'Check if another app is using your microphone';
            break;
          case 'not-allowed':
            errorMessage = 'Microphone permission denied';
            suggestion = 'Please allow microphone access in your browser settings';
            break;
          case 'network':
            errorMessage = 'Network error';
            suggestion = 'Check your internet connection';
            break;
          case 'aborted':
            errorMessage = 'Speech recognition was stopped';
            suggestion = 'You can try again';
            break;
          default:
            errorMessage = `Speech recognition error: ${event.error}`;
            suggestion = 'Try refreshing the page or using a different browser';
        }
        
        this.addTestMessage(`❌ ${errorMessage}`);
        this.addTestMessage(`💡 ${suggestion}`);
        this.showSpeechRecognitionFallback();
      };
      
      this.speechRecognition.onend = () => {
        this.isListening = false;
      };
    } else {
      this.addTestMessage('❌ Speech recognition not supported in this browser');
    }
  }

  // Update test phrase based on selected language
  updateTestPhrase(): void {
    const language = this.availableLanguages.find(lang => lang.code === this.selectedLanguage);
    if (language) {
      this.testPhrase = language.testPhrase;
      if (this.speechRecognition) {
        this.speechRecognition.lang = this.selectedLanguage;
      }
    }
  }

  // Step 1: Test speakers
  testSpeakers(): void {
    this.currentStep = 1;
    this.isSpeaking = true;
    this.addTestMessage('🔊 Testing speakers...');
    
    // Ensure voices are loaded
    this.loadVoicesAndSpeak();
  }

  // Load voices and speak test message
  loadVoicesAndSpeak(): void {
    const speakTestMessage = () => {
      const utterance = new SpeechSynthesisUtterance(
        'Hello! This is a speaker test. If you can hear this message clearly, your speakers are working properly. Please click the button below to confirm.'
      );
      
      // Configure voice
      const voices = this.speechSynthesis.getVoices();
      if (voices.length > 0) {
        const voice = voices.find(v => v.lang.startsWith(this.selectedLanguage.split('-')[0]));
        if (voice) {
          utterance.voice = voice;
        }
      }
      
      utterance.lang = this.selectedLanguage;
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 1;
      
      utterance.onstart = () => {
        this.isSpeaking = true;
        this.addTestMessage('🔊 Audio is playing...');
      };
      
      utterance.onend = () => {
        this.isSpeaking = false;
        this.addTestMessage('🔊 Speaker test completed. Did you hear the message clearly?');
      };
      
      utterance.onerror = (error) => {
        console.error('Speech synthesis error:', error);
        this.isSpeaking = false;
        this.addTestMessage('❌ Speaker test failed. Please check your audio settings.');
      };
      
      // Add a safety timeout in case onend doesn't fire
      setTimeout(() => {
        if (this.isSpeaking) {
          this.isSpeaking = false;
          this.addTestMessage('🔊 Speaker test completed. Did you hear the message clearly?');
        }
      }, 8000); // 8 seconds timeout
      
      this.speechSynthesis.speak(utterance);
    };

    // Check if voices are already loaded
    const voices = this.speechSynthesis.getVoices();
    if (voices.length > 0) {
      speakTestMessage();
    } else {
      // Wait for voices to load
      this.speechSynthesis.onvoiceschanged = () => {
        speakTestMessage();
      };
      
      // Fallback timeout in case voices never load
      setTimeout(() => {
        if (this.isSpeaking) {
          speakTestMessage();
        }
      }, 2000);
    }
  }

  // Confirm speaker test
  confirmSpeakerTest(passed: boolean): void {
    // Stop any ongoing speech
    this.speechSynthesis.cancel();
    this.isSpeaking = false;
    
    this.speakerTestPassed = passed;
    if (passed) {
      this.addTestMessage('✅ Speaker test passed!');
      this.currentStep = 2;
    } else {
      this.addTestMessage('❌ Speaker test failed. Please check your speakers and try again.');
    }
    this.checkAllTests();
  }

  // Skip speaker test (fallback option)
  skipSpeakerTest(): void {
    this.speechSynthesis.cancel();
    this.isSpeaking = false;
    this.addTestMessage('⏭️ Speaker test skipped. Proceeding to microphone test.');
    this.speakerTestPassed = true; // Assume it works
    this.currentStep = 2;
    this.checkAllTests();
  }

  // Step 2: Test microphone permissions
  testMicrophonePermissions(): void {
    this.currentStep = 2;
    this.addTestMessage('🎤 Testing microphone permissions...');
    
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((stream) => {
        this.addTestMessage('✅ Microphone permission granted!');
        this.microphoneTestPassed = true;
        this.currentStep = 3;
        
        // Stop the stream
        stream.getTracks().forEach(track => track.stop());
        this.checkAllTests();
      })
      .catch((error) => {
        this.addTestMessage(`❌ Microphone permission denied: ${error.message}`);
        this.microphoneTestPassed = false;
      });
  }

  // Step 3: Test speech recognition
  testSpeechRecognition(): void {
    this.currentStep = 3;
    this.capturedSpeech = '';
    this.speechRecognitionTestPassed = false;
    this.isListening = false;
    this.isProcessing = false;
    
    this.addTestMessage(`🎤 Please say: "${this.testPhrase}"`);
    this.addTestMessage(`🔧 Language set to: ${this.selectedLanguage}`);
    
    if (this.speechRecognition) {
      try {
        // Update language before starting
        this.speechRecognition.lang = this.selectedLanguage;
        
        // Add a timeout to prevent infinite listening
        const timeoutId = setTimeout(() => {
          if (this.isListening) {
            this.speechRecognition.stop();
            this.addTestMessage('⏰ Speech recognition timed out after 10 seconds');
            this.addTestMessage('💡 Try speaking louder or closer to the microphone');
          }
        }, 10000); // 10 second timeout
        
        // Clear timeout when recognition ends
        const originalOnEnd = this.speechRecognition.onend;
        this.speechRecognition.onend = () => {
          clearTimeout(timeoutId);
          this.isListening = false;
          if (originalOnEnd) originalOnEnd();
        };
        
        this.speechRecognition.start();
      } catch (error) {
        this.addTestMessage(`❌ Failed to start speech recognition: ${error}`);
        this.showSpeechRecognitionFallback();
      }
    } else {
      this.addTestMessage('❌ Speech recognition not available');
      this.showSpeechRecognitionFallback();
    }
  }

  // Show fallback options for speech recognition
  showSpeechRecognitionFallback(): void {
    this.addTestMessage('🔄 You can still proceed with the following options:');
    this.isListening = false;
    this.isProcessing = false;
  }

  // Manual confirmation for speech recognition
  confirmSpeechRecognition(worked: boolean): void {
    if (worked) {
      this.speechRecognitionTestPassed = true;
      this.addTestMessage('✅ Speech recognition confirmed as working!');
    } else {
      this.speechRecognitionTestPassed = false;
      this.addTestMessage('⚠️ Speech recognition marked as not working');
    }
    this.checkAllTests();
  }

  // Skip speech recognition test
  skipSpeechRecognition(): void {
    this.speechRecognitionTestPassed = true; // Assume it works for progression
    this.addTestMessage('⏭️ Speech recognition test skipped');
    this.isListening = false;
    this.isProcessing = false;
    this.checkAllTests();
  }

  // Retry speech recognition
  retrySpeechRecognition(): void {
    this.addTestMessage('🔄 Retrying speech recognition...');
    this.testSpeechRecognition();
  }

  // Speak confirmation message
  speakConfirmation(message: string): void {
    const utterance = new SpeechSynthesisUtterance(message);
    
    const voices = this.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.startsWith(this.selectedLanguage.split('-')[0]));
    if (voice) {
      utterance.voice = voice;
    }
    
    utterance.lang = this.selectedLanguage;
    utterance.rate = 0.9;
    
    this.speechSynthesis.speak(utterance);
  }

  // Check if all tests passed
  checkAllTests(): void {
    this.allTestsPassed = this.speakerTestPassed && this.microphoneTestPassed && this.speechRecognitionTestPassed;
    
    if (this.allTestsPassed) {
      this.currentStep = 4;
      this.addTestMessage('🎉 All audio tests passed! You\'re ready for voice-enabled learning!');
      this.speakConfirmation('Excellent! All your audio equipment is working perfectly. You can now enjoy voice-enabled language learning sessions.');
    }
  }

  // Add message to test log
  addTestMessage(message: string): void {
    this.testMessages.push(`${new Date().toLocaleTimeString()}: ${message}`);
  }

  // Reset all tests
  resetTests(): void {
    this.currentStep = 1;
    this.speakerTestPassed = false;
    this.microphoneTestPassed = false;
    this.speechRecognitionTestPassed = false;
    this.allTestsPassed = false;
    this.capturedSpeech = '';
    this.testMessages = [];
    this.stopAllTests();
  }

  // Stop all ongoing tests
  stopAllTests(): void {
    this.speechSynthesis.cancel();
    if (this.speechRecognition && this.isListening) {
      this.speechRecognition.stop();
    }
    this.isSpeaking = false;
    this.isListening = false;
    this.isProcessing = false;
  }

  // Navigate to learning modules
  goToLearningModules(): void {
    this.router.navigate(['/learning-modules']);
  }

  // Navigate back to dashboard
  goToDashboard(): void {
    this.router.navigate(['/student-progress']);
  }
}