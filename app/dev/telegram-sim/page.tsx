import { headers } from "next/headers";
import { DevTelegramSimConsole } from "@/components/dev-telegram-sim-console";
import { isLocalHostname, isDevTelegramSimEnabled } from "@/lib/dev-telegram-sim";

const isPageAccessible = async () => {
  if (!isDevTelegramSimEnabled()) {
    return false;
  }
  const headerStore = await headers();
  const host = headerStore.get("host") || "";
  const hostname = host.split(":")[0] || "";
  return isLocalHostname(hostname);
};

export default async function DevTelegramSimPage() {
  const accessible = await isPageAccessible();

  if (!accessible) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold">Dev Telegram Simulator Disabled</h1>
        <p className="mt-3 text-sm text-neutral-700">
          Enable <code>DEV_TELEGRAM_SIM_ENABLED=true</code> and use a local hostname to access this page.
        </p>
      </main>
    );
  }

  return <DevTelegramSimConsole />;
}
