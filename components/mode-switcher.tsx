"use client";

import { ImageIcon, Users } from "lucide-react";

interface ModeSwitcherProps {
  activeMode: "images" | "influencers";
  setActiveMode: (mode: "images" | "influencers") => void;
}

export function ModeSwitcher({ activeMode, setActiveMode }: ModeSwitcherProps) {
  return (
    <div className="flex items-center justify-center py-4">
      <div className="inline-flex items-center bg-secondary rounded-lg p-1">
        <button
          onClick={() => setActiveMode("images")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            activeMode === "images"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ImageIcon className="h-4 w-4" />
          Image References
        </button>
        <button
          onClick={() => setActiveMode("influencers")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
            activeMode === "influencers"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Instagram Influencers
        </button>
      </div>
    </div>
  );
}
