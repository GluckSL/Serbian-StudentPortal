// src/app/components/student-assignments/student-assignments.component.ts

import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { NgModel } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { NgStyle } from '@angular/common';
import { NgClass } from '@angular/common';
import { NgIf } from '@angular/common';
import { NgFor } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
//import { NgModule } from '@angular/core';

interface AssignmentFile {
  path: string;
  originalName: string;
  mimeType: string;
  size: number;
}

interface AssignmentSubmission {
  _id: string;
  title: string;
  status: string;
  createdAt: string;
  files: AssignmentFile[];
  teacherId?: {
    name: string;
    regNo: string;
    email: string;
  };
}

@Component({
  selector: 'app-student-assignments',
  templateUrl: './student-assignments.component.html',
  styleUrls: ['./student-assignments.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DatePipe, NgIf, NgFor],
})
export class StudentAssignmentsComponent {
  apiBase = '/api/assignments';
  selectedFiles: File[] = [];
  title = '';
  courseId = '';
  moduleId = '';

  loading = false;
  message = '';
  error = '';

  submissions: AssignmentSubmission[] = [];
  loadingSubmissions = false;
  selectedTemplateId: any;

  constructor(private http: HttpClient) {
    this.loadSubmissions();
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    this.selectedFiles = Array.from(input.files);
  }

  submitAssignment() {
    if (this.selectedFiles.length === 0) {
      this.error = 'Please select at least one file.';
      this.message = '';
      return;
    }

    this.loading = true;
    this.error = '';
    this.message = '';

    const formData = new FormData();
    this.selectedFiles.forEach((file) => formData.append('files', file));
    if (this.title) formData.append('title', this.title);
    if (this.courseId) formData.append('courseId', this.courseId);
    if (this.moduleId) formData.append('moduleId', this.moduleId);
    if (this.selectedTemplateId) formData.append('assignmentTemplateId', this.selectedTemplateId);

    this.http
      .post<any>(`${this.apiBase}/student-upload`, formData, {
        withCredentials: true,
      })
      .subscribe({
        next: () => {
          this.loading = false;
          this.message = 'Assignment uploaded successfully.';
          this.selectedFiles = [];
          this.title = '';
          this.courseId = '';
          this.moduleId = '';
          this.loadSubmissions();
        },
        error: (err) => {
          this.loading = false;
          this.error = err.error?.msg || 'Failed to upload assignment.';
        },
      });
  }

  loadSubmissions() {
    this.loadingSubmissions = true;
    this.http
      .get<any>(`${this.apiBase}/student`, {
        withCredentials: true,
      })
      .subscribe({
        next: (res) => {
          this.loadingSubmissions = false;
          this.submissions = res.data || [];
        },
        error: () => {
          this.loadingSubmissions = false;
        },
      });
  }

  getFileUrl(file: { path: string }): string {
    if (!file.path) return '#';
    if (file.path.startsWith('http')) return file.path;
    // app.js exposes /uploads as static [file:79] and mongo stores paths without leading slash
    return '/' + file.path.replace(/^\/+/, '');
  }

}
