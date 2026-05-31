import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../../shared/material.module';
import { InteractiveGameService } from '../../../services/interactive-game.service';
import { NotificationService } from '../../../../../services/notification.service';
import { ArenaTournamentDto } from '../../../glueck-arena.types';

@Component({
  selector: 'app-admin-tournament-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  template: `
    <div class="atm">
      <div class="atm__head">
        <button mat-icon-button routerLink="/admin/glueck-arena/command-center"><mat-icon>arrow_back</mat-icon></button>
        <h1>Tournament Manager</h1>
      </div>

      <mat-card class="atm__form">
        <mat-card-title>{{ editingId ? 'Edit' : 'Create' }} tournament</mat-card-title>
        <mat-card-content>
          <mat-form-field appearance="outline" class="atm__full"><mat-label>Title</mat-label>
            <input matInput [(ngModel)]="form.title"></mat-form-field>
          <mat-form-field appearance="outline" class="atm__full"><mat-label>Game set ID</mat-label>
            <input matInput [(ngModel)]="form.gameSetId"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Game type</mat-label>
            <mat-select [(ngModel)]="form.gameType">
              <mat-option value="scramble_rush">Scramble Rush</mat-option>
              <mat-option value="sentence_builder">Sentence Builder</mat-option>
              <mat-option value="flapjugation">Flapjugation</mat-option>
              <mat-option value="whackawort">Whack-a-Wort</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Starts at</mat-label>
            <input matInput type="datetime-local" [(ngModel)]="form.startsAtLocal"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Max players</mat-label>
            <input matInput type="number" [(ngModel)]="form.maxParticipants"></mat-form-field>
          <mat-form-field appearance="outline"><mat-label>Status</mat-label>
            <mat-select [(ngModel)]="form.status">
              <mat-option value="draft">Draft</mat-option>
              <mat-option value="scheduled">Scheduled</mat-option>
              <mat-option value="registration">Registration</mat-option>
            </mat-select>
          </mat-form-field>
          <h3>Rewards</h3>
          <div class="atm__row">
            <mat-form-field appearance="outline"><mat-label>1st XP</mat-label>
              <input matInput type="number" [(ngModel)]="form.rewards.xpFirst"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>2nd XP</mat-label>
              <input matInput type="number" [(ngModel)]="form.rewards.xpSecond"></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>3rd XP</mat-label>
              <input matInput type="number" [(ngModel)]="form.rewards.xpThird"></mat-form-field>
          </div>
          <button mat-raised-button color="primary" (click)="save()">Save</button>
          <button mat-stroked-button *ngIf="editingId" (click)="startTournament()">Start bracket</button>
        </mat-card-content>
      </mat-card>

      <h2>Tournaments</h2>
      <div *ngIf="analytics" class="atm__analytics">
        Active: {{ analytics.active }} · Finished: {{ analytics.finished }} · Total entries: {{ analytics.totalParticipants }}
      </div>
      <mat-card *ngFor="let t of tournaments" class="atm__item">
        <mat-card-title>{{ t.title }}</mat-card-title>
        <mat-card-subtitle>{{ t.status }} · {{ t.startsAt | date:'short' }}</mat-card-subtitle>
        <mat-card-actions>
          <button mat-button (click)="edit(t)">Edit</button>
          <a mat-button [routerLink]="['/glueck-arena/tournaments', t._id]">View</a>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .atm { max-width: 720px; margin: 0 auto; padding: 24px; }
    .atm__head { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; }
    .atm__form { margin-bottom: 32px; }
    .atm__full { width: 100%; }
    .atm__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .atm__analytics { margin-bottom: 16px; color: #555; }
    .atm__item { margin-bottom: 12px; }
  `]
})
export class AdminTournamentManagerComponent implements OnInit {
  tournaments: ArenaTournamentDto[] = [];
  analytics: { active: number; finished: number; totalParticipants: number } | null = null;
  editingId = '';
  form = {
    title: '',
    gameSetId: '',
    gameType: 'scramble_rush',
    startsAtLocal: '',
    maxParticipants: 32,
    status: 'draft',
    rewards: { xpFirst: 200, xpSecond: 100, xpThird: 50 },
  };

  constructor(private svc: InteractiveGameService, private notify: NotificationService) {}

  ngOnInit() {
    this.load();
    this.svc.adminTournamentAnalytics().subscribe({ next: r => this.analytics = r.analytics });
  }

  load() {
    this.svc.adminListTournaments().subscribe({ next: r => this.tournaments = r.tournaments || [] });
  }

  save() {
    const body = {
      title: this.form.title,
      gameSetId: this.form.gameSetId,
      gameType: this.form.gameType,
      startsAt: new Date(this.form.startsAtLocal).toISOString(),
      maxParticipants: this.form.maxParticipants,
      status: this.form.status,
      rewards: this.form.rewards,
    };
    const req = this.editingId
      ? this.svc.updateTournament(this.editingId, body)
      : this.svc.createTournament(body);
    req.subscribe({
      next: () => { this.notify.success('Saved'); this.load(); this.editingId = ''; },
      error: () => this.notify.error('Save failed'),
    });
  }

  edit(t: ArenaTournamentDto) {
    this.editingId = t._id;
    this.form.title = t.title;
    this.form.gameSetId = t.gameSetId;
    this.form.gameType = t.gameType;
    this.form.startsAtLocal = t.startsAt ? new Date(t.startsAt).toISOString().slice(0, 16) : '';
    this.form.maxParticipants = t.maxParticipants;
    this.form.status = t.status;
    this.form.rewards = { ...t.rewards } as typeof this.form.rewards;
  }

  startTournament() {
    if (!this.editingId) return;
    this.svc.startTournament(this.editingId).subscribe({
      next: () => { this.notify.success('Tournament started'); this.load(); },
      error: () => this.notify.error('Could not start'),
    });
  }
}
