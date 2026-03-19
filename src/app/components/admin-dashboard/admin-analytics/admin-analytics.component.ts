// src/app/components/admin-dashboard/admin-analytics/admin-analytics.component.ts
// Comprehensive Admin Analytics Dashboard

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { NgChartsModule } from 'ng2-charts';
import { ChartConfiguration } from 'chart.js';
import { MaterialModule } from '../../../shared/material.module';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { 
  AdminAnalyticsService, 
  ModuleUsageData, 
  TeacherPerformance, 
  BatchStats,
  DetailedUsage 
} from '../../../services/admin-analytics.service';
import { LearningModulesService } from '../../../services/learning-modules.service';
import { TeacherService } from '../../../services/teacher.service';

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    ReactiveFormsModule,
    NgChartsModule,
    MaterialModule
  ],
  templateUrl: './admin-analytics.component.html',
  styleUrls: ['./admin-analytics.component.css']
})
export class AdminAnalyticsComponent implements OnInit {
  Math = Math; // Add Math for template usage
  
  // Data properties
  moduleUsageData: ModuleUsageData[] = [];
  teacherPerformanceData: TeacherPerformance[] = [];
  batchStatsData: BatchStats[] = [];
  detailedUsageData: DetailedUsage[] = [];
  
  // Summary data
  moduleUsageSummary: any = {};
  teacherPerformanceSummary: any = {};
  
  // Loading states
  isLoadingModuleUsage = false;
  isLoadingTeacherPerformance = false;
  isLoadingDetailedUsage = false;
  
  // Filter options
  availableModules: any[] = [];
  availableTeachers: any[] = [];
  availableBatches: string[] = [];
  availableLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  
  // Autocomplete for student name
  studentNameControl = new FormControl('');
  filteredStudentNames!: Observable<string[]>;
  allStudentNames: string[] = [];
  
  // Active tab
  activeTab: 'ai-usage' | 'module-usage' | 'teacher-performance' = 'ai-usage';
  
  // Filters
  moduleUsageFilters = {
    moduleId: '',
    teacherId: '',
    batch: '',
    level: '',
    dateFrom: '',
    dateTo: '',
    studentName: '', // NEW: Student name search
    groupBy: 'module' as 'module' | 'teacher' | 'batch' | 'student'
  };
  
  teacherPerformanceFilters = {
    teacherId: '',
    batch: '',
    dateFrom: '',
    dateTo: ''
  };
  
  detailedUsageFilters = {
    moduleId: '',
    studentId: '',
    teacherId: '',
    batch: ''
  };
  
  // Pagination
  currentPage = 1;
  itemsPerPage = 10;
  
  // Sorting
  sortBy = '';
  sortOrder: 'asc' | 'desc' = 'desc';

  // AI Usage Analytics properties
  studentUsageData: any[] = [];
  moduleUsageDataAI: any[] = [];
  selectedStudent: any | null = null;
  studentDetailedSessions: any[] = [];
  
  // Teacher Performance Detail View properties
  selectedTeacher: any | null = null;
  teacherDetailedSessions: any[] = [];
  showTeacherDetailedView = false;
  isLoadingTeacherDetails = false;
  
  // AI Usage Summary statistics
  totalStudentsUsingAI = 0;
  totalAISessionsCount = 0;
  totalAITimeHours = 0;
  averageSessionDuration = 0;
  overallCompletionRate = 0;
  
  // AI Usage Loading states
  isLoadingAIUsage = false;
  isLoadingAIDetails = false;
  showDetailedView = false;
  
  // Conversation view
  showConversationView = false;
  selectedSessionConversation: any = null;
  conversationMessages: any[] = [];
  
  // AI Usage Charts
  studentEngagementChart: ChartConfiguration<'bar'>['data'] | null = null;
  studentEngagementOptions: ChartConfiguration<'bar'>['options'];
  
  modulePopularityChart: ChartConfiguration<'doughnut'>['data'] | null = null;
  modulePopularityOptions: ChartConfiguration<'doughnut'>['options'];
  
  completionRateChart: ChartConfiguration<'bar'>['data'] | null = null;
  completionRateOptions: ChartConfiguration<'bar'>['options'];

  constructor(
    private adminAnalyticsService: AdminAnalyticsService,
    private learningModulesService: LearningModulesService,
    private teacherService: TeacherService
  ) {
    this.initializeChartOptions();
  }

  ngOnInit(): void {
    this.loadFilterOptions();
    this.loadAIUsageData(); // Load AI Usage by default since it's the first tab
    this.initializeAutocomplete();
  }

