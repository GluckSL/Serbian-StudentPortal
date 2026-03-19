// src/app/components/chat/chat.component.ts
// Legacy component - redirects to AI Tutor Chat

import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat.component.html',
  styleUrls: ['./chat.component.css']
})
export class ChatComponent implements OnInit {
  constructor(private router: Router) {}

  ngOnInit() {
    // Redirect to the actual AI tutor chat
    this.router.navigate(['/ai-tutor-chat']);
  }
}
