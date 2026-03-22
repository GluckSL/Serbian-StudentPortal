// src/app/components/ai-tutor-chat/ai-tutor-chat.component.ts

import { Component, OnInit, OnDestroy, ViewChild, ElementRef, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AiTutorService, TutorMessage } from '../../services/ai-tutor.service';
import { LearningModulesService } from '../../services/learning-modules.service';
import { SubscriptionGuardService } from '../../services/subscription-guard.service';
import { Subscription } from 'rxjs';
import { timeout, take } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

// Speech Recognition interface
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

@Component({
  selector: 'app-ai-tutor-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-tutor-chat.component.html',
  styleUrls: ['./ai-tutor-chat.component.css']
})
export class AiTutorChatComponent implements OnInit, OnDestroy {
  @ViewChild('messagesContainer') private messagesContainer!: ElementRef;
  
  moduleId: string = '';
  module: any = null;
  sessionId: string = '';
  sessionType: string = 'practice';
  sessionActive: boolean = false;
  sessionStartTime: Date | null = null;
  isTeacherTestMode: boolean = false; // Track if this is a teacher testing session
  
  // Auto-refresh mechanism
  private autoRefreshInterval: any;
  private autoRefreshCount: number = 0;
  private maxAutoRefreshAttempts: number = 100; // Prevent infinite refresh
  
  // Local message storage to ensure persistence
  private localMessages: TutorMessage[] = [];
  
  messages: TutorMessage[] = [];
  currentMessage: string = '';
  isLoading: boolean = false;
  isSending: boolean = false;
  
  suggestions: string[] = [];
  currentExercise: any = null;
  exerciseAnswer: string = '';
  
  sessionStats = {
    totalMessages: 0,
    correctAnswers: 0,
    incorrectAnswers: 0,
    sessionScore: 0,
    conversationScore: 0, // New: Points for conversation participation
    totalScore: 0 // New: Combined score
  };
  
  // Speech processing state
  isProcessingSpeech: boolean = false;
  
  // Speech accumulation across auto-restarts
  private speechAccumulating: boolean = false; // Track if accumulating speech across restarts
  private previousMessage: string = ''; // Store message from before auto-restart
  
  // Enhanced mobile detection
  private isFirstDetection = true;
  microphoneMode: 'auto' | 'mobile' | 'desktop' = 'auto'; // User preference
  
  // Transcript visibility control
  showTranscript: boolean = true;
  transcriptMode: 'full' | 'minimal' | 'hidden' = 'full';
  
  // Dual subtitle system - English and Native Language
  showEnglishSubtitles: boolean = false;
  showNativeSubtitles: boolean = false;
  englishSubtitleCache: Map<string, string> = new Map(); // Cache English translations
  nativeSubtitleCache: Map<string, string> = new Map(); // Cache native language translations
  isTranslating: boolean = false;
  private messagesBeingTranslated: Set<string> = new Set(); // Track messages being translated
  
  // Legacy support (deprecated)
  get showSubtitles(): boolean {
    return this.showEnglishSubtitles || this.showNativeSubtitles;
  }
  get subtitleCache(): Map<string, string> {
    return this.nativeSubtitleCache;
  }
  
  // Speech functionality
  speechSynthesis: SpeechSynthesis;
  speechRecognition: any;
  isListening: boolean = false;
  isSpeaking: boolean = false;
  voiceEnabled: boolean = true;
  showSpeechError: boolean = false; // Track speech error state for inline display
  
  private subscriptions: Subscription[] = [];
  
  // Track if AI has sent a farewell message (for browser close handling)
  private pendingAutoComplete = false;
  private boundBeforeUnload: (() => void) | null = null;

  constructor(
    private route: ActivatedRoute,
    public router: Router, // Make router public for template access
    private http: HttpClient,
    private aiTutorService: AiTutorService,
    private learningModulesService: LearningModulesService,
    private subscriptionGuard: SubscriptionGuardService,
    private cdr: ChangeDetectorRef // Add ChangeDetectorRef for manual change detection
  ) {
    // Initialize speech synthesis
    this.speechSynthesis = window.speechSynthesis;
    
    // Initialize speech recognition
    this.initializeSpeechRecognition();
  }

  ngOnInit(): void {
    // Get route parameters first to check for test mode
    // Use take(1) to only check once and prevent re-triggering during the lesson
    this.route.queryParams.pipe(take(1)).subscribe(params => {
      this.isTeacherTestMode = params['testMode'] === 'true';
      this.moduleId = params['moduleId'];
      this.sessionType = params['sessionType'] || 'practice';
      
      console.log('🔍 Route params detected:', {
        testMode: params['testMode'],
        isTeacherTestMode: this.isTeacherTestMode,
        moduleId: this.moduleId,
        sessionType: this.sessionType
      });
      
      // Check subscription access (skip for teacher test mode)
      if (!this.isTeacherTestMode) {
        console.log('👤 Regular mode - checking subscription access...');
        
        // Add timeout to prevent hanging and take(1) to complete after first emission
        const subscriptionCheck = this.subscriptionGuard.checkPlatinumAccess().pipe(
          take(1), // Complete after first emission
          timeout(5000) // 5 second timeout
        );
        
        const subscriptionSub = subscriptionCheck.subscribe({
          next: (status) => {
            if (!status.hasAccess) {
              // User doesn't have PLATINUM access, show upgrade option
              const upgradeMessage = `🤖 AI Tutoring - Premium Feature\n\n${status.message}\n\nWould you like to request an upgrade to PLATINUM?\nOur sales team will contact you within 24 hours.`;
              
              if (confirm(upgradeMessage)) {
                // Send upgrade request
                this.requestUpgrade();
              } else {
                // Redirect to learning modules
                this.router.navigate(['/learning-modules']);
              }
              return;
            }
            
            // User has access, proceed with initialization
            this.initializeComponent();
          },
          error: (error) => {
            console.error('❌ Subscription check failed:', error);
            // Proceed anyway for development/testing
            console.log('⚠️ Proceeding without subscription check due to error');
            this.initializeComponent();
          }
        });
        
        this.subscriptions.push(subscriptionSub);
      } else {
        // Teacher test mode - skip subscription check
        console.log('🧪 Teacher test mode activated - skipping subscription check');
        this.initializeComponent();
      }
    });
  }

  private initializeComponent(): void {
    // Load transcript preferences
    this.loadTranscriptPreferences();
    
    // Load saved microphone mode preference
    const savedMode = localStorage.getItem('ai-tutor-mic-mode');
    if (savedMode && ['auto', 'mobile', 'desktop'].includes(savedMode)) {
      this.microphoneMode = savedMode as 'auto' | 'mobile' | 'desktop';
      console.log('📂 Loaded microphone mode preference:', this.microphoneMode);
    }
    
    // Module ID should already be set from ngOnInit
    console.log('🚀 AI Tutor Chat initialized:', { 
      moduleId: this.moduleId, 
      sessionType: this.sessionType,
      isTeacherTestMode: this.isTeacherTestMode 
    });
    
    if (this.moduleId) {
      this.loadModule();
      this.startNewSession();
    } else {
      this.router.navigate(['/learning-modules']);
    }
    
    // Subscribe to messages with enhanced handling and automatic refresh
    const messagesSub = this.aiTutorService.messages$.subscribe(messages => {
      console.log('📨 Messages updated from service:', messages.length, messages);
      
      // Update both local and component messages
      this.localMessages = [...messages];
      this.messages = [...messages];
      
      console.log('📊 Local messages count:', this.localMessages.length);
      console.log('📊 Component messages count:', this.messages.length);
      
      // Force change detection to ensure UI updates
      this.cdr.detectChanges();
      
      // Scroll to bottom after change detection
      setTimeout(() => {
        this.scrollToBottom();
        
        // Double-check message sync and force update if needed
        if (this.messages.length !== messages.length) {
          console.log('🔄 Forcing message sync...');
          this.messages = [...messages];
          this.cdr.detectChanges();
        }
      }, 50);
    });
    
    this.subscriptions.push(messagesSub);
    
    // Start auto-refresh mechanism for real-time updates
    this.startAutoRefresh();
  }

  private startAutoRefresh(): void {
    // Auto-refresh messages every 2 seconds for better performance
    this.autoRefreshInterval = setInterval(() => {
      if (this.sessionActive && !this.isLoading && !this.isSending) {
        this.autoRefreshMessages();
      }
    }, 2000); // Increased from 800ms to 2000ms to prevent performance issues
  }

  private autoRefreshMessages(): void {
    // Circuit breaker to prevent infinite refresh
    this.autoRefreshCount++;
    if (this.autoRefreshCount > this.maxAutoRefreshAttempts) {
      console.warn('⚠️ Auto-refresh limit reached, stopping to prevent infinite loop');
      if (this.autoRefreshInterval) {
        clearInterval(this.autoRefreshInterval);
        this.autoRefreshInterval = null;
      }
      return;
    }
    
    const serviceMessages = this.aiTutorService.getCurrentMessages();
    
    // Only update if there are new messages
    if (serviceMessages.length > this.messages.length) {
      console.log('🔄 Auto-refreshing messages:', serviceMessages.length, 'vs current:', this.messages.length);
      
      this.localMessages = [...serviceMessages];
      this.messages = [...serviceMessages];
      
      // Force UI update
      this.cdr.detectChanges();
      
      // Scroll to bottom
      setTimeout(() => this.scrollToBottom(), 50);
    }
  }

  ngOnDestroy(): void {
    console.log('🧹 Cleaning up AI tutor chat component...');
    
    // If completion was pending (AI said goodbye), mark it now before destroying
    if (this.pendingAutoComplete && this.moduleId && this.sessionActive) {
      console.log('📡 Pending completion detected on destroy — marking module as completed');
      this.pendingAutoComplete = false;
      this.autoCompleteModule();
    }
    
    // Remove beforeunload handler
    if (this.boundBeforeUnload) {
      window.removeEventListener('pagehide', this.boundBeforeUnload);
      window.removeEventListener('beforeunload', this.boundBeforeUnload);
      this.boundBeforeUnload = null;
    }
    
    // Unsubscribe from all subscriptions
    this.subscriptions.forEach(sub => {
      if (sub && !sub.closed) {
        sub.unsubscribe();
      }
    });
    this.subscriptions = [];
    
    // Clear auto-refresh interval
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
    
    // Stop any ongoing speech
    if (this.speechSynthesis) {
      this.speechSynthesis.cancel();
    }
    
    // Stop speech recognition
    if (this.speechRecognition && this.isListening) {
      this.speechRecognition.stop();
    }
    
    // DO NOT end session on component destroy
    // This was causing sessions to be marked as "completed" when users simply closed the browser
    // Sessions should remain "active" if abandoned, not marked as "completed"
    // Only explicit user action (clicking "End Session") should complete a session
    
    console.log('✅ AI tutor chat component cleaned up (session remains active if not explicitly ended)');
  }

  loadModule(): void {
    this.isLoading = true;
    this.learningModulesService.getModule(this.moduleId).subscribe({
      next: (module) => {
        this.module = module;
        this.isLoading = false;
        
        // Update speech recognition language based on module
        this.updateSpeechRecognitionLanguage();
      },
      error: (error) => {
        console.error('Error loading module:', error);
        this.isLoading = false;
        alert('Failed to load module');
        
        // Redirect based on user role and test mode
        if (this.isTeacherTestMode) {
          this.router.navigate(['/learning-modules']);
        } else {
          this.router.navigate(['/learning-modules']);
        }
      }
    });
  }

  // Unified language mapping
  private getLanguageCode(targetLanguage: string): string {
    const languageMap: { [key: string]: string } = {
      'English': 'en-US',
      'German': 'de-DE',
      'Spanish': 'es-ES',
      'French': 'fr-FR',
      'Tamil': 'ta-IN',
      'Sinhala': 'si-LK'
    };
    return languageMap[targetLanguage] || 'en-US';
  }

  // Detect the language of text based on character patterns
  private detectTextLanguage(text: string): string {
    // Tamil Unicode range: \u0B80-\u0BFF
    const tamilPattern = /[\u0B80-\u0BFF]/;
    
    // Sinhala Unicode range: \u0D80-\u0DFF
    const sinhalaPattern = /[\u0D80-\u0DFF]/;
    
    // German-specific characters
    const germanPattern = /[äöüßÄÖÜ]/;
    
    // Check for Tamil characters
    if (tamilPattern.test(text)) {
      return 'Tamil';
    }
    
    // Check for Sinhala characters
    if (sinhalaPattern.test(text)) {
      return 'Sinhala';
    }
    
    // Check for German characters
    if (germanPattern.test(text)) {
      return 'German';
    }
    
    // Default to target language if no specific characters detected
    return this.module?.targetLanguage || 'English';
  }

  // Update speech recognition language based on module
  updateSpeechRecognitionLanguage(): void {
    if (this.speechRecognition && this.module) {
      const langCode = this.getLanguageCode(this.module.targetLanguage);
      this.speechRecognition.lang = langCode;
      console.log(`🎤 Speech recognition set to ${this.module.targetLanguage} (${langCode})`);
    }
  }

