import React, { useState, useEffect, useRef } from 'react'
import { X, Maximize2, Sparkle, Square } from 'lucide-react'
import { MiniReport } from './MiniReport'

type AgentStepAction = Record<string, unknown>
type StepRow = { step: number; label: string }
type PagePreview = { dataUrl: string; url: string; title: string }

function hostnameOnly(url: string): string {
  try {
    const h = new URL(url).hostname
    return h.replace(/^www\./, '')
  } catch {
    return url.slice(0, 48)
  }
}

function humanizeStep(action: AgentStepAction): string {
  const a = action.action
  if (typeof a !== 'string') return 'Ran an action'
  switch (a) {
    case 'navigate': {
      const u = action.url
      return typeof u === 'string' ? `Opened ${hostnameOnly(u)}` : 'Navigated'
    }
    case 'new_tab': {
      const u = action.url
      return typeof u === 'string' && u
        ? `New tab → ${hostnameOnly(u)}`
        : 'Opened new tab'
    }
    case 'read_page':
      return 'Read page'
    case 'save_report':
      return 'Saved for report'
    case 'wait':
      return typeof action.ms === 'number' ? `Waited ${action.ms}ms` : 'Waited'
    case 'done':
      return 'Finished'
    default:
      return a.replace(/_/g, ' ')
  }
}

