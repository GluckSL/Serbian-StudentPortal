import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { MaterialModule } from '../../../../shared/material.module';
import { InteractiveGameService } from '../../services/interactive-game.service';
import { GameSet, LeaderboardEntry } from '../../glueck-arena.types';

@Component({
  selector: 'app-game-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, MaterialModule],
  template: `
    <div class="gd" *ngIf="!loading">
      <button mat-icon-button routerLink="/glueck-arena" class="gd__back">
        <mat-icon>arrow_back</mat-icon>
      </button>

      <div class="gd__hero" *ngIf="set" [style.background]="getTypeColor(set.gameType)">
        <img *ngIf="set.thumbnailUrl && !thumbnailBroken" [src]="set.thumbnailUrl" class="gd__hero__img" (error)="thumbnailBroken = true">
        <mat-icon *ngIf="!set.thumbnailUrl || thumbnailBroken" class="gd__hero__icon">{{ set.icon }}</mat-icon>
      </div>

      <div class="gd__content" *ngIf="set">
        <div class="gd__tags">
          <span class="gd__badge gd__badge--type">{{ formatType(set.gameType) }}</span>
          <span class="gd__badge gd__badge--diff gd__badge--diff-{{ set.difficulty | lowercase }}">{{ set.difficulty }}</span>
          <span *ngIf="set.level" class="gd__badge gd__badge--level">{{ set.level }}</span>
        </div>

        <h1 class="gd__title">{{ set.title }}</h1>
        <p class="gd__desc">{{ set.description }}</p>

        <div class="gd__meta">
          <div class="gd__meta__item">
            <mat-icon>bolt</mat-icon>
            <div><strong>{{ set.xpReward }}</strong><span>XP Nagrada</span></div>
          </div>
          <div class="gd__meta__item">
            <mat-icon>timer</mat-icon>
            <div><strong>~{{ set.estimatedDurationMinutes }} min</strong><span>Trajanje</span></div>
          </div>
          <div class="gd__meta__item">
            <mat-icon>quiz</mat-icon>
            <div><strong>{{ set.questionCount }}</strong><span>Pitanja</span></div>
          </div>
          <div class="gd__meta__item" *ngIf="set.studentProgress?.bestScore !== null">
            <mat-icon>emoji_events</mat-icon>
            <div><strong>{{ set.studentProgress?.bestScore }}</strong><span>Najbolji rezultat</span></div>
          </div>
        </div>

        <!-- Instructions -->
        <div class="gd__instructions">
          <h3>Kako se igra</h3>
          <p *ngIf="set.gameType === 'scramble_rush'">
            Slova padaju s neba — upiši tačnu reč pre nego što stignu do linije! 
            Imaš {{ 3 }} života. Završi sve nivoe da pobediš.
          </p>
          <p *ngIf="set.gameType === 'sentence_builder'">
            Prevuci i ispusti pomešane reči da formirate tačnu nemačku rečenicu.
            Proveri odgovor i zaradi XP za svaku tačnu rečenicu!
          </p>
          <p *ngIf="set.gameType === 'matching'">
            Povežite svaku stavku s leve strane s tačnom stavkom s desne strane.
          </p>
          <p *ngIf="set.gameType === 'flashcards'">
            Listajte kartice da testirate vokabular. Uskoro!
          </p>
          <p *ngIf="set.gameType === 'image_matching'">
            Prevucite svaku nemačku reč na odgovarajuću sliku.
          </p>
          <p *ngIf="set.gameType === 'gender_stack'">
            Reči padaju i gomilaju se na polici — prevuci svaki imenicu u DER, DIE ili DAS pre nego što se gomila prelije. Imaš 5 života.
          </p>
          <p *ngIf="set.gameType === 'flapjugation'">
            Uleti u tačnu konjugaciju glagola za prikazanu zamenicu — izbegni pogrešne i napravi konjugaciju refleksom!
          </p>
          <p *ngIf="set.gameType === 'whackawort'">
            Udri nemačke reči koje odgovaraju ciljnoj kategoriji — pogrešni odgovori koštaju jedan život!
          </p>
          <p *ngIf="set.gameType === 'memory'">Okrenite kartice da otkrijete slike i reči. Nađite i uparite svaku sliku s tačnom rečju!</p>
          <p *ngIf="set.gameType === 'jumbled_words'">Pogledajte sliku i složite pomešana slova u tačan redosled da formirate reč.</p>
          <p *ngIf="set.gameType === 'hangman'">Pročitajte nagoveštaj i pogađajte reč slovo po slovo. Svaki pogrešan odgovor privlači vešala!</p>
          <p *ngIf="set.gameType === 'word_picture_match'">Uparite svaku reč s tačnom slikom. Kliknite na sliku koja odgovara prikazanoj reči — uparite sve parove pre isteka vremena!</p>
          <p *ngIf="set.gameType === 'spin_wheel'">Zavrti točak, zatim eliminišite fraze jednu po jednu ili nastavite da ih zadržite — dok ne ostane jedna pobednička fraza.</p>
          <p *ngIf="set.gameType === 'tap_boxes'">Kucnite numerirane kutije na mreži — svaka se otvara s animacijom zumiranja i otkrivanja skrivene nemačke fraze.</p>
          <p *ngIf="set.gameType === 'word_search'">Pronađite skrivene reči vodoravno, vertikalno ili dijagonalno. Prevucite ili kucnite slova redom da otkrijete reč — tačni nalazi donose poene, pogrešni izbori oduzimaju život.</p>
        </div>

        <button mat-raised-button color="primary" class="gd__play-btn" (click)="play()">
          <mat-icon>play_arrow</mat-icon> Igraj odmah — Osvoji {{ set.xpReward }} XP
        </button>

        <!-- Leaderboard preview -->
        <div class="gd__leaderboard" *ngIf="leaderboard.length">
          <h3><mat-icon>leaderboard</mat-icon> Najbolji igrači</h3>
          <div class="gd__lb-row" *ngFor="let e of leaderboard">
            <span class="gd__lb-rank">{{ e.rank }}</span>
            <span class="gd__lb-name">{{ e.name }}</span>
            <span class="gd__lb-score">{{ e.bestScore }} poena</span>
          </div>
        </div>
      </div>

      <div *ngIf="loading" class="gd__loading"><mat-spinner diameter="40"></mat-spinner></div>
    </div>
  `,
  styles: [`
    .gd { max-width: 680px; margin: 0 auto; padding: 16px; }
    .gd__back { margin-bottom: 8px; }
    .gd__hero { height: 180px; border-radius: 20px; display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 20px; }
    .gd__hero__img { width: 100%; height: 100%; object-fit: cover; }
    .gd__hero__icon { font-size: 72px; width: 72px; height: 72px; color: rgba(255,255,255,.8); }
    .gd__tags { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
    .gd__badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .gd__badge--type { background: #e8edf5; color: #405980; }
    .gd__badge--diff-beginner { background: #e8f5e9; color: #2e7d32; }
    .gd__badge--diff-intermediate { background: #fff3e0; color: #e65100; }
    .gd__badge--diff-advanced { background: #fce4ec; color: #b71c1c; }
    .gd__badge--level { background: #ede7f6; color: #4527a0; }
    .gd__title { font-size: 26px; font-weight: 700; color: #2c3e50; margin: 0 0 8px; }
    .gd__desc { color: #666; line-height: 1.6; margin-bottom: 20px; }
    .gd__meta { display: flex; gap: 16px; flex-wrap: wrap; background: #f8f9fa; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
    .gd__meta__item { display: flex; align-items: center; gap: 8px; min-width: 100px; }
    .gd__meta__item mat-icon { color: #405980; }
    .gd__meta__item div { display: flex; flex-direction: column; }
    .gd__meta__item strong { font-size: 18px; font-weight: 700; color: #2c3e50; }
    .gd__meta__item span { font-size: 11px; color: #888; }
    .gd__instructions { background: #fff3e0; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .gd__instructions h3 { margin: 0 0 8px; color: #e65100; font-size: 15px; }
    .gd__instructions p { margin: 0; color: #5d4037; line-height: 1.6; }
    .gd__play-btn { width: 100%; padding: 12px !important; font-size: 16px !important; border-radius: 14px !important; margin-bottom: 24px; }
    .gd__leaderboard h3 { display: flex; align-items: center; gap: 8px; font-size: 16px; color: #405980; margin-bottom: 12px; }
    .gd__lb-row { display: flex; align-items: center; gap: 12px; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .gd__lb-rank { width: 28px; height: 28px; border-radius: 50%; background: #405980; color: white; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0; }
    .gd__lb-name { flex: 1; font-size: 14px; font-weight: 500; }
    .gd__lb-score { font-size: 14px; font-weight: 700; color: #ff8f00; }
    .gd__loading { display: flex; justify-content: center; padding: 64px; }
  `]
})
export class GameDetailComponent implements OnInit {
  set: GameSet | null = null;
  leaderboard: LeaderboardEntry[] = [];
  loading = false;
  thumbnailBroken = false;

