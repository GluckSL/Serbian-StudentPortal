import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { BattlefieldRoomListing, GameType } from '../../glueck-arena.types';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-battlefield-hub',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MaterialModule],
  template: `
    <div class="bfhub">
      <div class="bfhub__top">
        <div class="bfhub__brand">
          <mat-icon>sports_kabaddi</mat-icon>
          <div>
            <h1>Battlefield</h1>
            <p>Create or join real-time multiplayer game rooms</p>
          </div>
        </div>
        <div class="bfhub__top-actions">
          <a class="bfhub__top-btn" routerLink="/glueck-arena/battlefield/leaderboard">
            <mat-icon>leaderboard</mat-icon> <span>Leaderboard</span>
          </a>
          <div class="bfhub__top-btn" role="button" tabindex="0" (click)="openJoinDialog()" (keydown.enter)="openJoinDialog()">
            <mat-icon>vpn_key</mat-icon> <span>Join by Code</span>
          </div>
          <div class="bfhub__top-btn" role="button" tabindex="0" (click)="openCreateDialog()" (keydown.enter)="openCreateDialog()">
            <mat-icon>add</mat-icon> <span>Create Room</span>
          </div>
        </div>
        </div>

      <div class="bfhub__toolbar">
        <div class="bfhub__toolbar-btn" role="button" tabindex="0" (click)="refresh()" [class.bfhub__toolbar-btn--disabled]="loading" aria-label="Refresh" (keydown.enter)="refresh()">
          <span class="material-icons">refresh</span>
        </div>
        <div class="bfhub__search-input">
          <mat-icon>search</mat-icon>
          <input type="search" [(ngModel)]="searchQuery" (ngModelChange)="onSearch()" placeholder="Search rooms…" aria-label="Search rooms">
        </div>
        <div class="bfhub__dropdown-wrap">
          <div class="bfhub__dropdown" (click)="typeOpen = !typeOpen">
            <span>{{ gameTypeFilter ? formatGameType(gameTypeFilter) : 'All Games' }}</span>
            <mat-icon>expand_more</mat-icon>
          </div>
          <div class="bfhub__dropdown-menu" *ngIf="typeOpen">
            <div class="bfhub__dropdown-item" (click)="setGameType('')">All Games</div>
            <div class="bfhub__dropdown-item" *ngFor="let gt of gameTypes" (click)="setGameType(gt)">{{ formatGameType(gt) }}</div>
          </div>
        </div>
      </div>

      <div class="bfhub__rooms" *ngIf="!loading && rooms.length > 0">
        <div class="bfhub__room-card" *ngFor="let room of rooms" (click)="joinRoom(room)"
          [class.bfhub__room-card--playing]="room.status === 'playing'">
          <div class="bfhub__room-top">
            <span class="bfhub__room-game">{{ formatGameType(room.gameType) }}</span>
            <span class="bfhub__room-badge bfhub__room-badge--team" *ngIf="room.teamMode">Team Battle</span>
            <span class="bfhub__room-status" [class.bfhub__room-status--live]="room.status === 'playing'">
              {{ room.status === 'playing' ? 'LIVE' : 'Waiting' }}
            </span>
          </div>
          <div class="bfhub__room-name">{{ room.roomName }}</div>
          <div class="bfhub__room-host">
            <mat-icon>person</mat-icon> {{ room.hostName }}
          </div>
          <div class="bfhub__room-meta">
            <span class="bfhub__room-players">
              <mat-icon>people</mat-icon> {{ room.playerCount }}/{{ room.maxPlayers }}
            </span>
            <span class="bfhub__room-privacy" *ngIf="!room.isPublic">
              <mat-icon>lock</mat-icon> Private
            </span>
            <div class="bfhub__btn bfhub__btn--primary bfhub__room-join" role="button" tabindex="0">Join</div>
          </div>
        </div>
      </div>

      <div class="bfhub__empty" *ngIf="!loading && rooms.length === 0">
        <mat-icon>meeting_room</mat-icon>
        <h3>No rooms available</h3>
        <p>Create the first room or check back later</p>
      </div>

      <div class="bfhub__loading" *ngIf="loading">
        <mat-spinner diameter="40"></mat-spinner>
        <span>Loading rooms…</span>
      </div>
    </div>

    <!-- Create Room Dialog (inline) -->
    <div class="bfhub-overlay" *ngIf="showCreateDialog" (click)="showCreateDialog = false">
      <div class="bfhub-dialog" (click)="$event.stopPropagation()">
        <h2><mat-icon>add</mat-icon> Create Battlefield Room</h2>

        <div class="bfhub-dialog__field">
          <label>Room Name</label>
          <input matInput [(ngModel)]="newRoom.name" placeholder="My Awesome Room" maxlength="60">
        </div>

        <div class="bfhub-dialog__field">
          <label>Game Type</label>
          <select [(ngModel)]="newRoom.gameSetId" class="bfhub-dialog__select">
            <option value="" disabled>Select a game</option>
            <option *ngFor="let set of availableSets" [value]="set._id">{{ set.title }} ({{ formatGameType(set.gameType) }})</option>
          </select>
        </div>

        <div class="bfhub-dialog__field">
          <label>Visibility</label>
          <div class="bfhub-dialog__radio-group">
            <label class="bfhub-dialog__radio">
              <input type="radio" name="visibility" [value]="true" [(ngModel)]="newRoom.isPublic">
              <mat-icon>public</mat-icon> Public
            </label>
            <label class="bfhub-dialog__radio">
              <input type="radio" name="visibility" [value]="false" [(ngModel)]="newRoom.isPublic">
              <mat-icon>lock</mat-icon> Private (invite only)
            </label>
          </div>
        </div>

        <div class="bfhub-dialog__field">
          <label>Max Players</label>
          <select [(ngModel)]="newRoom.maxPlayers" class="bfhub-dialog__select">
            <option *ngFor="let n of [2,3,4,5,6,7,8]" [value]="n">{{ n }}</option>
          </select>
        </div>

        <div class="bfhub-dialog__actions">
          <div class="bfhub__btn" role="button" tabindex="0" (click)="showCreateDialog = false" (keydown.enter)="showCreateDialog = false">Cancel</div>
          <div class="bfhub__btn bfhub__btn--primary" role="button" tabindex="0" (click)="createRoom()" [class.bfhub__btn--disabled]="!newRoom.name || !newRoom.gameSetId || creating" (keydown.enter)="createRoom()">
            <mat-icon *ngIf="!creating">add</mat-icon>
            <mat-spinner *ngIf="creating" diameter="20"></mat-spinner>
            Create Room
          </div>
        </div>
      </div>
    </div>

    <!-- Join by Code Dialog -->
    <div class="bfhub-overlay" *ngIf="showJoinDialog" (click)="showJoinDialog = false">
      <div class="bfhub-dialog bfhub-dialog--small" (click)="$event.stopPropagation()">
        <h2><mat-icon>vpn_key</mat-icon> Join Room</h2>
        <p class="bfhub-dialog__hint">Enter the room code to join</p>
        <div class="bfhub-dialog__field">
          <input matInput [(ngModel)]="joinCode" placeholder="Room code (e.g. AB12CD34)"
            (keydown.enter)="joinByCode()" style="text-transform:uppercase;font-family:monospace;text-align:center;font-size:20px;letter-spacing:4px;font-weight:700;">
        </div>
        <div class="bfhub-dialog__actions">
          <div class="bfhub__btn" role="button" tabindex="0" (click)="showJoinDialog = false" (keydown.enter)="showJoinDialog = false">Cancel</div>
          <div class="bfhub__btn bfhub__btn--primary" role="button" tabindex="0" (click)="joinByCode()" [class.bfhub__btn--disabled]="!joinCode.trim()" (keydown.enter)="joinByCode()">
            <mat-icon>login</mat-icon> Join
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .bfhub { padding: 24px; background: #fff; border-radius: 0 0 14px 14px; border: 1px solid #e2e8f0; }
    .bfhub__top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .bfhub__brand { display: flex; align-items: center; gap: 12px; }
    .bfhub__brand mat-icon { font-size: 40px; width: 40px; height: 40px; color: #ff8f00; }
    .bfhub__brand h1 { margin: 0; font-size: 28px; font-weight: 800; color: #1e293b; }
    .bfhub__brand p { margin: 4px 0 0; font-size: 14px; color: #64748b; }
    .bfhub__top-actions { display: flex; gap: 8px; margin-left: auto; }
    .bfhub__top-btn {
      display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 14px;
      border-radius: 10px; background: #f1f5f9; border: 1px solid transparent;
      font-size: 12px; font-weight: 700; color: #64748b;
      cursor: pointer; white-space: nowrap; text-decoration: none;
      box-sizing: border-box; font-family: inherit; line-height: 1;
      -webkit-appearance: none; appearance: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .bfhub__top-btn:hover { border-color: #cbd5e1; background: #e8ecf1; }
    .bfhub__top-btn mat-icon { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }

    .bfhub__toolbar { display: flex; gap: 10px; margin-bottom: 24px; flex-wrap: wrap; padding: 12px 16px; background: #fff; border-radius: 16px; border: 1px solid #e2e8f0; }
    .bfhub__toolbar-btn {
      display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px;
      border-radius: 10px; background: #f1f5f9; border: 1px solid transparent;
      color: #64748b; cursor: pointer; padding: 0; margin: 0;
      box-sizing: border-box; line-height: 1; font-family: inherit;
      -webkit-appearance: none; appearance: none;
      transition: border-color 0.15s, background 0.15s;
    }
    .bfhub__toolbar-btn:hover { border-color: #cbd5e1; background: #e8ecf1; }
    .bfhub__toolbar-btn mat-icon, .bfhub__toolbar-btn .material-icons { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }
    .bfhub__toolbar-btn--disabled { opacity: 0.5; pointer-events: none; }
    .bfhub__search-input { flex: 1; min-width: 140px; display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 34px; border-radius: 10px; background: #f1f5f9; border: 1px solid transparent; }
    .bfhub__search-input mat-icon { color: #94a3b8; font-size: 18px; width: 18px; height: 18px; }
    .bfhub__search-input input { flex: 1; border: none; background: transparent; outline: none; font-size: 12px; font-weight: 700; color: #0f172a; }
    .bfhub__search-input input::placeholder { color: #94a3b8; }
    .bfhub__dropdown-wrap { position: relative; }
    .bfhub__dropdown { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border-radius: 10px; background: #f1f5f9; border: 1px solid transparent; font-size: 12px; font-weight: 700; color: #64748b; cursor: pointer; white-space: nowrap; user-select: none; transition: border-color 0.15s; }
    .bfhub__dropdown:hover { border-color: #cbd5e1; }
    .bfhub__dropdown mat-icon { font-size: 18px; width: 18px; height: 18px; color: #94a3b8; }
    .bfhub__dropdown-menu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 100; min-width: 180px; padding: 6px; border-radius: 12px; background: #fff; border: 1px solid #e2e8f0; box-shadow: 0 8px 28px rgba(15,23,42,0.12); animation: bfhub-dd-fade 0.15s ease; }
    @keyframes bfhub-dd-fade { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .bfhub__dropdown-item { padding: 8px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; color: #334155; cursor: pointer; transition: background 0.1s; }
    .bfhub__dropdown-item:hover { background: #f1f5f9; }
    .bfhub__rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .bfhub__room-card { background: #fff; border-radius: 16px; padding: 20px; cursor: pointer; border: 2px solid #e8ecf0; transition: all .15s; box-shadow: 0 2px 8px rgba(0,0,0,.04); }
    .bfhub__room-card:hover { border-color: #405980; box-shadow: 0 4px 16px rgba(64,89,128,.12); transform: translateY(-2px); }
    .bfhub__room-card--playing { border-color: #22c55e; }
    .bfhub__room-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .bfhub__room-game { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; background: #f1f5f9; padding: 4px 10px; border-radius: 999px; }
    .bfhub__room-badge { font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.04em; }
    .bfhub__room-badge--team { background: #ede9fe; color: #6d28d9; }
    .bfhub__room-status { font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; }
    .bfhub__room-status--live { color: #22c55e; animation: pulse-dot 1.5s ease infinite; }
    @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .bfhub__room-name { font-size: 18px; font-weight: 700; color: #1e293b; margin-bottom: 8px; }
    .bfhub__room-host { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #64748b; margin-bottom: 12px; }
    .bfhub__room-host mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .bfhub__room-meta { display: flex; align-items: center; gap: 12px; }
    .bfhub__room-players { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #64748b; }
    .bfhub__room-players mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .bfhub__room-privacy { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #94a3b8; }
    .bfhub__room-privacy mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .bfhub__room-join { margin-left: auto; }

    .bfhub__btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      height: 34px; padding: 0 16px; border-radius: 10px; border: 1px solid transparent;
      font-size: 13px; font-weight: 700; font-family: inherit; line-height: 1;
      cursor: pointer; white-space: nowrap; text-decoration: none;
      box-sizing: border-box; -webkit-appearance: none; appearance: none;
      background: #f1f5f9; color: #475569; transition: background 0.15s, border-color 0.15s;
    }
    .bfhub__btn:hover { background: #e8ecf1; border-color: #cbd5e1; }
    .bfhub__btn--primary { background: #1e3a5f; color: #fff; }
    .bfhub__btn--primary:hover { background: #162d4a; }
    .bfhub__btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .bfhub__btn--disabled { opacity: 0.5; pointer-events: none; }
    .bfhub__empty { text-align: center; padding: 64px 24px; color: #64748b; }
    .bfhub__empty mat-icon { font-size: 64px; width: 64px; height: 64px; opacity: 0.3; }
    .bfhub__empty h3 { margin: 16px 0 8px; }
    .bfhub__loading { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 64px; color: #64748b; }

    .bfhub-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
    .bfhub-dialog { background: #fff; border-radius: 20px; padding: 32px; max-width: 480px; width: 100%; max-height: 90vh; overflow-y: auto; }
    .bfhub-dialog h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 24px; font-size: 22px; color: #1e293b; }
    .bfhub-dialog h2 mat-icon { color: #ff8f00; }
    .bfhub-dialog__field { margin-bottom: 16px; }
    .bfhub-dialog__field label { display: block; font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 6px; }
    .bfhub-dialog__field input[matInput] { width: 100%; padding: 10px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 15px; box-sizing: border-box; }
    .bfhub-dialog__field input[matInput]:focus { border-color: #405980; outline: none; }
    .bfhub-dialog__select { width: 100%; padding: 10px 14px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 15px; background: #fff; }
    .bfhub-dialog__radio-group { display: flex; gap: 16px; }
    .bfhub-dialog__radio { display: flex; align-items: center; gap: 6px; padding: 10px 16px; border: 2px solid #e2e8f0; border-radius: 10px; cursor: pointer; font-size: 14px; }
    .bfhub-dialog__radio input { display: none; }
    .bfhub-dialog__radio:has(input:checked) { border-color: #405980; background: #f0f4ff; }
    .bfhub-dialog__radio mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .bfhub-dialog--small { max-width: 380px; text-align: center; }
    .bfhub-dialog__hint { color: #64748b; font-size: 14px; margin: -12px 0 20px; }
    .bfhub-dialog__actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }
    @media (max-width: 640px) {
      .bfhub { padding: 16px; }
      .bfhub__rooms { grid-template-columns: 1fr; }
      .bfhub__top-btn span { display: none; }
      .bfhub__top-btn { padding: 0; width: 34px; justify-content: center; }
    }
  `]
})
export class BattlefieldHubComponent implements OnInit, OnDestroy {
  rooms: BattlefieldRoomListing[] = [];
  loading = false;
  searchQuery = '';
  gameTypeFilter = '';
  showCreateDialog = false;
  showJoinDialog = false;
  joinCode = '';
  creating = false;
  availableSets: { _id: string; title: string; gameType: string }[] = [];
  gameTypes: GameType[] = ['scramble_rush', 'sentence_builder', 'image_matching', 'gender_stack', 'flashcards', 'matching', 'flapjugation', 'whackawort', 'memory'];
  typeOpen = false;