  startNewSession(): void {
    this.isLoading = true;
    
    console.log('🔄 Starting new session with params:', {
      moduleId: this.moduleId,
      sessionType: this.sessionType,
      isTeacherTestMode: this.isTeacherTestMode
    });
    
    // Clear previous session data
    this.aiTutorService.clearCurrentSession();
    this.localMessages = [];
    this.messages = [];
    this.sessionActive = false;
    this.sessionId = '';
    
    console.log('🔄 Starting new session, cleared previous messages');
    console.log('📊 Messages after clear - Local:', this.localMessages.length, 'Component:', this.messages.length);
    
    // Use teacher test mode if applicable
    console.log('📞 Calling startSession with:', {
      moduleId: this.moduleId,
      sessionType: this.sessionType,
      isTeacherTest: this.isTeacherTestMode
    });
    
    // Add timeout to prevent hanging
    const sessionStart = this.aiTutorService.startSession(this.moduleId, this.sessionType, this.isTeacherTestMode).pipe(
      timeout(20000) // 20 second timeout (longer than backend 15s timeout)
    );
    
    const sessionSub = sessionStart.subscribe({
      next: (response) => {
        console.log('✅ Session creation response:', response);
        this.sessionId = response.sessionId;
        this.sessionActive = true;
        this.sessionStartTime = new Date(); // Track when session started
        this.suggestions = response.suggestions || [];
        
        console.log('✅ New session started:', this.sessionId, this.isTeacherTestMode ? '(Teacher Test Mode)' : '');
        
        // Add welcome message
        if (response.welcomeMessage) {
          console.log('➕ Adding welcome message:', response.welcomeMessage);
          
          // Add to local storage first
          this.localMessages.push(response.welcomeMessage);
          this.messages = [...this.localMessages];
          
          // Then add to service
          this.aiTutorService.addMessageToCurrentSession(response.welcomeMessage);
          
          console.log('📊 Messages after welcome - Local:', this.localMessages.length, 'Component:', this.messages.length);
          
          // Role-play details removed - using simplified interface
          
          // Speak the welcome message if voice is enabled
          if (this.voiceEnabled && response.welcomeMessage.content) {
            setTimeout(() => {
              this.speakText(response.welcomeMessage.content);
            }, 1000); // Longer delay for welcome message
          }
        }
        
        this.isLoading = false;
      },
      error: (error) => {
        console.error('❌ Error starting session:', error);
        console.error('📋 Error details:', {
          status: error.status,
          message: error.message,
          error: error.error,
          isTeacherTestMode: this.isTeacherTestMode,
          moduleId: this.moduleId,
          sessionType: this.sessionType
        });
        
        this.isLoading = false;
        
        let errorMessage = 'Failed to start tutoring session';
        if (error.status === 403) {
          errorMessage = 'Permission denied. Please check your access rights.';
        } else if (error.status === 404) {
          errorMessage = 'Module not found or inactive.';
        } else if (error.status === 401) {
          errorMessage = 'Authentication required. Please login again.';
        } else if (error.error?.message) {
          errorMessage = `Failed to start session: ${error.error.message}`;
        }
        
        alert(errorMessage);
      }
    });
    
    this.subscriptions.push(sessionSub);
  }

  sendMessage(fromSpeech: boolean = false): void {
    if (!this.currentMessage.trim() || this.isSending || !this.sessionActive) {
      console.log('❌ Cannot send message:', { 
        hasMessage: !!this.currentMessage.trim(), 
        isSending: this.isSending, 
        sessionActive: this.sessionActive 
      });
      return;
    }
    
    const messageContent = this.currentMessage.trim();
    this.currentMessage = ''; // Clear immediately to prevent double-sending
    
    console.log('📤 Sending message:', messageContent, 'from:', fromSpeech ? 'speech' : 'text');
    
    // Show immediate loading feedback
    const loadingMessage: TutorMessage = {
      role: 'tutor',
      content: '🤖 Thinking...',
      messageType: 'text',
      timestamp: new Date(),
      metadata: { isLoading: true } as any as any
    };
    
    // Add loading message temporarily
    this.localMessages.push(loadingMessage);
    this.messages = [...this.localMessages];
    this.cdr.detectChanges();
    setTimeout(() => this.scrollToBottom(), 50);
    
    // Check for stop commands - end session immediately without AI response
    // Only trigger if the ENTIRE message is a stop command (not part of a sentence)
    const stopCommands = ['stop', 'end', 'finish', 'quit', 'exit', 'stopp', 'ende', 'beenden', 'aufhören'];
    const trimmedMessage = messageContent.trim().toLowerCase();
    const isStopCommand = stopCommands.some(cmd => 
      trimmedMessage === cmd.toLowerCase() || // Exact match
      trimmedMessage === `${cmd.toLowerCase()}.` || // With period
      trimmedMessage === `${cmd.toLowerCase()}!` || // With exclamation
      trimmedMessage === `${cmd.toLowerCase()}?`    // With question mark
    );
    
    if (isStopCommand) {
      // Add student message to UI with speech indicator
      const studentMessage: TutorMessage = {
        role: 'student',
        content: messageContent,
        messageType: 'text',
        timestamp: new Date(),
        metadata: fromSpeech ? { inputMethod: 'speech' } : { inputMethod: 'text' }
      };
      this.aiTutorService.addMessageToCurrentSession(studentMessage);
      
      // End session immediately without AI response
      this.endSessionSilently();
      return;
    }
    
    this.isSending = true;
    
    // Safety timeout to prevent stuck isSending state (60 seconds max)
    const sendingTimeout = setTimeout(() => {
      if (this.isSending) {
        console.warn('⚠️ Message sending timeout triggered - forcing isSending to false');
        this.isSending = false;
        this.cdr.detectChanges();
      }
    }, 60000);
    
    // Add student message to UI immediately with input method indicator
    const studentMessage: TutorMessage = {
      role: 'student',
      content: messageContent,
      messageType: 'text',
      timestamp: new Date(),
      metadata: fromSpeech ? { inputMethod: 'speech' } : { inputMethod: 'text' }
    };
    
    console.log('➕ Adding student message to session:', studentMessage);
    
    // Add to local storage first
    this.localMessages.push(studentMessage);
    this.messages = [...this.localMessages];
    
    // Force immediate UI update
    this.cdr.detectChanges();
    
    // Then add to service
    this.aiTutorService.addMessageToCurrentSession(studentMessage);
    
    // Scroll to show new message
    setTimeout(() => this.scrollToBottom(), 50);
    
    // Log the conversation for debugging
    console.log(`💬 ${fromSpeech ? '[SPEECH]' : '[TEXT]'} Student:`, messageContent);
    console.log('📊 Current messages count - Local:', this.localMessages.length, 'Component:', this.messages.length);
    
    // Send to backend
    this.aiTutorService.sendMessage(this.sessionId, messageContent).subscribe({
      next: (response) => {
        clearTimeout(sendingTimeout);
        console.log('📥 Received response from backend:', response);
        
        // Remove loading message and add real response
        this.localMessages = this.localMessages.filter(m => !(m.metadata as any)?.isLoading);
        
        // Add tutor response
        if (response.response) {
          console.log('➕ Adding AI response to session:', response.response);
          
          // Add to local storage first
          this.localMessages.push(response.response);
          this.messages = [...this.localMessages];
          
          // Force immediate UI update
          this.cdr.detectChanges();
          
          // Then add to service
          this.aiTutorService.addMessageToCurrentSession(response.response);
          
          // Scroll to show new message
          setTimeout(() => this.scrollToBottom(), 50);
          
          // Log AI response for debugging
          console.log('🤖 AI Response:', response.response.content);
          console.log('📊 Messages count after AI response - Local:', this.localMessages.length, 'Component:', this.messages.length);
          
          // Check if role-play session is naturally completed (not manually stopped)
          if (response.response.metadata?.sessionState === 'completed') {
            // Session naturally completed - mark module as completed
            console.log('🎭 Role-play session naturally completed - marking module as completed');
            this.markModuleAsCompleted();
          } else if (response.response.metadata?.sessionState === 'manually_ended') {
            // Session manually stopped - do NOT mark as completed
            console.log('🛑 Role-play session manually stopped - NOT marking module as completed');
          } else {
            // Check for automatic completion based on AI response content
            this.checkForAutoCompletion(response.response);
          }
          
          // Speak the AI response if voice is enabled
          if (this.voiceEnabled && response.response.content) {
            setTimeout(() => {
              this.speakText(response.response.content);
            }, 500); // Small delay to ensure message is displayed first
          }
        }
        
        // Update suggestions
        this.suggestions = response.suggestions || [];
        
        // Update stats
        if (response.sessionStats) {
          this.sessionStats = response.sessionStats;
        }
        
        // Check if response contains an exercise
        if (response.response.messageType === 'exercise' && response.response.metadata) {
          this.currentExercise = response.response.metadata;
        } else {
          this.currentExercise = null;
        }
        
        this.isSending = false;
        
        // Force immediate refresh to ensure all messages are visible
        setTimeout(() => {
          this.autoRefreshMessages();
        }, 100);
      },
      error: (error) => {
        clearTimeout(sendingTimeout);
        console.error('Error sending message:', error);
        this.isSending = false;
        
        // Still try to refresh in case of partial success
        setTimeout(() => {
          this.autoRefreshMessages();
        }, 100);
        
        alert('Failed to send message');
      }
    });
  }

  submitExerciseAnswer(): void {
    if (!this.exerciseAnswer.trim() || this.isSending || !this.currentExercise) {
      return;
    }
    
    const answer = this.exerciseAnswer.trim();
    this.exerciseAnswer = '';
    this.isSending = true;
    
    // Add student answer to UI
    const studentMessage: TutorMessage = {
      role: 'student',
      content: answer,
      messageType: 'text',
      timestamp: new Date(),
      metadata: { studentAnswer: answer }
    };
    this.aiTutorService.addMessageToCurrentSession(studentMessage);
    
    // Send exercise answer
    this.aiTutorService.sendMessage(
      this.sessionId,
      answer,
      'exercise_answer',
      answer
    ).subscribe({
      next: (response) => {
        // Add feedback
        if (response.response) {
          this.aiTutorService.addMessageToCurrentSession(response.response);
          
          // Speak the feedback if voice is enabled
          if (this.voiceEnabled && response.response.content) {
            setTimeout(() => {
              this.speakText(response.response.content);
            }, 500);
          }
        }
        
        // Update stats
        if (response.sessionStats) {
          this.sessionStats = response.sessionStats;
        }
        
        // Clear current exercise
        this.currentExercise = null;
        this.suggestions = response.suggestions || [];
        
        this.isSending = false;
      },
      error: (error) => {
        console.error('Error submitting answer:', error);
        this.isSending = false;
        alert('Failed to submit answer');
      }
    });
  }

  useSuggestion(suggestion: string): void {
    // Since we don't have a text input anymore, directly send the suggestion as a message
    if (!this.sessionActive || this.isSending || this.isProcessingSpeech) {
      return;
    }
    
    console.log('📤 Sending suggestion as message:', suggestion);
    
    // Set the suggestion as current message and send it
    this.currentMessage = suggestion;
    this.sendMessage(false); // false indicates it's not from speech
  }

  endSession(navigate: boolean = true): void {
    if (!this.sessionId) return;
    
    this.isLoading = true;
    this.aiTutorService.endSession(this.sessionId).subscribe({
      next: (response) => {
        this.sessionActive = false;
        this.aiTutorService.clearCurrentSession();
        
        if (navigate) {
          // Prepare session data for database storage
          const duration = this.calculateSessionDuration();
          const conversationCount = this.getStudentMessageCount();
          const vocabularyUsed = this.getVocabularyUsedList();
          
          const sessionData = {
            sessionId: this.sessionId,
            moduleId: this.moduleId,
            sessionType: this.sessionType,
            messages: this.messages,
            summary: {
              conversationCount: conversationCount,
              timeSpentMinutes: duration,
              vocabularyUsed: vocabularyUsed,
              exerciseScore: this.sessionStats.sessionScore,
              conversationScore: this.getConversationScore(),
              totalScore: this.sessionStats.sessionScore + this.getConversationScore(),
              correctAnswers: this.sessionStats.correctAnswers,
              incorrectAnswers: this.sessionStats.incorrectAnswers,
              accuracy: this.getScorePercentage()
            },
            sessionState: 'completed',
            isModuleCompleted: false
          };

          // Save session record to database for teacher review
          this.aiTutorService.saveSessionRecord(sessionData).subscribe({
            next: (saveResponse) => {
              console.log('✅ Session record saved for teacher review');
            },
            error: (saveError) => {
              console.error('❌ Error saving session record:', saveError);
              // Continue with normal flow even if saving fails
            }
          });

          // Show simple, concise summary as requested
          const summaryText = `Session Complete! 🎉

💬 Conversations: ${conversationCount}
⏱️ Time Spent: ${duration} minutes
📚 Vocabulary Used: ${vocabularyUsed.length > 0 ? vocabularyUsed.join(', ') : 'Practice completed'}

Great job! 🌟`;
          
          alert(summaryText);
          
          // Navigate back to learning modules list
          this.router.navigate(['/learning-modules']);
        }
        
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error ending session:', error);
        this.isLoading = false;
      }
    });
  }

  // End session silently when user says "stop" - no AI response
  endSessionSilently(): void {
    if (!this.sessionId) return;
    
    // Stop any ongoing speech immediately
    this.speechSynthesis.cancel();
    this.isSpeaking = false;
    
    // Stop listening
    if (this.isListening) {
      this.stopListening();
    }
    
    this.isLoading = true;
    this.aiTutorService.endSession(this.sessionId).subscribe({
      next: (response) => {
        this.sessionActive = false;
        this.aiTutorService.clearCurrentSession();
        
        // Calculate session metrics
        const duration = this.calculateSessionDuration();
        const conversationCount = this.getStudentMessageCount();
        const vocabularyUsed = this.getVocabularyUsedList();
        
        // Prepare session data for database storage
        const sessionData = {
          sessionId: this.sessionId,
          moduleId: this.moduleId,
          sessionType: this.sessionType,
          messages: this.messages,
          summary: {
            conversationCount: conversationCount,
            timeSpentMinutes: duration,
            vocabularyUsed: vocabularyUsed,
            exerciseScore: this.sessionStats.sessionScore,
            conversationScore: this.getConversationScore(),
            totalScore: this.sessionStats.sessionScore + this.getConversationScore(),
            correctAnswers: this.sessionStats.correctAnswers,
            incorrectAnswers: this.sessionStats.incorrectAnswers,
            accuracy: this.getScorePercentage()
          },
          sessionState: 'manually_ended',
          isModuleCompleted: false
        };

        // Save session record to database for teacher review
        this.aiTutorService.saveSessionRecord(sessionData).subscribe({
          next: (saveResponse) => {
            console.log('✅ Session record saved for teacher review (manually ended)');
          },
          error: (saveError) => {
            console.error('❌ Error saving session record:', saveError);
          }
        });
        
        const completionMessage: TutorMessage = {
          role: 'tutor',
          content: `⚠️ Session Stopped Before Completion

You ended the session early. Here's your progress:

💬 Conversations: ${conversationCount}
⏱️ Time Spent: ${duration} minutes
📚 Vocabulary Used: ${vocabularyUsed.length > 0 ? vocabularyUsed.join(', ') : 'Practice completed'}

🔄 **Module Status: NOT COMPLETED**
To complete this module and earn full credit:
- Restart the session and continue the conversation
- Practice until you reach all learning objectives
- Complete the full scenario from start to finish

💡 You can restart this module anytime to complete it!
Keep practicing! 🌟`,
          messageType: 'text',
          timestamp: new Date()
        };
        
        this.aiTutorService.addMessageToCurrentSession(completionMessage);
        this.isLoading = false;
        
        // No popup - let user use the buttons in the session-inactive section
      },
      error: (error) => {
        console.error('Error ending session:', error);
        this.isLoading = false;
        // Still end the session locally
        this.sessionActive = false;
        this.aiTutorService.clearCurrentSession();
      }
    });
  }

