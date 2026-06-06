// src/app/components/teacher-dashboard/module-form.component.ts

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { LearningModulesService, LearningModule } from '../../services/learning-modules.service';
import { ModuleDataTransferService } from '../../services/module-data-transfer.service';
import { NotificationService } from '../../services/notification.service';

@Component({
  selector: 'app-module-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    <div class="container-fluid py-4">
      <div class="row">
        <div class="col-12">
          <div class="card">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h4 class="mb-0">🎭 {{isEditMode ? 'Edit' : 'Create'}} Role-Play Module</h4>
              <button class="btn btn-secondary" (click)="goBack()">
                <i class="fas fa-arrow-left"></i> Back
              </button>
            </div>
            
            <div class="card-body">
              <form [formGroup]="moduleForm" (ngSubmit)="onSubmit()">
                <!-- Basic Information -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">Basic Information</h5>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Title *</label>
                    <input type="text" class="form-control" formControlName="title" 
                           placeholder="Enter module title">
                    <div class="text-danger" *ngIf="moduleForm.get('title')?.invalid && moduleForm.get('title')?.touched">
                      Title is required
                    </div>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Estimated Duration (minutes) *</label>
                    <input type="number" class="form-control" formControlName="estimatedDuration" 
                           placeholder="e.g., 45" min="10" max="120">
                    <div class="text-danger" *ngIf="moduleForm.get('estimatedDuration')?.invalid && moduleForm.get('estimatedDuration')?.touched">
                      Duration is required (10-120 minutes)
                    </div>
                    <small class="form-text text-muted">
                      How long should this role-play session take to complete? Consider vocabulary practice, exercises, and conversation time.
                      <br><strong>Suggestions:</strong> Quick role-play (15-20 min) | Standard session (30-45 min) | Extended practice (60+ min)
                    </small>
                  </div>

                  <div class="col-md-6 mb-3">
                    <label class="form-label">Course Day (Optional)</label>
                    <input type="number" class="form-control" formControlName="courseDay" 
                           placeholder="0 = Trial, or 1–200" min="0" max="200">
                    <div class="text-danger" *ngIf="moduleForm.get('courseDay')?.invalid && moduleForm.get('courseDay')?.touched">
                      Must be 0 (Trial) or between 1 and 200
                    </div>
                    <small class="form-text text-muted">
                      0 = Trial day. Leave empty for general pool.
                    </small>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Description *</label>
                    <textarea class="form-control" rows="3" formControlName="description" 
                              placeholder="Describe what students will learn in this module"></textarea>
                    <div class="text-danger" *ngIf="moduleForm.get('description')?.invalid && moduleForm.get('description')?.touched">
                      Description is required
                    </div>
                  </div>
                </div>

                <!-- Classification -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">Classification</h5>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Target Language *</label>
                    <select class="form-select" formControlName="targetLanguage" (change)="onTargetLanguageChange()">
                      <option value="">Select Target Language</option>
                      <option *ngFor="let language of availableLanguages" [value]="language">{{language}}</option>
                    </select>
                    <small class="form-text text-muted">The language students will learn</small>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Native Language *</label>
                    <select class="form-select" formControlName="nativeLanguage">
                      <option value="">Select Native Language</option>
                      <option *ngFor="let language of availableNativeLanguages" [value]="language">{{language}}</option>
                    </select>
                    <small class="form-text text-muted">The language for explanations and instructions</small>
                  </div>
                  
                  <div class="col-md-4 mb-3">
                    <label class="form-label">Level *</label>
                    <select class="form-select" formControlName="level">
                      <option value="">Select Level</option>
                      <option *ngFor="let level of levels" [value]="level">{{level}}</option>
                    </select>
                  </div>
                  
                  <div class="col-md-4 mb-3">
                    <label class="form-label">Category *</label>
                    <select class="form-select" formControlName="category">
                      <option value="">Select Category</option>
                      <option *ngFor="let category of categories" [value]="category">{{category}}</option>
                    </select>
                  </div>
                  
                  <div class="col-md-4 mb-3">
                    <label class="form-label">Difficulty *</label>
                    <select class="form-select" formControlName="difficulty">
                      <option value="">Select Difficulty</option>
                      <option *ngFor="let difficulty of difficulties" [value]="difficulty">{{difficulty}}</option>
                    </select>
                  </div>
                </div>

                <!-- Learning Objectives -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">Learning Objectives</h5>
                    <div formArrayName="learningObjectives">
                      <div *ngFor="let objective of learningObjectives.controls; let i = index" 
                           [formGroupName]="i" class="mb-3 p-3 border rounded">
                        <div class="d-flex justify-content-between align-items-center mb-2">
                          <h6 class="mb-0">Objective {{i + 1}}</h6>
                          <button type="button" class="btn btn-sm btn-outline-danger" 
                                  (click)="removeLearningObjective(i)" 
                                  [disabled]="learningObjectives.length === 1">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                        <div class="row">
                          <div class="col-md-6 mb-2">
                            <label class="form-label">Objective</label>
                            <input type="text" class="form-control" formControlName="objective" 
                                   placeholder="e.g., Learn basic greetings">
                          </div>
                          <div class="col-md-6 mb-2">
                            <label class="form-label">Description</label>
                            <input type="text" class="form-control" formControlName="description" 
                                   placeholder="Detailed description">
                          </div>
                        </div>
                      </div>
                    </div>
                    <button type="button" class="btn btn-outline-primary btn-sm" 
                            (click)="addLearningObjective()">
                      <i class="fas fa-plus"></i> Add Objective
                    </button>
                  </div>
                </div>

                <!-- Content -->
                <div class="row mb-4" formGroupName="content">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">Module Content</h5>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Introduction</label>
                    <textarea class="form-control" rows="4" formControlName="introduction" 
                              placeholder="Write an engaging introduction to the module"></textarea>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Key Topics</label>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" [(ngModel)]="newKeyTopic" 
                             [ngModelOptions]="{standalone: true}"
                             placeholder="Enter a key topic" (keyup.enter)="addKeyTopic()">
                      <button type="button" class="btn btn-outline-primary" (click)="addKeyTopic()">
                        <i class="fas fa-plus"></i>
                      </button>
                    </div>
                    <div class="d-flex flex-wrap gap-2">
                      <span *ngFor="let topic of keyTopics; let i = index" 
                            class="badge bg-secondary d-flex align-items-center">
                        {{topic}}
                        <button type="button" class="btn-close btn-close-white ms-2" 
                                (click)="removeKeyTopic(i)" style="font-size: 0.7em;"></button>
                      </span>
                    </div>
                  </div>
                </div>

                <!-- AI Tutor Configuration -->
                <div class="row mb-4" formGroupName="aiTutorConfig">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">AI Tutor Configuration</h5>
                  </div>
                  
                  <div class="col-12 mb-3">
                    <label class="form-label">Personality</label>
                    <input type="text" class="form-control" formControlName="personality" 
                           placeholder="e.g., friendly and encouraging German tutor">
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Focus Areas</label>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" [(ngModel)]="newFocusArea" 
                             [ngModelOptions]="{standalone: true}"
                             placeholder="Enter focus area" (keyup.enter)="addFocusArea()">
                      <button type="button" class="btn btn-outline-primary" (click)="addFocusArea()">
                        <i class="fas fa-plus"></i>
                      </button>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <span *ngFor="let area of focusAreas; let i = index" 
                            class="badge bg-info d-flex align-items-center">
                        {{area}}
                        <button type="button" class="btn-close btn-close-white ms-1" 
                                (click)="removeFocusArea(i)" style="font-size: 0.6em;"></button>
                      </span>
                    </div>
                  </div>
                  
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Helpful Phrases</label>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" [(ngModel)]="newHelpfulPhrase" 
                             [ngModelOptions]="{standalone: true}"
                             placeholder="Enter helpful phrase" (keyup.enter)="addHelpfulPhrase()">
                      <button type="button" class="btn btn-outline-primary" (click)="addHelpfulPhrase()">
                        <i class="fas fa-plus"></i>
                      </button>
                    </div>
                    <div class="d-flex flex-wrap gap-1">
                      <span *ngFor="let phrase of helpfulPhrases; let i = index" 
                            class="badge bg-success d-flex align-items-center">
                        {{phrase}}
                        <button type="button" class="btn-close btn-close-white ms-1" 
                                (click)="removeHelpfulPhrase(i)" style="font-size: 0.6em;"></button>
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Role-Play Configuration -->
                <div class="row mb-4" formGroupName="content">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">🎭 Role-Play Configuration</h5>
                  </div>
                  
                  <div formGroupName="rolePlayScenario">
                    <div class="col-12 mb-3">
                      <label class="form-label">Situation *</label>
                      <input type="text" class="form-control" formControlName="situation" 
                             placeholder="e.g., Ordering food at a German restaurant">
                      <small class="form-text text-muted">Describe the role-play scenario</small>
                    </div>
                    
                    <div class="col-12 mb-3">
                      <label class="form-label">Setting</label>
                      <input type="text" class="form-control" formControlName="setting" 
                             placeholder="e.g., A busy restaurant in Berlin">
                      <small class="form-text text-muted">Where does this scenario take place?</small>
                    </div>
                    
                    <div class="row">
                      <div class="col-md-6 mb-3">
                        <label class="form-label">Student Role *</label>
                        <input type="text" class="form-control" formControlName="studentRole" 
                               placeholder="e.g., Customer">
                        <small class="form-text text-muted">What role will the student play?</small>
                      </div>
                      
                      <div class="col-md-6 mb-3">
                        <label class="form-label">AI Role *</label>
                        <input type="text" class="form-control" formControlName="aiRole" 
                               placeholder="e.g., Waiter">
                        <small class="form-text text-muted">What role will the AI play?</small>
                      </div>
                    </div>
                    
                    <div class="col-12 mb-3">
                      <label class="form-label">Objective</label>
                      <textarea class="form-control" rows="2" formControlName="objective" 
                                placeholder="e.g., Successfully order a meal and ask questions about the menu"></textarea>
                      <small class="form-text text-muted">What should the student accomplish?</small>
                    </div>
                    
                    <div class="col-12 mb-3">
                      <label class="form-label">Student Guidance</label>
                      <textarea class="form-control" rows="3" formControlName="studentGuidance" 
                                placeholder="e.g., You are a tourist visiting Germany. Be polite and ask questions if you don't understand something."></textarea>
                      <small class="form-text text-muted">Instructions for the student about how to play their role</small>
                    </div>
                    
                    <div class="col-12 mb-3">
                      <label class="form-label">AI Personality</label>
                      <textarea class="form-control" rows="2" formControlName="aiPersonality" 
                                placeholder="e.g., You are a friendly, helpful waiter who speaks clearly and is patient with tourists."></textarea>
                      <small class="form-text text-muted">How should the AI behave in this role?</small>
                    </div>
                  </div>
                </div>

                <!-- Tags -->
                <div class="row mb-4">
                  <div class="col-12">
                    <h5 class="border-bottom pb-2">Tags</h5>
                    <div class="input-group mb-2">
                      <input type="text" class="form-control" [(ngModel)]="newTag" 
                             [ngModelOptions]="{standalone: true}"
                             placeholder="Enter tag" (keyup.enter)="addTag()">
                      <button type="button" class="btn btn-outline-primary" (click)="addTag()">
                        <i class="fas fa-plus"></i>
                      </button>
                    </div>
                    <div class="d-flex flex-wrap gap-2">
                      <span *ngFor="let tag of tags; let i = index" 
                            class="badge bg-warning text-dark d-flex align-items-center">
                        {{tag}}
                        <button type="button" class="btn-close ms-2" 
                                (click)="removeTag(i)" style="font-size: 0.7em;"></button>
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Form Actions -->
                <div class="row">
                  <div class="col-12">
                    <div class="d-flex justify-content-end gap-2">
                      <button type="button" class="btn btn-secondary" (click)="goBack()">
                        Cancel
                      </button>
                      <button type="submit" class="btn btn-primary" [disabled]="moduleForm.invalid || isSubmitting">
                        <span *ngIf="isSubmitting" class="spinner-border spinner-border-sm me-2"></span>
                        {{isEditMode ? 'Update' : 'Create'}} Module
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
    .badge {
      font-size: 0.8em;
    }
    .btn-close {
      padding: 0;
      margin: 0;
    }
  `]
})
export class ModuleFormComponent implements OnInit {
  moduleForm: FormGroup;
  isEditMode = false;
  isSubmitting = false;
  moduleId: string | null = null;

  // Form options
  levels: string[] = [];
  categories: string[] = [];
  difficulties: string[] = [];
  availableLanguages: string[] = [];
  availableNativeLanguages: string[] = [];

  // Dynamic arrays
  keyTopics: string[] = [];
  focusAreas: string[] = [];
  helpfulPhrases: string[] = [];
  tags: string[] = [];

  // Input fields for dynamic arrays
  newKeyTopic = '';
  newFocusArea = '';
  newHelpfulPhrase = '';
  newTag = '';

  // Language-specific content
  selectedTargetLanguage = '';
  selectedNativeLanguage = '';

  constructor(
    private fb: FormBuilder,
    private learningModulesService: LearningModulesService,
    private moduleDataTransferService: ModuleDataTransferService,
    private router: Router,
    private route: ActivatedRoute,
    private notify: NotificationService
  ) {
    this.moduleForm = this.createForm();
  }

  ngOnInit(): void {
    this.initializeOptions();
    this.checkEditMode();
    this.checkAiGeneratedModule();
  }

  createForm(): FormGroup {
    return this.fb.group({
      title: ['', Validators.required],
      description: ['', Validators.required],
      targetLanguage: ['German', Validators.required],
      nativeLanguage: ['English', Validators.required],
      level: ['', Validators.required],
      category: ['', Validators.required],
      difficulty: ['', Validators.required],
      estimatedDuration: ['', [Validators.required, Validators.min(10), Validators.max(120)]],
      learningObjectives: this.fb.array([this.createLearningObjective()]),
      prerequisites: [[]],
      content: this.fb.group({
        introduction: [''],
        keyTopics: [[]],
        examples: [[]],
        // Role-play specific fields (always present now)
        rolePlayScenario: this.fb.group({
          situation: ['', Validators.required],
          setting: [''],
          studentRole: ['', Validators.required],
          aiRole: ['', Validators.required],
          objective: [''],
          studentGuidance: [''],
          aiPersonality: [''],
          aiOpeningLines: [[]],
          suggestedStudentResponses: [[]]
        }),
        allowedVocabulary: [[]],
        allowedGrammar: [[]],
        conversationFlow: [[]],
        exercises: [[]]
      }),
      aiTutorConfig: this.fb.group({
        personality: ['friendly and encouraging language tutor'],
        focusAreas: [[]],
        commonMistakes: [[]],
        helpfulPhrases: [[]],
        culturalNotes: [[]]
      }),
      tags: [[]],
      courseDay: [null, [Validators.min(0), Validators.max(200)]]
    });
  }

  createLearningObjective(): FormGroup {
    return this.fb.group({
      objective: [''],
      description: ['']
    });
  }

  get learningObjectives(): FormArray {
    return this.moduleForm.get('learningObjectives') as FormArray;
  }

  initializeOptions(): void {
    this.levels = this.learningModulesService.getAvailableLevels();
    this.categories = this.learningModulesService.getAvailableCategories();
    this.difficulties = this.learningModulesService.getAvailableDifficulties();
    this.availableLanguages = this.learningModulesService.getAvailableLanguages();
    this.availableNativeLanguages = this.learningModulesService.getAvailableNativeLanguages();
  }

  checkEditMode(): void {
    this.moduleId = this.route.snapshot.paramMap.get('id');
    if (this.moduleId) {
      this.isEditMode = true;
      this.loadModule();
    }
  }

  checkAiGeneratedModule(): void {
    console.log('🔍 Checking for AI-generated module data...');
    
    // First try the transfer service
    if (this.moduleDataTransferService.hasGeneratedModule()) {
      const generatedModule = this.moduleDataTransferService.getGeneratedModule();
      if (generatedModule) {
        console.log('📋 Loading AI-generated module from service:', generatedModule.title);
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
        console.log('📋 Loading AI-generated module from sessionStorage:', generatedModule.title);
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

  loadModule(): void {
    if (!this.moduleId) return;

    this.learningModulesService.getModule(this.moduleId).subscribe({
      next: (module: LearningModule) => {
        this.populateForm(module);
      },
      error: (error: unknown) => {
        console.error('Error loading module:', error);
        this.notify.error('Failed to load module');
        this.goBack();
      }
    });
  }

  populateForm(module: LearningModule): void {
    // Set basic form values
    this.moduleForm.patchValue({
      title: module.title,
      description: module.description,
      targetLanguage: module.targetLanguage || 'German',
      nativeLanguage: module.nativeLanguage || 'English',
      level: module.level,
      category: module.category,
      difficulty: module.difficulty,
      estimatedDuration: module.estimatedDuration,
      prerequisites: module.prerequisites,
      content: {
        introduction: module.content.introduction,
        examples: module.content.examples,
        exercises: module.content.exercises
      },
      aiTutorConfig: {
        personality: module.aiTutorConfig.personality,
        commonMistakes: module.aiTutorConfig.commonMistakes,
        culturalNotes: module.aiTutorConfig.culturalNotes
      }
    });

    // Set learning objectives
    this.learningObjectives.clear();
    module.learningObjectives.forEach(obj => {
      this.learningObjectives.push(this.fb.group({
        objective: [obj.objective],
        description: [obj.description]
      }));
    });

    // Set dynamic arrays
    this.keyTopics = [...(module.content.keyTopics || [])];
    this.focusAreas = [...(module.aiTutorConfig.focusAreas || [])];
    this.helpfulPhrases = [...(module.aiTutorConfig.helpfulPhrases || [])];
    this.tags = [...(module.tags || [])];
    
    if (module.courseDay != null) {
      this.moduleForm.patchValue({ courseDay: Number(module.courseDay) });
    }
    
    // Set selected languages
    this.selectedTargetLanguage = module.targetLanguage || 'German';
    this.selectedNativeLanguage = module.nativeLanguage || 'English';
  }

  populateFormFromAiGenerated(generatedModule: any): void {
    console.log('🔧 Populating form with AI-generated data:', generatedModule);
    
    // Set basic form values
    this.moduleForm.patchValue({
      title: generatedModule.title || '',
      description: generatedModule.description || '',
      targetLanguage: generatedModule.targetLanguage || 'German',
      nativeLanguage: generatedModule.nativeLanguage || 'English',
      level: generatedModule.level || '',
      category: generatedModule.category || '',
      difficulty: generatedModule.difficulty || '',
      estimatedDuration: generatedModule.estimatedDuration || 30,
      content: {
        introduction: generatedModule.content?.introduction || '',
        examples: generatedModule.content?.examples || [],
        exercises: generatedModule.content?.exercises || []
      },
      aiTutorConfig: {
        personality: generatedModule.aiTutorConfig?.personality || 'friendly and encouraging language tutor',
        commonMistakes: generatedModule.aiTutorConfig?.commonMistakes || [],
        culturalNotes: generatedModule.aiTutorConfig?.culturalNotes || []
      }
    });

    // Set learning objectives
    this.learningObjectives.clear();
    if (generatedModule.learningObjectives && generatedModule.learningObjectives.length > 0) {
      generatedModule.learningObjectives.forEach((obj: any) => {
        this.learningObjectives.push(this.fb.group({
          objective: [obj.objective || ''],
          description: [obj.description || '']
        }));
      });
    } else {
      // Add at least one empty objective
      this.learningObjectives.push(this.createLearningObjective());
    }

    // Set dynamic arrays
    this.keyTopics = [...(generatedModule.content?.keyTopics || [])];
    this.focusAreas = [...(generatedModule.aiTutorConfig?.focusAreas || [])];
    this.helpfulPhrases = [...(generatedModule.aiTutorConfig?.helpfulPhrases || [])];
    this.tags = [...(generatedModule.tags || [])];
    
    // Set selected languages
    this.selectedTargetLanguage = generatedModule.targetLanguage || 'German';
    this.selectedNativeLanguage = generatedModule.nativeLanguage || 'English';
    
    // Handle role-play specific data if present
    if (generatedModule.content?.rolePlayScenario) {
      console.log('🎭 Loading role-play scenario data');
      this.moduleForm.patchValue({
        moduleType: 'roleplay',
        rolePlaySituation: generatedModule.content.rolePlayScenario.situation || '',
        rolePlaySetting: generatedModule.content.rolePlayScenario.setting || '',
        studentRole: generatedModule.content.rolePlayScenario.studentRole || '',
        aiRole: generatedModule.content.rolePlayScenario.aiRole || '',
        rolePlayObjective: generatedModule.content.rolePlayScenario.objective || '',
        studentGuidance: generatedModule.content.rolePlayScenario.studentGuidance || ''
      });
    } else {
      // Default to role-play module
      console.log('🎭 No role-play scenario found, but all modules are now role-play focused');
    }
    
    console.log('✅ Form populated successfully with AI-generated data');
  }

  addLearningObjective(): void {
    this.learningObjectives.push(this.createLearningObjective());
  }

  removeLearningObjective(index: number): void {
    if (this.learningObjectives.length > 1) {
      this.learningObjectives.removeAt(index);
    }
  }

  addKeyTopic(): void {
    if (this.newKeyTopic.trim()) {
      this.keyTopics.push(this.newKeyTopic.trim());
      this.newKeyTopic = '';
    }
  }

  removeKeyTopic(index: number): void {
    this.keyTopics.splice(index, 1);
  }

  addFocusArea(): void {
    if (this.newFocusArea.trim()) {
      this.focusAreas.push(this.newFocusArea.trim());
      this.newFocusArea = '';
    }
  }

  removeFocusArea(index: number): void {
    this.focusAreas.splice(index, 1);
  }

  addHelpfulPhrase(): void {
    if (this.newHelpfulPhrase.trim()) {
      this.helpfulPhrases.push(this.newHelpfulPhrase.trim());
      this.newHelpfulPhrase = '';
    }
  }

  removeHelpfulPhrase(index: number): void {
    this.helpfulPhrases.splice(index, 1);
  }

  addTag(): void {
    if (this.newTag.trim()) {
      this.tags.push(this.newTag.trim());
      this.newTag = '';
    }
  }

  removeTag(index: number): void {
    this.tags.splice(index, 1);
  }

  private normalizeCourseDay(raw: unknown): number | null {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const r = Math.round(n);
    if (r < 0 || r > 200) return null;
    return r;
  }

  onSubmit(): void {
    if (this.moduleForm.invalid) {
      this.moduleForm.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    const formValue = this.moduleForm.value;
    const courseDay = this.normalizeCourseDay(formValue.courseDay);

    // Prepare the module data
    const moduleData = {
      ...formValue,
      courseDay,
      content: {
        ...formValue.content,
        keyTopics: this.keyTopics
      },
      aiTutorConfig: {
        ...formValue.aiTutorConfig,
        focusAreas: this.focusAreas,
        helpfulPhrases: this.helpfulPhrases
      },
      tags: this.tags,
      changeDescription: this.isEditMode 
        ? `Module updated by teacher` 
        : undefined
    };

    const operation = this.isEditMode 
      ? this.learningModulesService.updateModule(this.moduleId!, moduleData)
      : this.learningModulesService.createModule(moduleData);

    operation.subscribe({
      next: (_response: unknown) => {
        const action = this.isEditMode ? 'updated' : 'created';
        this.notify.success(`Module ${action} successfully!`);
        this.goBack();
      },
      error: (error: unknown) => {
        console.error('Error saving module:', error);
        const action = this.isEditMode ? 'updating' : 'creating';
        this.notify.error(`Failed to ${action} module. Please try again.`);
        this.isSubmitting = false;
      }
    });
  }

  goBack(): void {
    this.router.navigate(['/learning-modules']);
  }

  onTargetLanguageChange(): void {
    const targetLanguage = this.moduleForm.get('targetLanguage')?.value;
    this.selectedTargetLanguage = targetLanguage;
    
    // Update AI tutor personality based on language
    const personalityMap: { [key: string]: string } = {
      'German': 'friendly and encouraging German tutor',
      'English': 'friendly and encouraging English tutor',
      'Spanish': 'friendly and encouraging Spanish tutor',
      'French': 'friendly and encouraging French tutor',
      'Italian': 'friendly and encouraging Italian tutor',
      'Portuguese': 'friendly and encouraging Portuguese tutor',
      'Dutch': 'friendly and encouraging Dutch tutor',
      'Swedish': 'friendly and encouraging Swedish tutor'
    };
    
    if (personalityMap[targetLanguage]) {
      this.moduleForm.patchValue({
        aiTutorConfig: {
          personality: personalityMap[targetLanguage]
        }
      });
    }
  }
}