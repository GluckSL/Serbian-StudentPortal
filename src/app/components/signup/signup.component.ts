//src/app/component/signup/signup.component.ts

import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { CoursesService } from '../../services/courses.service'

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [FormsModule, HttpClientModule, CommonModule],
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css']
})
export class SignupComponent {
  name: string = '';
  email: string = '';
  role: string = 'STUDENT'; // default role
  batch: string = '';
  medium: string | string[]  = '';
  conversationId: string = '';
  subscription: string = '';
  level: string = 'A1'; // default level
  studentStatus: string = 'UNCERTAIN'; // default status
  phoneNumber: string = '';
  address: string = '';
  age: number | null = null;
  servicesOpted: string = '';
  leadSource: string = '';
  languageLevelOpted: string = '';
  dateWithdrew: Date | null = null;
  reasonForWithdrawing: string = '';
  courseCompletionDates: {
    A1CompletionDate?: string | null;
    A2CompletionDate?: string | null;
    B1CompletionDate?: string | null;
    B2CompletionDate?: string | null;
  } = {};
  courseStartDates: {
    A1StartDate?: string | null;
    A2StartDate?: string | null;
    B1StartDate?: string | null;
    B2StartDate?: string | null;
  } = {};
  qualifications: string = '';
  
  // Teacher assignment
  assignedTeacher: string = '';   // ✅ selected teacher ID
  teachers: any[] = [];           // all fetched teachers

   // Teacher fields
  assignedCourses: string[] = []; // selected course IDs
  assignedBatches: string[] = []; // selected batches
  courses: any[] = []; // list fetched from backend

  isEditMode = false; // ✅ flag to track update mode
  studentId: string | null = null;


  constructor(
    private authService: AuthService, 
    private router: Router, 
    private coursesService: CoursesService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.loadCourses();

    // Check if an ID is passed in route → Edit mode
    this.studentId = this.route.snapshot.paramMap.get('id');
    if (this.studentId) {
      this.isEditMode = true;
      this.loadUserById(this.studentId);
    }
  }
  // Fetch available courses from backend
  loadCourses() {
    this.coursesService.getCourses().subscribe({
      next: (data) => this.courses = data,
      error: (err) => console.error('Failed to load courses', err)
    });
  }

  // Load teachers dynamically when student selects level + medium
  loadTeachers() {
    if (this.level && this.medium) {
      this.authService.getTeachers(this.level, this.medium).subscribe({
        next: (data) => this.teachers = data,
        error: (err) => {
          this.teachers = [];
          console.error('Failed to load teachers', err);
        }
      });
    }
  }


