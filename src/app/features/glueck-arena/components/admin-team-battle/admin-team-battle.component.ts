import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { TeamBattleDto } from '../../glueck-arena.types';
import { environment } from '../../../../../environments/environment';
import { Subscription } from 'rxjs';

interface BatchSummary { batchName: string; }

@Component({
  selector: 'app-admin-team-battle',
  standalone: true,
  imports: [CommonModule, FormsModule, MaterialModule],
  template: `
    <div class="atb">
      <div class="atb__top">
        <h1><mat-icon>groups</mat-icon> Team Battles</h1>
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> New Team Battle
        </button>
      </div>

      <!-- Filters -->
      <div class="atb__filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="statusFilter" (selectionChange)="load()">
            <mat-option value="">All</mat-option>
            <mat-option value="pending">Pending</mat-option>
            <mat-option value="active">Active</mat-option>
            <mat-option value="finished">Finished</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <!-- List -->
      <div class="atb__list" *ngIf="!loading">
        <div class="atb__card" *ngFor="let b of battles">
          <div class="atb__card-top">
            <span class="atb__card-status" [class]="'atb__card-status--' + b.status">{{ b.status | titlecase }}</span>
            <span class="atb__card-game">{{ b.gameType }}</span>
          </div>
          <div class="atb__card-title">{{ b.title }}</div>
          <div class="atb__card-teams">
            <div class="atb__card-team" [class.atb__card-team--winner]="b.winner === 'teamA'">
              <strong>{{ b.teamA.name }}</strong>
              <span>{{ b.teamA.score }} pts</span>
              <span class="atb__card-members">{{ b.teamA.members.length || 0 }} players</span>
            </div>
            <span class="atb__card-vs">VS</span>
            <div class="atb__card-team" [class.atb__card-team--winner]="b.winner === 'teamB'">
              <strong>{{ b.teamB.name }}</strong>
              <span>{{ b.teamB.score }} pts</span>
              <span class="atb__card-members">{{ b.teamB.members.length || 0 }} players</span>
            </div>
          </div>
          <div class="atb__card-meta">
            <span>Round {{ b.currentRound }}/{{ b.rounds }}</span>
            <span *ngIf="b.roomCode">Room: {{ b.roomCode }}</span>
          </div>
          <div class="atb__card-actions" *ngIf="b.status === 'pending'">
            <button mat-raised-button color="primary" (click)="startBattle(b._id)">
              <mat-icon>play_arrow</mat-icon> Start
            </button>
            <button mat-stroked-button color="warn" (click)="cancelBattle(b._id)">
              Cancel
            </button>
          </div>
        </div>
        <div class="atb__empty" *ngIf="battles.length === 0">
          <mat-icon>sports_kabaddi</mat-icon>
          <p>No team battles yet</p>
        </div>
      </div>

      <div class="atb__loading" *ngIf="loading">
        <mat-spinner diameter="40"></mat-spinner>
      </div>
    </div>

    <!-- Create Dialog -->
    <div class="atb-overlay" *ngIf="showCreate" (click)="showCreate = false">
      <div class="atb-dialog" (click)="$event.stopPropagation()">
        <h2><mat-icon>add</mat-icon> Create Team Battle</h2>

        <div class="atb-field">
          <label>Title</label>
          <input [(ngModel)]="form.title" placeholder="e.g. Batch A vs Batch B" class="atb-input">
        </div>

        <div class="atb-field">
          <label>Game Set</label>
          <select [(ngModel)]="form.gameSetId" class="atb-select" (ngModelChange)="onGameSetChange()">
            <option value="" disabled>Select a game set</option>
            <option *ngFor="let s of availableSets" [value]="s._id">{{ s.title }} ({{ formatGameType(s.gameType) }})</option>
          </select>
        </div>

        <div class="atb-field">
          <label>Rounds</label>
          <input [(ngModel)]="form.rounds" type="number" min="1" max="20" class="atb-input" style="width:80px">
        </div>

        <fieldset class="atb-team-set">
          <legend>Team A</legend>
          <div class="atb-field" *ngIf="!form.teamA.batchName">
            <label>Select Batch</label>
            <select [(ngModel)]="form.teamA.batchName" class="atb-select" (ngModelChange)="onBatchSelect('teamA')">
              <option value="" disabled>Choose a batch</option>
              <option *ngFor="let b of availableBatches" [value]="b.batchName" [disabled]="b.batchName === form.teamB.batchName">{{ b.batchName }}</option>
            </select>
          </div>
          <div *ngIf="form.teamA.batchName" class="atb-batch-selected">
            <div class="atb-batch-selected__header">
              <strong>{{ form.teamA.name }}</strong>
              <button mat-stroked-button color="warn" (click)="clearTeam('teamA')">Change</button>
            </div>
            <div class="atb-batch-selected__count">
              <mat-icon>people</mat-icon> {{ form.teamA.members.length }} students
            </div>
            <div class="atb-batch-selected__members" *ngIf="form.teamA.members.length > 0">
              <span class="atb-batch-member" *ngFor="let m of form.teamA.members | slice:0:20">{{ m.name }}</span>
              <span class="atb-batch-member atb-batch-member--more" *ngIf="form.teamA.members.length > 20">+{{ form.teamA.members.length - 20 }} more</span>
            </div>
          </div>
        </fieldset>

        <fieldset class="atb-team-set">
          <legend>Team B</legend>
          <div class="atb-field" *ngIf="!form.teamB.batchName">
            <label>Select Batch</label>
            <select [(ngModel)]="form.teamB.batchName" class="atb-select" (ngModelChange)="onBatchSelect('teamB')">
              <option value="" disabled>Choose a batch</option>
              <option *ngFor="let b of availableBatches" [value]="b.batchName" [disabled]="b.batchName === form.teamA.batchName">{{ b.batchName }}</option>
            </select>
          </div>
          <div *ngIf="form.teamB.batchName" class="atb-batch-selected">
            <div class="atb-batch-selected__header">
              <strong>{{ form.teamB.name }}</strong>
              <button mat-stroked-button color="warn" (click)="clearTeam('teamB')">Change</button>
            </div>
            <div class="atb-batch-selected__count">
              <mat-icon>people</mat-icon> {{ form.teamB.members.length }} students
            </div>
            <div class="atb-batch-selected__members" *ngIf="form.teamB.members.length > 0">
              <span class="atb-batch-member" *ngFor="let m of form.teamB.members | slice:0:20">{{ m.name }}</span>
              <span class="atb-batch-member atb-batch-member--more" *ngIf="form.teamB.members.length > 20">+{{ form.teamB.members.length - 20 }} more</span>
            </div>
          </div>
        </fieldset>

        <div class="atb-dialog-actions">
          <button mat-stroked-button (click)="showCreate = false">Cancel</button>
          <button mat-raised-button color="primary" (click)="createTeamBattle()" [disabled]="creating || !canCreate()">
            <mat-spinner *ngIf="creating" diameter="20"></mat-spinner>
            Create
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .atb { max-width: 900px; margin: 0 auto; padding: 24px; }
    .atb__top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .atb__top h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 24px; color: #1e293b; }
    .atb__top h1 mat-icon { color: #405980; }
    .atb__filters { margin-bottom: 16px; }
    .atb__list { display: flex; flex-direction: column; gap: 12px; }
    .atb__card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 2px 8px rgba(0,0,0,.06); border: 1px solid #e2e8f0; }
    .atb__card-top { display: flex; gap: 8px; margin-bottom: 8px; }
    .atb__card-status { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; background: #f1f5f9; color: #64748b; }
    .atb__card-status--active { background: #dcfce7; color: #15803d; }
    .atb__card-status--finished { background: #f1f5f9; color: #475569; }
    .atb__card-game { font-size: 12px; color: #94a3b8; }
    .atb__card-title { font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 12px; }
    .atb__card-teams { display: flex; align-items: center; gap: 16px; margin-bottom: 8px; }
    .atb__card-team { flex: 1; padding: 12px; background: #f8fafc; border-radius: 10px; text-align: center; }
    .atb__card-team--winner { background: #f0fdf4; border: 1px solid #22c55e; }
    .atb__card-team strong { display: block; font-size: 15px; }
    .atb__card-team span { font-size: 13px; color: #64748b; }
    .atb__card-members { display: block; font-size: 11px; color: #94a3b8; }
    .atb__card-vs { font-weight: 800; color: #ef4444; }
    .atb__card-meta { display: flex; gap: 16px; font-size: 13px; color: #94a3b8; margin-bottom: 8px; }
    .atb__card-actions { display: flex; gap: 8px; }
    .atb__empty { text-align: center; padding: 48px; color: #94a3b8; }
    .atb__empty mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
    .atb__loading { display: flex; justify-content: center; padding: 48px; }

    .atb-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .atb-dialog { background: #fff; border-radius: 20px; padding: 32px; max-width: 520px; width: 100%; max-height: 90vh; overflow-y: auto; }
    .atb-dialog h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 20px; }
    .atb-dialog h2 mat-icon { color: #ff8f00; }
    .atb-field { margin-bottom: 14px; }
    .atb-field label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 4px; }
    .atb-input, .atb-select { width: 100%; padding: 10px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 14px; box-sizing: border-box; background: #fff; }
    .atb-input:focus, .atb-select:focus { border-color: #405980; outline: none; }
    .atb-team-set { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    .atb-team-set legend { font-weight: 700; color: #405980; padding: 0 8px; font-size: 14px; }
    .atb-dialog-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 20px; }
    .atb-batch-selected { padding: 8px 0; }
    .atb-batch-selected__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .atb-batch-selected__header strong { font-size: 15px; color: #1e293b; }
    .atb-batch-selected__header button { font-size: 12px; min-width: auto; padding: 0 10px; line-height: 28px; }
    .atb-batch-selected__count { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #64748b; margin-bottom: 8px; }
    .atb-batch-selected__count mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .atb-batch-selected__members { display: flex; flex-wrap: wrap; gap: 4px; }
    .atb-batch-member { font-size: 11px; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 999px; }
    .atb-batch-member--more { background: #e2e8f0; color: #64748b; }
  `]
})
export class AdminTeamBattleComponent implements OnInit, OnDestroy {
  battles: TeamBattleDto[] = [];
  loading = true;
  statusFilter = '';
  showCreate = false;
  creating = false;
  availableSets: { _id: string; title: string; gameType: string }[] = [];
  availableBatches: BatchSummary[] = [];
  loadingBatches = false;
  private subs: Subscription[] = [];

