import React, { useEffect, useState } from 'react'
import { ChatProvider, useChat } from './contexts/ChatContext'
import { Chat } from './components/Chat'
import { AgentPanel } from './components/AgentPanel'
import { useDarkMode } from '@common/hooks/useDarkMode'
import { cn } from '@common/lib/utils'

type SidebarRail = 'chat' | 'agent'

const SidebarContent: React.FC = () => {
    const { isDarkMode } = useDarkMode()
    const { messages } = useChat()
    const [rail, setRail] = useState<SidebarRail>('chat')
    const [agentRunRequest, setAgentRunRequest] = useState<{ id: string; goal: string } | null>(null)

    const isCleanSlate = messages.length === 0

    // Apply dark mode class to the document
    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])

    useEffect(() => {
        const onHomeAgentRun = (payload: { goal: string; messageId: string }) => {
            const goal = payload?.goal?.trim()
            if (!goal) return
            setRail('agent')
            setAgentRunRequest({
                id: payload.messageId || `${Date.now()}`,
                goal,
            })
        }
        window.sidebarAPI.onHomeAgentRun(onHomeAgentRun)
        return () => {
            window.sidebarAPI.removeHomeAgentRunListener()
        }
    }, [])

    return (
        <div className="h-screen flex flex-col bg-background border-l border-border relative">
            {rail === 'chat' && isCleanSlate && (
                <div
                    className="absolute inset-0 pointer-events-none opacity-25 bg-bottom bg-no-repeat bg-[length:auto_50%] sm:bg-contain"
                    style={{ backgroundImage: "url('/look.png')" }}
                    aria-hidden
                />
            )}
            <div className="flex shrink-0 gap-1 p-2 border-b border-border">
                <button
                    type="button"
                    onClick={() => setRail('chat')}
                    className={cn(
                        'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                        rail === 'chat'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                    )}
                >
                    Chat
                </button>
                <button
                    type="button"
                    onClick={() => setRail('agent')}
                    className={cn(
                        'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                        rail === 'agent'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted'
                    )}
                >
                    Agent
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {rail === 'chat' ? (
                    <Chat />
                ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <AgentPanel externalRunRequest={agentRunRequest} />
                    </div>
                )}
            </div>
        </div>
    )
}

export const SidebarApp: React.FC = () => {
    return (
        <ChatProvider>
            <SidebarContent />
        </ChatProvider>
    )
}

