// src/app/components/teacher-dashboard/roleplay-module-form.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LearningModulesService } from '../../services/learning-modules.service';
import { ModuleDataTransferService } from '../../services/module-data-transfer.service';

@Component({
  selector: 'app-roleplay-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="container-fluid py-4">
      <div class="row">
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h4 class="mb-0">🎭 {{ isEditMode ? 'Edit' : 'Create' }} Role-Play Module</h4>
              <button class="btn btn-secondary" (click)="goBack()">
                <i class="fas fa-arrow-left"></i> Back
              </button>
            </div>
            
            <div class="card-body">
              <form [formGroup]="moduleForm" (ngSubmit)="onSubmit()">
                
                <!-- Basic Information -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">📝 Basic Information</h5>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Module Title *</label>
                    <input type="text" class="form-control" formControlName="title" 
                           placeholder="e.g., Restaurant Conversation">
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Description *</label>
                    <textarea class="form-control" rows="2" formControlName="description" 
                              placeholder="Brief description of the role-play scenario"></textarea>
                  </div>
                </div>

                <!-- Language & Level -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">🌍 Language & Level</h5>
                  </div>
                  
                  <div class="col-md-3 mb-3">
                    <label class="form-label">Target Language *</label>
                    <select class="form-select" formControlName="targetLanguage">
                      <option value="">Select Language</option>
                      <option *ngFor="let language of availableLanguages" [value]="language">{{language}}</option>
                    </select>
                  </div>
                  
                  <div class="col-md-3 mb-3">
                    <label class="form-label">Native Language *</label>
                    <select class="form-select" formControlName="nativeLanguage">
                      <option value="">Select Language</option>
                      <option *ngFor="let language of availableNativeLanguages" [value]="language">{{language}}</option>
                    </select>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Level *</label>
                    <select class="form-select" formControlName="level" (change)="onLevelChange()">
                      <option value="">Select Level</option>
                      <option *ngFor="let level of levels" [value]="level">{{level}}</option>
                    </select>
                    <small class="form-text text-muted">
                      CEFR proficiency level - determines content complexity and student access
                    </small>
                  </div>
                  
                  <!-- NEW: Minimum Completion Time -->
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Minimum Completion Time (minutes) *</label>
                    <input type="number" class="form-control" formControlName="minimumCompletionTime" 
                           min="5" max="60" placeholder="10">
                    <small class="form-text text-muted">
                      ⏱️ Minimum time required to complete this module (5-60 min)
                      <br><strong>Suggestions:</strong> Quick (5-8 min) | Standard (10-15 min) | Complex (15-20 min)
                    </small>
                  </div>
                </div>

                <!-- Role-Play Scenario -->
                <div class="row mb-4" formGroupName="rolePlayScenario">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">🎭 Role-Play Scenario</h5>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Situation *</label>
                    <input type="text" class="form-control" formControlName="situation" 
                           placeholder="e.g., At a restaurant, Job interview, Shopping">
                    <small class="form-text text-muted">The context/location of the role-play</small>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Setting</label>
                    <input type="text" class="form-control" formControlName="setting" 
                           placeholder="e.g., A busy restaurant in Berlin">
                    <small class="form-text text-muted">Detailed description of the environment</small>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Student Role *</label>
                    <input type="text" class="form-control" formControlName="studentRole" 
                           placeholder="e.g., Customer, Tourist, Job applicant">
                    <small class="form-text text-muted">What role the student plays</small>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">AI Role *</label>
                    <input type="text" class="form-control" formControlName="aiRole" 
                           placeholder="e.g., Waiter, Shop assistant, Interviewer">
                    <small class="form-text text-muted">What role the AI plays</small>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Objective</label>
                    <textarea class="form-control" rows="2" formControlName="objective" 
                              placeholder="e.g., Order a meal, ask about prices, and request the bill"></textarea>
                    <small class="form-text text-muted">What the student should accomplish in this role-play</small>
                  </div>
                </div>

                <!-- Role Personalities & Introductions -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">🎪 Role Personalities & Introductions</h5>
                    <p class="text-muted">Define how each role should behave and introduce themselves</p>
                  </div>
                  
                  <!-- AI Role Personality -->
                  <div class="col-md-6 mb-3">
                    <label class="form-label">AI Role Personality</label>
                    <textarea class="form-control" rows="3" [(ngModel)]="aiRolePersonality" 
                              [ngModelOptions]="{standalone: true}"
                              placeholder="e.g., Friendly and helpful waiter, professional but approachable, speaks clearly and patiently"></textarea>
                    <small class="form-text text-muted">How should the AI behave in this role?</small>
                  </div>
                  
                  <!-- Student Role Guidance -->
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Student Role Guidance</label>
                    <textarea class="form-control" rows="3" [(ngModel)]="studentRoleGuidance" 
                              [ngModelOptions]="{standalone: true}"
                              placeholder="e.g., You are a tourist visiting Germany for the first time. Be polite and ask questions if you don't understand something."></textarea>
                    <small class="form-text text-muted">Instructions for the student about their role</small>
                  </div>
                  
                  <!-- AI Opening Lines -->
                  <div class="col-12 mb-3">
                    <label class="form-label">AI Opening Lines</label>
                    <div class="row g-2 mb-2">
                      <div class="col-md-10">
                        <input type="text" class="form-control" [(ngModel)]="newAiOpeningLine" 
                               [ngModelOptions]="{standalone: true}" 
                               placeholder="e.g., Guten Tag! Welcome to our restaurant. How can I help you today?">
                      </div>
                      <div class="col-md-2">
                        <button type="button" class="btn btn-outline-primary w-100" (click)="addAiOpeningLine()">
                          <i class="fas fa-plus"></i> Add
                        </button>
                      </div>
                    </div>
                    
                    <div class="opening-lines-list">
                      <div *ngFor="let line of aiOpeningLines; let i = index" 
                           class="d-flex align-items-center mb-2 p-2 border rounded">
                        <div class="flex-grow-1">
                          <i class="fas fa-robot text-primary me-2"></i>
                          {{line}}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeAiOpeningLine(i)">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                    <small class="form-text text-muted">Different ways the AI can start the conversation</small>
                  </div>
                  
                  <!-- Suggested Student Responses -->
                  <div class="col-12 mb-3">
                    <label class="form-label">Suggested Student Responses</label>
                    <div class="row g-2 mb-2">
                      <div class="col-md-10">
                        <input type="text" class="form-control" [(ngModel)]="newStudentResponse" 
                               [ngModelOptions]="{standalone: true}" 
                               placeholder="e.g., Hallo! Ich hätte gern einen Tisch für zwei Personen.">
                      </div>
                      <div class="col-md-2">
                        <button type="button" class="btn btn-outline-success w-100" (click)="addStudentResponse()">
                          <i class="fas fa-plus"></i> Add
                        </button>
                      </div>
                    </div>
                    
                    <div class="student-responses-list">
                      <div *ngFor="let response of suggestedStudentResponses; let i = index" 
                           class="d-flex align-items-center mb-2 p-2 border rounded">
                        <div class="flex-grow-1">
                          <i class="fas fa-user text-success me-2"></i>
                          {{response}}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeStudentResponse(i)">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                    <small class="form-text text-muted">Example responses students can use to get started</small>
                  </div>
                </div>

                <!-- Vocabulary Constraints -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">📚 Student Learning Vocabulary</h5>
                    <p class="text-muted">Words that students should learn in this module (10-20 words)</p>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <div class="row g-2 mb-2">
                      <div class="col-md-4">
                        <input type="text" class="form-control" [(ngModel)]="newVocabWord" 
                               [ngModelOptions]="{standalone: true}" placeholder="Word/Phrase">
                      </div>
                      <div class="col-md-4">
                        <input type="text" class="form-control" [(ngModel)]="newVocabTranslation" 
                               [ngModelOptions]="{standalone: true}" placeholder="Translation">
                      </div>
                      <div class="col-md-3">
                        <input type="text" class="form-control" [(ngModel)]="newVocabCategory" 
                               [ngModelOptions]="{standalone: true}" placeholder="Category">
                      </div>
                      <div class="col-md-1">
                        <button type="button" class="btn btn-outline-primary w-100" (click)="addVocabulary()">
                          <i class="fas fa-plus"></i>
                        </button>
                      </div>
                    </div>

                    <!-- CSV Upload for Student Vocabulary -->
                    <div class="mb-2">
                      <input type="file" class="d-none" accept=".csv" #studentVocabCsv 
                             (change)="onStudentVocabCsvUpload($event)">
                      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="studentVocabCsv.click()">
                        <i class="fas fa-file-csv me-1"></i> Import from CSV
                      </button>
                      <small class="text-muted ms-2">Format: word, translation (optional), category (optional) — translations auto-generated if missing</small>
                      <span *ngIf="isTranslating" class="ms-2 text-primary">
                        <span class="spinner-border spinner-border-sm me-1"></span>Auto-translating...
                      </span>
                    </div>
                    
                    <div class="vocabulary-list">
                      <div *ngFor="let vocab of allowedVocabulary; let i = index" 
                           class="d-flex align-items-center mb-2 p-2 border rounded">
                        <div class="flex-grow-1">
                          <strong>{{vocab.word}}</strong> - {{vocab.translation}}
                          <small class="text-muted ms-2">({{vocab.category}})</small>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeVocabulary(i)">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                    <small class="text-muted">
                      <i class="fas fa-info-circle me-1"></i>
                      These are the core words students will learn
                    </small>
                  </div>
                </div>

                <!-- AI Tutor Vocabulary Control -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">🤖 AI Tutor Vocabulary Control</h5>
                    <p class="text-muted">
                      <strong>Control what vocabulary the AI tutor can use during conversations (15-30 words)</strong>
                      <br>
                      <small>
                        <i class="fas fa-lightbulb text-warning me-1"></i>
                        Include all student vocabulary PLUS additional support words the AI needs for natural conversation
                      </small>
                    </p>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <div class="row g-2 mb-2">
                      <div class="col-md-3">
                        <input type="text" class="form-control" [(ngModel)]="newAiVocabWord" 
                               [ngModelOptions]="{standalone: true}" placeholder="Word/Phrase">
                      </div>
                      <div class="col-md-3">
                        <input type="text" class="form-control" [(ngModel)]="newAiVocabTranslation" 
                               [ngModelOptions]="{standalone: true}" placeholder="Translation">
                      </div>
                      <div class="col-md-2">
                        <input type="text" class="form-control" [(ngModel)]="newAiVocabCategory" 
                               [ngModelOptions]="{standalone: true}" placeholder="Category">
                      </div>
                      <div class="col-md-3">
                        <input type="text" class="form-control" [(ngModel)]="newAiVocabUsage" 
                               [ngModelOptions]="{standalone: true}" placeholder="Usage example">
                      </div>
                      <div class="col-md-1">
                        <button type="button" class="btn btn-outline-success w-100" (click)="addAiVocabulary()">
                          <i class="fas fa-plus"></i>
                        </button>
                      </div>
                    </div>
                    
                    <div class="mb-2">
                      <button type="button" class="btn btn-sm btn-outline-info" (click)="copyStudentVocabToAi()">
                        <i class="fas fa-copy me-1"></i>
                        Copy Student Vocabulary to AI
                      </button>
                      <small class="text-muted ms-2">Quick start: Copy all student words, then add AI support words</small>
                    </div>

                    <!-- CSV Upload for AI Tutor Vocabulary -->
                    <div class="mb-2">
                      <input type="file" class="d-none" accept=".csv" #aiVocabCsv 
                             (change)="onAiVocabCsvUpload($event)">
                      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="aiVocabCsv.click()">
                        <i class="fas fa-file-csv me-1"></i> Import from CSV
                      </button>
                      <small class="text-muted ms-2">Format: word, translation (optional), category, usage — translations auto-generated if missing</small>
                      <span *ngIf="isTranslating" class="ms-2 text-primary">
                        <span class="spinner-border spinner-border-sm me-1"></span>Auto-translating...
                      </span>
                    </div>
                    
                    <div class="vocabulary-list border rounded p-2" style="background-color: #f8f9fa;">
                      <div *ngIf="aiTutorVocabulary.length === 0" class="text-center text-muted py-3">
                        <i class="fas fa-robot fa-2x mb-2"></i>
                        <p class="mb-0">No AI vocabulary defined yet. Add words the AI tutor can use.</p>
                      </div>
                      <div *ngFor="let vocab of aiTutorVocabulary; let i = index" 
                           class="d-flex align-items-start mb-2 p-2 border rounded bg-white">
                        <div class="flex-grow-1">
                          <div>
                            <strong class="text-success">{{vocab.word}}</strong> - {{vocab.translation}}
                            <small class="text-muted ms-2">({{vocab.category}})</small>
                          </div>
                          <div *ngIf="vocab.usage" class="small text-muted mt-1">
                            <i class="fas fa-quote-left me-1"></i>{{vocab.usage}}
                          </div>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeAiVocabulary(i)">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                    <small class="text-success">
                      <i class="fas fa-check-circle me-1"></i>
                      AI tutor will only use these {{aiTutorVocabulary.length}} words during conversations
                    </small>
                  </div>
                </div>

                <!-- Grammar Constraints -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">📖 Allowed Grammar</h5>
                    <p class="text-muted">Define the grammar structures the AI should focus on</p>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <div class="row g-2 mb-2">
                      <div class="col-md-6">
                        <input type="text" class="form-control" [(ngModel)]="newGrammarStructure" 
                               [ngModelOptions]="{standalone: true}" placeholder="Grammar structure (e.g., Present tense)">
                      </div>
                      <div class="col-md-5">
                        <input type="text" class="form-control" [(ngModel)]="newGrammarExample" 
                               [ngModelOptions]="{standalone: true}" placeholder="Example">
                      </div>
                      <div class="col-md-1">
                        <button type="button" class="btn btn-outline-primary w-100" (click)="addGrammar()">
                          <i class="fas fa-plus"></i>
                        </button>
                      </div>
                    </div>

                    <!-- CSV Upload for Grammar -->
                    <div class="mb-2">
                      <input type="file" class="d-none" accept=".csv" #grammarCsv 
                             (change)="onGrammarCsvUpload($event)">
                      <button type="button" class="btn btn-sm btn-outline-secondary" (click)="grammarCsv.click()">
                        <i class="fas fa-file-csv me-1"></i> Import from CSV
                      </button>
                      <small class="text-muted ms-2">Format: structure, example1; example2; example3</small>
                    </div>
                    
                    <div class="grammar-list">
                      <div *ngFor="let grammar of allowedGrammar; let i = index" 
                           class="d-flex align-items-center mb-2 p-2 border rounded">
                        <div class="flex-grow-1">
                          <strong>{{grammar.structure}}</strong>
                          <div class="text-muted small">Examples: {{grammar.examples.join(', ')}}</div>
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeGrammar(i)">
                          <i class="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Optional Conversation Flow -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">💬 Conversation Flow (Optional)</h5>
                    <p class="text-muted">Define the expected flow of the conversation</p>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <div class="row g-2 mb-2">
                      <div class="col-md-3">
                        <input type="text" class="form-control" [(ngModel)]="newFlowStage" 
                               [ngModelOptions]="{standalone: true}" placeholder="Stage (e.g., greeting)">
                      </div>
                      <div class="col-md-4">
                        <input type="text" class="form-control" [(ngModel)]="newFlowAiPrompt" 
                               [ngModelOptions]="{standalone: true}" placeholder="What AI might say">
                      </div>
                      <div class="col-md-4">
                        <input type="text" class="form-control" [(ngModel)]="newFlowExpectedResponse" 
                               [ngModelOptions]="{standalone: true}" placeholder="Expected student response">
                      </div>
                      <div class="col-md-1">
                        <button type="button" class="btn btn-outline-primary w-100" (click)="addConversationFlow()">
                          <i class="fas fa-plus"></i>
                        </button>
                      </div>
                    </div>
                    
                    <div class="flow-list">
                      <div *ngFor="let flow of conversationFlow; let i = index" 
                           class="mb-3 p-3 border rounded">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                          <h6 class="mb-0">Stage: {{flow.stage}}</h6>
                          <button type="button" class="btn btn-sm btn-outline-danger" (click)="removeConversationFlow(i)">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                        <div class="row">
                          <div class="col-md-6">
                            <small class="text-muted">AI might say:</small>
                            <div>{{flow.aiPrompts.join(', ')}}</div>
                          </div>
                          <div class="col-md-6">
                            <small class="text-muted">Student should try:</small>
                            <div>{{flow.expectedResponses.join(', ')}}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Form Actions -->
                <div class="row">
                  <div class="col-12">
                    <!-- Validation feedback -->
                    <div *ngIf="moduleForm.invalid && isEditMode" class="alert alert-warning mb-3">
                      <small><i class="fas fa-exclamation-triangle me-1"></i> Please fix the following to enable save:</small>
                      <ul class="mb-0 small">
                        <li *ngIf="moduleForm.get('title')?.invalid">Title is required</li>
                        <li *ngIf="moduleForm.get('description')?.invalid">Description is required</li>
                        <li *ngIf="moduleForm.get('targetLanguage')?.invalid">Target Language is required</li>
                        <li *ngIf="moduleForm.get('nativeLanguage')?.invalid">Native Language is required</li>
                        <li *ngIf="moduleForm.get('level')?.invalid">Level is required</li>
                        <li *ngIf="moduleForm.get('minimumCompletionTime')?.invalid">Minimum Completion Time must be between 5 and 60</li>
                        <li *ngIf="moduleForm.get('rolePlayScenario.situation')?.invalid">Situation is required</li>
                        <li *ngIf="moduleForm.get('rolePlayScenario.studentRole')?.invalid">Student Role is required</li>
                        <li *ngIf="moduleForm.get('rolePlayScenario.aiRole')?.invalid">AI Role is required</li>
                      </ul>
                    </div>
                    <div class="d-flex justify-content-end gap-2">
                      <button type="button" class="btn btn-secondary" (click)="goBack()">
                        Cancel
                      </button>
                      <button type="submit" class="btn btn-primary" [disabled]="moduleForm.invalid || isSubmitting">
                        <span *ngIf="isSubmitting" class="spinner-border spinner-border-sm me-2"></span>
                        {{ isEditMode ? 'Update' : 'Create' }} Role-Play Module
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .vocabulary-list, .grammar-list, .flow-list {
      max-height: 300px;
      overflow-y: auto;
    }
    .border {
      border-color: #dee2e6 !important;
    }
  `]
})
export class RoleplayModuleFormComponent implements OnInit {
  moduleForm: FormGroup;
  isSubmitting = false;

  // Form options
  levels: string[] = [];
  availableLanguages: string[] = [];
  availableNativeLanguages: string[] = [];

  // Dynamic arrays
  allowedVocabulary: Array<{word: string, translation: string, category: string}> = [];
  aiTutorVocabulary: Array<{word: string, translation: string, category: string, usage?: string}> = []; // NEW: AI Tutor vocabulary
  allowedGrammar: Array<{structure: string, examples: string[], level: string}> = [];
  conversationFlow: Array<{stage: string, aiPrompts: string[], expectedResponses: string[], helpfulPhrases: string[]}> = [];

  // Role personality and introduction fields
  aiRolePersonality = '';
  studentRoleGuidance = '';
  aiOpeningLines: string[] = [];
  suggestedStudentResponses: string[] = [];

  // Edit mode tracking
  isEditMode: boolean = false;
  moduleId: string | null = null;
  existingModule: any = null;
  isTranslating: boolean = false;

  // Input fields for dynamic arrays
  newVocabWord = '';
  newVocabTranslation = '';
  newVocabCategory = '';
  newAiVocabWord = ''; // NEW: AI vocabulary inputs
  newAiVocabTranslation = '';
  newAiVocabCategory = '';
  newAiVocabUsage = '';
  newGrammarStructure = '';
  newGrammarExample = '';
  newFlowStage = '';
  newFlowAiPrompt = '';
  newFlowExpectedResponse = '';
  newAiOpeningLine = '';
  newStudentResponse = '';

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private learningModulesService: LearningModulesService,
    private moduleDataTransferService: ModuleDataTransferService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.moduleForm = this.createForm();
  }

  ngOnInit(): void {
    this.initializeOptions();
    
    // Check if we're in edit mode by looking for route parameters
    this.route.params.subscribe(params => {
      if (params['id']) {
        this.isEditMode = true;
        this.moduleId = params['id'];
        this.loadExistingModule(params['id']);
      } else {
        // Only load AI-generated data if we're not in edit mode
        this.loadAiGeneratedData();
      }
    });
  }

  createForm(): FormGroup {
    return this.fb.group({
      title: ['', Validators.required],
      description: ['', Validators.required],
      targetLanguage: ['English', Validators.required],
      nativeLanguage: ['English', Validators.required],
      level: ['', Validators.required],
      category: ['Conversation'], // Fixed for role-play
      difficulty: ['Beginner'], // Auto-set based on level
      minimumCompletionTime: [10, [Validators.required, Validators.min(5), Validators.max(60)]], // NEW: Minimum time to complete
      rolePlayScenario: this.fb.group({
        situation: ['', Validators.required],
        studentRole: ['', Validators.required],
        aiRole: ['', Validators.required],
        setting: [''],
        objective: ['']
      })
    });
  }

  initializeOptions(): void {
    this.levels = this.learningModulesService.getAvailableLevels();
    this.availableLanguages = this.learningModulesService.getAvailableLanguages();
    this.availableNativeLanguages = this.learningModulesService.getAvailableNativeLanguages();
  }

  onLevelChange(): void {
    const level = this.moduleForm.get('level')?.value;
    if (level) {
      // Auto-set difficulty based on CEFR level
      let difficulty = 'Beginner';
      if (['B1', 'B2'].includes(level)) {
        difficulty = 'Intermediate';
      } else if (['C1', 'C2'].includes(level)) {
        difficulty = 'Advanced';
      }
      this.moduleForm.patchValue({ difficulty });
    }
  }

  addVocabulary(): void {
    if (this.newVocabWord.trim() && this.newVocabTranslation.trim()) {
      this.allowedVocabulary.push({
        word: this.newVocabWord.trim(),
        translation: this.newVocabTranslation.trim(),
        category: this.newVocabCategory.trim() || 'general'
      });
      this.newVocabWord = '';
      this.newVocabTranslation = '';
      this.newVocabCategory = '';
    }
  }

  removeVocabulary(index: number): void {
    this.allowedVocabulary.splice(index, 1);
  }

  // NEW: AI Tutor Vocabulary Methods
  addAiVocabulary(): void {
    if (this.newAiVocabWord.trim() && this.newAiVocabTranslation.trim()) {
      this.aiTutorVocabulary.push({
        word: this.newAiVocabWord.trim(),
        translation: this.newAiVocabTranslation.trim(),
        category: this.newAiVocabCategory.trim() || 'general',
        usage: this.newAiVocabUsage.trim() || undefined
      });
      this.newAiVocabWord = '';
      this.newAiVocabTranslation = '';
      this.newAiVocabCategory = '';
      this.newAiVocabUsage = '';
    }
  }

  removeAiVocabulary(index: number): void {
    this.aiTutorVocabulary.splice(index, 1);
  }

  copyStudentVocabToAi(): void {
    // Copy all student vocabulary to AI vocabulary (if not already there)
    this.allowedVocabulary.forEach(vocab => {
      const exists = this.aiTutorVocabulary.some(
        aiVocab => aiVocab.word.toLowerCase() === vocab.word.toLowerCase()
      );
      if (!exists) {
        this.aiTutorVocabulary.push({
          word: vocab.word,
          translation: vocab.translation,
          category: vocab.category,
          usage: undefined
        });
      }
    });
    
    if (this.allowedVocabulary.length > 0) {
      alert(`Copied ${this.allowedVocabulary.length} words to AI vocabulary. Now add additional support words the AI needs.`);
    } else {
      alert('No student vocabulary to copy. Add student vocabulary first.');
    }
  }

  addGrammar(): void {
    if (this.newGrammarStructure.trim()) {
      const existingGrammar = this.allowedGrammar.find(g => g.structure === this.newGrammarStructure.trim());
      if (existingGrammar && this.newGrammarExample.trim()) {
        existingGrammar.examples.push(this.newGrammarExample.trim());
      } else if (!existingGrammar) {
        this.allowedGrammar.push({
          structure: this.newGrammarStructure.trim(),
          examples: this.newGrammarExample.trim() ? [this.newGrammarExample.trim()] : [],
          level: this.moduleForm.get('level')?.value || 'A1'
        });
      }
      this.newGrammarStructure = '';
      this.newGrammarExample = '';
    }
  }

  removeGrammar(index: number): void {
    this.allowedGrammar.splice(index, 1);
  }

  addConversationFlow(): void {
    if (this.newFlowStage.trim()) {
      this.conversationFlow.push({
        stage: this.newFlowStage.trim(),
        aiPrompts: this.newFlowAiPrompt.trim() ? [this.newFlowAiPrompt.trim()] : [],
        expectedResponses: this.newFlowExpectedResponse.trim() ? [this.newFlowExpectedResponse.trim()] : [],
        helpfulPhrases: []
      });
      this.newFlowStage = '';
      this.newFlowAiPrompt = '';
      this.newFlowExpectedResponse = '';
    }
  }

  removeConversationFlow(index: number): void {
    this.conversationFlow.splice(index, 1);
  }

  addAiOpeningLine(): void {
    if (this.newAiOpeningLine.trim()) {
      this.aiOpeningLines.push(this.newAiOpeningLine.trim());
      this.newAiOpeningLine = '';
    }
  }

  removeAiOpeningLine(index: number): void {
    this.aiOpeningLines.splice(index, 1);
  }

  addStudentResponse(): void {
    if (this.newStudentResponse.trim()) {
      this.suggestedStudentResponses.push(this.newStudentResponse.trim());
      this.newStudentResponse = '';
    }
  }

  removeStudentResponse(index: number): void {
    this.suggestedStudentResponses.splice(index, 1);
  }

  onSubmit(): void {
    if (this.moduleForm.invalid) {
      this.moduleForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    const formValue = this.moduleForm.value;

    // Prepare the role-play module data
    const moduleData = {
      ...formValue,
      estimatedDuration: 30, // Default value - actual time tracked per session
      minimumCompletionTime: formValue.minimumCompletionTime || 10, // Use form value or default to 10
      content: {
        introduction: this.generateModuleIntroduction(formValue.targetLanguage, formValue.rolePlayScenario.situation),
        rolePlayScenario: {
          ...formValue.rolePlayScenario,
          aiPersonality: this.aiRolePersonality,
          studentGuidance: this.studentRoleGuidance,
          aiOpeningLines: this.aiOpeningLines,
          suggestedStudentResponses: this.suggestedStudentResponses
        },
        allowedVocabulary: this.allowedVocabulary,
        allowedGrammar: this.allowedGrammar,
        conversationFlow: this.conversationFlow,
        keyTopics: [formValue.rolePlayScenario.situation],
        examples: [],
        exercises: []
      },
      aiTutorConfig: {
        personality: this.aiRolePersonality || `experienced ${formValue.targetLanguage} tutor specialized in role-play scenarios`,
        focusAreas: [
          'Role-play conversation',
          'Situational vocabulary',
          'Natural dialogue flow',
          'Cultural appropriateness'
        ],
        helpfulPhrases: this.allowedVocabulary.map(v => v.word),
        commonMistakes: [],
        culturalNotes: [],
        allowedVocabulary: this.aiTutorVocabulary, // NEW: AI Tutor vocabulary control
        rolePlayInstructions: {
          aiRole: formValue.rolePlayScenario.aiRole,
          aiPersonality: this.aiRolePersonality,
          openingLines: this.aiOpeningLines,
          studentRole: formValue.rolePlayScenario.studentRole,
          studentGuidance: this.studentRoleGuidance,
          suggestedResponses: this.suggestedStudentResponses
        }
      },
      tags: ['role-play', formValue.rolePlayScenario.situation.toLowerCase(), formValue.level.toLowerCase()]
    };

    // Determine if we're creating or updating
    if (this.isEditMode && this.moduleId) {
      // Update existing module
      this.learningModulesService.updateModule(this.moduleId, moduleData).subscribe({
        next: (response) => {
          alert('Role-play module updated successfully!');
          this.goBack();
        },
        error: (error) => {
          console.error('Error updating role-play module:', error);
          alert('Failed to update role-play module. Please try again.');
          this.isSubmitting = false;
        }
      });
    } else {
      // Create new module
      this.learningModulesService.createModule(moduleData).subscribe({
        next: (response) => {
          alert('Role-play module created successfully!');
          this.goBack();
        },
        error: (error) => {
          console.error('Error creating role-play module:', error);
          alert('Failed to create role-play module. Please try again.');
          this.isSubmitting = false;
        }
      });
    }
  }

  loadAiGeneratedData(): void {
    // First try the transfer service
    if (this.moduleDataTransferService.hasGeneratedModule()) {
      const generatedModule = this.moduleDataTransferService.getGeneratedModule();
      if (generatedModule) {
        console.log('📋 Loading AI-generated role-play module from service:', generatedModule.title);
        this.populateFormFromAiGenerated(generatedModule);
        return;
      } else {
        console.log('⚠️ Transfer service indicated data exists but returned null');
      }
    }
    
    // Fallback to sessionStorage
    const sessionData = sessionStorage.getItem('aiGeneratedModule');
    if (sessionData) {
      try {
        const generatedModule = JSON.parse(sessionData);
        console.log('📋 Loading AI-generated role-play module from sessionStorage:', generatedModule.title);
        this.populateFormFromAiGenerated(generatedModule);
        // Clear sessionStorage after use
        sessionStorage.removeItem('aiGeneratedModule');
        return;
      } catch (error) {
        console.error('❌ Error parsing AI-generated module from sessionStorage:', error);
        sessionStorage.removeItem('aiGeneratedModule');
      }
    }
    
    console.log('ℹ️ No AI-generated module data found');
  }

  loadExistingModule(moduleId: string): void {
    console.log('📋 Loading existing module for editing:', moduleId);
    
    this.learningModulesService.getModule(moduleId).subscribe({
      next: (module) => {
        console.log('✅ Existing module loaded:', module.title);
        this.existingModule = module;
        this.populateFormFromExistingModule(module);
      },
      error: (error) => {
        console.error('❌ Error loading existing module:', error);
        alert('Error loading module for editing. Please try again.');
        this.router.navigate(['/learning-modules']);
      }
    });
  }

  populateFormFromExistingModule(module: any): void {
    console.log('🔧 Populating form with existing module data:', module);
    
    // Populate basic form fields
    this.moduleForm.patchValue({
      title: module.title || '',
      description: module.description || '',
      targetLanguage: module.targetLanguage || 'English',
      nativeLanguage: module.nativeLanguage || 'English',
      level: module.level || '',
      category: module.category || 'Conversation',
      difficulty: module.difficulty || 'Beginner',
      minimumCompletionTime: Math.min(60, Math.max(5, module.minimumCompletionTime || 10)), // ✅ Clamp to valid range
      rolePlayScenario: {
        situation: module.content?.rolePlayScenario?.situation || '',
        studentRole: module.content?.rolePlayScenario?.studentRole || '',
        aiRole: module.content?.rolePlayScenario?.aiRole || '',
        setting: module.content?.rolePlayScenario?.setting || '',
        objective: module.content?.rolePlayScenario?.objective || ''
      }
    });

    // Populate AI tutor configuration
    if (module.aiTutorConfig) {
      this.aiRolePersonality = module.aiTutorConfig.personality || '';
      
      // NEW: Load AI Tutor vocabulary
      this.aiTutorVocabulary = module.aiTutorConfig.allowedVocabulary || [];
      
      // Handle both old and new structure for student guidance
      this.studentRoleGuidance = 
        module.aiTutorConfig.rolePlayInstructions?.studentGuidance || 
        module.content?.rolePlayScenario?.studentGuidance || 
        '';
      
      // Populate AI opening lines
      this.aiOpeningLines = 
        module.aiTutorConfig.rolePlayInstructions?.openingLines || 
        module.content?.rolePlayScenario?.aiOpeningLines || 
        [];
      
      // Populate suggested student responses
      this.suggestedStudentResponses = 
        module.aiTutorConfig.rolePlayInstructions?.suggestedResponses || 
        module.content?.rolePlayScenario?.suggestedStudentResponses || 
        [];
    }

    // Populate vocabulary
    if (module.content?.allowedVocabulary) {
      this.allowedVocabulary = [...module.content.allowedVocabulary];
    }

    // Populate grammar
    if (module.content?.allowedGrammar) {
      this.allowedGrammar = [...module.content.allowedGrammar];
    }

    // Populate conversation flow
    if (module.content?.conversationFlow) {
      this.conversationFlow = [...module.content.conversationFlow];
    }

    console.log('✅ Form populated with existing module data');
    console.log('🔍 AI Configuration loaded:', {
      personality: this.aiRolePersonality,
      guidance: this.studentRoleGuidance,
      openingLines: this.aiOpeningLines.length,
      suggestedResponses: this.suggestedStudentResponses.length
    });
  }

  populateFormFromAiGenerated(generatedModule: any): void {
    console.log('🔧 Populating role-play form with AI-generated data:', generatedModule);
    
    // Set basic form values
    this.moduleForm.patchValue({
      title: generatedModule.title || '',
      description: generatedModule.description || '',
      targetLanguage: generatedModule.targetLanguage || 'English',
      nativeLanguage: generatedModule.nativeLanguage || 'English',
      level: generatedModule.level || '',
      difficulty: generatedModule.difficulty || ''
    });

    // Handle role-play scenario data
    if (generatedModule.content?.rolePlayScenario) {
      const scenario = generatedModule.content.rolePlayScenario;
      this.moduleForm.patchValue({
        rolePlayScenario: {
          situation: scenario.situation || '',
          setting: scenario.setting || '',
          studentRole: scenario.studentRole || '',
          aiRole: scenario.aiRole || '',
          objective: scenario.objective || '',
          aiPersonality: scenario.aiPersonality || '',
          studentGuidance: scenario.studentGuidance || ''
        }
      });

      // Set AI opening lines and student responses
      this.aiOpeningLines = [...(scenario.aiOpeningLines || [])];
      this.suggestedStudentResponses = [...(scenario.suggestedStudentResponses || [])];
    }

    // Set vocabulary, grammar, and conversation flow
    this.allowedVocabulary = [...(generatedModule.content?.allowedVocabulary || [])];
    this.allowedGrammar = [...(generatedModule.content?.allowedGrammar || [])];
    this.conversationFlow = [...(generatedModule.content?.conversationFlow || [])];

    // Set AI tutor config
    if (generatedModule.aiTutorConfig) {
      this.aiRolePersonality = generatedModule.aiTutorConfig.personality || '';
      this.studentRoleGuidance = generatedModule.aiTutorConfig.rolePlayInstructions?.studentGuidance || '';
      
      // NEW: Load AI Tutor vocabulary from generated module
      this.aiTutorVocabulary = generatedModule.aiTutorConfig.allowedVocabulary || [];
    }

    console.log('✅ Role-play form populated with AI-generated data');
  }

  generateModuleIntroduction(targetLanguage: string, situation: string): string {
    const introductions: { [key: string]: string } = {
      'German': `Willkommen zu diesem Rollenspiel-Szenario: ${situation}`,
      'English': `Welcome to this role-play scenario: ${situation}`
    };
    
    return introductions[targetLanguage] || introductions['English'];
  }

  goBack(): void {
    this.router.navigate(['/learning-modules']);
  }

  // CSV Parsing Helpers
  private parseCsvText(text: string): string[][] {
    return text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.split(',').map(cell => cell.trim()));
  }

  private isHeaderRow(row: string[]): boolean {
    const headerKeywords = ['word', 'translation', 'category', 'usage', 'structure', 'example', 'phrase'];
    return row.some(cell => headerKeywords.includes(cell.toLowerCase()));
  }

  private async autoTranslate(word: string): Promise<string> {
    const targetLang = this.moduleForm.get('targetLanguage')?.value || 'German';
    const nativeLang = this.moduleForm.get('nativeLanguage')?.value || 'English';
    // Translate from target language to native language (word is in target, translation is in native)
    try {
      const result: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/translate`, {
          text: word,
          from: targetLang,
          to: nativeLang
        })
      );
      // Remove the 💬 prefix the API adds
      return (result.translatedText || '').replace(/^💬\s*/, '').trim();
    } catch {
      return '';
    }
  }

  onStudentVocabCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;
      this.isTranslating = true;

      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const word = row[0];
          const translation = row.length >= 2 && row[1] ? row[1] : await this.autoTranslate(word);
          this.allowedVocabulary.push({
            word,
            translation,
            category: (row.length >= 3 ? row[2] : '') || 'general'
          });
          imported++;
        }
      }

      this.isTranslating = false;
      alert(`Imported ${imported} words to Student Vocabulary.`);
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  onAiVocabCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;
      this.isTranslating = true;

      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const word = row[0];
          const translation = row.length >= 2 && row[1] ? row[1] : await this.autoTranslate(word);
          this.aiTutorVocabulary.push({
            word,
            translation,
            category: (row.length >= 3 ? row[2] : '') || 'general',
            usage: row.length >= 4 ? row[3] : undefined
          });
          imported++;
        }
      }

      this.isTranslating = false;
      alert(`Imported ${imported} words to AI Tutor Vocabulary.`);
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }

  onGrammarCsvUpload(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const rows = this.parseCsvText(reader.result as string);
      let imported = 0;

      for (const row of rows) {
        if (this.isHeaderRow(row)) continue;
        if (row.length >= 1 && row[0]) {
          const examples = row.slice(1)
            .join(',')
            .split(';')
            .map(e => e.trim())
            .filter(e => e.length > 0);

          this.allowedGrammar.push({
            structure: row[0],
            examples: examples,
            level: this.moduleForm.get('level')?.value || 'A1'
          });
          imported++;
        }
      }

      alert(`Imported ${imported} grammar structures.`);
      (event.target as HTMLInputElement).value = '';
    };
    reader.readAsText(file);
  }
}