  newRoom = { name: '', gameSetId: '', isPublic: true, maxPlayers: 4 };

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private subs: Subscription[] = [];

  constructor(
    private svc: InteractiveGameService,
    private router: Router,
  ) {}

  ngOnInit() {
    this.refresh();
    this.loadSets();
    this.refreshTimer = setInterval(() => this.refresh(), 15000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.subs.forEach(s => s.unsubscribe());
  }

  loadSets() {
    this.subs.push(this.svc.getCatalog({ limit: 50 }).subscribe(res => {
      if (res?.items) {
        this.availableSets = res.items.map((s: any) => ({ _id: s._id, title: s.title, gameType: s.gameType }));
      }
    }));
  }

  refresh() {
    this.loading = true;
    this.subs.push(this.svc.listBattlefieldRooms({
      gameType: this.gameTypeFilter || undefined,
      search: this.searchQuery || undefined,
    }).subscribe({
      next: (res) => { this.rooms = res.rooms || []; this.loading = false; },
      error: () => { this.rooms = []; this.loading = false; },
    }));
  }

  onSearch() {
    this.refresh();
  }

  onFilterChange() {
    this.refresh();
  }

  setGameType(gt: string) {
    this.gameTypeFilter = gt;
    this.typeOpen = false;
    this.refresh();
  }

  openCreateDialog() {
    this.newRoom = { name: '', gameSetId: '', isPublic: true, maxPlayers: 4 };
    this.showCreateDialog = true;
  }

  openJoinDialog() {
    this.joinCode = '';
    this.showJoinDialog = true;
  }

  joinByCode() {
    const code = this.joinCode.trim().toUpperCase();
    if (!code) return;
    this.showJoinDialog = false;
    this.router.navigate(['/glueck-arena/battlefield/room', code]);
  }

  createRoom() {
    if (!this.newRoom.name || !this.newRoom.gameSetId) return;
    this.creating = true;
    this.subs.push(this.svc.createBattlefieldRoom({
      gameSetId: this.newRoom.gameSetId,
      roomName: this.newRoom.name,
      isPublic: this.newRoom.isPublic,
      maxPlayers: this.newRoom.maxPlayers,
    }).subscribe({
      next: (res) => {
        this.creating = false;
        this.showCreateDialog = false;
        if (res.room?.inviteCode) {
          this.router.navigate(['/glueck-arena/battlefield/room', res.room.inviteCode]);
        }
      },
      error: () => { this.creating = false; },
    }));
  }

  joinRoom(room: BattlefieldRoomListing) {
    this.router.navigate(['/glueck-arena/battlefield/room', room.inviteCode]);
  }

  formatGameType(gt: string): string {
    return gt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