  form = {
    title: '',
    gameSetId: '',
    gameType: 'scramble_rush',
    rounds: 5,
    teamA: { name: '', batchName: '', members: [] as { id: string; name: string }[] },
    teamB: { name: '', batchName: '', members: [] as { id: string; name: string }[] },
  };

  constructor(
    private svc: InteractiveGameService,
    private http: HttpClient,
  ) {}

  ngOnInit() { this.load(); this.loadSets(); this.loadBatches(); }
  ngOnDestroy() { this.subs.forEach(s => s.unsubscribe()); }

  loadSets() {
    this.subs.push(this.svc.getCatalog({ limit: 50 }).subscribe(res => {
      if (res?.items) {
        this.availableSets = res.items.map((s: any) => ({ _id: s._id, title: s.title, gameType: s.gameType }));
      }
    }));
  }

  async loadBatches() {
    this.loadingBatches = true;
    try {
      const res = await firstValueFrom(
        this.http.get<{ batches: BatchSummary[] }>(`${environment.apiUrl}/batch-journey`, { withCredentials: true })
      );
      this.availableBatches = (res?.batches || []).sort((a, b) => a.batchName.localeCompare(b.batchName));
    } catch {
      this.availableBatches = [];
    }
    this.loadingBatches = false;
  }

  load() {
    this.loading = true;
    this.subs.push(this.svc.listTeamBattles(this.statusFilter || undefined).subscribe({
      next: (res) => { this.battles = res.battles || []; this.loading = false; },
      error: () => this.loading = false,
    }));
  }

