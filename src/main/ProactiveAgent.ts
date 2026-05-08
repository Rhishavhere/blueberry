import { desktopCapturer, WebContents } from "electron";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export class ProactiveAgent {
  private intervalId: NodeJS.Timeout | null = null;
  private screenshots: string[] = [];
  private sender: WebContents | null = null;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private onSuggestion: ((text: string, images: string[]) => void) | null = null;

  public start(sender: WebContents, onSuggestion?: (text: string, images: string[]) => void) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.sender = sender;
    if (onSuggestion) this.onSuggestion = onSuggestion;
    this.screenshots = [];
    this.runLoop();
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.screenshots = [];
    this.isProcessing = false;
  }

  public setProcessing(val: boolean) {
    this.isProcessing = val;
    if (!val) {
      this.screenshots = [];
    }
  }

  private runLoop() {
    let count = 0;
    
    // Run every 20 seconds
    this.intervalId = setInterval(async () => {
      if (!this.isRunning || this.isProcessing) return;

      const img = await this.captureScreen();
      if (img) {
        this.screenshots.push(img);
        console.log(`[ProactiveAgent] Captured screenshot ${this.screenshots.length}/3`);
      }
      count++;

      if (count >= 3) {
        console.log("[ProactiveAgent] Got all 3 ss, sending 3 screenshots to Anthropic...");
        this.isProcessing = true;
        const helpText = await this.getProactiveSuggestion(this.screenshots);
        
        if (helpText && helpText.trim() && this.sender) {
          console.log("[ProactiveAgent] Suggestion:", helpText);
          if (this.onSuggestion) {
            this.onSuggestion(helpText, [...this.screenshots]);
          } else {
            this.sender.send("proactive-suggestion", { 
              text: helpText, 
              images: [...this.screenshots] 
            });
          }
        } else {
          console.log("[ProactiveAgent] No suggestion returned or returned empty.");
          this.isProcessing = false; // Reset if no suggestion
        }
        
        // Reset for next minute
        this.screenshots = [];
        count = 0;
      }
    }, 3000);
  }

  private async captureScreen(): Promise<string | null> {
    try {
      const sources = await desktopCapturer.getSources({ 
        types: ["screen"], 
        thumbnailSize: { width: 1280, height: 720 } 
      });
      
      if (sources.length > 0) {
        return sources[0].thumbnail.toDataURL();
      }
    } catch (e) {
      console.error("[ProactiveAgent] Failed to capture screen:", e);
    }
    return null;
  }

  private async getProactiveSuggestion(images: string[]): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[ProactiveAgent] ANTHROPIC_API_KEY is not set.");
      return null;
    }

    const modelId = process.env.AGENT_MODEL || "claude-3-5-haiku-20241022";
    try {
      const { text } = await generateText({
        model: anthropic(modelId),
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: "Analyze these 3 sequential screenshots taken 20 seconds apart. Suggest a short help message (1-2 sentences) if you see the user working on something specific. Format: 'I see you are [action]. Do you want me to help ?'. Do not explain why you are suggesting or talk about screenshots in the response." 
              },
              ...images.map(img => ({ 
                type: "image" as const, 
                image: img 
              }))
            ]
          }
        ]
      });
      return text;
    } catch (e) {
      console.error("[ProactiveAgent] Anthropic API error (in getProactiveSuggestion):", e);
      return null;
    }
  }

  public async callAnthropic(images: string[], suggestionText: string): Promise<string | null> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[ProactiveAgent] ANTHROPIC_API_KEY is not set.");
      return null;
    }

    this.isProcessing = true;
    const modelId = process.env.AGENT_MODEL || "claude-3-5-haiku-20241022";
    try {
      const { text } = await generateText({
        model: anthropic(modelId),
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `You previously suggested: "${suggestionText}". The user clicked "Sure". Based on these 3 sequential screenshots, provide the help you can offer. Be highly relevant to what they are doing. You cannot perform action on their behalf , the only help you can provide is by generating text output (info, analysis, tables, code, etc). You dont get any more chances to talk with the user. so its your best bet with what you can help. provide directly. ` 
              },
              ...images.map(img => ({ 
                type: "image" as const, 
                image: img 
              }))
            ]
          }
        ]
      });
      return text;
    } catch (e) {
      console.error("[ProactiveAgent] Anthropic API error:", e);
      return null;
    } finally {
      this.isProcessing = false;
    }
  }
}
