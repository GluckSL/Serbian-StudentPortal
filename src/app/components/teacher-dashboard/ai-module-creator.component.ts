// src/app/components/teacher-dashboard/ai-module-creator.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { LearningModulesService } from '../../services/learning-modules.service';
import { ModuleDataTransferService } from '../../services/module-data-transfer.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../services/notification.service';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-ai-module-creator',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="container-fluid py-4">
      <div class="row justify-content-center">
        <div class="col-lg-8 col-xl-6">
          <div class="card ai-creator-card">
            <div class="card-header text-center">
              <div class="ai-header-icon">
                <i class="fas fa-robot"></i>
              </div>
              <h3 class="mb-0">🎭 AI Role-Play Creator</h3>
              <p class="text-muted mb-0">Let AI generate a complete role-play scenario for you</p>
            </div>
            
            <div class="card-body">
              <form [formGroup]="aiForm" (ngSubmit)="generateModule()" *ngIf="!isGenerating && !generatedModule">
                <!-- Basic Requirements -->
                <div class="mb-4">
                  <h5 class="section-title">
                    <i class="fas fa-info-circle text-primary"></i>
                    Basic Information
                  </h5>
                  
                  <div class="row g-3">
                    <div class="col-md-6">
                      <label class="form-label">Target Language *</label>
                      <select class="form-select" formControlName="targetLanguage">
                        <option value="">Select Language</option>
                        <option *ngFor="let language of availableLanguages" [value]="language">{{language}}</option>
                      </select>
                    </div>
                    
                    <div class="col-md-6">
                      <label class="form-label">Native Language *</label>
                      <select class="form-select" formControlName="nativeLanguage">
                        <option value="">Select Language</option>
                        <option *ngFor="let language of availableNativeLanguages" [value]="language">{{language}}</option>
                      </select>
                    </div>
                    
                    <div class="col-md-12">
                      <div class="row">
                        <div class="col-md-6">
                          <label class="form-label">Level *</label>
                          <select class="form-select" formControlName="level" (change)="onLevelChange()">
                            <option value="">Select Level</option>
                            <option *ngFor="let level of levels" [value]="level">{{level}}</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- Module Description -->
                <div class="mb-4">
                  <h5 class="section-title">
                    <i class="fas fa-lightbulb text-warning"></i>
                    Module Description
                  </h5>
                  
                  <div class="mb-3">
                    <label class="form-label">What should this module teach? *</label>
                    <textarea 
                      class="form-control" 
                      rows="4" 
                      formControlName="description" 
                      placeholder="Describe what you want students to learn. For example: 'A module about ordering food in a restaurant, including greetings, menu vocabulary, asking questions about dishes, and paying the bill.'"></textarea>
                    <small class="form-text text-muted">
                      Be specific about the learning objectives, vocabulary, and situations you want to cover.
                    </small>
                  </div>
                  
                  <div class="row g-3">
                    <div class="col-md-12">
                      <label class="form-label">Module Type</label>
                      <select class="form-select" formControlName="moduleType" [disabled]="true">>
                        <option value="roleplay">🎭 Role-Play Module</option>
                      </select>
                      <small class="form-text text-muted">All modules are role-play focused. Session time is tracked automatically during student interactions.</small>
                    </div>
                  </div>
                </div>
                
                <!-- Role-Play Configuration (only shown when roleplay is selected) -->
                <div class="mb-4" *ngIf="aiForm.get('moduleType')?.value === 'roleplay'">
                  <h5 class="section-title">
                    <i class="fas fa-theater-masks text-success"></i>
                    Role-Play Configuration
                  </h5>
                  
                  <div class="roleplay-config">
                    <p class="text-muted mb-3">
                      <i class="fas fa-lightbulb me-2"></i>
                      Define the basic roles - AI will generate all other details automatically!
                    </p>
                    
                    <div class="row g-3">
                      <div class="col-md-6">
                        <label class="form-label">Student Role *</label>
                        <input 
                          type="text" 
                          class="form-control" 
                          formControlName="studentRole" 
                          placeholder="e.g., Customer, Tourist, Job applicant"
                          required>
                        <small class="form-text text-muted">What role will the student play? (Default: Student)</small>
                        <div class="text-danger small mt-1" *ngIf="aiForm.get('studentRole')?.invalid && aiForm.get('studentRole')?.touched">
                          Student role is required for role-play modules
                        </div>
                      </div>
                      
                      <div class="col-md-6">
                        <label class="form-label">AI Role *</label>
                        <input 
                          type="text" 
                          class="form-control" 
                          formControlName="aiRole" 
                          placeholder="e.g., Waiter, Shop assistant, Interviewer"
                          required>
                        <small class="form-text text-muted">What role will the AI play? (Default: Teacher)</small>
                        <div class="text-danger small mt-1" *ngIf="aiForm.get('aiRole')?.invalid && aiForm.get('aiRole')?.touched">
                          AI role is required for role-play modules
                        </div>
                      </div>
                    </div>
                    
                    <div class="ai-generation-note mt-3 p-3 bg-light rounded">
                      <h6 class="text-success mb-2">
                        <i class="fas fa-magic me-2"></i>AI will automatically generate:
                      </h6>
                      <div class="row">
                        <div class="col-md-6">
                          <ul class="list-unstyled mb-0">
                            <li><i class="fas fa-check text-success me-2"></i>Role personalities</li>
                            <li><i class="fas fa-check text-success me-2"></i>Opening conversation lines</li>
                            <li><i class="fas fa-check text-success me-2"></i>Student guidance</li>
                          </ul>
                        </div>
                        <div class="col-md-6">
                          <ul class="list-unstyled mb-0">
                            <li><i class="fas fa-check text-success me-2"></i>Scenario details</li>
                            <li><i class="fas fa-check text-success me-2"></i>Conversation flow</li>
                            <li><i class="fas fa-check text-success me-2"></i>Role-specific vocabulary</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- AI Generation Options -->
                <div class="mb-4">
                  <h5 class="section-title">
                    <i class="fas fa-cogs text-info"></i>
                    Role-Play Generation Options
                  </h5>
                  
                  <div class="ai-options">
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" formControlName="generateVocabulary" id="generateVocabulary">
                      <label class="form-check-label" for="generateVocabulary">
                        Generate scenario-specific vocabulary with translations
                      </label>
                      <small class="form-text text-muted">Creates vocabulary relevant to your specific role-play situation</small>
                    </div>
                    
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" formControlName="generateExercises" id="generateExercises">
                      <label class="form-check-label" for="generateExercises">
                        Create role-play practice exercises
                      </label>
                      <small class="form-text text-muted">Generates exercises to prepare students for the conversation</small>
                    </div>
                    
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" formControlName="generateConversation" id="generateConversation">
                      <label class="form-check-label" for="generateConversation">
                        Generate conversation flow and example dialogues
                      </label>
                      <small class="form-text text-muted">Creates sample conversations and conversation stages for the scenario</small>
                    </div>
                    
                    <div class="form-check">
                      <input class="form-check-input" type="checkbox" formControlName="generateCulturalNotes" id="generateCulturalNotes">
                      <label class="form-check-label" for="generateCulturalNotes">
                        Include cultural context and etiquette tips
                      </label>
                      <small class="form-text text-muted">Adds cultural information relevant to the role-play scenario</small>
                    </div>
                  </div>
                  
                  <div class="mt-3 p-3 bg-light rounded">
                    <h6 class="text-info mb-2">
                      <i class="fas fa-lightbulb me-2"></i>Role-Play Generation Tips:
                    </h6>
                    <ul class="list-unstyled mb-0 small">
                      <li><i class="fas fa-check text-success me-2"></i><strong>Vocabulary:</strong> Essential for students to understand key terms in the scenario</li>
                      <li><i class="fas fa-check text-success me-2"></i><strong>Exercises:</strong> Help students practice before the actual role-play conversation</li>
                      <li><i class="fas fa-check text-success me-2"></i><strong>Conversation Flow:</strong> Provides structure and example dialogues for the scenario</li>
                      <li><i class="fas fa-check text-success me-2"></i><strong>Cultural Notes:</strong> Important for real-world scenarios (restaurants, business, social situations)</li>
                    </ul>
                  </div>
                </div>
                
                <!-- Generate Button -->
                <div class="text-center">
                  <button 
                    type="submit" 
                    class="btn btn-warning btn-lg px-5"
                    [disabled]="aiForm.invalid">
                    <i class="fas fa-magic me-2"></i>
                    Generate Module with AI
                  </button>
                </div>
              </form>
              
              <!-- Generation Progress -->
              <div *ngIf="isGenerating" class="text-center py-5">
                <div class="ai-generating">
                  <div class="spinner-border text-warning mb-3" style="width: 3rem; height: 3rem;"></div>
                  <h4>🤖 AI is creating your module...</h4>
                  <p class="text-muted">{{generationStatus}}</p>
                  <div class="progress mt-3" style="height: 8px;">
                    <div class="progress-bar bg-warning progress-bar-striped progress-bar-animated" 
                         [style.width.%]="generationProgress"></div>
                  </div>
                </div>
              </div>
              
              <!-- Generated Module Preview -->
              <div *ngIf="generatedModule && !isGenerating" class="generated-module">
                <div class="alert alert-success">
                  <i class="fas fa-check-circle me-2"></i>
                  <strong>Module generated successfully!</strong> Review and edit as needed.
                </div>
                
                <div class="module-preview">
                  <h5>📋 Generated Module: {{generatedModule?.title || 'Untitled Module'}}</h5>
                  <p class="text-muted">{{generatedModule?.description || 'No description available'}}</p>
                  
                  <div class="row g-3 mb-3">
                    <div class="col-md-4">
                      <small class="text-muted">Level:</small><br>
                      <span class="badge bg-primary">{{generatedModule?.level || 'N/A'}}</span>
                    </div>
                    <div class="col-md-4">
                      <small class="text-muted">Category:</small><br>
                      <span class="badge bg-info">{{generatedModule?.category || 'N/A'}}</span>
                    </div>
                    <div class="col-md-4">
                      <small class="text-muted">Vocabulary:</small><br>
                      <span class="badge bg-success">{{getVocabularyCount()}} words</span>
                    </div>
                  </div>
                  
                  <div class="action-buttons">
                    <button class="btn btn-success me-2" (click)="saveModule()">
                      <i class="fas fa-save me-2"></i>
                      Save Module
                    </button>
                    <button class="btn btn-outline-primary me-2" (click)="editModule()">
                      <i class="fas fa-edit me-2"></i>
                      Edit & Customize
                    </button>
                    <button class="btn btn-outline-secondary" (click)="startOver()">
                      <i class="fas fa-redo me-2"></i>
                      Start Over
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div class="card-footer text-center">
              <button class="btn btn-secondary" (click)="goBack()" *ngIf="!isGenerating">
                <i class="fas fa-arrow-left me-2"></i>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ai-creator-card {
      border: none;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      border-radius: 1rem;
      overflow: hidden;
    }
    
    .card-header {
      background: linear-gradient(135deg, #ffc107, #e0a800);
      color: white;
      padding: 2rem;
      border-bottom: none;
    }
    
    .ai-header-icon {
      width: 60px;
      height: 60px;
      margin: 0 auto 1rem;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }
    
    .section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #f8f9fa;
    }
    
    .ai-options {
      background: #f8f9fa;
      padding: 1.5rem;
      border-radius: 0.5rem;
      border-left: 4px solid #ffc107;
    }
    
    .roleplay-config {
      background: #f0f8ff;
      padding: 1.5rem;
      border-radius: 0.5rem;
      border-left: 4px solid #28a745;
    }
    
    .ai-generation-note {
      border: 2px solid #28a745;
      background: linear-gradient(135deg, #f8fff9, #e8f5e8);
    }
    
    .ai-generation-note h6 {
      color: #28a745;
      font-weight: 600;
    }
    
    .form-check {
      margin-bottom: 0.75rem;
    }
    
    .form-check-label {
      font-weight: 500;
    }
    
    .ai-generating {
      padding: 2rem;
    }
    
    .generated-module {
      border: 2px solid #28a745;
      border-radius: 0.75rem;
      padding: 1.5rem;
      background: #f8fff9;
    }
    
    .module-preview {
      margin-top: 1rem;
    }
    
    .action-buttons {
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid #dee2e6;
    }
    
    .progress {
      max-width: 300px;
      margin: 0 auto;
    }
    
    @media (max-width: 768px) {
      .card-header {
        padding: 1.5rem;
      }
      
      .ai-header-icon {
        width: 50px;
        height: 50px;
        font-size: 1.25rem;
      }
      
      .action-buttons .btn {
        width: 100%;
        margin-bottom: 0.5rem;
      }
    }
  `]
})
export class AiModuleCreatorComponent implements OnInit {
  aiForm: FormGroup;
  isGenerating = false;
  generatedModule: any = null;
  generationStatus = 'Initializing AI...';
  generationProgress = 0;
  
  // Form options
  levels: string[] = [];
  availableLanguages: string[] = [];
  availableNativeLanguages: string[] = [];
  
  constructor(
    private fb: FormBuilder,
    private learningModulesService: LearningModulesService,
    private moduleDataTransferService: ModuleDataTransferService,
    private router: Router,
    private http: HttpClient,
    private notify: NotificationService
  ) {
    this.aiForm = this.createForm();
  }
  
  ngOnInit(): void {
    this.initializeOptions();
    // Initialize role-play validators since all modules are now role-play
    this.onModuleTypeChange();
  }
  
  createForm(): FormGroup {
    return this.fb.group({
      targetLanguage: ['English', Validators.required],
      nativeLanguage: ['English', Validators.required],
      level: ['', Validators.required],
      category: ['Conversation'], // Fixed for role-play modules
      difficulty: ['Beginner'], // Auto-set based on level
      description: ['', [Validators.required, Validators.minLength(20)]],
      moduleType: ['roleplay'], // Default to role-play
      
      // Role-play fields with default values (Student and Teacher)
      studentRole: ['Student', Validators.required],
      aiRole: ['Teacher', Validators.required],
      
      // AI generation options
      generateVocabulary: [true],
      generateExercises: [true],
      generateConversation: [true],
      generateCulturalNotes: [false]
    });
  }
  
  initializeOptions(): void {
    this.levels = this.learningModulesService.getAvailableLevels();
    this.availableLanguages = this.learningModulesService.getAvailableLanguages();
    this.availableNativeLanguages = this.learningModulesService.getAvailableNativeLanguages();
  }
  
  onModuleTypeChange(): void {
    const moduleType = this.aiForm.get('moduleType')?.value;
    
    if (moduleType === 'roleplay') {
      // Role-play modules MUST have roles - set validators and default values
      this.aiForm.get('studentRole')?.setValidators([Validators.required]);
      this.aiForm.get('aiRole')?.setValidators([Validators.required]);
      
      // Set default values if empty
      if (!this.aiForm.get('studentRole')?.value) {
        this.aiForm.patchValue({ studentRole: 'Student' });
      }
      if (!this.aiForm.get('aiRole')?.value) {
        this.aiForm.patchValue({ aiRole: 'Teacher' });
      }
    } else {
      // Standard modules don't need roles
      this.aiForm.get('studentRole')?.clearValidators();
      this.aiForm.get('aiRole')?.clearValidators();
    }
    
    // Update form validation
    this.aiForm.get('studentRole')?.updateValueAndValidity();
    this.aiForm.get('aiRole')?.updateValueAndValidity();
  }

  onLevelChange(): void {
    const level = this.aiForm.get('level')?.value;
    if (level) {
      // Auto-set difficulty based on CEFR level
      let difficulty = 'Beginner';
      if (['B1', 'B2'].includes(level)) {
        difficulty = 'Intermediate';
      } else if (['C1', 'C2'].includes(level)) {
        difficulty = 'Advanced';
      }
      this.aiForm.patchValue({ difficulty });
    }
  }
  
  async generateModule(): Promise<void> {
    if (this.aiForm.invalid) {
      this.aiForm.markAllAsTouched();
      
      // Show specific error for missing roles
      if (this.aiForm.get('moduleType')?.value === 'roleplay') {
        if (!this.aiForm.get('studentRole')?.value || !this.aiForm.get('aiRole')?.value) {
          this.notify.warning('Role-play modules require both Student Role and AI Role to be specified.');
          return;
        }
      }
      
      this.notify.warning('Please fill in all required fields before generating the module.');
      return;
    }
    
    this.isGenerating = true;
    this.generationProgress = 0;
    
    try {
      // Simulate AI generation process with progress updates
      await this.simulateAIGeneration();
      
      // Call the actual AI generation API
      const formData = this.aiForm.value;
      console.log('📋 Generating module with form data:', formData);
      
      const response = await this.callAIGenerationAPI(formData);
      
      // Validate and clean the response
      this.generatedModule = this.validateAndCleanResponse(response, formData);
      this.isGenerating = false;
      
      console.log('✅ Module generation completed successfully:', this.generatedModule.title);
      
    } catch (error) {
      console.error('❌ Error generating module:', error);
      
      // Create a fallback module to prevent undefined values
      const formData = this.aiForm.value;
      this.generatedModule = this.createFallbackModule(formData);
      this.isGenerating = false;
      
      // Show user-friendly error message
      this.notify.info('AI generation encountered an issue, but we created a basic module template for you. You can edit and customize it as needed.');
    }
  }
  
  private validateAndCleanResponse(response: any, formData: any): any {
    // ✅ Calculate intelligent minimum completion time
    const minimumCompletionTime = this.calculateMinimumCompletionTime(formData, response);
    
    // Ensure all required fields exist and are not undefined
    const cleanedResponse = {
      title: response?.title || `${formData.targetLanguage} ${formData.category} - ${formData.level}`,
      description: response?.description || formData.description || 'AI-generated learning module',
      targetLanguage: response?.targetLanguage || formData.targetLanguage,
      nativeLanguage: response?.nativeLanguage || formData.nativeLanguage,
      level: response?.level || formData.level,
      category: response?.category || formData.category,
      difficulty: response?.difficulty || formData.difficulty,
      estimatedDuration: 30, // Default value - actual time tracked per session
      minimumCompletionTime: minimumCompletionTime, // ✅ AI-calculated minimum time
      learningObjectives: response?.learningObjectives || [
        {
          objective: `Learn ${formData.category.toLowerCase()} skills in ${formData.targetLanguage}`,
          description: `Develop ${formData.level} level ${formData.category.toLowerCase()} abilities`
        }
      ],
      content: {
        introduction: this.generateModuleIntroduction(response?.targetLanguage || formData.targetLanguage, formData.category),
        keyTopics: response?.content?.keyTopics || [formData.category],
        allowedVocabulary: response?.content?.allowedVocabulary || [],
        allowedGrammar: response?.content?.allowedGrammar || [],
        examples: response?.content?.examples || [],
        exercises: response?.content?.exercises || [],
        
        // Role-play specific content
        ...(formData.moduleType === 'roleplay' && {
          rolePlayScenario: {
            situation: response?.content?.rolePlayScenario?.situation || formData.rolePlaySituation,
            setting: response?.content?.rolePlayScenario?.setting || formData.rolePlaySetting,
            studentRole: response?.content?.rolePlayScenario?.studentRole || formData.studentRole,
            aiRole: response?.content?.rolePlayScenario?.aiRole || formData.aiRole,
            objective: response?.content?.rolePlayScenario?.objective || formData.rolePlayObjective,
            aiPersonality: response?.content?.rolePlayScenario?.aiPersonality || formData.aiPersonality,
            studentGuidance: response?.content?.rolePlayScenario?.studentGuidance || formData.studentGuidance,
            aiOpeningLines: response?.content?.rolePlayScenario?.aiOpeningLines || [],
            suggestedStudentResponses: response?.content?.rolePlayScenario?.suggestedStudentResponses || []
          }
        })
      },
      aiTutorConfig: {
        personality: response?.aiTutorConfig?.personality || formData.aiPersonality || `friendly and encouraging ${formData.targetLanguage} tutor`,
        focusAreas: response?.aiTutorConfig?.focusAreas || [formData.category],
        helpfulPhrases: response?.aiTutorConfig?.helpfulPhrases || [],
        commonMistakes: response?.aiTutorConfig?.commonMistakes || [],
        culturalNotes: response?.aiTutorConfig?.culturalNotes || [],
        
        // CRITICAL: AI Tutor Vocabulary Control
        allowedVocabulary: response?.aiTutorConfig?.allowedVocabulary || 
                          response?.content?.allowedVocabulary || [],
        
        // Role-play instructions
        ...(formData.moduleType === 'roleplay' && {
          rolePlayInstructions: {
            aiRole: formData.aiRole,
            aiPersonality: formData.aiPersonality,
            openingLines: response?.aiTutorConfig?.rolePlayInstructions?.openingLines || [],
            studentRole: formData.studentRole,
            studentGuidance: formData.studentGuidance,
            suggestedResponses: response?.aiTutorConfig?.rolePlayInstructions?.suggestedResponses || []
          }
        })
      },
      tags: response?.tags || [
        formData.level.toLowerCase(), 
        formData.category.toLowerCase(),
        ...(formData.moduleType === 'roleplay' ? ['role-play'] : [])
      ],
      isActive: true
    };
    
    console.log('🔧 Response validated and cleaned:', cleanedResponse.title);
    return cleanedResponse;
  }
  
  private createFallbackModule(formData: any): any {
    // ✅ Calculate intelligent minimum completion time
    const minimumCompletionTime = this.calculateMinimumCompletionTime(formData, null);
    
    const baseModule = {
      title: `${formData.targetLanguage} ${formData.category} - ${formData.level}`,
      description: formData.description || 'Learning module created with AI assistance',
      targetLanguage: formData.targetLanguage,
      nativeLanguage: formData.nativeLanguage,
      level: formData.level,
      category: formData.category,
      difficulty: formData.difficulty,
      estimatedDuration: 30, // Default value - actual time tracked per session
      minimumCompletionTime: minimumCompletionTime, // ✅ AI-calculated minimum time
      learningObjectives: [
        {
          objective: `Learn ${formData.category.toLowerCase()} skills in ${formData.targetLanguage}`,
          description: `Develop ${formData.level} level ${formData.category.toLowerCase()} abilities`
        }
      ],
      content: {
        introduction: this.generateModuleIntroduction(formData.targetLanguage, formData.category),
        keyTopics: [formData.category],
        allowedVocabulary: [],
        allowedGrammar: [],
        examples: [],
        exercises: [],
        
        // Add role-play scenario if it's a role-play module
        ...(formData.moduleType === 'roleplay' && {
          rolePlayScenario: {
            situation: formData.rolePlaySituation || 'General conversation',
            setting: formData.rolePlaySetting || 'A friendly environment',
            studentRole: formData.studentRole || 'Student',
            aiRole: formData.aiRole || 'Teacher',
            objective: formData.rolePlayObjective || 'Practice conversation skills',
            aiPersonality: formData.aiPersonality || 'Friendly and encouraging tutor',
            studentGuidance: formData.studentGuidance || 'Be natural and don\'t worry about making mistakes',
            aiOpeningLines: [],
            suggestedStudentResponses: []
          }
        })
      },
      aiTutorConfig: {
        personality: formData.aiPersonality || `friendly and encouraging ${formData.targetLanguage} tutor`,
        focusAreas: [formData.category],
        helpfulPhrases: [],
        commonMistakes: [],
        culturalNotes: [],
        allowedVocabulary: [], // AI tutor vocabulary control
        
        // Add role-play instructions if it's a role-play module
        ...(formData.moduleType === 'roleplay' && {
          rolePlayInstructions: {
            aiRole: formData.aiRole || 'Teacher',
            aiPersonality: formData.aiPersonality || 'Friendly and encouraging teacher',
            openingLines: [],
            studentRole: formData.studentRole || 'Student',
            studentGuidance: formData.studentGuidance || 'Be natural and don\'t worry about making mistakes',
            suggestedResponses: []
          }
        })
      },
      tags: [
        formData.level.toLowerCase(), 
        formData.category.toLowerCase(),
        ...(formData.moduleType === 'roleplay' ? ['role-play'] : [])
      ],
      isActive: true
    };
    
    return baseModule;
  }
  
  private async simulateAIGeneration(): Promise<void> {
    const steps = [
      { message: 'Analyzing requirements...', progress: 20 },
      { message: 'Generating vocabulary...', progress: 40 },
      { message: 'Creating exercises...', progress: 60 },
      { message: 'Building conversation examples...', progress: 80 },
      { message: 'Finalizing module structure...', progress: 100 }
    ];
    
    for (const step of steps) {
      this.generationStatus = step.message;
      this.generationProgress = step.progress;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  private async callAIGenerationAPI(formData: any): Promise<any> {
    try {
      console.log('🤖 Calling AI generation API with data:', formData);
      
      // This will call our backend AI generation endpoint
      const response = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/ai/generate-module`, formData, {
          withCredentials: true
        })
      );
      
      console.log('✅ AI generation response received:', response);
      
      // Validate the response has required fields
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid response format from AI generation API');
      }
      
      // Check for undefined values in critical fields
      const criticalFields = ['title', 'description', 'targetLanguage', 'nativeLanguage', 'level', 'category', 'difficulty'];
      const undefinedFields = criticalFields.filter(field => (response as any)[field] === undefined);
      
      if (undefinedFields.length > 0) {
        console.warn('⚠️ Found undefined fields in AI response:', undefinedFields);
        
        // Fix undefined fields with fallback values
        const fixedResponse = { ...response };
        undefinedFields.forEach(field => {
          switch (field) {
            case 'title':
              (fixedResponse as any)[field] = `${formData.targetLanguage} ${formData.category} Module`;
              break;
            case 'description':
              (fixedResponse as any)[field] = formData.description || 'AI-generated learning module';
              break;
            case 'targetLanguage':
              (fixedResponse as any)[field] = formData.targetLanguage;
              break;
            case 'nativeLanguage':
              (fixedResponse as any)[field] = formData.nativeLanguage;
              break;
            case 'level':
              (fixedResponse as any)[field] = formData.level;
              break;
            case 'category':
              (fixedResponse as any)[field] = formData.category;
              break;
            case 'difficulty':
              (fixedResponse as any)[field] = formData.difficulty;
              break;
          }
        });
        
        console.log('🔧 Fixed undefined fields in response');
        return fixedResponse;
      }
      
      return response;
      
    } catch (error) {
      console.error('❌ Error calling AI generation API:', error);
      
      // ✅ Calculate intelligent minimum completion time
      const minimumCompletionTime = this.calculateMinimumCompletionTime(formData, null);
      
      // Create a fallback response to prevent undefined values
      const fallbackResponse = {
        title: `${formData.targetLanguage} ${formData.category} - ${formData.level}`,
        description: formData.description || 'AI-generated learning module',
        targetLanguage: formData.targetLanguage,
        nativeLanguage: formData.nativeLanguage,
        level: formData.level,
        category: formData.category,
        difficulty: formData.difficulty,
        estimatedDuration: 30, // Default value - actual time tracked per session
        minimumCompletionTime: minimumCompletionTime, // ✅ AI-calculated minimum time
        learningObjectives: [
          {
            objective: `Learn ${formData.category.toLowerCase()} skills in ${formData.targetLanguage}`,
            description: `Develop ${formData.level} level ${formData.category.toLowerCase()} abilities`
          }
        ],
        content: {
          introduction: `Welcome to this ${formData.targetLanguage} ${formData.category.toLowerCase()} module.`,
          keyTopics: [formData.category],
          allowedVocabulary: [],
          allowedGrammar: [],
          examples: [],
          exercises: []
        },
        aiTutorConfig: {
          personality: `friendly and encouraging ${formData.targetLanguage} tutor`,
          focusAreas: [formData.category],
          helpfulPhrases: [],
          commonMistakes: [],
          culturalNotes: []
        },
        tags: [formData.level.toLowerCase(), formData.category.toLowerCase()],
        isActive: true
      };
      
      console.log('🔄 Using fallback response to prevent undefined values');
      throw error; // Re-throw to trigger the error handling in generateModule()
    }
  }
  
  generateModuleIntroduction(targetLanguage: string, category: string): string {
    // Generate language-specific introductions for role-play modules
    const introductions: { [key: string]: { [key: string]: string } } = {
      'German': {
        'Conversation': 'Willkommen zu diesem Rollenspiel-Modul! Hier wirst du praktische Gesprächsfähigkeiten in realistischen Situationen üben.',
        'Grammar': 'Willkommen zu diesem Grammatik-Modul! Wir werden wichtige deutsche Grammatikregeln durch praktische Übungen lernen.',
        'Vocabulary': 'Willkommen zu diesem Wortschatz-Modul! Du wirst neue deutsche Wörter in natürlichen Kontexten lernen.',
        'Reading': 'Willkommen zu diesem Lesemodul! Wir werden deine deutschen Lesefähigkeiten durch interessante Texte verbessern.',
        'Writing': 'Willkommen zu diesem Schreibmodul! Du wirst lernen, auf Deutsch klar und effektiv zu schreiben.',
        'Listening': 'Willkommen zu diesem Hörverständnis-Modul! Wir werden deine Fähigkeit verbessern, gesprochenes Deutsch zu verstehen.'
      },
      'English': {
        'Conversation': 'Welcome to this role-play module! Here you will practice practical conversation skills in realistic situations.',
        'Grammar': 'Welcome to this grammar module! We will learn important English grammar rules through practical exercises.',
        'Vocabulary': 'Welcome to this vocabulary module! You will learn new English words in natural contexts.',
        'Reading': 'Welcome to this reading module! We will improve your English reading skills through interesting texts.',
        'Writing': 'Welcome to this writing module! You will learn to write clearly and effectively in English.',
        'Listening': 'Welcome to this listening module! We will improve your ability to understand spoken English.'
      }
    };
    
    // Get language-specific introduction or fall back to English
    const languageIntros = introductions[targetLanguage] || introductions['English'];
    return languageIntros[category] || languageIntros['Conversation'] || 'Welcome to this learning module!';
  }

  getVocabularyCount(): number {
    return this.generatedModule?.content?.allowedVocabulary?.length || 0;
  }
  
  saveModule(): void {
    if (!this.generatedModule) return;
    
    this.learningModulesService.createModule(this.generatedModule).subscribe({
      next: (response) => {
        this.notify.success('Module saved successfully!');
        this.router.navigate(['/learning-modules']);
      },
      error: (error) => {
        console.error('Error saving module:', error);
        this.notify.error('Failed to save module. Please try again.');
      }
    });
  }
  
  editModule(): void {
    if (!this.generatedModule) {
      console.log('❌ No generated module data to edit');
      return;
    }
    
    console.log('🔄 Transferring AI-generated module data for editing:', this.generatedModule.title);
    
    // Store the generated module in both the service and sessionStorage as backup
    this.moduleDataTransferService.setGeneratedModule(this.generatedModule);
    sessionStorage.setItem('aiGeneratedModule', JSON.stringify(this.generatedModule));
    
    this.router.navigate(['/create-roleplay-module']);
  }
  
  startOver(): void {
    this.generatedModule = null;
    this.isGenerating = false;
    this.generationProgress = 0;
    this.aiForm.reset({
      targetLanguage: 'English',
      nativeLanguage: 'English',
      moduleType: 'roleplay', // Always role-play now
      category: 'Conversation',
      difficulty: 'Beginner',
      studentRole: 'Student', // Default role
      aiRole: 'Teacher', // Default role
      generateVocabulary: true,
      generateExercises: true,
      generateConversation: true,
      generateCulturalNotes: false
    });
  }
  
  /**
   * ✅ Intelligently calculate minimum completion time based on module characteristics
   */
  private calculateMinimumCompletionTime(formData: any, response: any): number {
    let suggestedTime = 15; // Default
    
    // Check if it's a role-play module
    if (formData.moduleType === 'roleplay') {
      const situation = (formData.rolePlaySituation || response?.content?.rolePlayScenario?.situation || '').toLowerCase();
      
      // Quick scenarios (5-8 minutes)
      const quickScenarios = [
        'ordering coffee', 'buying ticket', 'asking directions', 
        'greeting', 'introduction', 'quick chat', 'small talk',
        'coffee', 'ticket', 'directions', 'hello', 'hi'
      ];
      
      // Standard scenarios (10-15 minutes)
      const standardScenarios = [
        'restaurant', 'shopping', 'hotel', 'pharmacy', 
        'post office', 'bank', 'doctor', 'dentist',
        'store', 'shop', 'market', 'hospital'
      ];
      
      // Complex scenarios (15-20 minutes)
      const complexScenarios = [
        'job interview', 'business meeting', 'negotiation',
        'complaint', 'problem solving', 'debate', 'presentation',
        'interview', 'meeting', 'negotiate', 'discuss'
      ];
      
      if (quickScenarios.some(s => situation.includes(s))) {
        suggestedTime = 7;
      } else if (standardScenarios.some(s => situation.includes(s))) {
        suggestedTime = 12;
      } else if (complexScenarios.some(s => situation.includes(s))) {
        suggestedTime = 18;
      } else {
        // Default for role-play
        suggestedTime = 12;
      }
    } else {
      // Non-role-play modules - based on category
      const category = formData.category?.toLowerCase() || '';
      
      if (category === 'grammar' || category === 'vocabulary') {
        suggestedTime = 15; // Standard practice time
      } else if (category === 'conversation') {
        suggestedTime = 12; // Conversation practice
      } else if (category === 'reading' || category === 'writing') {
        suggestedTime = 20; // More time for reading/writing
      } else if (category === 'listening') {
        suggestedTime = 10; // Listening exercises
      } else {
        suggestedTime = 15; // Default
      }
    }
    
    // Adjust based on difficulty level
    const difficulty = formData.difficulty?.toLowerCase() || '';
    if (difficulty === 'beginner') {
      suggestedTime += 2; // Beginners need more time
    } else if (difficulty === 'advanced') {
      suggestedTime -= 2; // Advanced learners can be faster
    }
    
    // Adjust based on CEFR level
    const level = formData.level?.toUpperCase() || '';
    if (level === 'A1') {
      suggestedTime += 2; // A1 needs more time
    } else if (level === 'C1' || level === 'C2') {
      suggestedTime -= 2; // C1/C2 can be faster
    }
    
    // Ensure time is within valid range (5-60 minutes)
    suggestedTime = Math.max(5, Math.min(60, suggestedTime));
    
    console.log(`🤖 AI calculated minimum completion time: ${suggestedTime} minutes`, {
      moduleType: formData.moduleType,
      category: formData.category,
      difficulty: formData.difficulty,
      level: formData.level,
      situation: formData.rolePlaySituation
    });
    
    return suggestedTime;
  }
  
  goBack(): void {
    this.router.navigate(['/module-creation-choice']);
  }
}