  startBattle(id: string) {
    this.subs.push(this.svc.startTeamBattle(id).subscribe({
      next: () => this.load(),
      error: () => {},
    }));
  }

  cancelBattle(id: string) {
    this.subs.push(this.svc.cancelTeamBattle(id).subscribe({
      next: () => this.load(),
      error: () => {},
    }));
  }

  onGameSetChange() {
    const set = this.availableSets.find(s => s._id === this.form.gameSetId);
    if (set) this.form.gameType = set.gameType;
  }

  formatGameType(gt: string): string {
    return gt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  openCreate() {
    this.form = {
      title: '',
      gameSetId: '',
      gameType: 'scramble_rush',
      rounds: 5,
      teamA: { name: '', batchName: '', members: [] },
      teamB: { name: '', batchName: '', members: [] },
    };
    this.showCreate = true;
  }

  canCreate(): boolean {
    return !!(
      this.form.title &&
      this.form.gameSetId &&
      this.form.teamA.batchName &&
      this.form.teamB.batchName &&
      this.form.teamA.batchName !== this.form.teamB.batchName &&
      this.form.teamA.members.length > 0 &&
      this.form.teamB.members.length > 0
    );
  }

  async onBatchSelect(team: 'teamA' | 'teamB') {
    const batchName = this.form[team].batchName;
    if (!batchName) return;
    try {
      const res = await firstValueFrom(
        this.http.get<{ students: { _id: string; name: string }[] }>(
          `${environment.apiUrl}/batch-journey/${encodeURIComponent(batchName)}/students`,
          { withCredentials: true }
        )
      );
      this.form[team].name = batchName;
      this.form[team].members = (res.students || []).map(s => ({ id: s._id, name: s.name }));
      if (!this.form.title) {
        const other = team === 'teamA' ? this.form.teamB.batchName : this.form.teamA.batchName;
        this.form.title = other ? `${batchName} vs ${other}` : '';
      }
    } catch {
      this.form[team].batchName = '';
      this.form[team].name = '';
      this.form[team].members = [];
    }
  }

  clearTeam(team: 'teamA' | 'teamB') {
    this.form[team].batchName = '';
    this.form[team].name = '';
    this.form[team].members = [];
  }

  createTeamBattle() {
    if (!this.canCreate()) return;
    this.creating = true;

    this.subs.push(this.svc.createTeamBattle({
      title: this.form.title,
      gameSetId: this.form.gameSetId,
      gameType: this.form.gameType,
      rounds: this.form.rounds,
      teamA: {
        name: this.form.teamA.name,
        type: 'classroom',
        classroomId: this.form.teamA.batchName,
        members: this.form.teamA.members,
      },
      teamB: {
        name: this.form.teamB.name,
        type: 'classroom',
        classroomId: this.form.teamB.batchName,
        members: this.form.teamB.members,
      },
    }).subscribe({
      next: () => {
        this.creating = false;
        this.showCreate = false;
        this.load();
      },
      error: () => this.creating = false,
    }));
  }
}