  getMessageClass(message: TutorMessage): string {
    return message.role === 'student' ? 'message-student' : 'message-tutor';
  }

  getMessageTypeIcon(messageType: string): string {
    switch (messageType) {
      case 'role-play-intro': return '🎭';
      case 'role-play-active': return '🎪';
      case 'role-play-complete': return '🎉';
      case 'exercise': return '📝';
      case 'feedback': return '💬';
      case 'hint': return '💡';
      case 'correction': return '✏️';
      case 'encouragement': return '🌟';
      default: return '';
    }
  }

  formatTimestamp(timestamp: Date): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private scrollToBottom(): void {
    try {
      if (this.messagesContainer) {
        this.messagesContainer.nativeElement.scrollTop = 
          this.messagesContainer.nativeElement.scrollHeight;
      }
    } catch (err) {
      console.error('Error scrolling to bottom:', err);
    }
  }

  refreshMessages(): void {
    console.log('🔄 Manually refreshing messages...');
    
    // Get messages from service
    const serviceMessages = this.aiTutorService.getCurrentMessages();
    console.log('📊 Service messages:', serviceMessages.length, serviceMessages);
    
    // Get local messages
    console.log('📊 Local messages:', this.localMessages.length, this.localMessages);
    
    // Use the longer array (more complete data)
    const messagesToUse = serviceMessages.length >= this.localMessages.length ? serviceMessages : this.localMessages;
    
    // Update both local and component messages
    this.localMessages = [...messagesToUse];
    this.messages = [...messagesToUse];
    
    // Force change detection
    this.cdr.detectChanges();
    
    console.log('📊 After refresh - Local:', this.localMessages.length, 'Component:', this.messages.length);
    
    setTimeout(() => this.scrollToBottom(), 50);
  }

  getSessionTypeLabel(): string {
    const types = this.aiTutorService.getSessionTypes();
    const type = types.find(t => t.value === this.sessionType);
    return type ? type.label : 'Tutoring Session';
  }

  getScorePercentage(): number {
    const total = this.sessionStats.correctAnswers + this.sessionStats.incorrectAnswers;
    return this.aiTutorService.calculateScorePercentage(
      this.sessionStats.correctAnswers,
      total
    );
  }

  // Calculate conversation participation score
  getConversationScore(): number {
    const studentMessages = this.getStudentMessageCount();
    const speechMessages = this.getSpeechMessageCount();
    
    // Base points for participation: 2 points per message, 3 points for speech
    const conversationPoints = (studentMessages * 2) + (speechMessages * 1); // Extra point for speech
    return conversationPoints;
  }

  // Get total engagement score
  getTotalEngagementScore(): number {
    const exerciseScore = this.sessionStats.sessionScore || 0;
    const conversationScore = this.getConversationScore();
    return exerciseScore + conversationScore;
  }

  // Helper method for template to convert index to letter (A, B, C, etc.)
  getOptionLetter(index: number): string {
    return String.fromCharCode(65 + index);
  }

  // Check if current module is a role-play module
  isRolePlayModule(): boolean {
    return this.module?.content?.rolePlayScenario ? true : false;
  }

  // Get role-play information for display
  getRolePlayInfo(): any {
    if (!this.isRolePlayModule()) return null;
    return {
      situation: this.module.content.rolePlayScenario.situation,
      studentRole: this.module.content.rolePlayScenario.studentRole,
      aiRole: this.module.content.rolePlayScenario.aiRole,
      objective: this.module.content.rolePlayScenario.objective
    };
  }

  // Mobile device detection helper
  private isMobileDevice(): boolean {
    // Check 1: User Agent string (traditional method)
    const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Check 2: Touch capability (mobile devices have touch)
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Check 3: Screen size (mobile screens are typically smaller)
    const smallScreen = window.innerWidth <= 768;
    
    // Check 4: Touch + Small Screen combination (strong mobile indicator)
    // This catches mobile devices using "Request Desktop Site"
    const touchMobile = hasTouch && smallScreen;
    
    // Check 5: Orientation API (mobile-specific feature)
    const hasOrientation = typeof window.orientation !== 'undefined' || 'orientation' in screen;
    
    // Final decision: Mobile if ANY indicator is true
    const isMobile = mobileUA || touchMobile || hasOrientation;
    
    // Debug logging (only on first detection to avoid spam)
    if (this.isFirstDetection) {
      console.log('🔍 Enhanced Mobile Detection:', {
        userAgent: navigator.userAgent.substring(0, 100) + '...',
        checks: {
          mobileUA: mobileUA,
          hasTouch: hasTouch,
          smallScreen: smallScreen,
          touchMobile: touchMobile,
          hasOrientation: hasOrientation
        },
        screenSize: {
          width: window.innerWidth,
          height: window.innerHeight
        },
        finalDecision: isMobile ? '📱 MOBILE' : '🖥️ DESKTOP'
      });
      this.isFirstDetection = false;
    }
    
    return isMobile;
  }

  /**
   * Determine if mobile behavior should be used
   * Respects user preference if set, otherwise uses auto-detection
   */
  private shouldUseMobileBehavior(): boolean {
    if (this.microphoneMode === 'mobile') {
      console.log('🎤 Using MOBILE mode (user preference)');
      return true;
    }
    
    if (this.microphoneMode === 'desktop') {
      console.log('🎤 Using DESKTOP mode (user preference)');
      return false;
    }
    
    // Auto mode - use enhanced detection
    const isMobile = this.isMobileDevice();
    console.log(`🎤 Using ${isMobile ? 'MOBILE' : 'DESKTOP'} mode (auto-detected)`);
    return isMobile;
  }

  /**
   * Save user's microphone mode preference
   */
  saveMicrophoneMode(): void {
    localStorage.setItem('ai-tutor-mic-mode', this.microphoneMode);
    console.log('💾 Microphone mode saved:', this.microphoneMode);
  }

  // Speech Recognition Methods
  initializeSpeechRecognition(): void {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.speechRecognition = new SpeechRecognition();
      
      this.speechRecognition.continuous = true; // Keep listening until manually stopped
      this.speechRecognition.interimResults = true; // Get interim results for better UX
      this.speechRecognition.maxAlternatives = 1; // Only need the best match
      
      // Set language based on module's target language
      if (this.module?.targetLanguage === 'English') {
        this.speechRecognition.lang = 'en-US';
      } else {
        this.speechRecognition.lang = 'de-DE'; // Default to German
      }
      
      this.speechRecognition.onstart = () => {
        this.isListening = true;
        console.log('🎤 Started listening...');
      };
      
      this.speechRecognition.onresult = (event: any) => {
        // Speech Recognition API fires this event multiple times as user speaks
        // IMPORTANT: event.results contains SEPARATE speech segments, NOT cumulative transcripts
        // We must concatenate ALL final results to get the complete message
        
        console.log('🎤 Speech result received:', {
          totalResults: event.results.length,
          resultIndex: event.resultIndex,
          speechAccumulating: this.speechAccumulating,
          previousMessage: this.previousMessage,
          currentMessage: this.currentMessage
        });
        
        // Build transcript from NEW results only (starting from event.resultIndex)
        // CRITICAL: event.resultIndex tells us where NEW results start
        // This prevents processing old results again after mobile auto-restart
        let completeTranscript = '';
        let hasNewFinalResult = false;
        let lowestConfidence = 1.0;
        
        console.log('🔍 Analyzing NEW results only (starting from index', event.resultIndex, '):');
        
        // FIXED: Only process NEW results starting from resultIndex
        // This prevents duplicate processing after mobile auto-restart
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0].transcript;
          const confidence = result[0].confidence || 0.8;
          const isFinal = result.isFinal;
          
          console.log(`  [${i}] "${transcript}" (final: ${isFinal}, confidence: ${confidence.toFixed(2)})`);
          
          // Only include final results with sufficient confidence
          if (isFinal) {
            if (confidence >= 0.6) {
              completeTranscript += transcript + ' ';
              hasNewFinalResult = true;
              lowestConfidence = Math.min(lowestConfidence, confidence);
            } else {
              console.log(`  ⚠️  Skipping result ${i} due to low confidence (${confidence.toFixed(2)} < 0.6)`);
            }
          }
        }
        
        completeTranscript = completeTranscript.trim();
        
        if (!hasNewFinalResult) {
          console.log('🎤 No new final results, waiting...');
          return;
        }
        
        console.log('🎤 Complete transcript from all final results:', completeTranscript);
        console.log('🎤 Lowest confidence in results:', lowestConfidence.toFixed(2));
        
        // Normalize the complete transcript
        const normalizedTranscript = this.normalizeText(completeTranscript);
        
        // ENHANCED: Skip if this is the exact same transcript we just captured
        // This prevents duplicate captures during auto-restart
        if (normalizedTranscript === this.currentMessage) {
          console.log('⚠️ Duplicate transcript detected - ignoring (same as current message)');
          return;
        }
        
        // Store the captured speech but DON'T send it yet
        if (normalizedTranscript && normalizedTranscript.trim()) {
          let updatedMessage = '';
          
          // Check if we need to accumulate with existing message
          // This handles BOTH mobile auto-restart AND desktop manual restart
          const hasExistingMessage = this.currentMessage && this.currentMessage.trim();
          const hasPreviousMessage = this.previousMessage && this.previousMessage.trim();
          
          if (this.speechAccumulating && hasPreviousMessage) {
            // Accumulating mode (mobile auto-restart OR desktop manual restart)
            // Remove duplicate words that appear at the end of previous message and start of new transcript
            updatedMessage = this.removeDuplicateWords(this.previousMessage, normalizedTranscript);
            console.log('🎤 Speech accumulated (deduplicated with previous):', updatedMessage);
          } else if (hasExistingMessage) {
            // Desktop: User clicked mic again after pause - accumulate with current message
            updatedMessage = this.removeDuplicateWords(this.currentMessage, normalizedTranscript);
            console.log('🎤 Speech accumulated (deduplicated with current):', updatedMessage);
          } else {
            // Fresh start: No existing message
            updatedMessage = normalizedTranscript;
            console.log('🎤 Speech stored (fresh start):', updatedMessage);
          }
          
          // CRITICAL: Final pass to remove ANY consecutive duplicates in the entire message
          // This catches duplicates that slip through during overlaps
          // Example: "guten guten Morgen" -> "guten Morgen"
          const finalCleanedMessage = this.removeConsecutiveDuplicates(updatedMessage);
          
          if (finalCleanedMessage !== updatedMessage) {
            console.log('🧹 Final cleanup removed consecutive duplicates:', {
              before: updatedMessage,
              after: finalCleanedMessage
            });
          }
          
          // Only update if the message actually changed
          if (finalCleanedMessage !== this.currentMessage) {
            this.currentMessage = finalCleanedMessage;
            console.log('✅ Final message updated:', this.currentMessage);
          } else {
            console.log('⚠️ Message unchanged - skipping update');
          }
          
          this.isProcessingSpeech = false;
          
          console.log('🎤 User must manually stop microphone to send message');
          
          // Force UI update to show captured text
          this.cdr.detectChanges();
        } else {
          console.log('🎤 Empty transcript, waiting for more speech...');
        }
        
