import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewEncapsulation } from '@angular/core';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterModule, HttpClientModule, CommonModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
  encapsulation: ViewEncapsulation.None,
})
export class HomeComponent implements AfterViewInit, OnDestroy {
  readonly year = new Date().getFullYear();

  /** Nav state: island nav elevates after scrolling; burger toggles the mobile panel. */
  scrolled = false;
  menuOpen = false;

  private observers: IntersectionObserver[] = [];

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.scrolled = window.scrollY > 24;
  }

  constructor(private host: ElementRef<HTMLElement>) {}

  /** Smooth-scroll to an in-page section, offsetting for the fixed island nav. */
  scrollTo(id: string, event: Event): void {
    event.preventDefault();
    this.menuOpen = false;
    const el = document.getElementById(id);
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const y = el.getBoundingClientRect().top + window.scrollY - 84;
    window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  ngAfterViewInit(): void {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setupStatCounters(reduceMotion);
    this.setupReveals(reduceMotion);
  }

  ngOnDestroy(): void {
    this.observers.forEach((o) => o.disconnect());
    this.observers = [];
  }

  /** Animates .ia-stat-num from 0 to its data-count when the stats strip scrolls into view. */
  private setupStatCounters(reduceMotion: boolean): void {
    const nums = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.ia-stat-num'));
    if (!nums.length) return;

    const setFinal = (el: HTMLElement) => { el.textContent = el.dataset['count'] || '0'; };
    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      nums.forEach(setFinal);
      return;
    }

    const animate = (el: HTMLElement) => {
      const target = Number(el.dataset['count'] || '0');
      const duration = 1400;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
        el.textContent = String(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          animate(entry.target as HTMLElement);
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.4 });
    nums.forEach((el) => io.observe(el));
    this.observers.push(io);
  }

  /** Adds .is-in to .ia-reveal and .ia-feat-card elements as they enter the viewport. */
  private setupReveals(reduceMotion: boolean): void {
    const targets = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.ia-reveal, .ia-feat-card')
    );
    if (!targets.length) return;

    if (reduceMotion || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in'));
      return;
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    }, { threshold: 0.15, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    this.observers.push(io);
  }
}
