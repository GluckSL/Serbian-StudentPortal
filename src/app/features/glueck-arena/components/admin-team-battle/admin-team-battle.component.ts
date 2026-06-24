import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { TeamBattleDto } from '../../glueck-arena.types';
import { environment } from '../../../../../environments/environment';
import { Subscription } from 'rxjs';

interface BatchSummary { batchName: string; }
interface StudentSearchResult { _id: string; name: string; regNo: string; email: string; }

type TeamKey = 'teamA' | 'teamB';

@Component({
  selector: 'app-admin-team-battle',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  template: `
    <div class="atb">
      <div class="atb__top">
        <h1><mat-icon>groups</mat-icon> Team Battles</h1>
        <div class="atb__top-actions">
          <button mat-stroked-button routerLink="/admin/glueck-arena/battlefield/team-battles/standings">
            <mat-icon>leaderboard</mat-icon> Standings
          </button>
          <button mat-raised-button color="primary" (click)="openCreate()">
            <mat-icon>add</mat-icon> New Team Battle
          </button>
        </div>
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
            <span *ngIf="b.status === 'active'">Round {{ b.currentRound }}</span>
            <span *ngIf="b.roomCode">Room: {{ b.roomCode }}</span>
          </div>
          <div class="atb__card-actions">
            <button mat-raised-button color="primary" (click)="startBattle(b._id)" *ngIf="b.status === 'pending'">
              <mat-icon>play_arrow</mat-icon> Start
            </button>
            <button mat-raised-button color="accent" (click)="toggleScorecard(b._id)" *ngIf="b.status === 'finished'" [disabled]="loadingScorecard === b._id">
              <mat-icon *ngIf="loadingScorecard !== b._id">{{ scorecardId === b._id ? 'expand_less' : 'sports_kabaddi' }}</mat-icon>
              <mat-spinner *ngIf="loadingScorecard === b._id" diameter="16"></mat-spinner>
              {{ scorecardId === b._id ? 'Hide Scorecard' : 'Scorecard' }}
            </button>
            <button mat-stroked-button color="warn" (click)="cancelBattle(b._id)" *ngIf="b.status === 'pending' || b.status === 'active'">
              <mat-icon>cancel</mat-icon> {{ b.status === 'active' ? 'Cancel Room' : 'Cancel' }}
            </button>
            <button mat-stroked-button color="warn" (click)="deleteBattle(b._id, b.title)" *ngIf="b.status !== 'active'">
              <mat-icon>delete</mat-icon> Delete
            </button>
          </div>

          <!-- Scorecard (IPL-style) -->
          <div class="atb-scorecard" *ngIf="scorecardId === b._id && scorecardData">
            <div class="atb-scorecard__header">
              <div class="atb-scorecard__team" [class.atb-scorecard__team--winner]="scorecardData.winner === 'teamA'">
                <span class="atb-scorecard__team-name">{{ scorecardData.teamA.name }}</span>
                <span class="atb-scorecard__team-score">{{ scorecardData.teamA.score }}</span>
              </div>
              <div class="atb-scorecard__vs">VS</div>
              <div class="atb-scorecard__team" [class.atb-scorecard__team--winner]="scorecardData.winner === 'teamB'">
                <span class="atb-scorecard__team-name">{{ scorecardData.teamB.name }}</span>
                <span class="atb-scorecard__team-score">{{ scorecardData.teamB.score }}</span>
              </div>
            </div>
            <div class="atb-scorecard__winner" *ngIf="scorecardData.winner">
              🏆 {{ scorecardData.winner === 'teamA' ? scorecardData.teamA.name : scorecardData.teamB.name }} Wins!
            </div>

            <div class="atb-scorecard__teams">
              <div class="atb-scorecard__side">
                <h4>{{ scorecardData.teamA.name }}</h4>
                <table class="atb-scorecard__table">
                  <thead>
                    <tr><th>Player</th><th>Points</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let m of scorecardData.teamA.members; let fi = first"
                      [class.atb-scorecard__top-scorer]="fi && scorecardData.teamA.members.length > 0">
                      <td>{{ m.name }} <span *ngIf="fi && scorecardData.teamB.members.length > 0 && (scorecardData.teamA.members[0].score >= (scorecardData.teamB.members[0]?.score || 0))">⭐</span></td>
                      <td class="atb-scorecard__pts">{{ m.score }}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr><th>Total</th><th class="atb-scorecard__pts">{{ scorecardData.teamA.score }}</th></tr>
                  </tfoot>
                </table>
              </div>

              <div class="atb-scorecard__side">
                <h4>{{ scorecardData.teamB.name }}</h4>
                <table class="atb-scorecard__table">
                  <thead>
                    <tr><th>Player</th><th>Points</th></tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let m of scorecardData.teamB.members; let fi = first"
                      [class.atb-scorecard__top-scorer]="fi && scorecardData.teamB.members.length > 0">
                      <td>{{ m.name }} <span *ngIf="fi && scorecardData.teamA.members.length > 0 && (scorecardData.teamB.members[0].score > (scorecardData.teamA.members[0]?.score || 0))">⭐</span></td>
                      <td class="atb-scorecard__pts">{{ m.score }}</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr><th>Total</th><th class="atb-scorecard__pts">{{ scorecardData.teamB.score }}</th></tr>
                  </tfoot>
                </table>
              </div>
            </div>
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

        <fieldset class="atb-team-set">
          <legend>Team A</legend>

          <!-- Mode Toggle -->
          <div class="atb-mode-toggle">
            <button type="button" class="atb-mode-btn" [class.atb-mode-btn--active]="form.teamA.teamMode === 'batch'" (click)="setTeamMode('teamA', 'batch')">Batch</button>
            <button type="button" class="atb-mode-btn" [class.atb-mode-btn--active]="form.teamA.teamMode === 'manual'" (click)="setTeamMode('teamA', 'manual')">Manual</button>
          </div>

          <!-- Batch Mode -->
          <ng-container *ngIf="form.teamA.teamMode === 'batch'">
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
          </ng-container>

          <!-- Manual Mode -->
          <ng-container *ngIf="form.teamA.teamMode === 'manual'">
            <div class="atb-field">
              <label>Team Name</label>
              <input [ngModel]="form.teamA.name" (ngModelChange)="form.teamA.name = $event; autoGenerateTitle()" placeholder="e.g. Die Meisters" class="atb-input">
            </div>
            <div class="atb-field atb-search-field">
              <label>Add Students</label>
              <input [(ngModel)]="form.teamA.searchQuery"
                     (ngModelChange)="onSearchInput('teamA')"
                     (focus)="onSearchFocus('teamA')"
                     (blur)="onSearchBlur('teamA')"
                     placeholder="Search by name, regNo, or email..."
                     class="atb-input" autocomplete="off">
              <div class="atb-search-dd" *ngIf="form.teamA.searchFocused && form.teamA.searchResults.length > 0">
                <div class="atb-search-dd__row" *ngFor="let s of form.teamA.searchResults" (mousedown)="addMember('teamA', s)">
                  <div class="atb-search-dd__name">{{ s.name }} <span class="atb-search-dd__reg">{{ s.regNo }}</span></div>
                  <div class="atb-search-dd__email">{{ s.email }}</div>
                </div>
              </div>
            </div>
            <div class="atb-chips">
              <span class="atb-chip" *ngFor="let m of form.teamA.members; let i = index">
                <button type="button" class="atb-chip__remove" (click)="removeMember('teamA', i)">×</button>
                {{ m.name }}
              </span>
              <span class="atb-chip atb-chip--hint" *ngIf="form.teamA.members.length === 0">No students selected yet</span>
            </div>
          </ng-container>
        </fieldset>

        <fieldset class="atb-team-set">
          <legend>Team B</legend>

          <!-- Mode Toggle -->
          <div class="atb-mode-toggle">
            <button type="button" class="atb-mode-btn" [class.atb-mode-btn--active]="form.teamB.teamMode === 'batch'" (click)="setTeamMode('teamB', 'batch')">Batch</button>
            <button type="button" class="atb-mode-btn" [class.atb-mode-btn--active]="form.teamB.teamMode === 'manual'" (click)="setTeamMode('teamB', 'manual')">Manual</button>
          </div>

          <!-- Batch Mode -->
          <ng-container *ngIf="form.teamB.teamMode === 'batch'">
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
          </ng-container>

          <!-- Manual Mode -->
          <ng-container *ngIf="form.teamB.teamMode === 'manual'">
            <div class="atb-field">
              <label>Team Name</label>
              <input [ngModel]="form.teamB.name" (ngModelChange)="form.teamB.name = $event; autoGenerateTitle()" placeholder="e.g. Die Überflieger" class="atb-input">
            </div>
            <div class="atb-field atb-search-field">
              <label>Add Students</label>
              <input [(ngModel)]="form.teamB.searchQuery"
                     (ngModelChange)="onSearchInput('teamB')"
                     (focus)="onSearchFocus('teamB')"
                     (blur)="onSearchBlur('teamB')"
                     placeholder="Search by name, regNo, or email..."
                     class="atb-input" autocomplete="off">
              <div class="atb-search-dd" *ngIf="form.teamB.searchFocused && form.teamB.searchResults.length > 0">
                <div class="atb-search-dd__row" *ngFor="let s of form.teamB.searchResults" (mousedown)="addMember('teamB', s)">
                  <div class="atb-search-dd__name">{{ s.name }} <span class="atb-search-dd__reg">{{ s.regNo }}</span></div>
                  <div class="atb-search-dd__email">{{ s.email }}</div>
                </div>
              </div>
            </div>
            <div class="atb-chips">
              <span class="atb-chip" *ngFor="let m of form.teamB.members; let i = index">
                <button type="button" class="atb-chip__remove" (click)="removeMember('teamB', i)">×</button>
                {{ m.name }}
              </span>
              <span class="atb-chip atb-chip--hint" *ngIf="form.teamB.members.length === 0">No students selected yet</span>
            </div>
          </ng-container>
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
    .atb__top-actions { display: flex; gap: 8px; }
    .atb__card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
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

    /* Mode toggle */
    .atb-mode-toggle { display: flex; gap: 0; margin-bottom: 14px; border-radius: 8px; overflow: hidden; border: 1px solid #e2e8f0; }
    .atb-mode-btn { flex: 1; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; background: #f8fafc; color: #64748b; transition: all .15s; }
    .atb-mode-btn:not(:last-child) { border-right: 1px solid #e2e8f0; }
    .atb-mode-btn--active { background: #405980; color: #fff; }

    /* Search dropdown */
    .atb-search-field { position: relative; }
    .atb-search-dd { position: absolute; top: 100%; left: 0; right: 0; z-index: 50; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); max-height: 240px; overflow-y: auto; margin-top: 4px; }
    .atb-search-dd__row { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: background .1s; }
    .atb-search-dd__row:last-child { border-bottom: none; }
    .atb-search-dd__row:hover { background: #f1f5f9; }
    .atb-search-dd__name { font-size: 14px; font-weight: 600; color: #1e293b; }
    .atb-search-dd__reg { font-size: 12px; font-weight: 400; color: #94a3b8; margin-left: 8px; }
    .atb-search-dd__email { font-size: 12px; color: #64748b; margin-top: 2px; }

    /* Chips */
    .atb-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .atb-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; background: #f1f5f9; color: #475569; padding: 4px 8px 4px 4px; border-radius: 999px; }
    .atb-chip--hint { background: transparent; color: #94a3b8; font-style: italic; padding: 4px 0; }
    .atb-chip__remove { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 999px; border: none; background: #e2e8f0; color: #64748b; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; transition: background .15s; }
    .atb-chip__remove:hover { background: #ef4444; color: #fff; }

    .atb-scorecard { margin-top: 16px; padding-top: 16px; border-top: 2px solid #e2e8f0; }
    .atb-scorecard__header { display: flex; align-items: center; justify-content: center; gap: 24px; margin-bottom: 8px; }
    .atb-scorecard__team { text-align: center; padding: 12px 24px; background: #f8fafc; border-radius: 12px; min-width: 140px; }
    .atb-scorecard__team--winner { background: #f0fdf4; border: 2px solid #22c55e; }
    .atb-scorecard__team-name { display: block; font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .atb-scorecard__team-score { display: block; font-size: 28px; font-weight: 800; color: #405980; }
    .atb-scorecard__team--winner .atb-scorecard__team-score { color: #16a34a; }
    .atb-scorecard__vs { font-size: 18px; font-weight: 800; color: #94a3b8; }
    .atb-scorecard__winner { text-align: center; font-size: 18px; font-weight: 800; color: #16a34a; margin-bottom: 16px; }
    .atb-scorecard__teams { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .atb-scorecard__side h4 { margin: 0 0 8px; font-size: 14px; color: #475569; }
    .atb-scorecard__table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .atb-scorecard__table th { text-align: left; padding: 6px 8px; font-size: 11px; color: #94a3b8; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; }
    .atb-scorecard__table td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; color: #1e293b; }
    .atb-scorecard__table tfoot th { padding: 8px; border-top: 2px solid #e2e8f0; font-size: 13px; color: #1e293b; }
    .atb-scorecard__pts { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
    .atb-scorecard__top-scorer { background: #fefce8; }
    .atb-scorecard__top-scorer td:first-child { font-weight: 700; }
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
  scorecardId: string | null = null;
  scorecardData: TeamBattleDto | null = null;
  loadingScorecard: string | null = null;
  private subs: Subscription[] = [];
  private searchTimers: Record<TeamKey, any> = { teamA: null, teamB: null };
  private searchRequestSeqs: Record<TeamKey, number> = { teamA: 0, teamB: 0 };

  form = {
    title: '',
    gameSetId: '',
    gameType: 'scramble_rush',
    teamA: {
      name: '',
      batchName: '',
      teamMode: 'batch' as 'batch' | 'manual',
      members: [] as { id: string; name: string }[],
      searchQuery: '',
      searchResults: [] as StudentSearchResult[],
      searchFocused: false,
    },
    teamB: {
      name: '',
      batchName: '',
      teamMode: 'batch' as 'batch' | 'manual',
      members: [] as { id: string; name: string }[],
      searchQuery: '',
      searchResults: [] as StudentSearchResult[],
      searchFocused: false,
    },
  };

  constructor(
    private svc: InteractiveGameService,
    private http: HttpClient,
  ) {}

  ngOnInit() { this.load(); this.loadSets(); this.loadBatches(); }
  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    clearTimeout(this.searchTimers.teamA);
    clearTimeout(this.searchTimers.teamB);
  }

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

  deleteBattle(id: string, title: string) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    this.subs.push(this.svc.deleteTeamBattle(id).subscribe({
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
      teamA: { name: '', batchName: '', teamMode: 'batch', members: [], searchQuery: '', searchResults: [], searchFocused: false },
      teamB: { name: '', batchName: '', teamMode: 'batch', members: [], searchQuery: '', searchResults: [], searchFocused: false },
    };
    this.showCreate = true;
  }

  canCreate(): boolean {
    if (!this.form.title || !this.form.gameSetId) return false;
    return this.teamValid('teamA') && this.teamValid('teamB');
  }

  private teamValid(team: TeamKey): boolean {
    const t = this.form[team];
    if (t.teamMode === 'batch') {
      return !!t.batchName && t.members.length > 0;
    }
    return !!t.name && t.members.length > 0;
  }

  autoGenerateTitle() {
    if (this.form.title) return;

    const getTeamName = (team: TeamKey): string => {
      const t = this.form[team];
      if (t.teamMode === 'batch' && t.batchName) return t.batchName;
      if (t.teamMode === 'manual' && t.name) return t.name;
      return '';
    };

    const aName = getTeamName('teamA');
    const bName = getTeamName('teamB');
    if (aName && bName) {
      this.form.title = `${aName} vs ${bName}`;
    }
  }

  setTeamMode(team: TeamKey, mode: 'batch' | 'manual') {
    const t = this.form[team];
    t.teamMode = mode;
    t.batchName = '';
    t.searchQuery = '';
    t.searchResults = [];
    t.searchFocused = false;
    if (mode === 'batch') {
      t.name = '';
      t.members = [];
    }
  }

  async onBatchSelect(team: TeamKey) {
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
      this.autoGenerateTitle();
    } catch {
      this.form[team].batchName = '';
      this.form[team].name = '';
      this.form[team].members = [];
    }
  }

  onSearchInput(team: TeamKey) {
    clearTimeout(this.searchTimers[team]);
    const q = this.form[team].searchQuery.trim();
    if (!q || q.length < 2) {
      this.form[team].searchResults = [];
      return;
    }
    const seq = ++this.searchRequestSeqs[team];
    this.searchTimers[team] = setTimeout(async () => {
      try {
        const res = await firstValueFrom(this.svc.searchStudents(q));
        if (seq !== this.searchRequestSeqs[team]) return;
        const existingIds = new Set(this.form[team].members.map(m => m.id));
        this.form[team].searchResults = (res.data || []).filter(s => !existingIds.has(s._id));
      } catch (e) {
        if (seq !== this.searchRequestSeqs[team]) return;
        this.form[team].searchResults = [];
        console.error('Student search error:', e);
      }
    }, 250);
  }

  onSearchFocus(team: TeamKey) {
    this.form[team].searchFocused = true;
    if (this.form[team].searchQuery.trim().length >= 2) {
      this.onSearchInput(team);
    }
  }

  onSearchBlur(team: TeamKey) {
    setTimeout(() => {
      this.form[team].searchFocused = false;
    }, 200);
  }

  addMember(team: TeamKey, student: StudentSearchResult) {
    if (this.form[team].members.some(m => m.id === student._id)) return;
    this.form[team].members.push({ id: student._id, name: student.name });
    this.form[team].searchQuery = '';
    this.form[team].searchResults = [];
    this.form[team].searchFocused = false;

    this.autoGenerateTitle();
  }

  removeMember(team: TeamKey, index: number) {
    this.form[team].members.splice(index, 1);
  }

  toggleScorecard(id: string) {
    if (this.scorecardId === id) {
      this.scorecardId = null;
      this.scorecardData = null;
      return;
    }
    this.scorecardId = id;
    this.scorecardData = null;
    this.loadingScorecard = id;
    this.subs.push(this.svc.getTeamBattleScorecard(id).subscribe({
      next: (res) => { this.scorecardData = res.battle; this.loadingScorecard = null; },
      error: () => { this.scorecardId = null; this.loadingScorecard = null; },
    }));
  }

  clearTeam(team: TeamKey) {
    this.form[team].batchName = '';
    this.form[team].name = '';
    this.form[team].members = [];
    this.form[team].searchQuery = '';
    this.form[team].searchResults = [];
    this.form[team].searchFocused = false;
  }

  createTeamBattle() {
    if (!this.canCreate()) return;
    this.creating = true;

    const buildTeam = (team: TeamKey) => {
      const t = this.form[team];
      if (t.teamMode === 'batch') {
        return {
          name: t.name,
          type: 'classroom',
          classroomId: t.batchName,
          members: t.members,
        };
      }
      return {
        name: t.name,
        type: 'manual',
        classroomId: null,
        members: t.members,
      };
    };

    this.subs.push(this.svc.createTeamBattle({
      title: this.form.title,
      gameSetId: this.form.gameSetId,
      gameType: this.form.gameType,
      teamA: buildTeam('teamA'),
      teamB: buildTeam('teamB'),
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
