import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';

@Component({
  selector: 'app-classroom-hub',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  template: `
    <div class="ch">
      <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
      <h1><mat-icon>class</mat-icon> Classrooms</h1>

      <mat-card>
        <mat-card-title>Join with class code</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline"><mat-label>Code</mat-label>
            <input matInput [(ngModel)]="joinCode"></mat-form-field>
          <button mat-raised-button (click)="join()">Join</button>
        </mat-card-content>
      </mat-card>

      <div *ngFor="let c of classrooms" class="ch__room">
        <mat-icon>school</mat-icon>
        <div>
          <strong>{{ c.name }}</strong>
          <span *ngIf="c.classCode"> · {{ c.classCode }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ch { max-width: 640px; margin: 0 auto; padding: 24px; }
    .ch__room { display: flex; gap: 12px; align-items: center; padding: 12px; background: #f5f5f5; border-radius: 12px; margin-top: 8px; }
  `]
})
export class ClassroomHubComponent implements OnInit {
  joinCode = '';
  classrooms: any[] = [];
  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}
  ngOnInit() {
    this.svc.listClassrooms().subscribe({ next: (r) => { this.classrooms = r.classrooms || []; } });
  }
  join() {
    this.svc.joinClassroom(this.joinCode).subscribe({
      next: () => { this.notify.success('Joined classroom!'); this.ngOnInit(); },
      error: (e) => this.notify.error(e?.error?.message || 'Failed')
    });
  }
}
