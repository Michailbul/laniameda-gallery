"use client";

import { useState } from "react";
import Image from "next/image";
import { ExternalLink, TrendingUp, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface Influencer {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  instagramUrl: string;
  followers: string;
  engagement: string;
  niche: string[];
  verified: boolean;
  contacted: boolean;
  status: "pending" | "approved" | "rejected" | "none";
  notes: string;
}

const sampleInfluencers: Influencer[] = [
  {
    id: "1",
    name: "Emma Johnson",
    handle: "@emmastyle",
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/emmastyle",
    followers: "1.2M",
    engagement: "4.8%",
    niche: ["Fashion", "Lifestyle"],
    verified: true,
    contacted: true,
    status: "approved",
    notes: "Responded positively, awaiting contract",
  },
  {
    id: "2",
    name: "Marcus Chen",
    handle: "@marcusfit",
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/marcusfit",
    followers: "890K",
    engagement: "5.2%",
    niche: ["Fitness", "Health"],
    verified: true,
    contacted: false,
    status: "none",
    notes: "",
  },
  {
    id: "3",
    name: "Sofia Rodriguez",
    handle: "@sofiacooks",
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/sofiacooks",
    followers: "2.1M",
    engagement: "6.1%",
    niche: ["Food", "Recipe"],
    verified: true,
    contacted: true,
    status: "pending",
    notes: "Initial outreach sent",
  },
  {
    id: "4",
    name: "Alex Kim",
    handle: "@alextech",
    avatar: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/alextech",
    followers: "450K",
    engagement: "3.9%",
    niche: ["Tech", "Reviews"],
    verified: false,
    contacted: true,
    status: "rejected",
    notes: "Budget mismatch",
  },
  {
    id: "5",
    name: "Lily Thompson",
    handle: "@lilytravel",
    avatar: "https://images.unsplash.com/photo-1518998053901-5348d3961a04?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/lilytravel",
    followers: "3.4M",
    engagement: "4.5%",
    niche: ["Travel", "Adventure"],
    verified: true,
    contacted: false,
    status: "none",
    notes: "",
  },
  {
    id: "6",
    name: "David Park",
    handle: "@davidart",
    avatar: "https://images.unsplash.com/photo-1579783902614-a3fb3927b6a5?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/davidart",
    followers: "780K",
    engagement: "5.8%",
    niche: ["Art", "Design"],
    verified: false,
    contacted: true,
    status: "approved",
    notes: "Campaign starting next month",
  },
  {
    id: "7",
    name: "Nina Patel",
    handle: "@ninabeauty",
    avatar: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/ninabeauty",
    followers: "1.8M",
    engagement: "4.2%",
    niche: ["Beauty", "Skincare"],
    verified: true,
    contacted: false,
    status: "none",
    notes: "",
  },
  {
    id: "8",
    name: "Jake Morrison",
    handle: "@jakegames",
    avatar: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=100&h=100&fit=crop",
    instagramUrl: "https://instagram.com/jakegames",
    followers: "560K",
    engagement: "7.1%",
    niche: ["Gaming", "Entertainment"],
    verified: false,
    contacted: true,
    status: "pending",
    notes: "Negotiating terms",
  },
];

const statusColors = {
  pending: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  rejected: "bg-red-500/10 text-red-500 border-red-500/20",
  none: "bg-muted text-muted-foreground border-border",
};

const statusLabels = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  none: "Not Contacted",
};

export function InfluencersTable() {
  const [influencers] = useState<Influencer[]>(sampleInfluencers);

  return (
    <div className="px-4 pb-8">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-muted-foreground font-medium">Influencer</TableHead>
            <TableHead className="text-muted-foreground font-medium">
              <div className="flex items-center gap-1">
                <Users className="h-4 w-4" />
                Followers
              </div>
            </TableHead>
            <TableHead className="text-muted-foreground font-medium">
              <div className="flex items-center gap-1">
                <TrendingUp className="h-4 w-4" />
                Engagement
              </div>
            </TableHead>
            <TableHead className="text-muted-foreground font-medium">Niche</TableHead>
            <TableHead className="text-muted-foreground font-medium">Status</TableHead>
            <TableHead className="text-muted-foreground font-medium">Notes</TableHead>
            <TableHead className="text-muted-foreground font-medium text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {influencers.map((influencer) => (
            <TableRow key={influencer.id} className="border-border hover:bg-muted/50">
              <TableCell>
                <div className="flex items-center gap-3">
                  <div className="relative h-10 w-10 overflow-hidden rounded-full bg-muted">
                    <Image
                      src={influencer.avatar || "/placeholder.svg"}
                      alt={influencer.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">{influencer.name}</span>
                      {influencer.verified && (
                        <svg
                          className="h-4 w-4 text-primary"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground">{influencer.handle}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell className="text-foreground font-medium">{influencer.followers}</TableCell>
              <TableCell>
                <span className="text-emerald-500 font-medium">{influencer.engagement}</span>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {influencer.niche.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="bg-secondary text-secondary-foreground text-xs"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className={`${statusColors[influencer.status]} border`}
                >
                  {statusLabels[influencer.status]}
                </Badge>
              </TableCell>
              <TableCell className="max-w-[200px]">
                <span className="text-sm text-muted-foreground truncate block">
                  {influencer.notes || "-"}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                  asChild
                >
                  <a href={influencer.instagramUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    View
                  </a>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
