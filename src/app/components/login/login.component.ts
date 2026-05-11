// src/app/components/login/login.component.ts

import {
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnInit,
  ViewChild
} from '@angular/core';
import { AuthService, SKIP_SESSION_RESTORE_KEY } from '../../services/auth.service';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { isSafeReturnUrl } from '../../services/join-class-flow.service';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, HttpClientModule, CommonModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  regNo: string = '';
  password: string = '';
  errorMessage: string = '';
  loading: boolean = false;
  showPassword: boolean = false;
  keepSessionActive = true;
  readonly currentYear = new Date().getFullYear();
  showSessionExpiredNotice = false;
  /** True while checking for an existing token session */
  checkingExistingSession = false;
  /** Safe internal path to navigate to after successful login (from ?returnUrl query param). */
  pendingReturnUrl = '';

  /** Pupil offset in px (translate) for each eye */
  leftPupil = { x: 0, y: 0 };
  rightPupil = { x: 0, y: 0 };

  @ViewChild('eyeLeft', { read: ElementRef }) eyeLeft?: ElementRef<HTMLElement>;
  @ViewChild('eyeRight', { read: ElementRef }) eyeRight?: ElementRef<HTMLElement>;

  private moveRaf = 0;
  private lastMove: MouseEvent | null = null;

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    const session = this.route.snapshot.queryParamMap.get('session');
    // Read returnUrl before clearing query params so it can be used after login.
    const rawReturnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '';
    if (rawReturnUrl && isSafeReturnUrl(rawReturnUrl)) {
      this.pendingReturnUrl = rawReturnUrl;
    }

    if (session === 'expired') {
      this.showSessionExpiredNotice = true;
      // Strip query params from the URL bar but keep pendingReturnUrl in memory.
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
      return;
    }

    // User just logged out (or chose a fresh login): show the form; do not auto-restore.
    try {
      if (sessionStorage.getItem(SKIP_SESSION_RESTORE_KEY) === '1') {
        sessionStorage.removeItem(SKIP_SESSION_RESTORE_KEY);
        this.authService.clearClientSession();
        this.checkingExistingSession = false;
        return;
      }
    } catch {
      /* ignore */
    }

    this.checkingExistingSession = true;
    this.authService.refreshUserProfile().subscribe({
      next: (user) => {
        this.checkingExistingSession = false;
        const path = this.authService.getPostLoginPath(user);
        if (path) {
          this.router.navigateByUrl(path);
        }
      },
      error: () => {
        this.checkingExistingSession = false;
      }
    });
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    this.lastMove = event;
    if (this.moveRaf) {
      return;
    }
    this.moveRaf = requestAnimationFrame(() => {
      this.moveRaf = 0;
      const e = this.lastMove;
      if (!e) {
        return;
      }
      this.ngZone.run(() => {
        this.updatePupil(this.eyeLeft, e, (o) => (this.leftPupil = o));
        this.updatePupil(this.eyeRight, e, (o) => (this.rightPupil = o));
      });
    });
  }

  private updatePupil(
    eyeRef: ElementRef<HTMLElement> | undefined,
    e: MouseEvent,
    set: (o: { x: number; y: number }) => void
  ): void {
    const el = eyeRef?.nativeElement;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const maxMove = 9;
    const sensitivity = 0.12;
    if (dist < 0.5) {
      set({ x: 0, y: 0 });
      return;
    }
    const move = Math.min(maxMove, dist * sensitivity);
    dx = (dx / dist) * move;
    dy = (dy / dist) * move;
    set({ x: dx, y: dy });
  }

  pupilTransform(p: { x: number; y: number }): string {
    return `translate(${p.x}px, ${p.y}px)`;
  }

  dismissSessionExpiredNotice(): void {
    this.showSessionExpiredNotice = false;
  }

  onCredentialFocus(): void {
    this.showSessionExpiredNotice = false;
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    this.errorMessage = '';
    this.showSessionExpiredNotice = false;
    this.loading = true;

    const user = {
      regNo: this.regNo,
      password: this.password,
      keepSessionActive: this.keepSessionActive
    };

    this.authService.login(user).subscribe({
      next: (response) => {
        this.authService.refreshUserProfile().subscribe({
          next: (profile) => {
            this.loading = false;

            const merged = profile || response.user;
            // If the student was redirected here mid-flow, send them back.
            if (this.pendingReturnUrl) {
              this.router.navigateByUrl(this.pendingReturnUrl);
            } else {
              const path = this.authService.getPostLoginPath(merged);
              if (path) {
                this.router.navigateByUrl(path);
              } else {
                this.errorMessage = 'Unknown user role.';
              }
            }
          },
          error: () => {
            this.loading = false;
            this.errorMessage = 'Failed to load user profile.';
          }
        });
      },
      error: (err) => {
        this.loading = false;

        if (err.status === 403) {
          this.errorMessage = 'Access denied. Your student account has been withdrawn.';
        } else if (err.status === 401 || err.status === 400) {
          this.errorMessage = 'Invalid username or password!';
        } else {
          this.errorMessage = 'Server error. Please try again later.';
        }
      }
    });
  }
}
