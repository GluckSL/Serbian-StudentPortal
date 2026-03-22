import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { FeedbackService } from '../../services/feedback.service';
import { AuthService} from '../../services/auth.service';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-feedback',
  standalone: true,
  templateUrl: './feedback-form.component.html',
  styleUrls: ['./feedback-form.component.css'],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    HttpClientModule,
    RouterModule
  ]
})
export class FeedbackFormComponent implements OnInit {
  feedbackForm!: FormGroup;
  submitted = false;
  successMessage = '';
  errorMessage = '';
  studentId: string = '';

  constructor(
    private fb: FormBuilder,
    private feedbackService: FeedbackService,
    private authService: AuthService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeForm();
    this.loadStudentProfile();
  }

  private initializeForm(): void {
    this.feedbackForm = this.fb.group({
      feedback: ['', [Validators.required, Validators.minLength(5)]],
      rating: [null, [Validators.required, Validators.min(1), Validators.max(5)]]
    });
  }

  // ✅ Fetch logged-in student profile
  private loadStudentProfile(): void {
    this.authService.getUserProfile().subscribe({
      next: (profile: any) => {
        //console.log('Student profile loaded:', profile);
        this.studentId = profile._id;
      },
      error: (err) => {
        console.error('Failed to load profile:', err);
      }
    });
  }
  
    onSubmit(): void {
    this.submitted = true;
    this.successMessage = '';
    this.errorMessage = '';

    if (this.feedbackForm.invalid) return;

    if (!this.studentId) {
      this.errorMessage = 'User information not loaded. Please try again.';
      return;
    }

    // ✅ Attach studentId before sending
    const feedbackData = {
      ...this.feedbackForm.value,
      studentId: this.studentId,
      rating: Number(this.feedbackForm.value.rating)
    };

    this.feedbackService.submitFeedback(feedbackData).subscribe({
      next: (response) => {
        if ((response as any).success) {
          this.successMessage = 'Thank you for your feedback!';
          this.feedbackForm.reset({ rating: null });
          this.submitted = false;
          this.router.navigate(['/student-progress']);
        } else {
          this.errorMessage = (response as any).message || 'Something went wrong.';
        }
      },
      error: (error) => {
        this.errorMessage = 'Failed to submit feedback. Please try again later.';
      }
    });
  }
}
