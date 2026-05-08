import { loadRoutines, updateRoutine, Routine } from "./routineStorage";
import { HeadlessAgent } from "./headlessAgent";
import { Tab } from "../Tab";

export class RoutineScheduler {
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  public start(): void {
    if (this.intervalId) return;
    
    console.log("Routine scheduler started (polling every 60s)");
    this.intervalId = setInterval(() => void this.checkSchedules(), 60_000);
    
    // Run an immediate check on start
    void this.checkSchedules();
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    // console.log("Routine scheduler stopped");
  }

  private async checkSchedules(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const routines = await loadRoutines();
      const now = new Date();

      for (const routine of routines) {
        if (!routine.schedule?.enabled) continue;
        
        const nextRun = routine.nextRun ? new Date(routine.nextRun) : null;
        
        // If nextRun is not set, calculate it and save
        if (!nextRun) {
          const calculatedNext = this.calculateNextRun(routine.schedule);
          await updateRoutine(routine.id, { nextRun: calculatedNext });
          continue;
        }

        // Check if it's time to run
        if (nextRun <= now) {
          // console.log(`[scheduler] Running scheduled routine: @${routine.name}`);
          
          // Run headless agent
          void this.runHeadlessRoutine(routine);
          
          // Calculate next run time
          const calculatedNext = this.calculateNextRun(routine.schedule);
          await updateRoutine(routine.id, {
            lastRun: now.toISOString(),
            nextRun: calculatedNext,
          });
        }
      }
    } catch (err) {
      // console.error("[scheduler] Error checking schedules:", err);
    } finally {
      this.running = false;
    }
  }

  private async runHeadlessRoutine(routine: Routine): Promise<void> {
    const headlessTab = new Tab("headless-sched-" + Date.now(), "about:blank");
    try {
      const agent = new HeadlessAgent();
      await agent.run({
        goal: routine.query,
        hiddenTab: headlessTab,
        emit: (event) => {
          // console.log(`[scheduler] Routine @${routine.name} event:`, event.type);
        }
      });
      // console.log(`[scheduler] Completed routine: @${routine.name}`);
    } catch (err) {
      // console.error(`[scheduler] Error running routine @${routine.name}:`, err);
    } finally {
      headlessTab.destroy();
    }
  }

  private calculateNextRun(schedule: Routine["schedule"]): string {
    if (!schedule) return new Date().toISOString();
    
    const now = new Date();
    const next = new Date(now);

    if (schedule.type === "hourly") {
      next.setHours(next.getHours() + 1);
    } else if (schedule.type === "daily" && schedule.time) {
      const [hours, minutes] = schedule.time.split(":").map(Number);
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
    } else if (schedule.type === "weekly" && schedule.time && schedule.dayOfWeek !== undefined) {
      const [hours, minutes] = schedule.time.split(":").map(Number);
      next.setHours(hours, minutes, 0, 0);
      
      // Calculate days until target day of week
      let daysUntil = (schedule.dayOfWeek - next.getDay() + 7) % 7;
      if (daysUntil === 0 && next <= now) {
        daysUntil = 7;
      }
      next.setDate(next.getDate() + daysUntil);
    }
    
    return next.toISOString();
  }
}

export const scheduler = new RoutineScheduler();
