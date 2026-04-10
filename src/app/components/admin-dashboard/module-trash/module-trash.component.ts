// src/app/components/admin-dashboard/module-trash/module-trash.component.ts
// Module Trash Management Component

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModuleTrashService, TrashItem, TrashStats } from '../../../services/module-trash.service';
import { NotificationService } from '../../../services/notification.service';

@Component({
  selector: 'app-module-trash',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './module-trash.component.html',
  styleUrls: ['./module-trash.component.css']
})
export class ModuleTrashComponent implements OnInit {
  Math = Math; // Add Math for template usage
  
  trashItems: TrashItem[] = [];
  stats: TrashStats | null = null;
  isLoading = false;
  selectedItems: Set<string> = new Set();
  
  // Filters
  filterLevel = '';
  filterCategory = '';
  filterExpired = '';
  searchTerm = '';
  
  // Sorting
  sortBy = 'deletedAt';
  sortOrder: 'asc' | 'desc' = 'desc';
  
  // Pagination
  currentPage = 1;
  itemsPerPage = 10;
  
  constructor(
    private trashService: ModuleTrashService,
    private notify: NotificationService
  ) {}

  ngOnInit(): void {
    this.loadTrashItems();
    this.loadStats();
  }

  loadTrashItems(): void {
    this.isLoading = true;
    this.trashService.getTrashItems().subscribe({
      next: (response) => {
        this.trashItems = response.trashItems;
        this.isLoading = false;
        console.log('📋 Loaded trash items:', this.trashItems.length);
      },
      error: (error) => {
        console.error('❌ Error loading trash items:', error);
        this.isLoading = false;
      }
    });
  }

  loadStats(): void {
    this.trashService.getTrashStats().subscribe({
      next: (response) => {
        this.stats = response.stats;
        console.log('📊 Loaded trash stats:', this.stats);
      },
      error: (error) => {
        console.error('❌ Error loading trash stats:', error);
      }
    });
  }

