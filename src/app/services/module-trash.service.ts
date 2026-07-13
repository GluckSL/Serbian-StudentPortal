// src/app/services/module-trash.service.ts
// Module Trash Management Service

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TrashItem {
  _id: string;
  title: string;
  description: string;
  level: string;
  category: string;
  targetLanguage: string;
  nativeLanguage: string;
  isDeleted: boolean;
  deletedAt: Date;
  deletedBy: {
    _id: string;
    name: string;
    email: string;
    regNo?: string;
  };
  deletionReason: string;
  scheduledDeletionDate: Date;
  daysRemaining: number;
  isExpired: boolean;
  createdBy: {
    _id: string;
    name: string;
    email: string;
    regNo?: string;
  };
  createdAt: Date;
}

export interface TrashStats {
  totalItems: number;
  expiredItems: number;
  itemsExpiringSoon: number;
  oldestItem: {
    id: string;
    title: string;
    deletedAt: Date;
    daysRemaining: number;
  } | null;
  newestItem: {
    id: string;
    title: string;
    deletedAt: Date;
    daysRemaining: number;
  } | null;
  byLevel: { [key: string]: number };
  byCategory: { [key: string]: number };
}

@Injectable({
  providedIn: 'root'
})
export class ModuleTrashService {
  private apiUrl = `${environment.apiUrl}/module-trash`;

  constructor(private http: HttpClient) {}

  // Get all trash items
  getTrashItems(): Observable<{ success: boolean; trashItems: TrashItem[]; totalItems: number }> {
    return this.http.get<{ success: boolean; trashItems: TrashItem[]; totalItems: number }>(`${this.apiUrl}`, { withCredentials: true });
  }

  // Move module to trash (soft delete)
  moveToTrash(moduleId: string, reason?: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/move/${moduleId}`, { reason }, { withCredentials: true });
  }

  // Restore module from trash
  restoreFromTrash(moduleId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/restore/${moduleId}`, {}, { withCredentials: true });
  }

  // Permanently delete module from trash
  permanentlyDelete(moduleId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/permanent/${moduleId}`, { withCredentials: true });
  }

  // Empty entire trash
  emptyTrash(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/empty`, { withCredentials: true });
  }

  // Run cleanup job manually
  runCleanup(): Observable<any> {
    return this.http.post(`${this.apiUrl}/cleanup`, {}, { withCredentials: true });
  }

  // Get trash statistics
  getTrashStats(): Observable<{ success: boolean; stats: TrashStats }> {
    return this.http.get<{ success: boolean; stats: TrashStats }>(`${this.apiUrl}/stats`, { withCredentials: true });
  }

  // Helper methods for UI
  getDaysRemainingText(daysRemaining: number): string {
    if (daysRemaining <= 0) {
      return 'Expired';
    } else if (daysRemaining === 1) {
      return '1 day remaining';
    } else if (daysRemaining <= 7) {
      return `${daysRemaining} days remaining (expires soon)`;
    } else {
      return `${daysRemaining} days remaining`;
    }
  }

  getDaysRemainingClass(daysRemaining: number): string {
    if (daysRemaining <= 0) {
      return 'text-danger';
    } else if (daysRemaining <= 7) {
      return 'text-warning';
    } else {
      return 'text-muted';
    }
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}