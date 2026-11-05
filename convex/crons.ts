import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// The gallery's scheduled jobs. One today: the morning newspaper, compiled at
// 05:30 UTC (07:30 Prague in winter, 06:30 in summer) for the configured
// owner, then announced on Telegram when a bot token is set. See
// convex/newspaper.ts and agent-docs/features/newspaper/PRD.md.
const crons = cronJobs();

crons.daily("compile the morning newspaper", { hourUTC: 5, minuteUTC: 30 }, internal.newspaper.compileAll, {});

export default crons;
