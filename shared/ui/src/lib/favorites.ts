import { useCallback, useState } from "react";
import { parseFavorites, toggleFavorite } from "./locations";

const KEY = "mantel.favoriteLocations";

function read(): string[] {
  try {
    return parseFavorites(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

function write(ids: readonly string[]): void {
  try {
    if (ids.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
  }
}

export function useFavoriteLocations(): { favorites: string[]; toggle: (id: string) => void } {
  const [favorites, setFavorites] = useState<string[]>(read);
  const toggle = useCallback((id: string) => {
    setFavorites((current) => {
      const next = toggleFavorite(current, id);
      write(next);
      return next;
    });
  }, []);
  return { favorites, toggle };
}