        // Show what was captured in the UI but don't send
        // The user will manually stop the mic when ready to send
      };
      
      this.speechRecognition.onerror = (event: any) => {
        console.error('🎤 Speech recognition error:', event.error);
        
        // Don't set isListening to false for 'no-speech' error on mobile
        // This allows auto-restart to work properly
        if (event.error !== 'no-speech' || !this.shouldUseMobileBehavior()) {
          this.isListening = false;
        }
        
        // Provide user feedback for common errors
        let errorMessage = '';
        switch (event.error) {
          case 'no-speech':
            errorMessage = 'No speech detected. Please try speaking again.';
            // On mobile, this is normal - will auto-restart
            if (this.shouldUseMobileBehavior()) {
              console.log('🎤 No speech on mobile - will auto-restart');
              return; // Don't show error on mobile
            }
            break;
          case 'audio-capture':
            errorMessage = 'Microphone not accessible. Please check permissions.';
            break;
          case 'not-allowed':
            errorMessage = 'Microphone permission denied. Please allow microphone access.';
            break;
          case 'network':
            errorMessage = 'Network error. Please check your connection.';
            break;
          default:
            errorMessage = `Speech recognition error: ${event.error}`;
        }
        
        // Show error message briefly
        console.warn('🎤', errorMessage);
        // You could show a toast notification here if you have one
      };
      
      this.speechRecognition.onend = () => {
        console.log('🎤 Speech recognition ended');
        
        // Check if this was a user-initiated stop or browser auto-stop
        if (this.isListening) {
          // Browser auto-stopped (user didn't tap stop button)
          console.log('🎤 Browser auto-stopped speech recognition');
          
          // Use enhanced detection with user preference support
          if (this.shouldUseMobileBehavior()) {
            console.log('🎤 Mobile behavior detected - auto-restarting...');
            
            // Set accumulating flag BEFORE restart to preserve previous speech
            this.speechAccumulating = true;
            
            // Save current message before restart
            this.previousMessage = this.currentMessage;
            
            // Small delay before restart to avoid rapid cycling
            setTimeout(() => {
              if (this.isListening && this.speechRecognition) {
                try {
                  // Safety check: ensure recognition is not already running
                  if (this.speechRecognition.state === 'running') {
                    console.log('🎤 Recognition already running, skipping restart');
                    return;
                  }
                  this.speechRecognition.start();
                  console.log('🎤 Speech recognition restarted successfully (accumulating mode)');
                } catch (error: any) {
                  // Handle "already started" error gracefully
                  if (error.message && error.message.includes('already started')) {
                    console.warn('⚠️ Recognition already started during auto-restart, continuing...');
                  } else {
                    console.error('🎤 Failed to restart:', error);
                    this.isListening = false;
                    this.speechAccumulating = false; // Reset flag on error
                    this.previousMessage = ''; // Clear previous message
                    this.cdr.detectChanges();
                  }
                }
              }
            }, 100); // 100ms delay
          } else {
            // Desktop - don't auto-restart, but KEEP accumulating mode
            // This allows user to manually restart and continue their message
            console.log('🎤 Desktop behavior detected - not auto-restarting, but keeping accumulation mode');
            this.isListening = false;
            this.speechAccumulating = true; // KEEP accumulating for manual restart
            this.previousMessage = this.currentMessage; // Save current message
            console.log('🎤 Desktop: Ready for manual restart. Current message preserved:', this.currentMessage);
          }
        } else {
          // User manually stopped (stopListening() was called)
          console.log('🎤 User manually stopped speech recognition');
          this.speechAccumulating = false; // Reset flag
          this.previousMessage = ''; // Clear previous message
        }
        
        this.cdr.detectChanges();
      };
    } else {
      console.warn('Speech recognition not supported in this browser');
      this.voiceEnabled = false;
    }
  }

  // Start listening for speech input
  startListening(): void {
    if (this.speechRecognition && !this.isListening) {
      // Clear any previous error messages
      this.showSpeechError = false;
      
      // Check if we should preserve existing message
      const hasExistingMessage = this.currentMessage && this.currentMessage.trim();
      
      if (hasExistingMessage) {
        // User is continuing their speech - preserve the message
        console.log('🎤 Continuing speech with existing message:', this.currentMessage);
        this.speechAccumulating = true;
        this.previousMessage = this.currentMessage; // Save for deduplication
      } else if (!this.speechAccumulating) {
        // Fresh start - clear everything
        console.log('🎤 Starting fresh speech session');
        this.currentMessage = '';
        this.previousMessage = '';
      }
      
      try {
        this.speechRecognition.start();
        console.log('🎤 Microphone started, accumulating:', this.speechAccumulating);
      } catch (error: any) {
        // Handle "already started" error gracefully
        if (error.message && error.message.includes('already started')) {
          console.warn('⚠️ Speech recognition already running, stopping and restarting...');
          this.speechRecognition.stop();
          // Retry after a short delay
          setTimeout(() => {
            try {
              this.speechRecognition.start();
              console.log('🎤 Microphone restarted successfully');
            } catch (retryError) {
              console.error('❌ Failed to restart microphone:', retryError);
              this.showSpeechError = true;
            }
          }, 100);
        } else {
          console.error('❌ Error starting speech recognition:', error);
          this.showSpeechError = true;
        }
      }
    }
  }

  // Stop listening and send the captured message directly
  stopListening(): void {
    if (this.speechRecognition && this.isListening) {
      console.log('🎤 Stopping microphone, current message:', this.currentMessage);
      
      // Set to false BEFORE calling stop() so onend knows this was user-initiated
      this.isListening = false;
      this.speechAccumulating = false; // Reset accumulating flag
      this.previousMessage = ''; // Clear previous message storage
      
      // Stop speech recognition
      this.speechRecognition.stop();
      
      // Wait a bit longer to ensure speech recognition has fully processed
      setTimeout(() => {
        // If there's a captured message, send it directly
        if (this.currentMessage && this.currentMessage.trim()) {
          console.log('🎤 Microphone stopped - sending message directly:', this.currentMessage);
          
          // Send the message that was captured (and possibly edited) during listening
          this.sendMessage(true); // true indicates speech input
        } else {
          console.log('🎤 Microphone stopped - no message to send');
          console.warn('⚠️ Speech was not captured. This might be due to:');
          console.warn('   - Speaking too quickly after starting');
          console.warn('   - Network issues');
          console.warn('   - Browser speech recognition limitations');
          console.warn('   - Low audio quality or background noise');
          
          // CRITICAL: Reset all flags that might disable the microphone button
          this.isProcessingSpeech = false;
          this.isSending = false;
          this.isListening = false;
          
          // Show non-intrusive inline error message instead of alert popup
          this.showSpeechError = true;
          
          // Auto-hide after 5 seconds
          setTimeout(() => {
            this.showSpeechError = false;
            this.cdr.detectChanges();
          }, 5000);
          
          this.cdr.detectChanges();
        }
      }, 800); // Increased delay from 500ms to 800ms to ensure processing completes
    }
  }

  // Clear speech error and reset all blocking flags
  clearSpeechError(): void {
    console.log('🧹 Clearing speech error and resetting flags');
    this.showSpeechError = false;
    this.isProcessingSpeech = false;
    this.isSending = false;
    this.isListening = false;
    this.speechAccumulating = false;
    this.previousMessage = '';
    this.cdr.detectChanges();
  }

  // Normalize text for consistent processing
  private normalizeText(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold** formatting
      .replace(/\*(.*?)\*/g, '$1')     // Remove *italic* formatting
      .replace(/🎭|📝|💬|💡|✏️|🌟|🎪|🎉/g, '') // Remove emojis
      .replace(/\n\n/g, '. ')          // Replace double newlines with periods
      .replace(/\n/g, ' ')             // Replace single newlines with spaces
      .replace(/\s+/g, ' ')            // Normalize whitespace
      .trim();
  }

  // Smart deduplication for mobile speech accumulation
  // Removes duplicate words that appear at the end of previous message and start of new transcript
  private removeDuplicateWords(previousMessage: string, newTranscript: string): string {
      // STEP 1: Remove consecutive duplicate words within the new transcript itself
      // This handles cases like "guten guten guten Morgen" -> "guten Morgen"
      const cleanedTranscript = this.removeConsecutiveDuplicates(newTranscript);

      if (cleanedTranscript !== newTranscript) {
        console.log('🔍 Removed consecutive duplicates:', {
          original: newTranscript,
          cleaned: cleanedTranscript
        });
      }

      const prevWords = previousMessage.trim().split(/\s+/);
      const newWords = cleanedTranscript.trim().split(/\s+/);

      console.log('🔍 Deduplication check:', {
        previousMessage,
        newTranscript: cleanedTranscript,
        prevWords,
        newWords
      });

      // STEP 2: Check if new transcript is completely contained in previous message
      // This handles cases where speech recognition re-captures the same audio
      const prevLower = previousMessage.toLowerCase().trim();
      const newLower = cleanedTranscript.toLowerCase().trim();

      if (prevLower.includes(newLower)) {
        console.log('⚠️ New transcript already contained in previous message - ignoring duplicate');
        return previousMessage; // Don't add duplicate
      }

      // STEP 3: Find the longest overlap between end of previous and start of new
      let overlapLength = 0;
      const maxOverlap = Math.min(prevWords.length, newWords.length);

      for (let i = 1; i <= maxOverlap; i++) {
        const prevEnd = prevWords.slice(-i).join(' ').toLowerCase();
        const newStart = newWords.slice(0, i).join(' ').toLowerCase();

        if (prevEnd === newStart) {
          overlapLength = i;
        }
      }

      if (overlapLength > 0) {
        // Remove the overlapping words from the new transcript
        const deduplicatedNewWords = newWords.slice(overlapLength);

        // If all words were overlapping, don't add anything
        if (deduplicatedNewWords.length === 0) {
          console.log('⚠️ Complete overlap detected - no new words to add');
          return previousMessage;
        }

        const result = previousMessage + ' ' + deduplicatedNewWords.join(' ');

        console.log('✅ Deduplication applied:', {
          previousMessage,
          newTranscript: cleanedTranscript,
          overlapLength,
          overlappingWords: newWords.slice(0, overlapLength).join(' '),
          newWordsAdded: deduplicatedNewWords.join(' '),
          result
        });

        return result.trim();
      }

      // No overlap found, just concatenate
      console.log('✅ No overlap - concatenating');
      return (previousMessage + ' ' + cleanedTranscript).trim();
    }

    /**
     * Remove consecutive duplicate words from a transcript
     * Example: "guten guten guten Morgen" -> "guten Morgen"
     */
    private removeConsecutiveDuplicates(text: string): string {
      if (!text || text.trim().length === 0) {
        return text;
      }

      const words = text.trim().split(/\s+/);
      const result: string[] = [];

      for (let i = 0; i < words.length; i++) {
        const currentWord = words[i].toLowerCase();
        const prevWord = i > 0 ? words[i - 1].toLowerCase() : '';

        // Only add the word if it's different from the previous word
        if (currentWord !== prevWord) {
          result.push(words[i]); // Keep original casing
        } else {
          console.log(`🔍 Skipping consecutive duplicate: "${words[i]}"`);
        }
      }

      return result.join(' ');
    }


  // Text-to-Speech: Speak the AI tutor's response
  speakText(text: string): void {
      if (!this.voiceEnabled || this.isSpeaking) return;

      // Stop any current speech
      this.speechSynthesis.cancel();

      // Clean up markdown formatting and emojis for better speech
      const cleanText = this.normalizeText(text);

      const utterance = new SpeechSynthesisUtterance(cleanText);

      // Debug: Log module language info
      console.log('🔊 TTS Debug:', {
        moduleTitle: this.module?.title,
        targetLanguage: this.module?.targetLanguage,
        nativeLanguage: this.module?.nativeLanguage,
        textPreview: cleanText.substring(0, 50),
        isMobile: this.isMobileDevice()
      });

      // Detect the actual language of the text being spoken
      const detectedLanguage = this.detectTextLanguage(cleanText);
      console.log('🔊 Detected text language:', detectedLanguage);

      // Configure voice based on detected language with platform-specific preferences
      const voices = this.speechSynthesis.getVoices();
      let targetVoice;
      const selectedLang = this.getLanguageCode(detectedLanguage);
      const isMobile = this.isMobileDevice();

      console.log('🔊 Available voices:', voices.length, 'Platform:', isMobile ? 'Mobile' : 'Desktop');

      // Find appropriate voice for the language with platform-specific preferences
      if (selectedLang.startsWith('en')) {
        // English voice selection
        if (isMobile) {
          // Mobile: Prefer native voices (better quality on mobile)
          targetVoice = voices.find(voice => 
            !voice.localService && voice.lang.startsWith('en-US')
          ) || voices.find(voice => 
            voice.lang.startsWith('en-US')
          ) || voices.find(voice => 
            voice.lang.startsWith('en')
          );
        } else {
          // Desktop: Prefer Google voices or high-quality voices
          targetVoice = voices.find(voice => 
            voice.name.includes('Google') && voice.lang.startsWith('en-US')
          ) || voices.find(voice => 
            voice.lang.startsWith('en-US')
          ) || voices.find(voice => 
            voice.lang.startsWith('en')
          );
        }
        console.log('🔊 Using English TTS');
      } else if (selectedLang.startsWith('de')) {
        // German voice selection
        if (isMobile) {
          // Mobile: Prefer native German voices
          targetVoice = voices.find(voice => 
            !voice.localService && voice.lang.startsWith('de-DE')
          ) || voices.find(voice => 
            voice.lang.startsWith('de-DE')
          ) || voices.find(voice => 
            voice.lang.startsWith('de')
          );
        } else {
          // Desktop: Prefer Google German voices
          targetVoice = voices.find(voice => 
            voice.name.includes('Google') && voice.lang.startsWith('de-DE')
          ) || voices.find(voice => 
            voice.lang.startsWith('de-DE')
          ) || voices.find(voice => 
            voice.lang.startsWith('de')
          );
        }
        console.log('🔊 Using German TTS');
      } else if (selectedLang.startsWith('ta')) {
        // Tamil voice selection
        targetVoice = voices.find(voice => 
          voice.lang.startsWith('ta')
        ) || voices.find(voice => 
          voice.name.toLowerCase().includes('tamil')
        );
        console.log('🔊 Using Tamil TTS');
      } else if (selectedLang.startsWith('si')) {
        // Sinhala voice selection
        targetVoice = voices.find(voice => 
          voice.lang.startsWith('si')
        ) || voices.find(voice => 
          voice.name.toLowerCase().includes('sinhala')
        );
        console.log('🔊 Using Sinhala TTS');
      } else {
        // Fallback: Use English as default with platform preference
        if (isMobile) {
          targetVoice = voices.find(voice => 
            !voice.localService && voice.lang.startsWith('en')
          ) || voices.find(voice => 
            voice.lang.startsWith('en')
          );
        } else {
          targetVoice = voices.find(voice => 
            voice.name.includes('Google') && voice.lang.startsWith('en')
          ) || voices.find(voice => 
            voice.lang.startsWith('en')
          );
        }
        console.log('🔊 Using English TTS as fallback');
      }

      utterance.lang = selectedLang;

      console.log('🔊 Selected voice:', {
        name: targetVoice?.name || 'Default',
        lang: targetVoice?.lang || selectedLang,
        localService: targetVoice?.localService,
        platform: isMobile ? 'Mobile' : 'Desktop'
      });

      if (targetVoice) {
        utterance.voice = targetVoice;
      }

      // Level-based speech rate for better learning experience
      // Beginners need slower speech, advanced learners can handle normal speed
      let speechRate = 0.8; // Default rate

      if (this.module?.level) {
        switch (this.module.level.toUpperCase()) {
          case 'A1':
            speechRate = 0.6; // Very slow for absolute beginners
            console.log('🔊 Using A1 rate: 0.6 (very slow for beginners)');
            break;
          case 'A2':
            speechRate = 0.7; // Slow for elementary learners
            console.log('🔊 Using A2 rate: 0.7 (slow for elementary)');
            break;
          case 'B1':
          case 'B2':
            speechRate = 0.8; // Normal learning pace for intermediate
            console.log(`🔊 Using ${this.module.level} rate: 0.8 (normal for intermediate)`);
            break;
          case 'C1':
          case 'C2':
            speechRate = 0.9; // Slightly faster for advanced learners
            console.log(`🔊 Using ${this.module.level} rate: 0.9 (faster for advanced)`);
            break;
          default:
            speechRate = 0.8; // Default fallback
            console.log('🔊 Using default rate: 0.8');
        }
      } else {
        console.log('🔊 No module level found, using default rate: 0.8');
      }

      utterance.rate = speechRate;
      utterance.pitch = 1;
      utterance.volume = 1;

      console.log('🔊 Final TTS settings:', {
        rate: speechRate,
        level: this.module?.level || 'Unknown',
        pitch: 1,
        volume: 1
      });

      // Safety timeout to prevent stuck isSpeaking state (30 seconds max)
      const safetyTimeout = setTimeout(() => {
        if (this.isSpeaking) {
          console.warn('⚠️ TTS safety timeout triggered - forcing isSpeaking to false');
          this.isSpeaking = false;
          this.speechSynthesis.cancel();
          this.cdr.detectChanges();
        }
      }, 30000);

      utterance.onstart = () => {
        this.isSpeaking = true;
        console.log('🔊 Speech started');
        this.cdr.detectChanges();
      };

      utterance.onend = () => {
        clearTimeout(safetyTimeout);
        this.isSpeaking = false;
        console.log('🔊 Speech ended');
        this.cdr.detectChanges();

        // Manual microphone control - students decide when to speak
        // No automatic microphone activation for better learning control
      };

      utterance.onerror = (event) => {
        clearTimeout(safetyTimeout);
        console.error('🔊 Speech error:', event);
        this.isSpeaking = false;
        this.cdr.detectChanges();
      };

      this.speechSynthesis.speak(utterance);
    }


  // Stop current speech
  stopSpeaking(): void {
    this.speechSynthesis.cancel();
    this.isSpeaking = false;
  }

  // Toggle voice functionality
  toggleVoice(): void {
    this.voiceEnabled = !this.voiceEnabled;
    if (!this.voiceEnabled) {
      this.stopSpeaking();
      this.stopListening();
    }
  }

  // Get conversation statistics
  getStudentMessageCount(): number {
    return this.messages.filter(m => m.role === 'student').length;
  }

  getAIMessageCount(): number {
    return this.messages.filter(m => m.role === 'tutor').length;
  }

  getSpeechMessageCount(): number {
    return this.messages.filter(m => 
      m.role === 'student' && m.metadata?.inputMethod === 'speech'
    ).length;
  }

  getTypedMessageCount(): number {
    return this.messages.filter(m => 
      m.role === 'student' && m.metadata?.inputMethod === 'text'
    ).length;
  }

  // Calculate session duration in minutes
  calculateSessionDuration(): number {
    if (!this.sessionStartTime) return 0;
    const now = new Date();
    const durationMs = now.getTime() - this.sessionStartTime.getTime();
    return Math.round(durationMs / 60000); // Convert to minutes
  }

  // Count vocabulary words used by student (basic implementation)
  getVocabularyUsedCount(): number {
    return this.getVocabularyUsedList().length;
  }

  // Get vocabulary usage percentage
  getVocabularyUsagePercentage(): number {
    if (!this.module?.content?.allowedVocabulary) return 0;
    const totalVocab = this.module.content.allowedVocabulary.length;
    const usedVocab = this.getVocabularyUsedCount();
    return totalVocab > 0 ? Math.round((usedVocab / totalVocab) * 100) : 0;
  }

  // Get list of actual vocabulary words used by student
  getVocabularyUsedList(): string[] {
    // If module has defined vocabulary, use that
    if (this.module?.content?.allowedVocabulary && this.module.content.allowedVocabulary.length > 0) {
      const studentMessages = this.messages
        .filter(m => m.role === 'student')
        .map(m => m.content.toLowerCase())
        .join(' ');
      
      const usedVocabulary: string[] = [];
      this.module.content.allowedVocabulary.forEach((vocab: any) => {
        if (studentMessages.includes(vocab.word.toLowerCase())) {
          usedVocabulary.push(vocab.word);
        }
      });
      
      return usedVocabulary;
    }
    
    // Fallback: Extract meaningful words from student messages
    const studentMessages = this.messages
      .filter(m => m.role === 'student')
      .map(m => m.content)
      .join(' ');
    
    if (!studentMessages.trim()) return [];
    
    // Extract words (remove common words, punctuation, etc.)
    const words = studentMessages
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => 
        word.length > 2 && // At least 3 characters
        !['the', 'and', 'but', 'for', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall', 'this', 'that', 'these', 'those', 'with', 'from', 'they', 'them', 'their', 'there', 'where', 'when', 'what', 'who', 'how', 'why', 'yes', 'you', 'your', 'mine', 'his', 'her', 'our', 'stop', 'end', 'finish', 'quit', 'exit'].includes(word)
      );
    
    // Return unique words (first 10 to avoid overwhelming display)
    return [...new Set(words)].slice(0, 10);
  }

  // Transcript control methods
  toggleTranscript(): void {
    this.showTranscript = !this.showTranscript;
    
    // Save preference to localStorage
    localStorage.setItem('transcriptVisible', this.showTranscript.toString());
    
    console.log('📝 Transcript visibility toggled:', this.showTranscript);
  }

  setTranscriptMode(mode: 'full' | 'minimal' | 'hidden'): void {
    this.transcriptMode = mode;
    this.showTranscript = mode !== 'hidden';
    
    // Save preference to localStorage
    localStorage.setItem('transcriptMode', mode);
    localStorage.setItem('transcriptVisible', this.showTranscript.toString());
    
    console.log('📝 Transcript mode changed to:', mode);
  }

  getTranscriptModeLabel(): string {
    switch (this.transcriptMode) {
      case 'full': return 'Full Transcript';
      case 'minimal': return 'Minimal View';
      case 'hidden': return 'Hidden';
      default: return 'Full Transcript';
    }
  }

  // Load transcript preferences from localStorage
  private loadTranscriptPreferences(): void {
    const savedVisible = localStorage.getItem('transcriptVisible');
    const savedMode = localStorage.getItem('transcriptMode') as 'full' | 'minimal' | 'hidden';
    
    if (savedVisible !== null) {
      this.showTranscript = savedVisible === 'true';
    }
    
    if (savedMode) {
      this.transcriptMode = savedMode;
      this.showTranscript = savedMode !== 'hidden';
    }
    
    console.log('📝 Loaded transcript preferences:', { 
      visible: this.showTranscript, 
      mode: this.transcriptMode 
    });
  }

  // Mark module as completed when role-play session ends
  private markModuleAsCompleted(): void {
    this.pendingAutoComplete = false; // Clear flag to prevent double-trigger
    if (!this.moduleId) {
      console.warn('⚠️ Cannot mark module as completed: No module ID');
      return;
    }

    // ✅ CHECK MINIMUM TIME REQUIREMENT BEFORE MARKING AS COMPLETE
    const duration = this.calculateSessionDuration();
    const requiredMinutes = this.module?.minimumCompletionTime || 15;
    
    if (duration < requiredMinutes) {
      console.warn(`⚠️ Cannot mark module as completed: ${duration} min < ${requiredMinutes} min required`);
      return; // Don't mark as complete if insufficient time
    }

    const sessionData = {
      totalScore: this.getTotalEngagementScore(),
      conversationScore: this.getConversationScore(),
      exerciseScore: this.sessionStats.sessionScore || 0,
      messagesExchanged: this.getStudentMessageCount(),
      speechMessages: this.getSpeechMessageCount(),
      sessionType: this.sessionType,
      completedAt: new Date(),
      timeSpentMinutes: duration // ✅ Include duration in session data
    };

    console.log('📋 Marking module as completed with session data:', sessionData);

    this.learningModulesService.markModuleCompleted(this.moduleId, { sessionData }).subscribe({
      next: (response) => {
        console.log('✅ Module marked as completed successfully:', response);
        
        // Prepare session data for database storage
        const duration = this.calculateSessionDuration();
        const conversationCount = this.getStudentMessageCount();
        const vocabularyUsed = this.getVocabularyUsedList();
        
        const sessionRecordData = {
          sessionId: this.sessionId,
          moduleId: this.moduleId,
          sessionType: this.sessionType,
          messages: this.messages,
          summary: {
            conversationCount: conversationCount,
            timeSpentMinutes: duration,
            vocabularyUsed: vocabularyUsed,
            exerciseScore: this.sessionStats.sessionScore,
            conversationScore: this.getConversationScore(),
            totalScore: this.sessionStats.sessionScore + this.getConversationScore(),
            correctAnswers: this.sessionStats.correctAnswers,
            incorrectAnswers: this.sessionStats.incorrectAnswers,
            accuracy: this.getScorePercentage()
          },
          sessionState: 'completed',
          isModuleCompleted: true
        };

        // Save session record to database for teacher review
        this.aiTutorService.saveSessionRecord(sessionRecordData).subscribe({
          next: (saveResponse) => {
            console.log('✅ Module completion session record saved for teacher review');
          },
          error: (saveError) => {
            console.error('❌ Error saving module completion session record:', saveError);
          }
        });
        
        // Show comprehensive success message with detailed metrics
        const accuracy = this.getScorePercentage();
        const vocabularyCount = this.getVocabularyUsedCount();
        const exerciseCount = this.sessionStats.correctAnswers + this.sessionStats.incorrectAnswers;
        
        const completionMessage: TutorMessage = {
          role: 'tutor',
          content: `🎉 Module Completed! 

💬 Conversations: ${sessionData.messagesExchanged}
⏱️ Time Spent: ${duration} minutes
📚 Vocabulary Used: ${vocabularyCount > 0 ? `${vocabularyCount} words` : 'Practice completed'}

✅ Module Status: COMPLETED
🌟 Great job! Ready for your next challenge? 🚀`,
          messageType: 'text',
          timestamp: new Date()
        };

        // Add completion message to chat
        this.aiTutorService.addMessageToCurrentSession(completionMessage);
        
        // Update local messages
        this.localMessages.push(completionMessage);
        this.messages = [...this.localMessages];
        this.cdr.detectChanges();
        
        // Scroll to show completion message
        setTimeout(() => this.scrollToBottom(), 100);
        
        // Automatically redirect to summary after showing completion message
        setTimeout(() => {
          console.log('🔄 Automatically redirecting to session summary...');
          this.navigateToSummary();
        }, 30000); // Wait 30 seconds to let user read the completion message
      },
      error: (error) => {
        console.error('❌ Error marking module as completed:', error);
        
        // Still show a completion message even if backend fails
        const fallbackMessage: TutorMessage = {
          role: 'tutor',
          content: `🎉 Role-play session completed successfully!

You've done great work in this session. Keep up the excellent progress! 🌟`,
          messageType: 'text',
          timestamp: new Date()
        };

        this.aiTutorService.addMessageToCurrentSession(fallbackMessage);
        this.localMessages.push(fallbackMessage);
        this.messages = [...this.localMessages];
        this.cdr.detectChanges();
        setTimeout(() => this.scrollToBottom(), 100);
        
        // Automatically redirect to summary even if backend fails
        setTimeout(() => {
          console.log('🔄 Automatically redirecting to session summary (fallback)...');
          this.navigateToSummary();
        }, 30000);
      }
    });
  }

  // Navigate to session summary/performance history after module completion
  private navigateToSummary(): void {
    if (this.isTeacherTestMode) {
      // For teacher test sessions, go back to learning modules
      console.log('🔄 Teacher test completed, redirecting to learning modules');
      this.router.navigate(['/learning-modules']);
    } else {
      // For student sessions, go to performance history where they can see the summary
      console.log('🔄 Student session completed, redirecting to performance history');
      this.router.navigate(['/performance-history']);
    }
  }

  // Toggle English subtitles
  toggleEnglishSubtitles(): void {
    this.showEnglishSubtitles = !this.showEnglishSubtitles;
    
    if (this.showEnglishSubtitles) {
      this.englishSubtitleCache.clear();
      this.messagesBeingTranslated.clear();
      console.log('🔤 English subtitle cache cleared for fresh translations');
      this.refreshEnglishTranslations();
    } else {
      this.messagesBeingTranslated.clear();
      console.log('🔤 English subtitles hidden');
    }
    
    console.log('🔤 English subtitles toggled:', this.showEnglishSubtitles ? 'ON' : 'OFF');
  }

  // Toggle native language subtitles
  toggleNativeSubtitles(): void {
    this.showNativeSubtitles = !this.showNativeSubtitles;
    
    if (this.showNativeSubtitles) {
      this.nativeSubtitleCache.clear();
      this.messagesBeingTranslated.clear();
      console.log('🔤 Native subtitle cache cleared for fresh translations');
      this.refreshNativeTranslations();
    } else {
      this.messagesBeingTranslated.clear();
      console.log('🔤 Native subtitles hidden');
    }
    
    console.log('🔤 Native subtitles toggled:', this.showNativeSubtitles ? 'ON' : 'OFF');
  }

  // Legacy toggle function (deprecated - kept for compatibility)
  toggleSubtitles(): void {
    // Toggle native subtitles by default for backward compatibility
    this.toggleNativeSubtitles();
  }

  // Refresh English translations
  private refreshEnglishTranslations(): void {
    if (!this.showEnglishSubtitles || !this.module) return;
    
    console.log('🔄 Refreshing English translations with delay...');
    
    this.messages
      .filter(m => m.role === 'tutor')
      .forEach((message, index) => {
        setTimeout(() => {
          this.loadEnglishSubtitleAsync(message);
        }, index * 500);
      });
    
    this.cdr.detectChanges();
  }

  // Refresh native language translations
  private refreshNativeTranslations(): void {
    if (!this.showNativeSubtitles || !this.module) return;
    
    console.log('🔄 Refreshing native translations with delay...');
    
    this.messages
      .filter(m => m.role === 'tutor')
      .forEach((message, index) => {
        setTimeout(() => {
          this.loadNativeSubtitleAsync(message);
        }, index * 500);
      });
    
    this.cdr.detectChanges();
  }

  // Force refresh all translations (legacy support)
  private refreshAllTranslations(): void {
    this.refreshNativeTranslations();
  }

  // Get native language translation for AI messages (LEGACY - kept for compatibility)
  async getMessageTranslation(message: TutorMessage): Promise<string> {
    return this.getNativeTranslation(message);
  }

  // Get English translation for AI messages
  async getEnglishTranslation(message: TutorMessage): Promise<string> {
    if (message.role !== 'tutor' || !this.module) {
      return '';
    }

    const targetLanguage = this.module.targetLanguage;
    
    // Don't translate if already in English
    if (targetLanguage === 'English') {
      return '';
    }

    // Check cache first
    const cacheKey = `${message.content}_${targetLanguage}_English`;
    if (this.englishSubtitleCache.has(cacheKey)) {
      return this.englishSubtitleCache.get(cacheKey) || '';
    }

    // Don't translate if message is likely already in English
    if (this.isMessageInNativeLanguage(message.content, 'English')) {
      return '';
    }

    try {
      this.isTranslating = true;
      const translation = await this.translateMessage(message.content, targetLanguage, 'English');
      
      // Cache the translation
      this.englishSubtitleCache.set(cacheKey, translation);
      
      return translation;
    } catch (error) {
      console.error('❌ English translation error:', error);
      return '';
    } finally {
      this.isTranslating = false;
    }
  }

  // Get native language translation for AI messages
  async getNativeTranslation(message: TutorMessage): Promise<string> {
    if (message.role !== 'tutor' || !this.module) {
      return '';
    }

    const targetLanguage = this.module.targetLanguage;
    const nativeLanguage = this.module.nativeLanguage;
    
    // Don't translate if target and native are the same
    if (targetLanguage === nativeLanguage) {
      return '';
    }

    // Check cache first
    const cacheKey = `${message.content}_${targetLanguage}_${nativeLanguage}`;
    if (this.nativeSubtitleCache.has(cacheKey)) {
      return this.nativeSubtitleCache.get(cacheKey) || '';
    }

    // Don't translate if message is likely already in native language
    if (this.isMessageInNativeLanguage(message.content, nativeLanguage)) {
      return '';
    }

    try {
      this.isTranslating = true;
      const translation = await this.translateMessage(message.content, targetLanguage, nativeLanguage);
      
      // Cache the translation
      this.nativeSubtitleCache.set(cacheKey, translation);
      
      return translation;
    } catch (error) {
      console.error('❌ Native translation error:', error);
      return '';
    } finally {
      this.isTranslating = false;
    }
  }

  // Check if message is likely in native language (simple heuristic)
  private isMessageInNativeLanguage(content: string, nativeLanguage: string): boolean {
    const lowerContent = content.toLowerCase();
    
    // Don't translate session summary/completion messages
    const summaryKeywords = [
      'module completed',
      'session completed', 
      'session complete',
      'congratulations',
      'great job',
      'well done',
      'excellent work',
      'fantastic progress',
      'conversations:',
      'time spent:',
      'vocabulary used:',
      'module status:',
      'session status:',
      'performance',
      'summary',
      'total score',
      'accuracy',
      'keep practicing',
      'next challenge',
      'automatically completed',
      'session ended',
      'practice again'
    ];
    
    // Check if this is a summary/completion message
    const isSummaryMessage = summaryKeywords.some(keyword => 
      lowerContent.includes(keyword.toLowerCase())
    );
    
    if (isSummaryMessage) {
      console.log('📊 Skipping translation for summary/completion message');
      return true; // Treat as native language to skip translation
    }
    
    // Simple detection based on common phrases
    const nativeLanguagePhrases: { [key: string]: string[] } = {
      'English': ['hello', 'thank you', 'goodbye', 'how are you', 'welcome', 'congratulations'],
      'Tamil': ['வணக்கம்', 'நன்றி', 'பயிற்சி', 'வாழ்த்துக்கள்', 'அமர்வு'],
      'Sinhala': ['ආයුබෝවන්', 'ස්තූතියි', 'පුහුණුවීම', 'සුභපැතුම්', 'සැසිය']
    };

    const phrases = nativeLanguagePhrases[nativeLanguage] || [];
    return phrases.some((phrase: string) => lowerContent.includes(phrase.toLowerCase()));
  }

  // Translate message using OpenAI-powered backend service
  private async translateMessage(content: string, fromLanguage: string, toLanguage: string): Promise<string> {
    try {
      console.log('🔤 Translating with OpenAI:', { content: content.substring(0, 50), fromLanguage, toLanguage });
      
      // Use our OpenAI-powered backend translation service with cache busting
      const response = await fetch('/api/translate?' + new URLSearchParams({
        t: Date.now().toString() // Cache busting parameter
      }), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache', // Prevent caching
        },
        body: JSON.stringify({
          text: content,
          from: fromLanguage,
          to: toLanguage
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result.translatedText) {
          console.log('✅ OpenAI translation success:', result.translatedText);
          return result.translatedText;
        }
      } else {
        console.warn('⚠️ Translation API error:', response.status);
      }

      // Fallback message if translation fails
      const languageNames: { [key: string]: string } = {
        'Tamil': 'தமிழில்',
        'Sinhala': 'සිංහලෙන්',
        'English': 'in English',
        'German': 'auf Deutsch'
      };
      
      const nativeName = languageNames[toLanguage] || toLanguage;
      return `💬 ${nativeName} translation processing...`;

    } catch (error) {
      console.error('❌ Translation service error:', error);
      
      // Simple fallback message
      const languageNames: { [key: string]: string } = {
        'Tamil': 'தමிழில்',
        'Sinhala': 'සිංහලෙන්',
        'English': 'in English',
        'German': 'auf Deutsch'
      };
      
      const nativeName = languageNames[toLanguage] || toLanguage;
      return `💬 ${nativeName} translation temporarily unavailable`;
    }
  }

  // Get English subtitle for message (synchronous for template)
  getEnglishSubtitle(message: TutorMessage): string {
    if (!this.showEnglishSubtitles || message.role !== 'tutor' || !this.module) {
      return '';
    }

    const targetLanguage = this.module.targetLanguage;
    
    // Don't show subtitle if already in English
    if (targetLanguage === 'English') {
      return '';
    }

    // Don't show subtitle if message is likely already in English
    if (this.isMessageInNativeLanguage(message.content, 'English')) {
      return '';
    }

    // Check cache first
    const cacheKey = `${message.content}_${targetLanguage}_English`;
    if (this.englishSubtitleCache.has(cacheKey)) {
      return this.englishSubtitleCache.get(cacheKey) || '';
    }

    // Don't translate if this is a loading/typing message or incomplete message
    if (this.isSending || message.content.includes('🤖 Thinking...') || message.content.length < 10) {
      return '';
    }

    // Check if already being translated
    const messageKey = `en_${message.timestamp}_${message.content.substring(0, 50)}`;
    if (this.messagesBeingTranslated.has(messageKey)) {
      return '';
    }

    // Trigger async translation
    setTimeout(() => {
      if (!this.messagesBeingTranslated.has(messageKey)) {
        this.loadEnglishSubtitleAsync(message);
      }
    }, 100);
    
    return '';
  }

  // Get native subtitle for message (synchronous for template)
  getNativeSubtitle(message: TutorMessage): string {
    if (!this.showNativeSubtitles || message.role !== 'tutor' || !this.module) {
      return '';
    }

    const targetLanguage = this.module.targetLanguage;
    const nativeLanguage = this.module.nativeLanguage;
    
    // Don't show subtitle if languages are the same
    if (targetLanguage === nativeLanguage) {
      return '';
    }

    // Don't show subtitle if message is likely already in native language
    if (this.isMessageInNativeLanguage(message.content, nativeLanguage)) {
      return '';
    }

    // Check cache first
    const cacheKey = `${message.content}_${targetLanguage}_${nativeLanguage}`;
    if (this.nativeSubtitleCache.has(cacheKey)) {
      return this.nativeSubtitleCache.get(cacheKey) || '';
    }

    // Don't translate if this is a loading/typing message or incomplete message
    if (this.isSending || message.content.includes('🤖 Thinking...') || message.content.length < 10) {
      return '';
    }

    // Check if already being translated
    const messageKey = `native_${message.timestamp}_${message.content.substring(0, 50)}`;
    if (this.messagesBeingTranslated.has(messageKey)) {
      return '';
    }

    // Trigger async translation
    setTimeout(() => {
      if (!this.messagesBeingTranslated.has(messageKey)) {
        this.loadNativeSubtitleAsync(message);
      }
    }, 100);
    
    return '';
  }

  // Get subtitle for message (LEGACY - kept for compatibility)
  getMessageSubtitle(message: TutorMessage): string {
    return this.getNativeSubtitle(message);
  }

  // Check if a specific message is being translated
  isMessageBeingTranslated(message: TutorMessage, type: 'en' | 'native' = 'native'): boolean {
    const prefix = type === 'en' ? 'en_' : 'native_';
    const messageKey = `${prefix}${message.timestamp}_${message.content.substring(0, 50)}`;
    return this.messagesBeingTranslated.has(messageKey);
  }

  // Load subtitle asynchronously - only after message is complete (LEGACY - kept for compatibility)
  private async loadSubtitleAsync(message: TutorMessage): Promise<void> {
    // Redirect to native subtitle loading
    return this.loadNativeSubtitleAsync(message);
  }

  // Load English subtitle asynchronously
  private async loadEnglishSubtitleAsync(message: TutorMessage): Promise<void> {
    const messageKey = `en_${message.timestamp}_${message.content.substring(0, 50)}`;
    
    if (this.messagesBeingTranslated.has(messageKey)) {
      return;
    }
    
    try {
      this.messagesBeingTranslated.add(messageKey);
      this.cdr.detectChanges();
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (!this.showEnglishSubtitles || !this.messagesBeingTranslated.has(messageKey)) {
        return;
      }
      
      const currentMessage = this.messages.find(m => 
        m.timestamp === message.timestamp && m.content === message.content
      );
      
      if (!currentMessage || !this.showEnglishSubtitles) {
        return;
      }

      console.log('🔤 Starting English translation:', message.content.substring(0, 50));
      
      const translation = await this.getEnglishTranslation(message);
      if (translation) {
        console.log('✅ English translation completed');
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('❌ Error loading English subtitle:', error);
    } finally {
      this.messagesBeingTranslated.delete(messageKey);
      this.cdr.detectChanges();
    }
  }

  // Load native language subtitle asynchronously
  private async loadNativeSubtitleAsync(message: TutorMessage): Promise<void> {
    const messageKey = `native_${message.timestamp}_${message.content.substring(0, 50)}`;
    
    if (this.messagesBeingTranslated.has(messageKey)) {
      return;
    }
    
    try {
      this.messagesBeingTranslated.add(messageKey);
      this.cdr.detectChanges();
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (!this.showNativeSubtitles || !this.messagesBeingTranslated.has(messageKey)) {
        return;
      }
      
      const currentMessage = this.messages.find(m => 
        m.timestamp === message.timestamp && m.content === message.content
      );
      
      if (!currentMessage || !this.showNativeSubtitles) {
        return;
      }

      console.log('🔤 Starting native translation:', message.content.substring(0, 50));
      
      const translation = await this.getNativeTranslation(message);
      if (translation) {
        console.log('✅ Native translation completed');
        this.cdr.detectChanges();
      }
    } catch (error) {
      console.error('❌ Error loading native subtitle:', error);
    } finally {
      this.messagesBeingTranslated.delete(messageKey);
      this.cdr.detectChanges();
    }
  }

  // Check if session is completed or ending (to prevent auto-microphone activation)
  isSessionCompleted(): boolean {
    // Check if session is no longer active
    if (!this.sessionActive) {
      return true;
    }
    
    // Check if the last AI message indicates completion
    const lastAIMessage = this.messages
      .filter(m => m.role === 'tutor')
      .pop();
    
    if (lastAIMessage) {
      const completionKeywords = [
        'congratulations',
        'completed',
        'finished',
        'well done',
        'great job',
        'session ended',
        'module completed',
        'successfully completed',
        'final results'
      ];
      
      const messageContent = lastAIMessage.content.toLowerCase();
      const hasCompletionKeyword = completionKeywords.some(keyword => 
        messageContent.includes(keyword)
      );
      
      // Also check for completion emojis
      const hasCompletionEmoji = messageContent.includes('🎉') || 
                                 messageContent.includes('✅') || 
                                 messageContent.includes('🌟');
      
      if (hasCompletionKeyword || hasCompletionEmoji) {
        console.log('🎯 Session completion detected - preventing auto-microphone activation');
        return true;
      }
    }
    
    return false;
  }

  // Check for automatic completion based on AI response patterns
  private checkForAutoCompletion(aiMessage: TutorMessage): void {
    const messageContent = aiMessage.content.toLowerCase();
    
    // Get both target and native languages for comprehensive completion detection
    const targetLanguage = this.module?.targetLanguage || 'English';
    const nativeLanguage = this.module?.nativeLanguage || 'English';
    
    console.log('🔍 Checking completion for languages:', { targetLanguage, nativeLanguage });
    
    // ✅ TIME-BASED SAFETY CHECK: Only allow completion within 3 minutes of required time
    const currentDuration = this.calculateSessionDuration();
    const requiredMinutes = this.module?.minimumCompletionTime || 15;
    const minimumAllowedTime = Math.max(0, requiredMinutes - 3); // Can complete 3 min before required time
    
    if (currentDuration < minimumAllowedTime) {
      console.log(`⏱️ Too early for completion: ${currentDuration} min < ${minimumAllowedTime} min (required: ${requiredMinutes} min, safety buffer: 3 min)`);
      console.log('🚫 Blocking auto-completion - session too short');
      return; // Block auto-completion
    }
    
    console.log(`✅ Time check passed: ${currentDuration} min >= ${minimumAllowedTime} min (can complete)`);
    
    // ✅ NEW: Combination-based detection - requires multiple keywords to be present
    // This prevents false positives from single words appearing in normal conversation
    const completionCombinations = this.getCompletionCombinations(targetLanguage, nativeLanguage);
    
    // Check if any combination is satisfied
    let matchedCombination: any = null;
    for (const combo of completionCombinations) {
      const allKeywordsPresent = combo.keywords.every((keyword: string) => 
        messageContent.includes(keyword.toLowerCase())
      );
      
      if (allKeywordsPresent) {
        matchedCombination = combo;
        break;
      }
    }
    
    // Exclude messages that ask to continue the current session
    const continueKeywords = ['continue', 'let\'s continue', 'keep going', 'carry on', 'go on', 'more minutes', 'weitermachen', 'weiter üben'];
    const isAskingToContinue = continueKeywords.some(keyword => 
      messageContent.includes(keyword.toLowerCase())
    );
    
    if (matchedCombination && !isAskingToContinue) {
      console.log('🎯 Auto-completion detected in AI response:', {
        targetLanguage,
        nativeLanguage,
        matchedCombination: matchedCombination.description,
        keywords: matchedCombination.keywords,
        isAskingToContinue,
        currentDuration: currentDuration,
        requiredMinutes: requiredMinutes,
        messagePreview: messageContent.substring(0, 100) + '...'
      });
      
      // Flag that completion is pending — if user closes browser, ngOnDestroy can handle it
      this.pendingAutoComplete = true;
      this.registerBeforeUnloadHandler();
      
      // Wait a moment for the message to be displayed, then auto-complete
      setTimeout(() => {
        this.autoCompleteModule();
      }, 2000); // 2 second delay to let user read the message
    } else if (matchedCombination && isAskingToContinue) {
      console.log('⚠️ Completion phrase detected but asking to continue - blocking auto-completion');
    }
  }

  // ✅ NEW: Get completion keyword combinations
  // Requires multiple keywords to be present to confirm completion
  // This prevents false positives from single words in normal conversation
  // IMPORTANT: "module" or "session" is REQUIRED in most combinations, but we have fallback patterns
  private getCompletionCombinations(targetLanguage: string, nativeLanguage: string): any[] {
    const combinations: { [key: string]: any[] } = {
      'English': [
        // PRIMARY: All combinations require "module" or "session" as mandatory keyword
        
        // Combination 1: Module + Congratulations + Completed
        { keywords: ['module', 'congratulations', 'completed'], description: 'Module + Congratulations + Completed' },
        { keywords: ['module', 'congratulations', 'finished'], description: 'Module + Congratulations + Finished' },
        
        // Combination 2: Module + Successfully + Completed
        { keywords: ['module', 'successfully', 'completed'], description: 'Module + Successfully + Completed' },
        { keywords: ['module', 'successfully', 'finished'], description: 'Module + Successfully + Finished' },
        
        // Combination 3: Module + Status + Completed (for system messages)
        { keywords: ['module', 'status', 'completed'], description: 'Module + Status + Completed' },
        { keywords: ['module', 'status', 'finished'], description: 'Module + Status + Finished' },
        
        // Combination 4: Module + Completed (minimum)
        { keywords: ['module', 'completed'], description: 'Module + Completed' },
        { keywords: ['module', 'finished'], description: 'Module + Finished' },
        
        // Session alternatives (if "module" is not used)
        { keywords: ['session', 'congratulations', 'completed'], description: 'Session + Congratulations + Completed' },
        { keywords: ['session', 'successfully', 'completed'], description: 'Session + Successfully + Completed' },
        { keywords: ['session', 'status', 'completed'], description: 'Session + Status + Completed' },
        { keywords: ['session', 'completed'], description: 'Session + Completed' },
        
        // FALLBACK: Patterns without "module" but with strong completion indicators
        // These require 3+ keywords to avoid false positives
        { keywords: ['thank you', 'practicing', 'great work'], description: 'Thank you + Practicing + Great work' },
        { keywords: ['thank you', 'practicing', 'fantastic'], description: 'Thank you + Practicing + Fantastic' },
        { keywords: ['thank you', 'practicing', 'excellent'], description: 'Thank you + Practicing + Excellent' },
        { keywords: ['thank you', 'practicing', 'wonderful'], description: 'Thank you + Practicing + Wonderful' },
        { keywords: ['thank you', 'practicing', 'today'], description: 'Thank you + Practicing + Today' },
        { keywords: ['great work', 'today', 'goodbye'], description: 'Great work + Today + Goodbye' },
        { keywords: ['excellent work', 'today', 'goodbye'], description: 'Excellent work + Today + Goodbye' },
        { keywords: ['wonderful job', 'today', 'goodbye'], description: 'Wonderful job + Today + Goodbye' },
        { keywords: ['well done', 'today', 'goodbye'], description: 'Well done + Today + Goodbye' },
        { keywords: ['fantastic progress', 'goodbye'], description: 'Fantastic progress + Goodbye' },
        { keywords: ['great progress', 'goodbye'], description: 'Great progress + Goodbye' }
      ],
      'German': [
        // PRIMARY: All combinations require "modul" or "sitzung" as mandatory keyword
        
        // Combination 1: Modul + Glückwunsch + Abgeschlossen
        { keywords: ['modul', 'glückwunsch', 'abgeschlossen'], description: 'Modul + Glückwunsch + Abgeschlossen' },
        { keywords: ['modul', 'herzlichen glückwunsch'], description: 'Modul + Herzlichen Glückwunsch' },
        
        // Combination 2: Modul + Erfolgreich + Abgeschlossen
        { keywords: ['modul', 'erfolgreich', 'abgeschlossen'], description: 'Modul + Erfolgreich + Abgeschlossen' },
        
        // Combination 3: Modul + Status + Abgeschlossen
        { keywords: ['modul', 'status', 'abgeschlossen'], description: 'Modul + Status + Abgeschlossen' },
        
        // Combination 4: Modul + Abgeschlossen (minimum)
        { keywords: ['modul', 'abgeschlossen'], description: 'Modul + Abgeschlossen' },
        
        // Combination 5: Modul + Praise words + Abgeschlossen
        { keywords: ['modul', 'wunderbar', 'abgeschlossen'], description: 'Modul + Wunderbar + Abgeschlossen' },
        { keywords: ['modul', 'ausgezeichnet', 'abgeschlossen'], description: 'Modul + Ausgezeichnet + Abgeschlossen' },
        { keywords: ['modul', 'perfekt', 'abgeschlossen'], description: 'Modul + Perfekt + Abgeschlossen' },
        { keywords: ['modul', 'toll', 'abgeschlossen'], description: 'Modul + Toll + Abgeschlossen' },
        
        // Session/Sitzung alternatives
        { keywords: ['sitzung', 'erfolgreich', 'abgeschlossen'], description: 'Sitzung + Erfolgreich + Abgeschlossen' },
        { keywords: ['sitzung', 'abgeschlossen'], description: 'Sitzung + Abgeschlossen' },
        { keywords: ['sitzung', 'beendet'], description: 'Sitzung + Beendet' },
        { keywords: ['session', 'beendet'], description: 'Session + Beendet' },
        
        // FALLBACK: Patterns without "modul" but with strong completion indicators
        { keywords: ['danke', 'üben', 'toll'], description: 'Danke + Üben + Toll' },
        { keywords: ['danke', 'üben', 'wunderbar'], description: 'Danke + Üben + Wunderbar' },
        { keywords: ['danke', 'üben', 'ausgezeichnet'], description: 'Danke + Üben + Ausgezeichnet' },
        { keywords: ['danke', 'üben', 'heute'], description: 'Danke + Üben + Heute' },
        { keywords: ['toll gemacht', 'heute', 'auf wiedersehen'], description: 'Toll gemacht + Heute + Auf Wiedersehen' },
        { keywords: ['wunderbar', 'heute', 'tschüss'], description: 'Wunderbar + Heute + Tschüss' }
      ],
      'Tamil': [
        // PRIMARY: Combination with பாடம் (module)
        { keywords: ['பாடம்', 'வாழ்த்துக்கள்', 'முடிந்தது'], description: 'பாடம் + வாழ்த்துக்கள் + முடிந்தது' },
        { keywords: ['பாடம்', 'முடிந்தது'], description: 'பாடம் + முடிந்தது' },
        { keywords: ['அமர்வு', 'முடிந்தது'], description: 'அமர்வு + முடிந்தது' },
        
        // FALLBACK: Patterns without பாடம்
        { keywords: ['நன்றி', 'பயிற்சி', 'சிறப்பு'], description: 'நன்றி + பயிற்சி + சிறப்பு' },
        { keywords: ['நன்றி', 'பயிற்சி', 'இன்று'], description: 'நன்றி + பயிற்சி + இன்று' },
        // Farewell patterns the AI actually uses
        { keywords: ['நன்றி', 'நல்ல நாள்'], description: 'நன்றி + நல்ல நாள்' },
        { keywords: ['பயிற்சி', 'நன்றி'], description: 'பயிற்சி + நன்றி' },
        { keywords: ['நன்றி', 'இருக்கட்டும்'], description: 'நன்றி + இருக்கட்டும்' },
        { keywords: ['நன்றி', 'சந்திப்போம்'], description: 'நன்றி + சந்திப்போம்' },
        { keywords: ['நன்றி', 'வாழ்த்துக்கள்'], description: 'நன்றி + வாழ்த்துக்கள்' },
        { keywords: ['பயிற்சி', 'நல்ல நாள்'], description: 'பயிற்சி + நல்ல நாள்' }
      ],
      'Sinhala': [
        // PRIMARY: Combination with පාඩම (module)
        { keywords: ['පාඩම', 'සුභපැතුම්', 'අවසන්'], description: 'පාඩම + සුභපැතුම් + අවසන්' },
        { keywords: ['පාඩම', 'අවසන්'], description: 'පාඩම + අවසන්' },
        { keywords: ['සැසිය', 'අවසන්'], description: 'සැසිය + අවසන්' },
        
        // FALLBACK: Patterns without පාඩම
        { keywords: ['ස්තූතියි', 'පුහුණුව', 'විශිෂ්ට'], description: 'ස්තූතියි + පුහුණුව + විශිෂ්ට' },
        { keywords: ['ස්තූතියි', 'පුහුණුව', 'අද'], description: 'ස්තූතියි + පුහුණුව + අද' },
        // Farewell patterns
        { keywords: ['ස්තූතියි', 'හොඳ දිනයක්'], description: 'ස්තූතියි + හොඳ දිනයක්' },
        { keywords: ['පුහුණු', 'ස්තූතියි'], description: 'පුහුණු + ස්තූතියි' },
        { keywords: ['ස්තූතියි', 'සුභපැතුම්'], description: 'ස්තූතියි + සුභපැතුම්' },
        { keywords: ['ස්තූතියි', 'හමුවෙමු'], description: 'ස්තූතියි + හමුවෙමු' },
        { keywords: ['පුහුණු', 'හොඳ දිනයක්'], description: 'පුහුණු + හොඳ දිනයක්' }
      ]
    };
    
    // Get combinations for both target and native languages
    const targetCombos = combinations[targetLanguage] || combinations['English'];
    const nativeCombos = combinations[nativeLanguage] || combinations['English'];
    
    // Combine and deduplicate
    return [...targetCombos, ...nativeCombos];
  }

  // Get completion phrases for specific language
  private getCompletionPhrases(targetLanguage: string): string[] {
    const phrases: { [key: string]: string[] } = {
      'English': [
        'thank you for practicing',
        'have a fantastic day',
        'feel free to reach out',
        'practice again',
        'see you next time',
        'goodbye',
        'until next time',
        'great work today',
        'you did excellent',
        'session is complete',
        'well done today',
        'fantastic progress',
        'keep up the great work',
        'good bye',
        'bye for now',
        'talk to you later',
        'have a great day',
        'wonderful job',
        'excellent work',
        'session completed',
        'module completed',
        'congratulations'
      ],
      'German': [
        'vielen dank fürs üben',
        'danke fürs praktizieren',
        'haben sie einen schönen tag',
        'hab einen schönen tag',
        'auf wiedersehen',
        'bis zum nächsten mal',
        'tschüss',
        'tschau',
        'session beendet',
        'sitzung beendet',
        'modul abgeschlossen',
        'erfolgreich abgeschlossen',
        'dieses modul beendet',
        'du hast abgeschlossen',
        'herzlichen glückwunsch',
        'glückwunsch',
        'bis bald',
        'bereit für die nächste herausforderung',
        'bereit für das nächste modul'
      ],
      'Tamil': [
        'பயிற்சிக்கு நன்றி',
        'நல்ல நாள் இருக்கட்டும்',
        'மீண்டும் பயிற்சி செய்யுங்கள்',
        'அடுத்த முறை சந்திப்போம்',
        'வணக்கம்',
        'பிரியாவிடை',
        'இன்று நல்ல வேலை',
        'சிறப்பாக செய்தீர்கள்',
        'அமர்வு முடிந்தது',
        'நன்றாக செய்தீர்கள்',
        'அருமையான முன்னேற்றம்',
        'தொடர்ந்து செய்யுங்கள்',
        'வாழ்த்துக்கள்',
        'பாராட்டுக்கள்',
        'மிகச் சிறப்பு',
        'அமர்வு நிறைவு',
        'பாடம் முடிந்தது'
      ],
      'Sinhala': [
        'පුහුණුවීමට ස්තූතියි',
        'හොඳ දිනයක් වේවා',
        'නැවත පුහුණු වන්න',
        'ඊළඟ වතාවේ හමුවෙමු',
        'ආයුබෝවන්',
        'සමුගන්නවා',
        'අද හොඳ වැඩක්',
        'ඔබ විශිෂ්ට ලෙස කළා',
        'සැසිය අවසන්',
        'හොඳින් කළා',
        'අපූරු ප්‍රගතියක්',
        'දිගටම කරන්න',
        'සුභපැතුම්',
        'ප්‍රශංසනීය',
        'ඉතා විශිෂ්ට',
        'සැසිය සම්පූර්ණ',
        'පාඩම අවසන්'
      ]
    };
    
    return phrases[targetLanguage] || phrases['English'];
  }

  // Get farewell patterns for specific language
  private getFarewellPatterns(targetLanguage: string): RegExp[] {
    const patterns: { [key: string]: RegExp[] } = {
      'English': [
        /thank you.*practicing.*today/i,
        /have a (great|fantastic|wonderful) day/i,
        /feel free to reach out/i,
        /practice again.*questions/i,
        /(goodbye|see you|bye)/i,
        /until next time/i,
        /keep.*practicing/i,
        /(good bye|talk.*later)/i,
        /(wonderful|excellent).*work/i,
        /session.*(complete|completed|finished)/i,
        /module.*(complete|completed|finished)/i
      ],
      'German': [
        /vielen dank.*üben/i,
        /danke.*praktizieren/i,
        /(haben sie|hab).*schönen tag/i,
        /auf wiedersehen/i,
        /bis zum nächsten mal/i,
        /(tschüss|tschau|bis bald)/i,
        /(großartige|toll).*arbeit/i,
        /(gut|ausgezeichnet|wunderbar).*gemacht/i,
        /weiter.*so/i,
        /(session|sitzung).*(beendet|abgeschlossen)/i,
        /modul.*abgeschlossen/i,
        /herzlichen.*glückwunsch/i
      ],
      'Tamil': [
        /பயிற்சிக்கு.*நன்றி/i,
        /நல்ல.*நாள்/i,
        /மீண்டும்.*பயிற்சி/i,
        /அடுத்த.*முறை/i,
        /(வணக்கம்|பிரியாவிடை)/i,
        /நல்ல.*வேலை/i,
        /சிறப்பாக.*செய்தீர்கள்/i,
        /அமர்வு.*முடிந்தது/i,
        /நன்றாக.*செய்தீர்கள்/i,
        /அருமையான.*முன்னேற்றம்/i,
        /(வாழ்த்துக்கள்|பாராட்டுக்கள்)/i,
        /பாடம்.*முடிந்தது/i
      ],
      'Sinhala': [
        /පුහුණුවීමට.*ස්තූතියි/i,
        /හොඳ.*දිනයක්/i,
        /නැවත.*පුහුණු/i,
        /ඊළඟ.*වතාවේ/i,
        /(ආයුබෝවන්|සමුගන්නවා)/i,
        /හොඳ.*වැඩක්/i,
        /විශිෂ්ට.*ලෙස/i,
        /සැසිය.*අවසන්/i,
        /හොඳින්.*කළා/i,
        /අපූරු.*ප්‍රගතියක්/i,
        /(සුභපැතුම්|ප්‍රශංසනීය)/i,
        /පාඩම.*අවසන්/i
      ]
    };
    
    return patterns[targetLanguage] || patterns['English'];
  }

  // Get practice encouragement phrases for specific language
  private getPracticeEncouragementPhrases(targetLanguage: string): string[] {
    const phrases: { [key: string]: string[] } = {
      'English': [
        'practice again',
        'feel free to reach out',
        'have any other questions',
        'come back anytime',
        'practice more',
        'keep practicing',
        'try again later'
      ],
      'German': [
        'üben sie weiter',
        'praktizieren sie weiter',
        'kommen sie gerne wieder',
        'haben sie noch fragen',
        'melden sie sich gerne',
        'bis zum nächsten üben',
        'weiter üben',
        'mehr praktizieren'
      ],
      'Tamil': [
        'மீண்டும் பயிற்சி செய்யுங்கள்',
        'தொடர்ந்து பயிற்சி செய்யுங்கள்',
        'எப்போது வேண்டுமானாலும் வாருங்கள்',
        'வேறு கேள்விகள் உள்ளதா',
        'தொடர்பு கொள்ளுங்கள்',
        'அடுத்த பயிற்சிக்கு வாருங்கள்',
        'மேலும் பயிற்சி செய்யுங்கள்'
      ],
      'Sinhala': [
        'නැවත පුහුණු වන්න',
        'දිගටම පුහුණු වන්න',
        'ඕනෑම වේලාවක එන්න',
        'වෙනත් ප්‍රශ්න තිබේද',
        'සම්බන්ධ වන්න',
        'ඊළඟ පුහුණුවට එන්න',
        'තවත් පුහුණු වන්න'
      ]
    };
    
    return phrases[targetLanguage] || phrases['English'];
  }

  // Automatically complete the module when AI indicates session is done
  // Register beforeunload handler so browser close still triggers completion
  private registerBeforeUnloadHandler(): void {
    if (this.boundBeforeUnload) return; // Already registered
    this.boundBeforeUnload = () => {
      if (this.pendingAutoComplete && this.moduleId && this.sessionActive) {
        const duration = this.calculateSessionDuration();
        const data = JSON.stringify({
          sessionData: {
            totalScore: 0,
            messagesExchanged: this.getStudentMessageCount(),
            sessionType: this.sessionType,
            completedAt: new Date().toISOString(),
            timeSpentMinutes: duration
          },
          autoCompleted: true
        });
        // Use sendBeacon for reliable delivery on page close
        navigator.sendBeacon('/api/learning-modules/' + this.moduleId + '/complete', new Blob([data], { type: 'application/json' }));
        console.log('📡 Sent completion beacon on browser close');
      }
    };
    window.addEventListener('pagehide', this.boundBeforeUnload);
    window.addEventListener('beforeunload', this.boundBeforeUnload);
  }

  private autoCompleteModule(): void {
    if (!this.sessionActive) {
      console.log('⚠️ Session already inactive, skipping auto-completion');
      return;
    }
    
    // Clear pending flag to prevent double-trigger from ngOnDestroy/beforeunload
    this.pendingAutoComplete = false;
    
    // ✅ CHECK MINIMUM TIME REQUIREMENT BEFORE AUTO-COMPLETING
    const duration = this.calculateSessionDuration();
    const requiredMinutes = this.module?.minimumCompletionTime || 15;
    
    // ✅ ALWAYS ALLOW COMPLETION when AI detects natural end (role-play finished, etc.)
    const minutesShort = requiredMinutes - duration;
    const isEarlyCompletion = duration < requiredMinutes;
    
    if (isEarlyCompletion) {
      console.log(`🎯 Early completion detected: ${duration} min (${minutesShort} min before ${requiredMinutes} min requirement)`);
    } else {
      console.log(`🎯 Auto-completing module: ${duration} min >= ${requiredMinutes} min required`);
    }
    
    // Stop any ongoing speech
    this.speechSynthesis.cancel();
    this.isSpeaking = false;
    
    // Stop listening
    if (this.isListening) {
      this.stopListening();
    }
    
    // Mark as completed and end session
    this.sessionActive = false;
    
    // Calculate session metrics
    const conversationCount = this.getStudentMessageCount();
    const vocabularyUsed = this.getVocabularyUsedList();
    
    // STAGE 1: Show celebration message with early completion acknowledgment
    let celebrationContent = '';
    
    if (isEarlyCompletion) {
      // Early completion message - user's exact requested format
      celebrationContent = `🎉 Great progress! You completed the module ${minutesShort} minute${minutesShort > 1 ? 's' : ''} before the given time. 

I'm finishing the module now but if you want to try again you can try again. 

Thank you! 🌟

📊 Your Session Summary:
• Practice Time: ${duration} minutes
• Conversations: ${conversationCount} exchanges
• Vocabulary Practiced: ${vocabularyUsed.length} words
• Module Status: ✅ COMPLETED

You'll be redirected to the summary page shortly...`;
    } else {
      // Normal completion message
      celebrationContent = `🎉✨ CONGRATULATIONS! ✨🎉

🌟 Module Completed Successfully! 🌟

You've done an amazing job!

📊 Your Session Summary:
• Practice Time: ${duration} minutes
• Conversations: ${conversationCount} exchanges
• Vocabulary Practiced: ${vocabularyUsed.length} words
• Module Status: ✅ COMPLETED

You'll be redirected to the summary page shortly...`;
    }
    
    const celebrationMessage: TutorMessage = {
      role: 'tutor',
      content: celebrationContent,
      messageType: 'text',
      timestamp: new Date(),
      metadata: { 
        isCelebration: true,
        autoCompleted: true 
      } as any
    };
    
    // Add celebration message to chat
    this.aiTutorService.addMessageToCurrentSession(celebrationMessage);
    this.localMessages.push(celebrationMessage);
    this.messages = [...this.localMessages];
    this.cdr.detectChanges();
    
    // Scroll to show celebration message
    setTimeout(() => this.scrollToBottom(), 100);
    
    // STAGE 2: After 15 seconds, show detailed summary (stays for 15 seconds minimum)
    setTimeout(() => {
      this.showDetailedCompletionSummary(duration, conversationCount, vocabularyUsed);
    }, 15000); // 15 seconds delay
  }

  // Show detailed completion summary after celebration
  private showDetailedCompletionSummary(duration: number, conversationCount: number, vocabularyUsed: string[]): void {
    // Prepare session data for database storage
    const sessionData = {
      sessionId: this.sessionId,
      moduleId: this.moduleId,
      sessionType: this.sessionType,
      messages: this.messages,
      summary: {
        conversationCount: conversationCount,
        timeSpentMinutes: duration,
        vocabularyUsed: vocabularyUsed,
        exerciseScore: this.sessionStats.sessionScore,
        conversationScore: this.getConversationScore(),
        totalScore: this.sessionStats.sessionScore + this.getConversationScore(),
        correctAnswers: this.sessionStats.correctAnswers,
        incorrectAnswers: this.sessionStats.incorrectAnswers,
        accuracy: this.getScorePercentage()
      },
      sessionState: 'completed', // Auto-completed by AI
      isModuleCompleted: true // Mark module as completed
    };

    // Save session record and mark module as completed
    this.aiTutorService.saveSessionRecord(sessionData).subscribe({
      next: (saveResponse) => {
        console.log('✅ Auto-completed session record saved');
        
        // Also mark module as completed in the learning modules system
        this.markModuleAsCompletedWithData(sessionData);
      },
      error: (saveError) => {
        console.error('❌ Error saving auto-completed session record:', saveError);
        // Still try to mark module as completed
        this.markModuleAsCompletedWithData(sessionData);
      }
    });
    
    // Add detailed summary message to chat
    const summaryMessage: TutorMessage = {
      role: 'tutor',
      content: `📊 Session Summary

💬 Conversations: ${conversationCount}
⏱️ Time Spent: ${duration} minutes
📚 Vocabulary Used: ${vocabularyUsed.length > 0 ? vocabularyUsed.join(', ') : 'Practice completed'}
🎯 Total Score: ${sessionData.summary.totalScore} points

✅ **Module Status: COMPLETED**

🌟 Excellent work! You've successfully completed this module!

You can now move on to the next challenge or review your progress in the performance history.`,
      messageType: 'text',
      timestamp: new Date(),
      metadata: { 
        isSummary: true,
        autoCompleted: true 
      } as any
    };
    
    // Add summary message to chat
    this.aiTutorService.addMessageToCurrentSession(summaryMessage);
    this.localMessages.push(summaryMessage);
    this.messages = [...this.localMessages];
    this.cdr.detectChanges();
    
    // Scroll to show summary message
    setTimeout(() => this.scrollToBottom(), 100);
    
    // Auto-redirect after 15 seconds (summary stays visible for 15 seconds minimum)
    setTimeout(() => {
      console.log('🔄 Automatically redirecting after summary display...');
      this.navigateToSummary();
    }, 15000); // 15 seconds = minimum display time
    
    // End the backend session
    this.aiTutorService.endSession(this.sessionId).subscribe({
      next: (response) => {
        console.log('✅ Backend session ended after auto-completion');
      },
      error: (error) => {
        console.error('❌ Error ending backend session:', error);
      }
    });
  }

  // Mark module as completed with session data
  private markModuleAsCompletedWithData(sessionData: any): void {
    if (!this.moduleId) {
      console.warn('⚠️ Cannot mark module as completed: No module ID');
      return;
    }

    console.log('📋 Marking module as completed with session data:', sessionData.summary);

    this.learningModulesService.markModuleCompleted(this.moduleId, { 
      sessionData: sessionData.summary,
      autoCompleted: true 
    }).subscribe({
      next: (response) => {
        console.log('✅ Module marked as completed successfully (auto-completion):', response);
      },
      error: (error) => {
        console.error('❌ Error marking module as completed (auto-completion):', error);
      }
    });
  }

  // Request subscription upgrade
  private requestUpgrade(): void {
    this.http.post(`${environment.apiUrl}/upgrade-requests/request-upgrade`, {
      phone: 'Not provided', // Can be updated if you have phone field
      message: 'Student requested PLATINUM upgrade for AI Tutoring access'
    }, { withCredentials: true }).subscribe({
      next: (response: any) => {
        alert(`✅ Upgrade Request Submitted!\n\n${response.message}\n\nOur sales team will contact you soon to discuss pricing and payment options.`);
        this.router.navigate(['/learning-modules']);
      },
      error: (error) => {
        console.error('Error submitting upgrade request:', error);
        alert('❌ Failed to submit upgrade request. Please contact support directly.');
        this.router.navigate(['/learning-modules']);
      }
    });
  }
}