  constructor(
    private svc: InteractiveGameService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id')!;
    this.loading = true;
    this.thumbnailBroken = false;
    this.svc.getGameDetail(id).subscribe({
      next: (r) => {
        this.set = r.set;
        this.leaderboard = r.leaderboardPreview || [];
        this.loading = false;
      },
      error: () => { this.loading = false; this.router.navigate(['/glueck-arena']); }
    });
  }

  play() {
    if (!this.set) return;
    this.router.navigate(['/glueck-arena', this.set._id, 'play']);
  }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'linear-gradient(135deg,#1565c0,#42a5f5)',
      sentence_builder: 'linear-gradient(135deg,#2e7d32,#66bb6a)',
      matching: 'linear-gradient(135deg,#6a1b9a,#ab47bc)',
      flashcards: 'linear-gradient(135deg,#e65100,#ffa726)',
      image_matching: 'linear-gradient(135deg,#7c3aed,#a78bfa)',
      gender_stack: 'linear-gradient(135deg,#0284c7,#38bdf8)',
      flapjugation: 'linear-gradient(135deg,#be185d,#ec4899)',
      whackawort: 'linear-gradient(135deg,#d97706,#f59e0b)',
      memory: 'linear-gradient(135deg,#0891b2,#22d3ee)',
      word_picture_match: 'linear-gradient(135deg,#0d9488,#2dd4bf)',
    };
    return map[type] ?? 'linear-gradient(135deg,#405980,#7a9cc0)';
  }

  formatType(t: string): string {
    const map: Record<string, string> = {
      scramble_rush: 'Scramble Rush', sentence_builder: 'Sentence Builder', matching: 'Matching',
      flashcards: 'Flashcards', image_matching: 'Image Matching', gender_stack: 'Gender Stack',
      flapjugation: 'Flapjugation', whackawort: 'Whack-a-Wort',
      memory: 'Memory Game',
      word_picture_match: 'Word-Picture Match',
    };
    return map[t] ?? t;
  }
}
