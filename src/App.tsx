import { useState, useEffect, useRef } from "react";
import { format, isToday, isYesterday } from "date-fns";
import DOMPurify from "dompurify";
import { supabase } from "./lib/supabase";
import { Send, Menu, Search, PenSquare, Paperclip, Mic, User, Sparkles, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Types
export interface Email {
  id: string;
  thread_id: string;
  message_id: string;
  in_reply_to: string | null;
  from_address: string;
  to_address: string;
  subject: string;
  html_body: string;
  text_body: string;
  folder: string;
  created_at: string;
}

export interface Thread {
  threadId: string;
  subject: string;
  lastUpdated: string;
  emails: Email[];
}

export default function App() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [composerFromPrefix, setComposerFromPrefix] = useState("hello");
  const [composerTo, setComposerTo] = useState("");
  const [composerSubject, setComposerSubject] = useState("");
  const [composerBody, setComposerBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchThreads();
    
    // Subscribe to new emails
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
        },
        (payload) => {
          console.log('New email received!', payload);
          fetchThreads(); // Simple reload for now, could be optimized
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    // Scroll to bottom when thread changes or new emails arrive
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeThreadId, threads]);

  const fetchThreads = async () => {
    try {
      const res = await fetch('/api/emails');
      if (!res.ok) throw new Error('Failed to fetch emails');
      const emails: Email[] = await res.json();
      
      if (!emails || emails.length === 0) return;

      // Group by thread_id
      const grouped = emails.reduce((acc: Record<string, Thread>, email: Email) => {
        if (!acc[email.thread_id]) {
          acc[email.thread_id] = {
            threadId: email.thread_id,
            subject: email.subject,
            lastUpdated: email.created_at,
            emails: []
          };
        }
        acc[email.thread_id].emails.push(email);
        // Update lastUpdated to newest
        if (new Date(email.created_at) > new Date(acc[email.thread_id].lastUpdated)) {
          acc[email.thread_id].lastUpdated = email.created_at;
        }
        return acc;
      }, {});

      const sortedThreads = Object.values(grouped).sort((a, b) => 
        new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
      );

      setThreads(sortedThreads);
      
      if (!activeThreadId && sortedThreads.length > 0) {
        setActiveThreadId(sortedThreads[0].threadId);
      }
    } catch (error) {
      console.error("Error fetching emails:", error);
    }
  };

  const composerRef = useRef<HTMLTextAreaElement>(null);
  
  useEffect(() => {
    // Auto-expand textarea
    if (composerRef.current) {
      composerRef.current.style.height = "56px"; // Reset to min-height
      const scrollHeight = composerRef.current.scrollHeight;
      composerRef.current.style.height = scrollHeight + "px";
    }
  }, [composerBody]);

  const handleSend = async () => {
    if (!composerTo && !activeThread) return; // Need 'to' for new threads
    if (!composerSubject && !activeThread) return;
    if (!composerBody.trim()) return;

    setIsSending(true);

    try {
      // If active thread, we are replying
      let to = composerTo;
      let subject = composerSubject;
      let replyToMessageId = undefined;
      
      if (activeThread) {
         // Auto-fill for reply
         const lastEmail = activeThread.emails[activeThread.emails.length - 1];
         // If last email was from me, I'm replying to whoever I sent it to, else replying to whoever sent it to me
         const imSender = lastEmail.from_address.endsWith('@auraplot.site');
         to = imSender ? lastEmail.to_address : lastEmail.from_address;
         subject = lastEmail.subject.startsWith('Re:') ? lastEmail.subject : `Re: ${lastEmail.subject}`;
         replyToMessageId = lastEmail.message_id;
      }

      const res = await fetch("/api/emails/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromPrefix: composerFromPrefix,
          to,
          subject,
          htmlBody: composerBody,
          replyToMessageId,
          threadId: activeThread?.threadId
        })
      });

      if (res.ok) {
        setComposerBody("");
        if (!activeThread) {
           setComposerTo("");
           setComposerSubject("");
        }
        await fetchThreads();
      } else {
        const err = await res.json();
        alert("Failed to send: " + err.error);
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setIsSending(false);
    }
  };

  const activeThread = threads.find(t => t.threadId === activeThreadId);

  const formatThreadDate = (dateString: string) => {
    const d = new Date(dateString);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "MMM d");
  };

  const isMyDomain = (emailString: string) => {
    return emailString.toLowerCase().includes('@auraplot.site');
  };

  return (
    <div className="flex h-screen w-full bg-[#F5F4F0] text-[#1A1A1A] font-sans overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-72 bg-[#E8E3DA] border-r border-black/10 flex flex-col shrink-0 transition-all duration-300">
        <div className="p-6 border-b border-black/10">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-black text-white rounded-lg flex items-center justify-center shadow-inner">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="font-semibold text-lg tracking-tight font-sans text-[#1A1A1A]">Epistle</span>
          </div>
          <button 
            className="w-full flex items-center gap-3 px-4 py-2 bg-[#F5F4F0] border border-black/10 rounded-xl text-sm font-medium hover:bg-black/5 shadow-sm transition-colors text-[#1A1A1A]"
            onClick={() => setActiveThreadId(null)}
          >
            <PenSquare className="w-[18px] h-[18px] text-[#1A1A1A]/70" /> New thread
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 no-scrollbar">
          <div className="px-3 py-2 text-[11px] font-bold text-[#1A1A1A]/50 uppercase tracking-wider font-sans">Threads</div>
          {threads.map(thread => (
            <button
              key={thread.threadId}
              onClick={() => setActiveThreadId(thread.threadId)}
              className={`w-full text-left p-3 rounded-xl flex flex-col transition-colors group ${
                activeThreadId === thread.threadId 
                  ? "bg-black/5" 
                  : "hover:bg-black/5"
              }`}
            >
              <div className="text-sm font-medium truncate w-full text-[#1A1A1A] font-sans">
                {thread.subject || "(No subject)"}
              </div>
              <div className="text-xs text-[#1A1A1A]/70 truncate w-full mt-0.5 font-sans">
                {(() => {
                   const lastUser = thread.emails[thread.emails.length - 1];
                   return isMyDomain(lastUser.from_address) ? 'You' : lastUser.from_address.split('@')[0];
                })()}
              </div>
              <div className="text-[10px] text-[#1A1A1A]/60 mt-1 uppercase tracking-wider font-mono">
                {formatThreadDate(thread.lastUpdated)}
              </div>
            </button>
          ))}
        </div>
        
        {/* User profile tiny area */}
        <div className="p-4 border-t border-black/10">
          <div className="flex items-center gap-3 px-1">
             <div className="w-8 h-8 rounded-full bg-[#1A1A1A]/10 flex items-center justify-center font-bold text-xs text-[#1A1A1A] tracking-wider">
                EP
             </div>
             <div className="flex-1 min-w-0">
               <div className="text-xs font-semibold truncate text-[#1A1A1A] font-sans">auraplot.site</div>
               <div className="text-[10px] text-[#1A1A1A]/60 uppercase tracking-wider truncate font-mono">System Admin</div>
             </div>
          </div>
        </div>
      </aside>

      {/* Main Mail/Chat Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[#F5F4F0]">
        
        {activeThread ? (
          <>
            <header className="h-14 border-b border-black/10 flex items-center justify-between px-8 bg-[#F5F4F0]/90 backdrop-blur-sm sticky top-0 z-10 shrink-0">
              <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-[#1A1A1A] truncate max-w-lg font-sans">{activeThread.subject}</h2>
                <span className="px-2 py-0.5 bg-[#E8E3DA] border border-black/10 rounded text-[10px] font-medium text-[#1A1A1A]/70 uppercase tracking-widest font-mono">Inbox</span>
              </div>
            </header>

            <ScrollArea className="flex-1 w-full no-scrollbar shrink-0">
              <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-40 p-8">
                {activeThread.emails.map((email, idx) => {
                  const isMe = isMyDomain(email.from_address) || email.folder === 'sent';
                  
                  return isMe ? (
                    <div key={email.id} className="flex gap-4 items-start">
                      <div className="flex-1 flex flex-col items-end space-y-2">
                        <div className="text-[11px] font-bold text-[#1A1A1A]/60 uppercase tracking-widest text-right font-mono">
                          You (via {email.from_address})
                        </div>
                        <div className="text-[15px] leading-relaxed text-[#1A1A1A] max-w-2xl bg-[#E8E3DA] p-5 rounded-2xl rounded-tr-none border border-black/10 shadow-sm whitespace-pre-wrap break-words font-serif">
                          {email.text_body || email.html_body.replace(/<[^>]*>?/gm, '')}
                        </div>
                        <div className="text-[10px] text-[#1A1A1A]/60 font-mono uppercase tracking-widest">
                          {format(new Date(email.created_at), "h:mm a")}
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-[#E8E3DA] border border-black/10 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-[#1A1A1A] shadow-inner tracking-widest mt-1 uppercase">
                        EP
                      </div>
                    </div>
                  ) : (
                    <div key={email.id} className="flex gap-4 items-start">
                      <div className="w-8 h-8 rounded-full bg-[#1A1A1A] border border-[#1A1A1A] text-[#F5F4F0] flex items-center justify-center flex-shrink-0 text-[10px] font-bold uppercase mt-1 tracking-widest">
                        {email.from_address.charAt(0)}
                      </div>
                      <div className="flex-1 space-y-2">
                        <div className="text-[11px] font-bold text-[#1A1A1A]/60 uppercase tracking-widest font-mono">
                          {email.from_address}
                        </div>
                        <div className="text-[15px] leading-relaxed text-[#1A1A1A] max-w-2xl bg-[#F5F4F0] p-5 rounded-2xl rounded-tl-none border border-black/10">
                           <div className="markdown-body claud-html-render" 
                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(email.html_body || email.text_body) }} 
                           />
                        </div>
                        <div className="text-[10px] text-[#1A1A1A]/60 font-mono uppercase tracking-widest">
                          {format(new Date(email.created_at), "h:mm a")}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} className="h-4" />
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full max-w-3xl mx-auto w-full px-8 gap-6 pb-20">
             <div className="w-16 h-16 bg-[#E8E3DA] border border-black/10 rounded-3xl flex items-center justify-center shadow-sm">
                <Sparkles className="w-7 h-7 text-[#1A1A1A]/70" strokeWidth={1.5} />
             </div>
             <h2 className="text-[22px] font-medium text-[#1A1A1A] font-serif tracking-tight mt-2">How can I help you today?</h2>
             
             {/* New thread metadata inputs */}
             <div className="w-full max-w-[600px] flex flex-col gap-3 mt-4">
                <Input 
                   placeholder="To: someone@example.com" 
                   value={composerTo} 
                   onChange={e => setComposerTo(e.target.value)} 
                   className="bg-[#E8E3DA] border-black/10 shadow-sm text-sm h-12 rounded-xl focus-visible:ring-black/20 text-[#1A1A1A] font-sans"
                />
                <Input 
                   placeholder="Subject" 
                   value={composerSubject} 
                   onChange={e => setComposerSubject(e.target.value)} 
                   className="bg-[#E8E3DA] border-black/10 shadow-sm text-sm h-12 font-medium rounded-xl focus-visible:ring-black/20 text-[#1A1A1A] font-sans"
                />
             </div>
          </div>
        )}

        {/* Floating Bottom Composer */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F5F4F0] via-[#F5F4F0] to-transparent">
           <div className="max-w-4xl mx-auto">
             
             <div className="bg-[#E8E3DA] border border-black/10 rounded-2xl shadow-lg">
                 <div className="px-4 py-2 border-b border-black/10 flex items-center gap-2">
                   <span className="text-[10px] font-bold text-[#1A1A1A]/50 uppercase tracking-widest font-mono">From</span>
                   <div className="flex items-center gap-1 bg-[#F5F4F0] border border-black/10 rounded-md px-2 py-0.5 shadow-sm">
                      <input 
                        type="text" 
                        value={composerFromPrefix}
                        onChange={e => setComposerFromPrefix(e.target.value)}
                        className="bg-transparent text-xs font-medium w-16 focus:outline-none text-[#1A1A1A] font-sans"
                      />
                      <span className="text-xs text-[#1A1A1A]/60 select-none font-sans">@auraplot.site</span>
                   </div>
                 </div>
                 
                 <div className="p-3 sm:p-4 flex gap-4 items-end relative">
                    <Textarea 
                      ref={composerRef}
                      placeholder={activeThread ? "Reply to this thread..." : "Type your message here..."}
                      className="flex-1 bg-transparent border-none resize-none focus:ring-0 text-[15px] py-1 placeholder-[#1A1A1A]/50 shadow-none min-h-[48px] max-h-[30vh] overflow-y-auto pr-16 text-[#1A1A1A] font-serif"
                      value={composerBody}
                      onChange={e => setComposerBody(e.target.value)}
                      onKeyDown={e => {
                         if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                           handleSend();
                         }
                      }}
                    />
                    <button 
                        onClick={handleSend}
                        disabled={isSending || !composerBody.trim()}
                        className="absolute right-4 bottom-4 bg-black text-white p-2 rounded-xl hover:bg-black/80 transition-colors flex items-center justify-center h-10 w-10 shrink-0 disabled:bg-[#1A1A1A]/10 disabled:text-[#1A1A1A]/40"
                    >
                        <Send className="w-[18px] h-[18px] relative -left-[1px] top-[1px]" />
                    </button>
                 </div>
             </div>

             <div className="text-center mt-3">
               <p className="text-[10px] text-[#1A1A1A]/50 font-mono uppercase tracking-widest">Email client powered by Resend API and Supabase</p>
             </div>
           </div>
        </div>

      </main>
    </div>
  );
}

