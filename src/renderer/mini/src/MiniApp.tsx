import React, { useState, useEffect } from 'react'
import { X, Maximize2 } from 'lucide-react'

export const MiniApp: React.FC = () => {
  const [query, setQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  // Auto-focus input on mount
  useEffect(() => {
    const input = document.getElementById('mini-search-input')
    if (input) input.focus()
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    
    let finalUrl = query.trim()
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        if (finalUrl.includes('.') && !finalUrl.includes(' ')) {
            finalUrl = `https://${finalUrl}`
        } else {
            finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`
        }
    }
    
    if (window.miniAPI) {
        window.miniAPI.search(finalUrl)
        setIsExpanded(true)
    }
  }

  const handleClose = () => {
    if (isExpanded) {
        // Collapse the search result and clear the text
        if (window.miniAPI) window.miniAPI.collapse()
        setIsExpanded(false)
        setQuery('')
    } else {
        // Close Blueberry
        if (window.miniAPI) window.miniAPI.quitApp()
    }
  }

  const handleExpandToMain = () => {
    if (window.miniAPI) {
        window.miniAPI.exitMiniMode()
    }
  }

  return (
    <div className="flex w-full h-[80px] items-center justify-center p-4 bg-transparent app-region-no-drag">
      
      {/* Pill Container */}
      <form onSubmit={handleSearch} className="flex w-full h-[48px] items-center bg-white/80 dark:bg-black/60 backdrop-blur-xl rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.12)] px-4 app-region-drag border border-gray-100/50 dark:border-white/10">
        
        {/* Blueberry Logo */}
        <div className="flex items-center justify-center mr-3 w-6 h-6 flex-shrink-0 opacity-80">
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
          placeholder="Search or type URL"
          className="flex-1 bg-transparent border-none outline-none text-base text-gray-800 dark:text-gray-100 placeholder:text-gray-400 app-region-no-drag font-medium"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Actions */}
        <div className="flex items-center ml-2 gap-1 flex-shrink-0 app-region-no-drag">
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
    </div>
  )
}
