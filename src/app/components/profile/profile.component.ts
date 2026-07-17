import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { CommonModule } from '@angular/common';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../services/notification.service';

const apiUrl = environment.apiUrl;  // Base API URL

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, HttpClientModule, RouterModule, FormsModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.css']
})
export class ProfileComponent implements OnInit {
  userProfile: any = null;            // Store user profile data including profile photo URL
  selectedFile: File | null = null;   // Store the selected file from input
  uploading: boolean = false;         // Upload in progress flag
  uploadError: string = '';           // Upload error message

  // Change password state
  showChangePassword = false;
  pwCurrent = '';
  pwNew = '';
  pwConfirm = '';
  showCurrentPw = false;
  showNewPw = false;
  showConfirmPw = false;
  pwLoading = false;
  pwError = '';
  pwSuccess = '';

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
      this.uploadError = 'Prvo izaberite fotografiju.';
      return;
    }

    this.uploading = true;
    this.uploadError = '';

    this.authService.uploadProfilePhoto(this.selectedFile).subscribe({
      next: (res: any) => {
        this.uploading = false;
        this.notify.success('Profilna fotografija je uspešno otpremljena!');

        if (res.profilePhoto) {
          this.userProfile.profilePhoto = this.getFullPhotoUrl(res.profilePhoto);
        }

        window.location.reload();

        this.selectedFile = null;
      },
      error: (err) => {
        this.uploading = false;
        console.error('Error uploading photo:', err);
        this.uploadError = 'Otpremanje fotografije nije uspelo. Pokušajte ponovo.';
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

  roleLabel(role: string): string {
    const labels: Record<string, string> = {
      STUDENT: 'Učenik',
      TEACHER: 'Nastavnik',
      TEACHER_ADMIN: 'Administrator nastave',
      ADMIN: 'Administrator',
      SUB_ADMIN: 'Pomoćni administrator',
    };
    return labels[role] || role;
  }

  deleteAccount(userId: string) {
    this.notify.confirm('Obriši nalog', 'Da li ste sigurni da želite da obrišete nalog? Ova radnja se ne može poništiti.', 'Da, obriši', 'Otkaži').subscribe(ok => {
      if (!ok) return;
      this.authService.deleteUser(userId).subscribe({
        next: () => {
          this.notify.success('Nalog je uspešno obrisan.');
          this.router.navigate(['/login']);
        },
        error: (err) => {
          console.error('Error deleting account:', err);
          this.notify.error('Brisanje naloga nije uspelo. Pokušajte ponovo.');
        }
      });
    });
  }

  cancelChangePassword(): void {
    this.showChangePassword = false;
    this.pwCurrent = '';
    this.pwNew = '';
    this.pwConfirm = '';
    this.pwError = '';
    this.pwSuccess = '';
  }

  submitChangePassword(): void {
    this.pwError = '';
    this.pwSuccess = '';
    if (!this.pwCurrent || !this.pwNew || !this.pwConfirm) {
      this.pwError = 'Sva polja su obavezna.';
      return;
    }
    if (this.pwNew.length < 8) {
      this.pwError = 'Nova lozinka mora imati najmanje 8 znakova.';
      return;
    }
    if (this.pwNew !== this.pwConfirm) {
      this.pwError = 'Nove lozinke se ne podudaraju.';
      return;
    }
    this.pwLoading = true;
    this.authService.changePassword({
      currentPassword: this.pwCurrent,
      newPassword: this.pwNew,
      confirmPassword: this.pwConfirm,
    }).subscribe({
      next: () => {
        this.pwLoading = false;
        this.pwSuccess = 'Lozinka je uspešno ažurirana!';
        this.pwCurrent = '';
        this.pwNew = '';
        this.pwConfirm = '';
        setTimeout(() => { this.cancelChangePassword(); }, 2000);
      },
      error: (err: any) => {
        this.pwLoading = false;
        this.pwError = err?.error?.msg || 'Ažuriranje lozinke nije uspelo. Pokušajte ponovo.';
      },
    });
  }
}
