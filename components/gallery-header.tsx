"use client";

import { SlidersHorizontal, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

interface GalleryHeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onFilterClick: () => void;
  selectedTagsCount: number;
}

export function GalleryHeader({
  activeTab,
  setActiveTab,
  onFilterClick,
  selectedTagsCount,
}: GalleryHeaderProps) {
  const tabs = ["For You", "Random", "Hot", "Top Day", "Likes"];

  return (
    <header className="sticky top-0 z-50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab}
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab(tab)}
              className={`text-sm font-medium transition-colors ${
                activeTab === tab
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "Top Day" && <ChevronDown className="ml-1 h-3 w-3" />}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onFilterClick}
          className="relative text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Filters
          {selectedTagsCount > 0 && (
            <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {selectedTagsCount}
            </span>
          )}
        </Button>
      </div>
    </header>
  );
}
