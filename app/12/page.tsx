"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Search,
  Bell,
  Settings,
  User,
  Image,
  FolderOpen,
  Star,
  Heart,
  Upload,
  ChevronRight,
  ExternalLink,
  Plus,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";

const EMBER = [
  "#ff4800",
  "#ff5400",
  "#ff6000",
  "#ff6d00",
  "#ff7900",
  "#ff8500",
  "#ff9100",
  "#ff9e00",
  "#ffaa00",
  "#ffb600",
] as const;

const gradientCSS = `linear-gradient(135deg, ${EMBER[0]}, ${EMBER[4]}, ${EMBER[9]})`;

function SidebarItem({
  icon: Icon,
  label,
  active = false,
  badge,
}: {
  icon: typeof Home;
  label: string;
  active?: boolean;
  badge?: number;
}) {
  return (
    <motion.div
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors"
      style={{
        background: active ? EMBER[0] + "15" : "transparent",
        color: active ? EMBER[4] : "#f0e8e060",
      }}
      whileHover={{ backgroundColor: EMBER[0] + "10" }}
    >
      <Icon size={18} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span
          className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
          style={{ background: EMBER[0], color: "#000" }}
        >
          {badge}
        </span>
      )}
    </motion.div>
  );
}

function StatCard({ label, value, change }: { label: string; value: string; change: string }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ borderColor: "#ffffff08", background: "#ffffff04" }}
    >
      <p className="text-xs" style={{ color: "#f0e8e050" }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold" style={{ color: "#f0e8e0" }}>
        {value}
      </p>
      <p className="mt-1 text-xs font-mono" style={{ color: EMBER[6] }}>
        {change}
      </p>
    </div>
  );
}

function GalleryItem({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <motion.div
      className="group flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
      style={{ borderColor: "#ffffff08", background: "#ffffff03" }}
      whileHover={{ borderColor: color + "30", backgroundColor: color + "08" }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ background: color + "15" }}
      >
        <FolderOpen size={18} style={{ color }} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium" style={{ color: "#f0e8e0" }}>
          {title}
        </p>
        <p className="text-xs" style={{ color: "#f0e8e040" }}>
          {count} items
        </p>
      </div>
      <ChevronRight size={16} style={{ color: "#f0e8e020" }} />
    </motion.div>
  );
}

export default function EmberModeDarkTheme() {
  const [activeTab, setActiveTab] = useState<"overview" | "gallery" | "settings">("overview");

  return (
    <div
      className="flex min-h-screen"
      style={{
        background: "#111110",
        fontFamily: "var(--font-geist-sans)",
        color: "#f0e8e0",
      }}
    >
      {/* Sidebar */}
      <div
        className="flex w-60 flex-col border-r p-4"
        style={{ borderColor: "#ffffff08", background: "#0c0c0b" }}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ background: gradientCSS }}
          >
            <span className="text-sm font-bold text-black">E</span>
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "#f0e8e0" }}>
              Ember Mode
            </p>
            <p className="text-[10px]" style={{ color: EMBER[6] }}>
              Active
            </p>
          </div>
        </div>

        <div className="space-y-0.5">
          <SidebarItem icon={Home} label="Overview" active={activeTab === "overview"} />
          <SidebarItem icon={Image} label="Gallery" active={activeTab === "gallery"} badge={12} />
          <SidebarItem icon={Star} label="Favorites" />
          <SidebarItem icon={Upload} label="Uploads" badge={3} />
          <SidebarItem icon={Heart} label="Liked" />
          <SidebarItem icon={Settings} label="Settings" active={activeTab === "settings"} />
        </div>

        <div className="mt-auto pt-4">
          <div
            className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            style={{ borderColor: "#ffffff08", background: "#ffffff04" }}
          >
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: EMBER[2] + "20", color: EMBER[2] }}
            >
              M
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium">Michael</p>
              <p className="text-[10px]" style={{ color: "#f0e8e040" }}>
                Pro Plan
              </p>
            </div>
            <MoreHorizontal size={14} style={{ color: "#f0e8e030" }} />
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-auto">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-8 py-4"
          style={{ borderColor: "#ffffff08" }}
        >
          <div>
            <p className="text-xs font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
              Route /12
            </p>
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ember Mode
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <div
              className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: "#ffffff10", background: "#ffffff05" }}
            >
              <Search size={14} style={{ color: "#f0e8e040" }} />
              <input
                placeholder="Search..."
                className="w-40 bg-transparent text-xs outline-none placeholder:text-[#f0e8e030]"
                style={{ color: "#f0e8e0" }}
              />
            </div>

            <button
              className="relative rounded-lg border p-2 transition-colors"
              style={{ borderColor: "#ffffff10" }}
            >
              <Bell size={16} style={{ color: "#f0e8e060" }} />
              <div
                className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full"
                style={{ background: EMBER[0] }}
              />
            </button>

            <motion.button
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-black"
              style={{ background: gradientCSS }}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
            >
              <Plus size={14} />
              New Upload
            </motion.button>
          </div>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Assets" value="2,847" change="+12% this week" />
            <StatCard label="Collections" value="34" change="+3 new" />
            <StatCard label="Storage" value="14.2 GB" change="72% used" />
            <StatCard label="Shared" value="128" change="+8 today" />
          </div>

          {/* Collections */}
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Recent Collections</h2>
              <button className="text-xs" style={{ color: EMBER[4] }}>
                View all <ExternalLink size={12} className="ml-1 inline" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <GalleryItem title="Sunset Series" count={48} color={EMBER[0]} />
              <GalleryItem title="Urban Textures" count={32} color={EMBER[3]} />
              <GalleryItem title="Nature Close-ups" count={67} color={EMBER[5]} />
              <GalleryItem title="Architecture" count={23} color={EMBER[7]} />
              <GalleryItem title="Portraits" count={41} color={EMBER[9]} />
              <GalleryItem title="Abstract" count={19} color={EMBER[2]} />
            </div>
          </div>

          {/* Recent Activity */}
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">Recent Activity</h2>
            <div className="space-y-2">
              {[
                { action: "Uploaded 12 photos to", target: "Sunset Series", time: "2m ago", color: EMBER[0] },
                { action: "Created collection", target: "Abstract", time: "1h ago", color: EMBER[4] },
                { action: "Shared", target: "Architecture" , time: "3h ago", color: EMBER[6] },
                { action: "Liked 5 items in", target: "Portraits", time: "5h ago", color: EMBER[8] },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-4 py-3"
                  style={{ background: "#ffffff03" }}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ background: item.color }}
                  />
                  <p className="flex-1 text-sm" style={{ color: "#f0e8e080" }}>
                    {item.action}{" "}
                    <span style={{ color: item.color }}>{item.target}</span>
                  </p>
                  <span className="text-xs font-mono" style={{ color: "#f0e8e030" }}>
                    {item.time}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom nav overlay */}
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-6 border-t py-3 text-sm"
        style={{
          borderColor: "#ffffff08",
          background: "#111110e0",
          backdropFilter: "blur(10px)",
          color: "#f0e8e060",
        }}
      >
        <Link href="/11" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <span className="opacity-30">Next →</span>
      </div>
    </div>
  );
}
