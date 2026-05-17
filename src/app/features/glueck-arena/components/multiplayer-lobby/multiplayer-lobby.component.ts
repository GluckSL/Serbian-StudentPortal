import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { NotificationService } from '../../../../services/notification.service';

@Component({
  selector: 'app-multiplayer-lobby',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MaterialModule],
  template: `
    <div class="mp">
      <button mat-icon-button routerLink="/glueck-arena"><mat-icon>arrow_back</mat-icon></button>
      <h1><mat-icon>groups</mat-icon> Multiplayer Battle</h1>

      <mat-tab-group>
        <mat-tab label="Join room">
          <mat-card>
            <mat-card-content>
              <mat-form-field appearance="outline" class="mp__field">
                <mat-label>Invite code</mat-label>
                <input matInput [(ngModel)]="joinCode" placeholder="ABCD1234">
              </mat-form-field>
              <button mat-raised-button color="primary" (click)="join()" [disabled]="!joinCode">Enter battle</button>
            </mat-card-content>
          </mat-card>
        </mat-tab>
        <mat-tab label="Create room">
          <mat-card>
            <mat-card-content>
              <mat-form-field appearance="outline" class="mp__field">
                <mat-label>Game set ID</mat-label>
                <input matInput [(ngModel)]="createGameSetId" placeholder="Paste game set ID">
              </mat-form-field>
              <button mat-raised-button color="accent" (click)="create()" [disabled]="!createGameSetId">Create & host</button>
            </mat-card-content>
          </mat-card>
        </mat-tab>
        <mat-tab label="Matchmaking">
          <mat-card>
            <mat-card-content>
              <mat-form-field appearance="outline">
                <mat-label>Mode</mat-label>
                <mat-select [(ngModel)]="mmMode">
                  <mat-option value="casual">Casual</mat-option>
                  <mat-option value="ranked">Ranked</mat-option>
                </mat-select>
              </mat-form-field>
              <p *ngIf="mmStatus?.inQueue">In queue · position {{ mmStatus.position }} · ~{{ mmStatus.estimatedWaitSeconds }}s</p>
              <div class="mp__actions">
                <button mat-raised-button color="primary" (click)="joinQueue()" [disabled]="mmStatus?.inQueue">Find match</button>
                <button mat-stroked-button (click)="leaveQueue()" *ngIf="mmStatus?.inQueue">Cancel</button>
              </div>
            </mat-card-content>
          </mat-card>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .mp { max-width: 560px; margin: 0 auto; padding: 24px; }
    .mp h1 { display: flex; align-items: center; gap: 8px; }
    .mp__field { width: 100%; }
    .mp__actions { display: flex; gap: 8px; margin-top: 12px; }
    mat-card { margin-top: 16px; }
  `]
})
export class MultiplayerLobbyComponent implements OnInit {
  joinCode = '';
  createGameSetId = '';
  mmMode: 'casual' | 'ranked' = 'casual';
  mmStatus: any = null;
  private mmPoll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private svc: InteractiveGameService,
    private notify: NotificationService,
    private router: Router
  ) {}

  ngOnInit() {
    const q = new URLSearchParams(window.location.search).get('code');
    if (q) {
      this.joinCode = q;
      this.join();
    }
  }

  enterBattle(code: string) {
    this.router.navigate(['/glueck-arena/multiplayer/battle'], { queryParams: { code } });
  }

  join() {
    const code = this.joinCode.trim().toUpperCase();
    this.svc.joinMultiplayerRoom(code).subscribe({
      next: () => this.enterBattle(code),
      error: (e) => this.notify.error(e?.error?.message || 'Join failed'),
    });
  }

  create() {
    this.svc.createMultiplayerRoom(this.createGameSetId).subscribe({
      next: (r) => {
        const code = r.room?.inviteCode;
        if (code) this.enterBattle(code);
        else this.notify.error('Room created but no code returned');
      },
      error: (e) => this.notify.error(e?.error?.message || 'Create failed'),
    });
  }

  joinQueue() {
    this.svc.joinMatchmaking({ mode: this.mmMode }).subscribe({
      next: (r) => {
        if (r.matched && r.room?.inviteCode) {
          this.enterBattle(r.room.inviteCode);
          return;
        }
        this.mmPoll = setInterval(() => this.pollMm(), 3000);
        this.pollMm();
      },
      error: (e) => this.notify.error(e?.error?.message || 'Queue failed'),
    });
  }

  pollMm() {
    this.svc.getMatchmakingStatus().subscribe({
      next: (r) => {
        this.mmStatus = r;
        if (r.matched && r.room?.inviteCode) {
          if (this.mmPoll) clearInterval(this.mmPoll);
          this.enterBattle(r.room.inviteCode);
        }
      },
    });
  }

  leaveQueue() {
    if (this.mmPoll) clearInterval(this.mmPoll);
    this.svc.leaveMatchmaking().subscribe(() => { this.mmStatus = null; });
  }
}
