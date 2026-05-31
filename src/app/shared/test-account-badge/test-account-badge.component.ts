import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Small purple "Test" pill shown next to student names when `User.isTestAccount` is true.
 * Use anywhere the full student document (or `isTestAccount`) is available.
 */
@Component({
  selector: 'app-test-account-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span *ngIf="show" class="tab-badge" [attr.title]="title" role="img" [attr.aria-label]="title">Test</span>
  `,
  styles: [`
    :host { display: inline-flex; vertical-align: middle; align-items: center; }
    .tab-badge {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 4px;
      background: linear-gradient(135deg, #6d28d9, #7c3aed);
      color: #fff;
      margin-left: 6px;
      line-height: 1.25;
      box-shadow: 0 1px 2px rgba(109, 40, 217, 0.25);
      flex-shrink: 0;
    }
  `]
})
export class TestAccountBadgeComponent {
  @Input() show = false;
  @Input() title = 'Test account — excluded from batch analytics and progress totals';
}
