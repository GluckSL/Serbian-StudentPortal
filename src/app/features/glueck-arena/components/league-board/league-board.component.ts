import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { LeagueBoard } from '../../glueck-arena.types';

@Component({
  selector: 'app-league-board',
  standalone: true,
  imports: [CommonModule, MaterialModule],
  template: `
    <div class="lb" *ngIf="board">
      <h2><mat-icon>emoji_events</mat-icon> {{ board.tier | titlecase }} League</h2>
      <p class="lb__week">Week {{ board.weekKey }} · Top {{ board.promoteTop }} promote</p>

      <div class="lb__podium" *ngIf="board.leaderboard.length >= 3">
        <div class="lb__place lb__place--2" *ngIf="board.leaderboard[1]">
          <span class="lb__rank">2</span>
          <strong>{{ board.leaderboard[1].name }}</strong>
          <span>{{ board.leaderboard[1].weeklyXp }} XP</span>
        </div>
        <div class="lb__place lb__place--1">
          <span class="lb__rank">1</span>
          <strong>{{ board.leaderboard[0].name }}</strong>
          <span>{{ board.leaderboard[0].weeklyXp }} XP</span>
        </div>
        <div class="lb__place lb__place--3" *ngIf="board.leaderboard[2]">
          <span class="lb__rank">3</span>
          <strong>{{ board.leaderboard[2].name }}</strong>
          <span>{{ board.leaderboard[2].weeklyXp }} XP</span>
        </div>
      </div>

      <div class="lb__row" *ngFor="let e of board.leaderboard; let i = index" [class.lb__me]="e.isMe">
        <span>#{{ e.rank || i + 1 }} {{ e.name }}</span>
        <span>{{ e.weeklyXp }} XP</span>
      </div>
      <p *ngIf="board.myRank" class="lb__my">Your rank: #{{ board.myRank }}</p>
    </div>
    <mat-spinner *ngIf="!board" diameter="40"></mat-spinner>
  `,
  styles: [`
    .lb h2 { display: flex; align-items: center; gap: 8px; text-transform: capitalize; }
    .lb__week { color: #888; font-size: 14px; }
    .lb__podium { display: flex; align-items: flex-end; justify-content: center; gap: 12px; margin: 24px 0; }
    .lb__place { text-align: center; padding: 12px; border-radius: 12px; background: #f5f5f5; min-width: 90px; }
    .lb__place--1 { background: linear-gradient(180deg,#fff8e1,#ffecb3); transform: scale(1.08); }
    .lb__place--2 { height: 80px; }
    .lb__place--3 { height: 64px; }
    .lb__rank { font-size: 24px; font-weight: 800; color: #ff8f00; display: block; }
    .lb__me { background: #e3f2fd; border-radius: 8px; }
    .lb__my { font-weight: 600; color: #405980; margin-top: 16px; }
    .lb__row { display: flex; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee; }
    .lb__row.lb__me { background: #e3f2fd; border-radius: 8px; }
  `]
})
export class LeagueBoardComponent implements OnInit {
  board: LeagueBoard | null = null;

  constructor(private svc: InteractiveGameService) {}

  ngOnInit() {
    this.svc.getMyLeague().subscribe({ next: (r) => { this.board = r; } });
  }
}