export const MiniApp: React.FC = () => {
  const [query, setQuery] = useState('')
  const [searchUrl, setSearchUrl] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [agentSteps, setAgentSteps] = useState<StepRow[]>([])
  const [pagePreview, setPagePreview] = useState<PagePreview | null>(null)
  const [agentPhase, setAgentPhase] = useState<'idle' | 'working' | 'done'>('idle')
  const [agentConclusion, setAgentConclusion] = useState('')
  const [agentReportUrl, setAgentReportUrl] = useState('')
  const [reportError, setReportError] = useState('')
  const [showFullReport, setShowFullReport] = useState(false)

  const webviewRef = useRef<Electron.WebviewTag>(null)
  const stepsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const input = document.getElementById('mini-search-input')
    if (input) input.focus()
  }, [])

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [agentSteps])

  useEffect(() => {
    if (!window.miniAPI) return
    const cleanup = window.miniAPI.onAgentEvent((event: {
      type: string
      message?: string
      action?: AgentStepAction
      step?: number
      text?: string
      url?: string
      dataUrl?: string
      title?: string
    }) => {
      if (event.type === 'step' && event.action && event.step != null) {
        setAgentSteps(prev => [
          ...prev,
          { step: event.step!, label: humanizeStep(event.action!) },
        ])
      } else if (event.type === 'page_preview' && event.dataUrl && event.url) {
        setPagePreview({
          dataUrl: event.dataUrl,
          url: event.url,
          title: event.title ?? '',
        })
      } else if (event.type === 'conclusion' && event.text) {
        setAgentConclusion(event.text)
      } else if (event.type === 'report' && event.url) {
        setAgentReportUrl(event.url)
      } else if (event.type === 'report_error' && event.message) {
        setReportError(event.message)
        setAgentPhase('done')
      } else if (event.type === 'error' && event.message) {
        setReportError(event.message)
        setAgentPhase('done')
      } else if (event.type === 'finished') {
        setAgentPhase('done')
      }
    })
    return cleanup
  }, [])

  useEffect(() => {
    if (isAgentMode && showFullReport) return
    const webview = webviewRef.current
    if (!webview) return

    const handleNavigate = (e: { url: string }) => {
      setSearchUrl(e.url)
    }

    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleNavigate)

    return () => {
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleNavigate)
    }
  }, [isExpanded, isAgentMode, showFullReport])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    
    if (isAgentMode) {
      setAgentSteps([])
      setPagePreview(null)
      setAgentPhase('working')
      setAgentConclusion('')
      setAgentReportUrl('')
      setReportError('')
      setShowFullReport(false)
      setIsExpanded(true)
      if (window.miniAPI) {
        void window.miniAPI.startHeadlessAgent(query.trim())
      }
      return
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
      void window.miniAPI.search()
    }
  }

  const handleClose = () => {
    if (isExpanded) {
      if (window.miniAPI) void window.miniAPI.collapse()
      setIsExpanded(false)
      setQuery('')
      setSearchUrl('')
      setAgentReportUrl('')
      setReportError('')
      setAgentPhase('idle')
      setAgentSteps([])
      setPagePreview(null)
      setShowFullReport(false)
    } else {
      if (window.miniAPI) void window.miniAPI.quitApp()
    }
  }

  const handleExpandToMain = () => {
    if (window.miniAPI) {
      void window.miniAPI.exitMiniMode(isAgentMode && showFullReport ? agentReportUrl : searchUrl)
    }
  }

  const handleOpenReport = () => {
    setShowFullReport(true)
    if (window.miniAPI) void window.miniAPI.expandFull()
  }

  const handleStopAgent = () => {
    if (window.miniAPI) {
      void window.miniAPI.stopHeadlessAgent()
      setAgentPhase('done')
    }
  }

  return (
    <div className="flex flex-col w-full h-screen items-center app-region-no-drag">
      
      <form 
        onSubmit={handleSearch} 
        className="flex w-[400px] h-[42px] items-center justify-center bg-white dark:bg-black/60 rounded-full px-6 app-region-drag"
      >
        <div id='dock-logo' className="flex items-center justify-center mr-3 w-5 h-5 flex-shrink-0 opacity-80 app-region-drag">
          <img src="/icon.svg" alt="Logo" className="w-full h-full object-contain pointer-events-none" onError={(e) => {
            (e.target as HTMLImageElement).src = '/icon.png'
          }} />
        </div>

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

      {isExpanded && isAgentMode && showFullReport && (
        <div className="w-[750px] flex-1 mt-4 rounded-xl overflow-hidden shadow-2xl border border-gray-200 dark:border-white/10 bg-white relative">
          <div className="w-full h-full overflow-y-auto report-scroll-container">
            <MiniReport 
              reportId={(() => {
                try { return new URLSearchParams(agentReportUrl.split('?')[1]).get('id') || '' }
                catch { return '' }
              })()} 
            />
          </div>
        </div>
      )}

      {isExpanded && isAgentMode && !showFullReport && (
        <div className="w-[420px] mt-2 rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-950/95">
          {agentPhase === 'working' ? (
            <div className="flex gap-2.5 p-2.5 h-[168px]">
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex items-center gap-1.5 mb-1.5 shrink-0">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Working</span>
                </div>
                <ul className="flex-1 overflow-y-auto min-h-0">
                  {agentSteps.length === 0 ? (
                    <li className="text-xs text-gray-400">Starting…</li>
                  ) : (
                    agentSteps.map((s) => (
                      <li
                        key={s.step}
                        className="flex items-baseline gap-1.5 py-0.5 text-xs leading-snug"
                      >
                        <span className="text-gray-400 shrink-0 w-4 text-right tabular-nums">{s.step}</span>
                        <span className="text-gray-600 dark:text-gray-300 truncate">{s.label}</span>
                      </li>
                    ))
                  )}
                  <div ref={stepsEndRef} />
                </ul>
              </div>

              {pagePreview && (
                <div
                  className="w-[96px] h-[72px] shrink-0 rounded-md overflow-hidden border border-gray-200/80 dark:border-white/10 self-start mt-4"
                  title={pagePreview.title || pagePreview.url}
                >
                  <img
                    src={pagePreview.dataUrl}
                    alt=""
                    className="w-full h-full object-cover object-top"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Done</span>
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 leading-relaxed">
                    {agentConclusion || 'The agent finished the task.'}
                  </p>
                </div>
                {pagePreview && (
                  <div className="w-[88px] h-[66px] shrink-0 rounded-md overflow-hidden border border-gray-200/80 dark:border-white/10">
                    <img
                      src={pagePreview.dataUrl}
                      alt=""
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                {agentSteps.length > 0 && (
                  <span className="text-xs text-gray-400 truncate">
                    {agentSteps.length} step{agentSteps.length !== 1 ? 's' : ''}
                  </span>
                )}
                <div className="ml-auto shrink-0">
                  {agentReportUrl ? (
                    <button
                      onClick={handleOpenReport}
                      className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded-md transition-colors"
                    >
                      Open Report
                    </button>
                  ) : reportError ? (
                    <span className="text-xs text-red-500 line-clamp-1 max-w-[180px]" title={reportError}>
                      {reportError}
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">No report</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
