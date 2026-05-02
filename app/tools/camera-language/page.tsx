import type { Metadata } from "next";
import { CameraLanguageTool } from "@/components/tools/camera-language-tool";

export const metadata: Metadata = {
  title: "Camera Language Tool | Laniameda Gallery",
  description:
    "Camera movement terms and prompt blocks for cinematic AI video generation.",
};

export default function CameraLanguagePage() {
  return <CameraLanguageTool />;
}
