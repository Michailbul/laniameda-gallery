"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";

interface FilterSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  tags: string[];
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onClearAll: () => void;
}

export function FilterSidebar({
  isOpen,
  onClose,
  tags,
  selectedTags,
  onTagToggle,
  onClearAll,
}: FilterSidebarProps) {
  const tagCategories: Record<string, string[]> = {
    Style: ["Portrait", "Landscape", "Abstract", "Minimalist", "Surreal", "Editorial"],
    Subject: ["Fashion", "Nature", "Technology", "Architecture", "Animals", "People"],
    Mood: ["Dark", "Vibrant", "Moody", "Dramatic", "Dreamy", "Ethereal"],
    Color: ["Warm", "Cool", "Monochrome", "Neon", "Pastel", "Earth Tones"],
  };
  const knownTags = new Set(Object.values(tagCategories).flat());
  const extraTags = tags.filter((tag) => !knownTags.has(tag));
  if (extraTags.length > 0) {
    tagCategories.Other = extraTags;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-background/80 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-72 bg-card border-r border-border z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h2 className="text-lg font-semibold text-foreground">Filters</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          {/* Selected Tags Count & Clear */}
          {selectedTags.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 bg-secondary/50 border-b border-border">
              <span className="text-sm text-muted-foreground">
                {selectedTags.length} filter{selectedTags.length !== 1 ? "s" : ""} selected
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-primary hover:text-primary/80 h-auto p-0"
              >
                Clear all
              </Button>
            </div>
          )}

          {/* Tag Categories */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-6">
              {Object.entries(tagCategories).map(([category, categoryTags]) => (
                <div key={category}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {categoryTags.map((tag) => (
                      <label
                        key={tag}
                        className="flex items-center gap-3 cursor-pointer group"
                      >
                        <Checkbox
                          checked={selectedTags.includes(tag)}
                          onCheckedChange={() => onTagToggle(tag)}
                          className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <span
                          className={`text-sm transition-colors ${
                            selectedTags.includes(tag)
                              ? "text-foreground"
                              : "text-muted-foreground group-hover:text-foreground"
                          }`}
                        >
                          {tag}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Apply Button */}
          <div className="p-4 border-t border-border">
            <Button
              onClick={onClose}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
