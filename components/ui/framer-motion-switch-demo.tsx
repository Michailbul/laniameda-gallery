"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/framer-motion-switch";

export default function FramerMotionSwitchDemo() {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-8 bg-black p-8">
      <Switch checked={checked} setChecked={setChecked} label="Dark mode" />
      <Switch
        checked={!checked}
        setChecked={() => setChecked((current) => !current)}
        label="Inverse"
      />
    </div>
  );
}
