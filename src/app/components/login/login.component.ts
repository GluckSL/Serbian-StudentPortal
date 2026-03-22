// src/app/components/login/login.component.ts

import { Component } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, HttpClientModule, CommonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent {
  regNo: string = '';
  password: string = '';
  errorMessage: string = '';   // <-- holds error messages
  loading: boolean = false;    // <-- for optional spinner
  showPassword: boolean = false; // <-- for password visibility toggle

  constructor(private authService: AuthService, private router: Router) {}

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit() {
    this.errorMessage = '';
    this.loading = true;

    const user = { regNo: this.regNo, password: this.password };
    console.log('🔍 Sending to server:', user);
    console.log('🔍 regNo value:', this.regNo);
    console.log('🔍 password value:', this.password);

    this.authService.login(user).subscribe({
      next: (response) => {
        console.log('✅ Login successful:', response);
        
        // Ensure user profile is refreshed before navigation
        this.authService.refreshUserProfile().subscribe({
          next: (user) => {
            console.log('✅ User profile refreshed:', user);
            this.loading = false;

            const role = user?.role || response.user?.role || response.role;

            if (role === 'ADMIN') {
              this.router.navigate(['/admin-dashboard']);
            } else if (role === 'TEACHER' || role === 'TEACHER_ADMIN') {
              this.router.navigate(['/teacher-dashboard']);
            } else if (role === 'STUDENT') {
              this.router.navigate(['/student-progress']);
            } else {
              this.errorMessage = 'Unknown user role.';
            }
          },
          error: (err) => {
            console.error('❌ Error refreshing profile:', err);
            this.loading = false;
            this.errorMessage = 'Failed to load user profile.';
          }
        });
      },
      error: (err) => {
        this.loading = false;
        console.error('Login failed', err);

        if (err.status === 403) {
          this.errorMessage = 'Access denied. Your student account has been withdrawn.';
        }
        else if (err.status === 401 || err.status === 400) {
          this.errorMessage = 'Invalid username or password!';
        }
        else {
          this.errorMessage = 'Server error. Please try again later.';
        }
      }
    });
  }
}
