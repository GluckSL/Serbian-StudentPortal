import { Component, OnInit } from '@angular/core';
import { CourseMaterialService, CourseMaterial } from '../../services/courseMaterial.service';
import { CoursesService } from '../../services/courses.service';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { NotificationService } from '../../services/notification.service';

interface Course {
  _id?: string;
  title: string;
}

@Component({
  selector: 'app-course-material-upload',
  standalone: true,
  imports: [FormsModule, CommonModule, HttpClientModule],
  templateUrl: './course-material-upload.component.html',
  styleUrls: ['./course-material-upload.component.css']
})
export class UploadCourseMaterialComponent implements OnInit {

    courseMaterial: CourseMaterial = {
        course: '',
        materials: []
    };

    courses: Course[] = [];             // List of courses for dropdown
    selectedFiles: File[] = [];        // Selected files
    uploading: boolean = false;        // Upload in progress
    uploadError: string = '';           // Error message

    constructor(
        private courseMaterialService: CourseMaterialService, 
        private coursesService: CoursesService,
        private router: Router, 
        private http: HttpClient,
        private notify: NotificationService
    ) {}

    ngOnInit(): void {
        this.loadCourses();
    }

    // Fetch all available courses
    loadCourses(): void {
        this.coursesService.getCourses().subscribe({
        next: (data: Course[]) => {
            this.courses = data;
        },
        error: (err) => {
            console.error('Error loading courses:', err);
        }
        });
    }

    // Called when user selects files
    onFilesSelected(event: Event) {
        const input = event.target as HTMLInputElement;
        if (input.files && input.files.length > 0) {
        this.selectedFiles = Array.from(input.files);
        this.uploadError = '';
        }
    }

        // Upload selected files and send to backend
        uploadMaterials(event: Event) {
    event.preventDefault();

    if (!this.courseMaterial.course) {
        this.uploadError = 'Please select a course first.';
        return;
    }

    if (this.selectedFiles.length === 0) {
        this.uploadError = 'Please select at least one file to upload.';
        return;
    }

    this.uploading = true;
    this.uploadError = '';

    const formData = new FormData();
    formData.append('course', this.courseMaterial.course);  // add course ID
    this.selectedFiles.forEach(file => formData.append('files', file, file.name));

    // Send directly to courseMaterial endpoint
    this.http.post(`${this.courseMaterialService['apiUrl']}`, formData)
        .subscribe({
        next: (res: any) => {
            this.uploading = false;
            this.notify.success('Course materials uploaded successfully!');
            this.selectedFiles = [];
            this.courseMaterial.materials = [];
            this.courseMaterial.course = '';
            this.router.navigate(['/view-course-materials']);
        },
        error: (err) => {
            this.uploading = false;
            //console.error('Error uploading files:', err);
            this.uploadError = 'Failed to upload files. Please try again.';
        }
        });
    }

}
