export interface FinanceBatchPreset {
  name: string;
  batches: string[];
  savedAt: string;
}

const STORAGE_KEY = 'ph-finance-batch-presets-v1';

export function loadFinanceBatchPresets(): FinanceBatchPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FinanceBatchPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.batches))
      .map((p) => ({
        name: p.name.trim(),
        batches: [...new Set(p.batches.map((b) => String(b).trim()).filter(Boolean))],
        savedAt: p.savedAt || new Date().toISOString(),
      }))
      .filter((p) => p.name && p.batches.length);
  } catch {
    return [];
  }
}

export function saveFinanceBatchPreset(name: string, batches: string[]): FinanceBatchPreset[] {
  const trimmedName = name.trim();
  if (!trimmedName) return loadFinanceBatchPresets();

  const normalizedBatches = [...new Set(batches.map((b) => String(b).trim()).filter(Boolean))];
  if (!normalizedBatches.length) return loadFinanceBatchPresets();

  const existing = loadFinanceBatchPresets().filter(
    (p) => p.name.toLowerCase() !== trimmedName.toLowerCase(),
  );
  const next: FinanceBatchPreset[] = [
    { name: trimmedName, batches: normalizedBatches, savedAt: new Date().toISOString() },
    ...existing,
  ].slice(0, 30);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteFinanceBatchPreset(name: string): FinanceBatchPreset[] {
  const trimmed = name.trim().toLowerCase();
  const next = loadFinanceBatchPresets().filter((p) => p.name.toLowerCase() !== trimmed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