  // Filtering and sorting
  get filteredItems(): TrashItem[] {
    let filtered = [...this.trashItems];

    // Apply filters
    if (this.filterLevel) {
      filtered = filtered.filter(item => item.level === this.filterLevel);
    }
    
    if (this.filterCategory) {
      filtered = filtered.filter(item => item.category === this.filterCategory);
    }
    
    if (this.filterExpired === 'expired') {
      filtered = filtered.filter(item => item.isExpired);
    } else if (this.filterExpired === 'active') {
      filtered = filtered.filter(item => !item.isExpired);
    }
    
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.title.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term) ||
        item.deletedBy.name.toLowerCase().includes(term)
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (this.sortBy) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'level':
          aValue = a.level;
          bValue = b.level;
          break;
        case 'deletedAt':
          aValue = new Date(a.deletedAt);
          bValue = new Date(b.deletedAt);
          break;
        case 'daysRemaining':
          aValue = a.daysRemaining;
          bValue = b.daysRemaining;
          break;
        case 'deletedBy':
          aValue = a.deletedBy.name.toLowerCase();
          bValue = b.deletedBy.name.toLowerCase();
          break;
        default:
          return 0;
      }
      
      if (aValue < bValue) return this.sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return this.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }

  // Pagination
  get paginatedItems(): TrashItem[] {
    const filtered = this.filteredItems;
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    return filtered.slice(startIndex, startIndex + this.itemsPerPage);
  }

  get totalPages(): number {
    return Math.ceil(this.filteredItems.length / this.itemsPerPage);
  }

  // Actions
  restoreItem(item: TrashItem): void {
    this.notify.confirm('Restore Module', `Restore "${item.title}"?`).subscribe(ok => {
      if (!ok) return;
      this.trashService.restoreFromTrash(item._id).subscribe({
        next: () => { this.loadTrashItems(); this.loadStats(); },
        error: () => this.notify.error('Failed to restore module')
      });
    });
  }

  permanentlyDeleteItem(item: TrashItem): void {
    this.notify.confirm(
      'Permanent Deletion',
      `Permanently delete "${item.title}"? This CANNOT be undone!`,
      'Yes, Delete Forever', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.trashService.permanentlyDelete(item._id).subscribe({
        next: () => { this.loadTrashItems(); this.loadStats(); },
        error: () => this.notify.error('Failed to permanently delete module')
      });
    });
  }

  emptyTrash(): void {
    this.notify.confirm(
      'Empty Trash',
      `Permanently delete ALL ${this.trashItems.length} modules in the trash? This CANNOT be undone!`,
      'Yes, Empty Trash', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      this.trashService.emptyTrash().subscribe({
        next: (response) => {
          this.loadTrashItems();
          this.loadStats();
          this.notify.success(`Trash emptied. ${response.deletedCount} modules permanently deleted.`);
        },
        error: () => this.notify.error('Failed to empty trash')
      });
    });
  }

  runCleanup(): void {
    this.notify.confirm('Run Cleanup', 'Permanently delete all expired items?').subscribe(ok => {
      if (!ok) return;
      this.trashService.runCleanup().subscribe({
        next: (response) => {
          this.loadTrashItems();
          this.loadStats();
          if (response.deletedCount > 0) {
            this.notify.success(`Cleanup done. ${response.deletedCount} expired modules deleted.`);
          } else {
            this.notify.info('Cleanup completed. No expired modules found.');
          }
        },
        error: () => this.notify.error('Failed to run cleanup')
      });
    });
  }

  // Selection management
  toggleSelection(itemId: string): void {
    if (this.selectedItems.has(itemId)) {
      this.selectedItems.delete(itemId);
    } else {
      this.selectedItems.add(itemId);
    }
  }

  selectAll(): void {
    this.paginatedItems.forEach(item => this.selectedItems.add(item._id));
  }

  deselectAll(): void {
    this.selectedItems.clear();
  }

  // Bulk actions
  bulkRestore(): void {
    if (this.selectedItems.size === 0) return;
    this.notify.confirm('Bulk Restore', `Restore ${this.selectedItems.size} selected modules?`).subscribe(ok => {
      if (!ok) return;
      const promises = Array.from(this.selectedItems).map(id => this.trashService.restoreFromTrash(id).toPromise());
      Promise.all(promises).then(() => {
        this.loadTrashItems(); this.loadStats(); this.selectedItems.clear();
      }).catch(() => this.notify.error('Some modules failed to restore'));
    });
  }

  bulkDelete(): void {
    if (this.selectedItems.size === 0) return;
    this.notify.confirm(
      'Bulk Permanent Delete',
      `Permanently delete ${this.selectedItems.size} selected modules? This CANNOT be undone!`,
      'Yes, Delete All', 'Cancel'
    ).subscribe(ok => {
      if (!ok) return;
      const promises = Array.from(this.selectedItems).map(id => this.trashService.permanentlyDelete(id).toPromise());
      Promise.all(promises).then(() => {
        this.loadTrashItems(); this.loadStats(); this.selectedItems.clear();
      }).catch(() => this.notify.error('Some modules failed to delete'));
    });
  }

  // Utility methods
  setSortBy(field: string): void {
    if (this.sortBy === field) {
      this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortBy = field;
      this.sortOrder = 'asc';
    }
  }

  getDaysRemainingText(daysRemaining: number): string {
    return this.trashService.getDaysRemainingText(daysRemaining);
  }

  getDaysRemainingClass(daysRemaining: number): string {
    return this.trashService.getDaysRemainingClass(daysRemaining);
  }

  formatDate(date: Date | string): string {
    return this.trashService.formatDate(date);
  }

  getUniqueValues(field: keyof TrashItem): string[] {
    const values = this.trashItems.map(item => {
      if (field === 'level' || field === 'category') {
        return item[field] as string;
      }
      return '';
    }).filter(Boolean);
    
    return [...new Set(values)].sort();
  }
}