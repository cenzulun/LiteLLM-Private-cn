import { MultiSelect } from "@/components/shared/MultiSelect";
import { SearchSelect } from "@/components/shared/SearchSelect";
import { Button } from "@/components/ui/button";
import { ArrowDown, Plus, X } from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

interface FallbackEntry {
  id: string;
  primaryModel: string | null;
  fallbackModels: string[];
}

interface BudgetFallbacksEditorProps {
  value: Record<string, string[]>;
  onChange: (v: Record<string, string[]>) => void;
  availableModels: string[];
}

const entriesToDict = (entries: readonly FallbackEntry[]): Record<string, string[]> =>
  Object.fromEntries(
    entries
      .filter(
        (e): e is FallbackEntry & { primaryModel: string } => e.primaryModel !== null && e.fallbackModels.length > 0,
      )
      .map((e) => [e.primaryModel, e.fallbackModels]),
  );

const dictToEntries = (dict: Record<string, string[]>): FallbackEntry[] => {
  const keys = Object.keys(dict);
  if (keys.length === 0) return [];
  return keys.map((model, i) => ({
    id: String(i + 1),
    primaryModel: model,
    fallbackModels: dict[model],
  }));
};

export function BudgetFallbacksEditor({ value, onChange, availableModels }: BudgetFallbacksEditorProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FallbackEntry[]>(() => dictToEntries(value));

  const emitChange = (updated: FallbackEntry[]) => {
    setEntries(updated);
    onChange(entriesToDict(updated));
  };

  const addEntry = () => {
    emitChange([...entries, { id: Date.now().toString(), primaryModel: null, fallbackModels: [] }]);
  };

  const removeEntry = (id: string) => {
    emitChange(entries.filter((e) => e.id !== id));
  };

  const updateEntry = (id: string, patch: Partial<FallbackEntry>) => {
    emitChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const usedPrimaryModels = new Set(entries.map((e) => e.primaryModel).filter(Boolean));

  if (entries.length === 0) {
    return (
      <span hidden aria-hidden="true" />
    );
  }

  return (
    <span hidden aria-hidden="true" />
  );
}