  initializeAutocomplete(): void {
    // Initialize filtered student names observable
    this.filteredStudentNames = this.studentNameControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterStudentNames(value || ''))
    );
    
    // Subscribe to value changes to update the filter
    this.studentNameControl.valueChanges.subscribe(value => {
      this.moduleUsageFilters.studentName = value || '';
    });
  }

  private _filterStudentNames(value: string): string[] {
    const filterValue = value.toLowerCase();
    return this.allStudentNames.filter(name => 
      name.toLowerCase().includes(filterValue)
    );
  }

  loadFilterOptions(): void {
    // Load modules
    this.learningModulesService.getModules({ limit: 1000 }).subscribe({
      next: (response) => {
        this.availableModules = response.modules || [];
      },
      error: (error) => {
        console.error('Error loading modules:', error);
      }
    });

    // Load teachers
    this.teacherService.getAllTeachers().subscribe({
      next: (response) => {
        this.availableTeachers = response.data || [];
      },
      error: (error) => {
        console.error('Error loading teachers:', error);
      }
    });

    // Load batches and levels from API
    this.adminAnalyticsService.getFilterOptions().subscribe({
      next: (response) => {
        if (response.success) {
          this.availableBatches = response.batches;
          this.availableLevels = response.levels;
          console.log('✅ Filter options loaded:', { batches: this.availableBatches.length, levels: this.availableLevels.length });
        }
      },
      error: (error) => {
        console.error('❌ Error loading filter options:', error);
        // Fallback to default levels if API fails
        this.availableLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      }
    });
  }

  // Tab management
  setActiveTab(tab: 'ai-usage' | 'module-usage' | 'teacher-performance'): void {
    this.activeTab = tab;
    
    switch (tab) {
      case 'ai-usage':
        if (this.studentUsageData.length === 0) {
          this.loadAIUsageData();
        }
        break;
      case 'module-usage':
        if (this.moduleUsageData.length === 0) {
          this.loadModuleUsage();
        }
        break;
      case 'teacher-performance':
        if (this.teacherPerformanceData.length === 0) {
          this.loadTeacherPerformance();
        }
        break;
    }
  }

  // Data loading methods
  loadModuleUsage(): void {
    this.isLoadingModuleUsage = true;
    
    const filters = { ...this.moduleUsageFilters };
    // Remove empty filters
    Object.keys(filters).forEach(key => {
      if (!filters[key as keyof typeof filters]) {
        delete filters[key as keyof typeof filters];
      }
    });

    this.adminAnalyticsService.getModuleUsage(filters).subscribe({
      next: (response) => {
        this.moduleUsageData = response.data;
        this.moduleUsageSummary = response.summary;
        this.isLoadingModuleUsage = false;
        console.log('Module usage data loaded:', response);
      },
      error: (error) => {
        console.error('Error loading module usage:', error);
        this.isLoadingModuleUsage = false;
      }
    });
  }

  loadTeacherPerformance(): void {
    this.isLoadingTeacherPerformance = true;
    
    const filters = { ...this.teacherPerformanceFilters };
    Object.keys(filters).forEach(key => {
      if (!filters[key as keyof typeof filters]) {
        delete filters[key as keyof typeof filters];
      }
    });

    this.adminAnalyticsService.getTeacherPerformance(filters).subscribe({
      next: (response) => {
        this.teacherPerformanceData = response.teacherPerformance;
        this.batchStatsData = response.batchStats;
        this.teacherPerformanceSummary = response.summary;
        this.isLoadingTeacherPerformance = false;
        console.log('Teacher performance data loaded:', response);
      },
      error: (error) => {
        console.error('Error loading teacher performance:', error);
        this.isLoadingTeacherPerformance = false;
      }
    });
  }

  loadDetailedUsage(): void {
    this.isLoadingDetailedUsage = true;
    
    const filters = { ...this.detailedUsageFilters };
    Object.keys(filters).forEach(key => {
      if (!filters[key as keyof typeof filters]) {
        delete filters[key as keyof typeof filters];
      }
    });

    this.adminAnalyticsService.getStudentModuleDetails(filters).subscribe({
      next: (response) => {
        this.detailedUsageData = response.detailedUsage;
        this.isLoadingDetailedUsage = false;
        console.log('Detailed usage data loaded:', response);
      },
      error: (error) => {
        console.error('Error loading detailed usage:', error);
        this.isLoadingDetailedUsage = false;
      }
    });
  }

  // Filter methods
  applyModuleUsageFilters(): void {
    this.loadModuleUsage();
  }

  applyTeacherPerformanceFilters(): void {
    this.loadTeacherPerformance();
  }

  applyDetailedUsageFilters(): void {
    this.loadDetailedUsage();
  }

  clearModuleUsageFilters(): void {
    this.moduleUsageFilters = {
      moduleId: '',
      teacherId: '',
      batch: '',
      level: '',
      dateFrom: '',
      dateTo: '',
      studentName: '',
      groupBy: 'module'
    };
    this.loadModuleUsage();
  }

  clearTeacherPerformanceFilters(): void {
    this.teacherPerformanceFilters = {
      teacherId: '',
      batch: '',
      dateFrom: '',
      dateTo: ''
    };
    this.loadTeacherPerformance();
  }

  clearDetailedUsageFilters(): void {
    this.detailedUsageFilters = {
      moduleId: '',
      studentId: '',
      teacherId: '',
      batch: ''
    };
    this.loadDetailedUsage();
  }

  // Utility methods
  formatTimeSpent(minutes: number): string {
    return this.adminAnalyticsService.formatTimeSpent(minutes);
  }

  formatDate(date: Date | string): string {
    return this.adminAnalyticsService.formatDate(date);
  }

  formatDateTime(date: Date | string): string {
    return this.adminAnalyticsService.formatDateTime(date);
  }

  getCompletionRateColor(rate: number): string {
    return this.adminAnalyticsService.getCompletionRateColor(rate);
  }

  getScoreColor(score: number): string {
    return this.adminAnalyticsService.getScoreColor(score);
  }

  // Export methods
  exportModuleUsage(): void {
    const exportData = this.moduleUsageData.map(item => ({
      'Module/Group': this.getDisplayName(item._id),
      'Total Sessions': item.totalSessions,
      'Total Time (minutes)': item.totalTimeSpent,
      'Completed Sessions': item.completedSessions,
      'Completion Rate (%)': Math.round(item.completionRate),
      'Average Score': Math.round(item.averageScore),
      'Unique Students': item.uniqueStudentCount,
      'Avg Time per Student (minutes)': Math.round(item.averageTimePerStudent),
      'Vocabulary Learned': item.totalVocabularyLearned
    }));
    
    this.adminAnalyticsService.exportToCSV(exportData, 'module_usage_analytics');
  }

  exportTeacherPerformance(): void {
    const exportData = this.teacherPerformanceData.map(teacher => ({
      'Teacher Name': teacher._id.teacherName,
      'Teacher Email': teacher._id.teacherEmail,
      'Total Time (minutes)': teacher.totalTimeSpent,
      'Total Sessions': teacher.totalSessions,
      'Completed Sessions': teacher.totalCompletedSessions,
      'Completion Rate (%)': Math.round(teacher.overallCompletionRate),
      'Average Score': Math.round(teacher.averageScore),
      'Total Students': teacher.totalStudents,
      'Avg Time per Student (minutes)': Math.round(teacher.averageTimePerStudent),
      'Modules Taught': teacher.modulePerformance.length
    }));
    
    this.adminAnalyticsService.exportToCSV(exportData, 'teacher_performance_analytics');
  }

  exportDetailedUsage(): void {
    const exportData = this.detailedUsageData.map(session => ({
      'Session ID': session.sessionId,
      'Student Name': session.studentName,
      'Student Batch': session.studentBatch,
      'Student Level': session.studentLevel,
      'Teacher Name': session.teacherName,
      'Module Name': session.moduleName,
      'Module Level': session.moduleLevel,
      'Session Type': session.sessionType,
      'Duration (minutes)': session.durationMinutes,
      'Status': session.sessionState,
      'Score': session.summary?.totalScore || 0,
      'Date': this.formatDateTime(session.createdAt)
    }));
    
    this.adminAnalyticsService.exportToCSV(exportData, 'detailed_usage_analytics');
  }

  // Sorting methods
  sortData(field: string): void {
    if (this.sortBy === field) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortOrder = 'desc';
    }
    
    // Apply sorting based on active tab
    switch (this.activeTab) {
      case 'module-usage':
        this.sortModuleUsageData();
        break;
      case 'teacher-performance':
        this.sortTeacherPerformanceData();
        break;
    }
  }

  private sortModuleUsageData(): void {
    this.moduleUsageData.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy) {
        case 'name':
          aValue = this.getDisplayName(a._id).toLowerCase();
          bValue = this.getDisplayName(b._id).toLowerCase();
          break;
        case 'totalSessions':
          aValue = a.totalSessions;
          bValue = b.totalSessions;
          break;
        case 'totalTimeSpent':
          aValue = a.totalTimeSpent;
          bValue = b.totalTimeSpent;
          break;
        case 'completionRate':
          aValue = a.completionRate;
          bValue = b.completionRate;
          break;
        case 'averageScore':
          aValue = a.averageScore;
          bValue = b.averageScore;
          break;
        default:
          return 0;
      }
      
      if (this.sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  }

  private sortTeacherPerformanceData(): void {
    this.teacherPerformanceData.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy) {
        case 'teacherName':
          aValue = a._id.teacherName.toLowerCase();
          bValue = b._id.teacherName.toLowerCase();
          break;
        case 'totalTimeSpent':
          aValue = a.totalTimeSpent;
          bValue = b.totalTimeSpent;
          break;
        case 'totalSessions':
          aValue = a.totalSessions;
          bValue = b.totalSessions;
          break;
        case 'completionRate':
          aValue = a.overallCompletionRate;
          bValue = b.overallCompletionRate;
          break;
        case 'averageScore':
          aValue = a.averageScore;
          bValue = b.averageScore;
          break;
        default:
          return 0;
      }
      
      if (this.sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  }

  private sortDetailedUsageData(): void {
    this.detailedUsageData.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy) {
        case 'studentName':
          aValue = a.studentName.toLowerCase();
          bValue = b.studentName.toLowerCase();
          break;
        case 'moduleName':
          aValue = a.moduleName.toLowerCase();
          bValue = b.moduleName.toLowerCase();
          break;
        case 'durationMinutes':
          aValue = a.durationMinutes;
          bValue = b.durationMinutes;
          break;
        case 'createdAt':
          aValue = new Date(a.createdAt);
          bValue = new Date(b.createdAt);
          break;
        default:
          return 0;
      }
      
      if (this.sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  }

  // Helper methods
  getDisplayName(idObject: any): string {
    if (idObject.moduleName) {
      return `${idObject.moduleName} (${idObject.moduleLevel})`;
    }
    if (idObject.teacherName) {
      return idObject.teacherName;
    }
    if (idObject.batch) {
      return `Batch ${idObject.batch}`;
    }
    if (idObject.studentName) {
      return `${idObject.studentName} (${idObject.studentLevel})`;
    }
    return 'Unknown';
  }

  // Pagination methods
  get paginatedData(): any[] {
    let data: any[] = [];
    
    switch (this.activeTab) {
      case 'module-usage':
        data = this.moduleUsageData;
        break;
      case 'teacher-performance':
        data = this.teacherPerformanceData;
        break;
    }
    
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    return data.slice(startIndex, startIndex + this.itemsPerPage);
  }

  get totalPages(): number {
    let dataLength = 0;
    
    switch (this.activeTab) {
      case 'module-usage':
        dataLength = this.moduleUsageData.length;
        break;
      case 'teacher-performance':
        dataLength = this.teacherPerformanceData.length;
        break;
    }
    
    return Math.ceil(dataLength / this.itemsPerPage);
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  // ====== AI USAGE ANALYTICS METHODS ======
  
  initializeChartOptions(): void {
    // Student Engagement Chart Options
    this.studentEngagementOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { 
          display: true, 
          text: 'Student Engagement Levels',
          font: { size: 16, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.y} students`
          }
        }
      },
      scales: {
        y: { 
          beginAtZero: true, 
          ticks: { stepSize: 1 },
          title: { display: true, text: 'Number of Students', font: { weight: 'bold' } }
        },
        x: { 
          title: { display: true, text: 'Engagement Level', font: { weight: 'bold' } }
        }
      }
    };

    // Module Popularity Chart Options
    this.modulePopularityOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { 
          display: true, 
          position: 'right',
          labels: { font: { size: 12 } }
        },
        title: { 
          display: true, 
          text: 'Most Popular AI Modules',
          font: { size: 16, weight: 'bold' }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const label = context.label || '';
              const value = context.parsed || 0;
              return `${label}: ${value} sessions`;
            }
          }
        }
      }
    };

    // Level Distribution Chart Options
    this.completionRateOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        title: { 
          display: true, 
          text: 'Students by CEFR Level',
          font: { size: 16, weight: 'bold' }
        }
      },
      scales: {
        y: { 
          beginAtZero: true,
          ticks: { stepSize: 1 },
          title: { display: true, text: 'Number of Students', font: { weight: 'bold' } }
        },
        x: { 
          title: { display: true, text: 'CEFR Level', font: { weight: 'bold' } }
        }
      }
    };
  }

  async loadAIUsageData(): Promise<void> {
    this.isLoadingAIUsage = true;
    
    try {
      // Build filters with studentsOnly flag
      const filters: any = { 
        groupBy: 'student',
        studentsOnly: 'true'
      };
      if (this.moduleUsageFilters.batch) filters.batch = this.moduleUsageFilters.batch;
      if (this.moduleUsageFilters.level) filters.level = this.moduleUsageFilters.level;
      if (this.moduleUsageFilters.dateFrom) filters.dateFrom = this.moduleUsageFilters.dateFrom;
      if (this.moduleUsageFilters.dateTo) filters.dateTo = this.moduleUsageFilters.dateTo;
      if (this.moduleUsageFilters.studentName) filters.studentName = this.moduleUsageFilters.studentName;

      // Fetch student usage data
      const response = await this.adminAnalyticsService.getModuleUsage(filters).toPromise();
      
      if (response && response.data) {
        this.processStudentUsageData(response.data);
        this.calculateAISummaryStatistics(response.data);
        
        // Extract student names for autocomplete (only if no name filter applied)
        if (!this.moduleUsageFilters.studentName) {
          this.allStudentNames = response.data
            .map((item: any) => item._id.studentName)
            .filter((name: string) => name) // Remove null/undefined
            .sort();
        }
      }

      // Fetch module usage data
      const moduleFilters = { ...filters, groupBy: 'module' };
      const moduleResponse = await this.adminAnalyticsService.getModuleUsage(moduleFilters).toPromise();
      
      if (moduleResponse && moduleResponse.data) {
        this.processModuleUsageDataAI(moduleResponse.data);
      }

      // Generate charts
      this.generateAICharts();
      
    } catch (error) {
      console.error('Error loading AI usage data:', error);
    } finally {
      this.isLoadingAIUsage = false;
    }
  }

  processStudentUsageData(data: any[]): void {
    this.studentUsageData = data.map(item => ({
      studentId: item._id.studentId,
      studentName: item._id.studentName,
      studentEmail: item._id.studentEmail || 'No email',
      studentBatch: item._id.studentBatch || 'Not assigned',
      studentLevel: item._id.studentLevel || 'Not set',
      totalSessions: item.totalSessions,
      totalTimeMinutes: item.totalTimeSpent,
      completedSessions: item.completedSessions,
      completionRate: item.completionRate,
      averageScore: item.averageScore,
      modulesUsed: item.sessions?.length || 0,
      lastSessionDate: item.sessions?.[0]?.date || new Date(),
      vocabularyLearned: item.totalVocabularyLearned || 0,
      totalConversations: item.totalConversations || 0 // NEW: Total student messages
    })).sort((a, b) => b.totalTimeMinutes - a.totalTimeMinutes);
  }

  processModuleUsageDataAI(data: any[]): void {
    this.moduleUsageDataAI = data.map(item => ({
      moduleId: item._id.moduleId,
      moduleName: item._id.moduleName,
      moduleLevel: item._id.moduleLevel,
      totalSessions: item.totalSessions,
      totalTimeMinutes: item.totalTimeSpent,
      uniqueStudents: item.uniqueStudentCount,
      averageScore: item.averageScore
    })).sort((a, b) => b.totalSessions - a.totalSessions);
  }

  calculateAISummaryStatistics(data: any[]): void {
    this.totalStudentsUsingAI = data.length;
    this.totalAISessionsCount = data.reduce((sum, item) => sum + item.totalSessions, 0);
    const totalMinutes = data.reduce((sum, item) => sum + item.totalTimeSpent, 0);
    this.totalAITimeHours = Math.round(totalMinutes / 60);
    this.averageSessionDuration = this.totalAISessionsCount > 0 
      ? Math.round(totalMinutes / this.totalAISessionsCount) 
      : 0;
    
    const totalCompleted = data.reduce((sum, item) => sum + item.completedSessions, 0);
    this.overallCompletionRate = this.totalAISessionsCount > 0
      ? Math.round((totalCompleted / this.totalAISessionsCount) * 100)
      : 0;
  }

  generateAICharts(): void {
    this.generateEngagementLevelChart();
    this.generateModulePopularityChart();
    this.generateLevelDistributionChart();
  }

  generateEngagementLevelChart(): void {
    const highEngagement = this.studentUsageData.filter(s => s.totalTimeMinutes >= 60).length;
    const mediumEngagement = this.studentUsageData.filter(s => s.totalTimeMinutes >= 30 && s.totalTimeMinutes < 60).length;
    const lowEngagement = this.studentUsageData.filter(s => s.totalTimeMinutes < 30).length;
    
    this.studentEngagementChart = {
      labels: ['High Engagement (60+ min)', 'Medium Engagement (30-59 min)', 'Low Engagement (<30 min)'],
      datasets: [{
        label: 'Number of Students',
        data: [highEngagement, mediumEngagement, lowEngagement],
        backgroundColor: [
          'rgba(75, 192, 192, 0.8)',
          'rgba(255, 206, 86, 0.8)',
          'rgba(255, 99, 132, 0.8)'
        ],
        borderColor: [
          'rgba(75, 192, 192, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(255, 99, 132, 1)'
        ],
        borderWidth: 2
      }]
    };
  }

  generateModulePopularityChart(): void {
    const top6Modules = this.moduleUsageDataAI.slice(0, 6);
    
    this.modulePopularityChart = {
      labels: top6Modules.map(m => m.moduleName),
      datasets: [{
        data: top6Modules.map(m => m.totalSessions),
        backgroundColor: [
          'rgba(255, 99, 132, 0.8)',
          'rgba(54, 162, 235, 0.8)',
          'rgba(255, 206, 86, 0.8)',
          'rgba(75, 192, 192, 0.8)',
          'rgba(153, 102, 255, 0.8)',
          'rgba(255, 159, 64, 0.8)'
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)',
          'rgba(75, 192, 192, 1)',
          'rgba(153, 102, 255, 1)',
          'rgba(255, 159, 64, 1)'
        ],
        borderWidth: 2
      }]
    };
  }

  generateLevelDistributionChart(): void {
    const levelCounts = new Map<string, number>();
    this.studentUsageData.forEach(student => {
      const level = student.studentLevel;
      levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    });

    const levels = Array.from(levelCounts.keys()).sort();
    const counts = levels.map(level => levelCounts.get(level) || 0);

    this.completionRateChart = {
      labels: levels,
      datasets: [{
        label: 'Number of Students',
        data: counts,
        backgroundColor: 'rgba(153, 102, 255, 0.8)',
        borderColor: 'rgba(153, 102, 255, 1)',
        borderWidth: 2
      }]
    };
  }

  async viewStudentDetails(student: any): Promise<void> {
    this.selectedStudent = student;
    this.showDetailedView = true;
    this.isLoadingAIDetails = true;

    try {
      console.log('🔍 Loading student details for:', student);
      console.log('📋 Student ID:', student.studentId);
      
      const response = await this.adminAnalyticsService.getStudentModuleDetails({
        studentId: student.studentId
      }).toPromise();

      console.log('📦 API Response:', response);

      if (response && response.detailedUsage) {
        this.studentDetailedSessions = response.detailedUsage;
        console.log('📊 Loaded sessions:', this.studentDetailedSessions.length);
        console.log('📋 Sessions data:', this.studentDetailedSessions);
        
        if (this.studentDetailedSessions.length > 0) {
          console.log('📝 First session:', this.studentDetailedSessions[0]);
          console.log('📋 First session messages:', this.studentDetailedSessions[0]?.messages?.length || 0);
        }
      } else {
        console.warn('⚠️ No detailedUsage in response');
      }
    } catch (error) {
      console.error('❌ Error loading student details:', error);
      alert('Error loading student details. Check console for details.');
    } finally {
      this.isLoadingAIDetails = false;
    }
  }

  closeDetailedView(): void {
    this.showDetailedView = false;
    this.selectedStudent = null;
    this.studentDetailedSessions = [];
  }

  // Helper method to count student messages
  getStudentMessageCount(messages: any[]): number {
    if (!messages || !Array.isArray(messages)) {
      return 0;
    }
    return messages.filter(m => m.role === 'student').length;
  }

  // Teacher Performance Detail View Methods
  async viewTeacherDetails(teacher: any): Promise<void> {
    this.selectedTeacher = teacher;
    this.showTeacherDetailedView = true;
    this.isLoadingTeacherDetails = true;

    try {
      console.log('🔍 Loading teacher own usage for:', teacher);
      console.log('📋 Full teacher object:', JSON.stringify(teacher, null, 2));
      console.log('📋 Teacher _id:', teacher._id);
      console.log('📋 Teacher Email:', teacher._id?.teacherEmail);
      
      // Check if email exists
      const teacherEmail = teacher._id?.teacherEmail || teacher.teacherEmail || teacher.email;
      
      if (!teacherEmail) {
        console.error('❌ No teacher email found in object');
        alert('Cannot load teacher details: Email not found');
        this.isLoadingTeacherDetails = false;
        return;
      }
      
      console.log('✅ Using teacher email:', teacherEmail);
      
      // Load sessions where teacher was the student (teacher's own usage)
      const teacherOwnResponse = await this.adminAnalyticsService.getTeacherOwnUsage({
        teacherEmail: teacherEmail
      }).toPromise();
      
      console.log('📦 Teacher Own Usage Response:', teacherOwnResponse);
      
      if (teacherOwnResponse && teacherOwnResponse.detailedUsage) {
        this.teacherDetailedSessions = teacherOwnResponse.detailedUsage;
        console.log('📊 Loaded teacher own sessions:', this.teacherDetailedSessions.length);
      } else {
        console.warn('⚠️ No detailedUsage in teacher own response');
        this.teacherDetailedSessions = [];
      }
      
    } catch (error) {
      console.error('❌ Error loading teacher details:', error);
      alert('Error loading teacher details. Check console for details.');
    } finally {
      this.isLoadingTeacherDetails = false;
    }
  }

  closeTeacherDetailedView(): void {
    this.showTeacherDetailedView = false;
    this.selectedTeacher = null;
    this.teacherDetailedSessions = [];
  }

  viewConversation(session: any): void {
    this.selectedSessionConversation = session;
    this.conversationMessages = session.messages || [];
    this.showConversationView = true;
  }

  closeConversationView(): void {
    this.showConversationView = false;
    this.selectedSessionConversation = null;
    this.conversationMessages = [];
  }

  formatTimestamp(timestamp: Date | string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  exportConversation(): void {
    if (!this.selectedSessionConversation || !this.conversationMessages.length) {
      return;
    }

    const session = this.selectedSessionConversation;
    let csvContent = 'data:text/csv;charset=utf-8,';
    
    // Add header
    csvContent += 'Conversation Transcript\n';
    csvContent += `Module: ${session.moduleName}\n`;
    csvContent += `Date: ${this.formatDateTime(session.createdAt)}\n`;
    csvContent += `Duration: ${this.formatTimeSpent(session.durationMinutes)}\n`;
    csvContent += `Student: ${session.studentName}\n\n`;
    
    // Add column headers
    csvContent += 'Time,Role,Message,Input Method\n';
    
    // Add messages
    this.conversationMessages.forEach(msg => {
      const time = this.formatTimestamp(msg.timestamp);
      const role = msg.role === 'student' ? 'Student' : 'AI Tutor';
      const content = `"${msg.content.replace(/"/g, '""')}"`;  // Escape quotes
      const inputMethod = msg.metadata?.inputMethod || 'N/A';
      csvContent += `${time},${role},${content},${inputMethod}\n`;
    });
    
    // Create download link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `conversation_${session.sessionId}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Format session status for display
  formatSessionStatus(status: string): string {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'Completed';
      case 'active':
        return 'Incomplete';
      case 'manually_ended':
        return 'Ended Early';
      case 'abandoned':
        return 'Abandoned';
      default:
        return status || 'Unknown';
    }
  }

  // Get badge class for session status
  getStatusBadgeClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-success';
      case 'active':
        return 'bg-warning';
      case 'manually_ended':
        return 'bg-info';
      case 'abandoned':
        return 'bg-danger';
      default:
        return 'bg-secondary';
    }
  }

  formatTimeAI(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }

  // Determine how the session ended based on status and other factors
  getCompletionMethod(session: any): string {
    const status = session.sessionState?.toLowerCase();
    const messages = session.messages || [];
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const lastAIMessage = [...messages].reverse().find(m => m.role === 'tutor');
    
    // Check if session is completed
    if (status === 'completed') {
      // Check if last AI message contains auto-completion indicators
      if (lastAIMessage) {
        const content = lastAIMessage.content?.toLowerCase() || '';
        
        // Check for auto-completion celebration messages
        if (content.includes('congratulations') || 
            content.includes('module completed') ||
            content.includes('great progress! you completed') ||
            content.includes('modul abgeschlossen') ||
            content.includes('herzlichen glückwunsch') ||
            content.includes('session complete') ||
            content.includes('successfully completed')) {
          return 'Auto-Completion by AI';
        }
      }
      
      // If completed but no auto-completion indicators, it's manual
      return 'Manual End by User';
    }
    
    // Check for stop command (manually_ended status)
    if (status === 'manually_ended') {
      // Check if last student message was a stop command
      const lastStudentMessage = [...messages].reverse().find(m => m.role === 'student');
      if (lastStudentMessage) {
        const content = lastStudentMessage.content?.toLowerCase().trim() || '';
        const stopCommands = ['stop', 'end', 'finish', 'quit', 'exit', 'stopp', 'ende', 'beenden', 'aufhören'];
        
        if (stopCommands.some(cmd => 
          content === cmd || 
          content === `${cmd}.` || 
          content === `${cmd}!` || 
          content === `${cmd}?`
        )) {
          return 'Stop Command by User';
        }
      }
      
      // Otherwise it's manual end via button
      return 'Manual End by User';
    }
    
    // Active sessions - need to determine if it's a false positive or truly abandoned
    if (status === 'active') {
      // Check if last AI message suggests completion (false positive scenario)
      if (lastAIMessage) {
        const content = lastAIMessage.content?.toLowerCase() || '';
        
        // Check for words that might have triggered false positive
        // These are single words that appear in normal conversation
        const falsePositiveWords = [
          'wunderbar', 'wonderful', 'perfekt', 'perfect', 
          'ausgezeichnet', 'excellent', 'toll', 'great',
          'fantastisch', 'fantastic', 'gut gemacht', 'well done'
        ];
        
        // If session is very short (< 5 min) and contains these words, likely false positive
        const duration = session.durationMinutes || 0;
        if (duration < 5 && falsePositiveWords.some(word => content.includes(word))) {
          // Check if it doesn't have proper completion phrases
          const hasProperCompletion = 
            content.includes('congratulations') ||
            content.includes('module completed') ||
            content.includes('modul abgeschlossen') ||
            content.includes('herzlichen glückwunsch');
          
          if (!hasProperCompletion) {
            return 'Auto-Completion by AI (False Positive)';
          }
        }
      }
      
      // Check if session is old (likely abandoned)
      const sessionDate = new Date(session.createdAt);
      const now = new Date();
      const hoursSinceSession = (now.getTime() - sessionDate.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceSession > 1) { // More than 1 hour old
        return 'Browser Close/Navigation';
      }
      
      return 'In Progress';
    }
    
    // Explicitly marked as abandoned
    if (status === 'abandoned') {
      return 'Browser Close/Navigation';
    }
    
    return 'Unknown';
  }

  // Get badge class for completion method
  getCompletionMethodBadgeClass(method: string): string {
    switch (method) {
      case 'Auto-Completion by AI':
        return 'bg-success';
      case 'Auto-Completion by AI (False Positive)':
        return 'bg-danger'; // Red to highlight the issue
      case 'Manual End by User':
        return 'bg-primary';
      case 'Stop Command by User':
        return 'bg-warning';
      case 'Browser Close/Navigation':
        return 'bg-secondary';
      case 'In Progress':
        return 'bg-info';
      default:
        return 'bg-secondary';
    }
  }

  // Get icon for completion method
  getCompletionMethodIcon(method: string): string {
    switch (method) {
      case 'Auto-Completion by AI':
        return 'fa-robot';
      case 'Auto-Completion by AI (False Positive)':
        return 'fa-exclamation-triangle'; // Warning icon
      case 'Manual End by User':
        return 'fa-hand-pointer';
      case 'Stop Command by User':
        return 'fa-stop-circle';
      case 'Browser Close/Navigation':
        return 'fa-times-circle';
      case 'In Progress':
        return 'fa-spinner fa-spin';
      default:
        return 'fa-question-circle';
    }
  }

  getCompletionRateColorAI(rate: number): string {
    if (rate >= 80) return '#28a745';
    if (rate >= 60) return '#ffc107';
    if (rate >= 40) return '#fd7e14';
    return '#dc3545';
  }

  exportAIUsageData(): void {
    const exportData = this.studentUsageData.map(student => ({
      'Student Name': student.studentName,
      'Email': student.studentEmail,
      'Batch': student.studentBatch,
      'Level': student.studentLevel,
      'Total Sessions': student.totalSessions,
      'Total Time (hours)': Math.round(student.totalTimeMinutes / 60 * 10) / 10,
      'Completed Sessions': student.completedSessions,
      'Completion Rate (%)': Math.round(student.completionRate),
      'Average Score': Math.round(student.averageScore),
      'Modules Used': student.modulesUsed,
      'Total Conversations': student.totalConversations,
      'Last Session': this.formatDate(student.lastSessionDate)
    }));

    this.adminAnalyticsService.exportToCSV(exportData, 'ai_usage_analytics');
  }
}