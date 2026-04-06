import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../services/notification.service';

const apiUrl = environment.apiUrl;  // Base API URL

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  userProfile: any = null;            // Store user profile data including profile photo URL
  selectedFile: File | null = null;   // Store the selected file from input
  uploading: boolean = false;         // Upload in progress flag
  uploadError: string = '';           // Upload error message

  constructor(
    private authService: AuthService,
    private http: HttpClient,
    private router: Router,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadUserProfile();
  }

  loadUserProfile() {
    this.authService.getUserProfile().subscribe({
      next: (response: any) => {
        // Convert relative profilePic path to full HTTPS URL
        if (response.profilePic) {
          this.userProfile = {
            ...response,
            profilePhoto: this.getFullPhotoUrl(response.profilePic)
          };
        } else {
          this.userProfile = response;
        }
      },
      error: (error: any) => {
        console.error('Error loading profile:', error);
        if (error.status === 401) {
          this.router.navigate(['/login']);
        }
      }
    });
  }


  // Called when user selects a file
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      this.uploadError = '';
    }
  }

  // Upload selected photo to backend
  uploadPhoto(event: Event) {
    event.preventDefault();

    if (!this.selectedFile) {
      this.uploadError = 'Please select a photo first.';
      return;
    }

    this.uploading = true;
    this.uploadError = '';

    this.authService.uploadProfilePhoto(this.selectedFile).subscribe({
      next: (res: any) => {
        this.uploading = false;
        this.notify.success('Profile photo uploaded successfully!');

        if (res.profilePhoto) {
          this.userProfile.profilePhoto = this.getFullPhotoUrl(res.profilePhoto);
        }

        window.location.reload();

        this.selectedFile = null;
      },
      error: (err) => {
        this.uploading = false;
        console.error('Error uploading photo:', err);
        this.uploadError = 'Failed to upload photo. Please try again.';
      }
    });
  }

  // Utility function to convert any path to HTTPS relative URL
  getFullPhotoUrl(relativePath: string): string {
    if (!relativePath) return 'https://via.placeholder.com/150';

    // ✅ If the backend already returned a full URL, just use it
    if (relativePath.startsWith('http')) {
      return relativePath;
    }

    // Otherwise, build a full URL with your domain
    return `https://gluckstudentsportal.com${relativePath}`;
  }

  getLevelPercent(): number {
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const idx = levels.indexOf(this.userProfile?.level);
    if (idx < 0) return 0;
    return ((idx + 1) / levels.length) * 100;
  }

  deleteAccount(userId: string) {
    this.notify.confirm('Delete Account', 'Are you sure you want to delete this account? This action cannot be undone.', 'Yes, Delete', 'Cancel').subscribe(ok => {
      if (!ok) return;
      this.authService.deleteUser(userId).subscribe({
        next: () => {
          this.notify.success('Account deleted successfully.');
          this.router.navigate(['/login']);
        },
        error: (err) => {
          console.error('Error deleting account:', err);
          this.notify.error('Failed to delete account. Please try again.');
        }
      });
    });
  }
}
