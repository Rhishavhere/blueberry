import React, { useState, useEffect, useRef } from 'react'
import { X, Maximize2, Sparkle, Square } from 'lucide-react'
import { MiniReport } from './MiniReport'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export const MiniApp: React.FC = () => {
  const [query, setQuery] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  
  // Agent States
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [agentLogs, setAgentLogs] = useState<string[]>([])
  const [agentPhase, setAgentPhase] = useState<'idle' | 'working' | 'done'>('idle')
  const [agentConclusion, setAgentConclusion] = useState('')
  const [agentReportUrl, setAgentReportUrl] = useState('')
  const [reportError, setReportError] = useState('')
  const [showFullReport, setShowFullReport] = useState(false)

  // Proactive States
  const [proactiveHelp, setProactiveHelp] = useState<string | null>(null)
  const [proactiveImages, setProactiveImages] = useState<string[]>([])
  const [proactiveResult, setProactiveResult] = useState<string | null>(null)
  const [isProactiveWorking, setIsProactiveWorking] = useState(false)

  const webviewRef = useRef<Electron.WebviewTag>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  // Auto-focus input on mount
  useEffect(() => {
    const input = document.getElementById('mini-search-input')
    if (input) input.focus()
  }, [])

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [agentLogs])

  // Agent Event Listener
  useEffect(() => {
    if (!window.miniAPI) return;
    const cleanup = window.miniAPI.onAgentEvent((event: any) => {
      if (event.type === 'log') {
        setAgentLogs(prev => [...prev, event.message]);
      } else if (event.type === 'step') {
        setAgentLogs(prev => [...prev, `[Action] ${event.action.action}`]);
      } else if (event.type === 'conclusion') {
        setAgentConclusion(event.text);
      } else if (event.type === 'report') {
        setAgentReportUrl(event.url);
      } else if (event.type === 'report_error') {
        setAgentLogs(prev => [...prev, `[Report Error] ${event.message}`]);
        setReportError(event.message);
      } else if (event.type === 'error') {
        setAgentLogs(prev => [...prev, `[Error] ${event.message}`]);
        setReportError(event.message);
        setAgentPhase('done');
      } else if (event.type === 'finished') {
        setAgentPhase('done');
      }
    });
    return cleanup;
  }, []);

  // Proactive Suggestion Listener
  useEffect(() => {
    if (!window.miniAPI) return;
    // @ts-ignore
    const cleanup = window.miniAPI.onProactiveSuggestion((data: any) => {
      setProactiveHelp(data.text);
      setProactiveImages(data.images);
      setIsExpanded(true); // Expand dock to show help
    });
    return cleanup;
  }, []);

  // Sync webview navigation with React state (only in normal search mode)
  useEffect(() => {
    if (isAgentMode && showFullReport) return; // Don't sync URL in report mode
    const webview = webviewRef.current;
    if (!webview) return;

    const handleNavigate = (e: any) => {
      setSearchUrl(e.url);
    };

    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
    };
  }, [isExpanded, isAgentMode, showFullReport]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    
    if (isAgentMode) {
      setAgentLogs([])
      setAgentPhase('working')
      setAgentConclusion('')
      setAgentReportUrl('')
      setReportError('')
      setShowFullReport(false)
      setIsExpanded(true)
      if (window.miniAPI) {
          window.miniAPI.startHeadlessAgent(query.trim())
      }
      return;
    }
    
    let finalUrl = query.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
            finalUrl = `https://${finalUrl}`
        } else {
            finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}&hl=en`
        }
    }
    
    setSearchUrl(finalUrl)
    setIsExpanded(true)
    if (window.miniAPI) {
        window.miniAPI.search()
    }
  }

  const handleClose = () => {
    if (isExpanded) {
        if (window.miniAPI) window.miniAPI.collapse()
        setIsExpanded(false)
        setQuery('')
        setSearchUrl('')
        setAgentReportUrl('')
        setReportError('')
        setAgentPhase('idle')
        setShowFullReport(false)
    } else {
        if (window.miniAPI) window.miniAPI.quitApp()
    }
  }

  const handleExpandToMain = () => {
    if (window.miniAPI) {
        window.miniAPI.exitMiniMode(isAgentMode && showFullReport ? agentReportUrl : searchUrl)
    }
  }

  const handleOpenReport = () => {
    setShowFullReport(true)
    if (window.miniAPI) window.miniAPI.expandFull()
  }

  const handleStopAgent = () => {
    if (window.miniAPI) {
      window.miniAPI.stopHeadlessAgent();
      setAgentPhase('done');
      setAgentLogs(prev => [...prev, "[User] Agent stopped manually."]);
    }
  }

  const handleProactiveSure = async () => {
    setIsProactiveWorking(true);
    // @ts-ignore
    const result = await window.miniAPI.acceptProactive(proactiveImages, proactiveHelp);
    setProactiveResult(result);
    setIsProactiveWorking(false);
  }

  return (
    <div className="flex flex-col w-full h-screen items-center app-region-no-drag">
      
      {/* Pill Container (Dock) */}
      <form 
        onSubmit={handleSearch} 
        className="flex w-[400px] h-[42px] items-center justify-center bg-white dark:bg-black/60 rounded-full px-6 app-region-drag"
      >
        
        {/* Blueberry Logo */}
        <div id='dock-logo' className="flex items-center justify-center mr-3 w-5 h-5 flex-shrink-0 opacity-80 app-region-drag">
          <img src="/icon.svg" alt="Logo" className="w-full h-full object-contain pointer-events-none" onError={(e) => {
              (e.target as HTMLImageElement).src = '/icon.png';
          }} />
        </div>

        {/* Input */}
        <input
          id="mini-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={isAgentMode ? "Ask agent" : "Search"}
          className="flex-1 bg-transparent border-none outline-none text-md font-medium text-gray-600 dark:text-gray-100 placeholder:text-gray-400 app-region-no-drag"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Actions */}
        <div className="flex items-center ml-2 gap-1 flex-shrink-0 app-region-no-drag">
          {isAgentMode && agentPhase === 'working' ? (
            <button 
                type="button"
                onClick={handleStopAgent}
                title="Stop Agent"
                className="w-7 h-7 rounded-full bg-red-100 text-red-500 dark:bg-red-900/40 dark:text-red-400 hover:bg-red-200/40 dark:hover:bg-red-900/60 transition-colors focus:outline-none flex items-center justify-center"
            >
                <Square className="w-2 h-2" />
            </button>
          ) : (
            <button 
                type="button"
                onClick={() => setIsAgentMode(!isAgentMode)}
                title="Toggle Agent Mode"
                className={`w-7 h-7 rounded-full transition-colors focus:outline-none flex items-center justify-center ${isAgentMode ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
                <Sparkle className="w-4 h-4" />
            </button>
          )}
          <button 
              type="button"
              onClick={handleExpandToMain}
              title="Return to Main Window"
              className="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none flex items-center justify-center"
          >
              <Maximize2 className="w-4 h-4" />
          </button>
          <button 
              type="button"
              onClick={handleClose}
              title={isExpanded ? "Close Result" : "Close Mini Mode"}
              className="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none flex items-center justify-center"
          >
              <X className="w-4 h-4" />
          </button>
        </div>

      </form>

      {/* Embedded Webview Result (Normal Search) */}
      {isExpanded && !isAgentMode && (
        <div className="w-[750px] flex-1 mt-4 rounded-xl overflow-hidden shadow-2xl border border-gray-200 dark:border-white/10 bg-white">
          <webview 
            ref={webviewRef}
            src={searchUrl} 
            className="w-full h-full"
            // @ts-ignore
            allowpopups="true"
          />
        </div>
      )}

      {/* Agent Full Report React View */}
      {isExpanded && isAgentMode && showFullReport && (
        <div className="w-[750px] flex-1 mt-4 rounded-xl overflow-hidden shadow-2xl border border-gray-200 dark:border-white/10 bg-white relative">
          <div className="w-full h-full overflow-y-auto report-scroll-container">
            <MiniReport 
              reportId={(() => {
                try { return new URLSearchParams(agentReportUrl.split('?')[1]).get('id') || ''; }
                catch { return ''; }
              })()} 
            />
          </div>
        </div>
      )}

      {/* Proactive Help View */}
      {isExpanded && proactiveHelp && !proactiveResult && (
        <div className="w-[500px] mt-4 bg-white dark:bg-black/80 rounded-2xl shadow-xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkle className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-gray-800 dark:text-gray-200">Proactive Suggestion</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {isProactiveWorking ? "Generating help..." : proactiveHelp}
          </p>
          {!isProactiveWorking && (
            <div className="flex justify-end mt-2 gap-2">
              <button 
                onClick={() => {
                  setProactiveHelp(null);
                  setProactiveImages([]);
                  // @ts-ignore
                  window.miniAPI.dismissProactive();
                }}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium rounded-lg transition-colors"
              >
                No thanks
              </button>
              <button 
                onClick={handleProactiveSure}
                className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Sure
              </button>
            </div>
          )}
        </div>
      )}

      {/* Proactive Result View */}
      {isExpanded && proactiveResult && (
        <div className="w-[750px] flex-1 mt-4 rounded-xl overflow-hidden shadow-2xl border border-gray-200 dark:border-white/10 bg-white relative p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkle className="w-5 h-5 text-purple-500" />
              <span className="font-semibold text-gray-800 dark:text-gray-200">Proactive Help</span>
            </div>
            <button 
              onClick={() => {
                setProactiveResult(null);
                setProactiveHelp(null);
                setProactiveImages([]);
                // @ts-ignore
                window.miniAPI.dismissProactive();
              }}
              className="w-7 h-7 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors focus:outline-none flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="w-full h-full overflow-y-auto text-gray-700 dark:text-gray-200 text-sm leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{proactiveResult}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Agent Low Expanded View (Working or Conclusion) */}
      {isExpanded && isAgentMode && !showFullReport && (
        <div className="w-[500px] min-h-[120px] max-h-[220px] mt-4 bg-white dark:bg-black/80 rounded-2xl shadow-xl border border-gray-200 dark:border-white/10 flex flex-col overflow-hidden p-4">
          {agentPhase === 'working' ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Sparkle className="w-5 h-5 text-blue-500 animate-pulse" />
                <span className="font-semibold text-gray-800 dark:text-gray-200">Agents are on the case..</span>
              </div>
              <ul className="flex-1 overflow-y-auto py-2 pl-2">
                {agentLogs.map((log, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 px-10 py-2 text-sm leading-snug"
                  >
                    <div className="w-2 h-2 rounded-full bg-gray-400 shrink-0"></div>
                    <span className="text-gray-500 font-medium">{log}</span>
                  </li>
                ))}
                <div ref={logsEndRef} />
              </ul>
            </>
          ) : (
            <div className="flex flex-col h-full justify-between">
              <div className="flex items-center gap-2 mb-2">
                <Sparkle className="w-5 h-5 text-green-500" />
                <span className="font-semibold text-gray-800 dark:text-gray-200">Task Complete</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
                {agentConclusion || "The agent finished the research task."}
              </p>
              <div className="flex justify-end mt-2">
                {agentReportUrl ? (
                  <button 
                    onClick={handleOpenReport}
                    className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Open Full Report
                  </button>
                ) : reportError ? (
                  <span className="text-sm text-red-500 line-clamp-2 max-w-[300px]" title={reportError}>{reportError}</span>
                ) : (
                  <span className="text-sm text-gray-400">No report generated.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
