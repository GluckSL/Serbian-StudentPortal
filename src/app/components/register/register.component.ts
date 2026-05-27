import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { PublicSignupWizardComponent } from '../public-signup/public-signup-wizard.component';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterModule, PublicSignupWizardComponent],
  templateUrl: './register.component.html',
  styleUrls: ['../login/login.component.css'],
})
export class RegisterComponent {
  constructor(private router: Router) {}

  goToLogin(): void {
    this.router.navigateByUrl('/login');
  }
}
