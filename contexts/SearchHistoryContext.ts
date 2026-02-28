import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import { SearchHistoryItem } from '@/types/genealogy';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 50;

export const [SearchHistoryProvider, useSearchHistory] = createContextHook(() => {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  const loadQuery = useQuery({
    queryKey: ['searchHistory'],
    queryFn: async () => {
      const stored = await AsyncStorage.getItem(HISTORY_KEY);
      if (stored) return JSON.parse(stored) as SearchHistoryItem[];
      return [];
    },
  });

  useEffect(() => {
    if (loadQuery.data) {
      setHistory(loadQuery.data);
    }
  }, [loadQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (items: SearchHistoryItem[]) => {
      await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(items));
      return items;
    },
  });

  const addEntry = useCallback(
    (entry: Omit<SearchHistoryItem, 'id' | 'timestamp'>) => {
      const newEntry: SearchHistoryItem = {
        ...entry,
        type: entry.type ?? 'search',
        id: Date.now().toString(),
        timestamp: Date.now(),
      };
      setHistory((prev) => {
        const updated = [newEntry, ...prev].slice(0, MAX_HISTORY);
        saveMutation.mutate(updated);
        return updated;
      });
    },
    [saveMutation]
  );

  const addRelationshipEntry = useCallback(
    (params: {
      person1Id: string;
      person1Name: string;
      person2Id: string;
      person2Name: string;
      relationshipResult: string;
      pathCount: number;
    }) => {
      const newEntry: SearchHistoryItem = {
        id: Date.now().toString(),
        type: 'relationship',
        query: `${params.person1Name} ↔ ${params.person2Name}`,
        resultCount: params.pathCount,
        timestamp: Date.now(),
        person1Id: params.person1Id,
        person1Name: params.person1Name,
        person2Id: params.person2Id,
        person2Name: params.person2Name,
        relationshipResult: params.relationshipResult,
        pathCount: params.pathCount,
      };
      setHistory((prev) => {
        const updated = [newEntry, ...prev].slice(0, MAX_HISTORY);
        saveMutation.mutate(updated);
        return updated;
      });
    },
    [saveMutation]
  );

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveMutation.mutate([]);
  }, [saveMutation]);

  return {
    history,
    addEntry,
    addRelationshipEntry,
    clearHistory,
  };
});
