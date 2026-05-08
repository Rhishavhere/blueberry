import { desktopCapturer, WebContents } from "electron";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export class ProactiveAgent {
  private intervalId: NodeJS.Timeout | null = null;
  private screenshots: string[] = [];
  private sender: WebContents | null = null;
  private isRunning: boolean = false;
  private isProcessing: boolean = false;

  public start(sender: WebContents) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.sender = sender;
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
        console.log("[ProactiveAgent] 60 seconds passed, sending 3 screenshots to Gemini...");
        this.isProcessing = true;
        const helpText = await this.callGemini(this.screenshots);
        
        if (helpText && helpText.trim() && this.sender) {
          console.log("[ProactiveAgent] Gemini suggestion:", helpText);
          this.sender.send("proactive-suggestion", { 
            text: helpText, 
            images: [...this.screenshots] // send a copy
          });
        } else {
          console.log("[ProactiveAgent] Gemini did not return a suggestion or returned empty.");
          this.isProcessing = false; // Reset if no suggestion
        }
        
        // Reset for next minute
        this.screenshots = [];
        count = 0;
      }
    }, 20000);
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

  private async callGemini(images: string[]): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY; // Fallback or assume GEMINI_API_KEY
    if (!apiKey) {
      console.error("[ProactiveAgent] GEMINI_API_KEY is not set.");
      return null;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const parts = [
      { text: "Analyze these 3 sequential screenshots taken 20 seconds apart. Suggest a short help message (1-2 sentences) if you see the user working on something specific. Format: 'I see you are [action]. Do you want me to help ?'. If they are not doing anything specific or you can't tell, return empty." }
    ];

    for (const img of images) {
      const base64Data = img.split(",")[1];
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: base64Data
        }
      } as any);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts }] })
      });
      
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return text || null;
    } catch (e) {
      console.error("[ProactiveAgent] Gemini API error:", e);
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
    try {
      const { text } = await generateText({
        model: anthropic("claude-3-5-sonnet-20241022"),
        messages: [
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `You previously suggested: "${suggestionText}". The user clicked "Sure". Based on these 3 sequential screenshots, provide the help you can offer. Be highly relevant to what they are doing. You cannot perform action on their behalf , the only help you can provide is by generating text output (info, analysis, tables, code, etc). ` 
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