  // ✅ Load existing user for update
  private loadUserById(id: string): void {
    this.authService.getUserById(id).subscribe({
      next: (data) => {
        this.name = data.name;
        this.email = data.email;
        this.role = data.role;  
        if (this.role === 'STUDENT') {
          this.batch = data.batch || '';
          this.medium = data.medium || '';
          this.subscription = data.subscription || '';
          this.level = data.level || 'A1';
          this.assignedTeacher = data.assignedTeacher || '';
          this.conversationId = data.conversationId || '';
          this.studentStatus = data.studentStatus || 'UNCERTAIN';
          this.phoneNumber = data.phoneNumber || '';
          this.address = data.address || '';
          this.age = data.age || null;
          this.servicesOpted = data.servicesOpted || data['programEnrolled'] || '';
          this.leadSource = data.leadSource || '';
          this.languageLevelOpted = data.languageLevelOpted || '';
          this.dateWithdrew = data.dateWithdrew || null;
          this.reasonForWithdrawing = data.reasonForWithdrawing || '';
          this.courseCompletionDates = {
            A1CompletionDate: data.courseCompletionDates?.A1CompletionDate
              ? new Date(data.courseCompletionDates.A1CompletionDate).toISOString().split('T')[0]
              : null,
            A2CompletionDate: data.courseCompletionDates?.A2CompletionDate
              ? new Date(data.courseCompletionDates.A2CompletionDate).toISOString().split('T')[0]
              : null,
            B1CompletionDate: data.courseCompletionDates?.B1CompletionDate
              ? new Date(data.courseCompletionDates.B1CompletionDate).toISOString().split('T')[0]
              : null,
            B2CompletionDate: data.courseCompletionDates?.B2CompletionDate
              ? new Date(data.courseCompletionDates.B2CompletionDate).toISOString().split('T')[0]
              : null
          };

          this.courseStartDates = {
            A1StartDate: data.courseStartDates?.A1StartDate
              ? new Date(data.courseStartDates.A1StartDate).toISOString().split('T')[0]
              : null,
            A2StartDate: data.courseStartDates?.A2StartDate
              ? new Date(data.courseStartDates.A2StartDate).toISOString().split('T')[0]
              : null,
            B1StartDate: data.courseStartDates?.B1StartDate
              ? new Date(data.courseStartDates.B1StartDate).toISOString().split('T')[0]
              : null,
            B2StartDate: data.courseStartDates?.B2StartDate
              ? new Date(data.courseStartDates.B2StartDate).toISOString().split('T')[0]
              : null
          };

          this.qualifications = data.qualifications || '';
          this.loadTeachers(); // load teachers for selected level + medium
        } else if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
          this.medium = data.medium || [];
          this.assignedCourses = data.assignedCourses?.map((c: any) => c._id || c) || [];
          this.assignedBatches = data['assignedBatches'] || [];
        }
      },
      error: (err) => {
        console.error('Failed to load user for edit', err);
      }
    });
  }

  onSubmit() {

    if (this.role === 'STUDENT') {
      if (!this.medium || !this.subscription || !this.batch) {
        alert('Batch, Medium, and Subscription are required for students!');
        return;
      }
      if (!this.assignedTeacher) {
        alert('You must select a teacher for the student!');
        return;
      }
    }

    if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
      if (!this.medium || (Array.isArray(this.medium) && this.medium.length === 0) 
          || this.assignedCourses.length === 0 
          || !this.assignedBatches.length) {
        alert("Medium, and at least one course are required for teachers!");
        return;
      }
    }


    const user: any = {
      name: this.name,
      email: this.email,
      role: this.role,
    };

    if (this.role === 'STUDENT') {
      user.batch = this.batch;
      user.medium = this.medium;
      user.conversationId = this.conversationId;
      user.subscription = this.subscription;
      user.level = this.level;
      user.assignedTeacher = this.assignedTeacher;
      user.studentStatus = this.studentStatus;
      user.phoneNumber = this.phoneNumber;
      user.address = this.address;
      user.age = this.age;
      user.servicesOpted = this.servicesOpted;
      user.leadSource = this.leadSource;
      user.languageLevelOpted = this.languageLevelOpted;
      user.dateWithdrew = this.dateWithdrew;
      user.reasonForWithdrawing = this.reasonForWithdrawing;
      user.courseCompletionDates = this.courseCompletionDates;
      user.courseStartDates = this.courseStartDates;
      user.qualifications = this.qualifications;
    }

    if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
      user.medium = this.medium;
      user.assignedCourses = this.assignedCourses;
      user.assignedBatches = this.assignedBatches;
    }

    // ✅ Decide whether to create or update
    if (this.isEditMode && this.studentId) {
      // UPDATE existing user
      this.authService.updateUser(this.studentId, user).subscribe({
        next: (response: any) => {
          alert('User updated successfully!');
          if (this.role === 'STUDENT') {
            this.router.navigate(['/admin-dashboard']);
            return;
          }
          this.router.navigate(['/teachers']);
        },
        error: (error: any) => {
          alert('Update failed: ' + (error.error?.message || 'Please try again later.'));
          console.error('Update failed', error);
        }
      });
    } else {
      // CREATE new user
      this.authService.signup(user).subscribe({
        next: (response: any) => {
          alert(user.role + ' Registered Successfully!');

          if (this.role === 'TEACHER' || this.role === 'TEACHER_ADMIN') {
            this.router.navigate(['/teachers']);
            return;
          }
          this.router.navigate(['/admin-dashboard']);
        },
        error: (error: any) => {
          alert('Registration failed: ' + (error.error?.message || 'Please try again later.'));
          console.error('Register failed', error);
        }
      });
    }

  }
  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  scrollToBottom() {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  onCourseChange(event: any, courseId: string) {
    if (event.target.checked) {
      this.assignedCourses.push(courseId);
    } else {
      this.assignedCourses = this.assignedCourses.filter(id => id !== courseId);
    }
  }

  onAssignedBatchesChange(value: string) {
    this.assignedBatches = value.split(',').map(batch => batch.trim());
  }

}
