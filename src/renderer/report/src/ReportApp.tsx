import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Components } from "react-markdown";
import { Download, Clock, ChevronUp } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Loaded = {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
};

type TocEntry = { id: string; text: string; level: number };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function estimateReadTime(markdown: string): number {
  const words = markdown.trim().split(/\s+/).length;
  return Math.max(1, Math.round(words / 300));
}

function extractToc(markdown: string): TocEntry[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const entries: TocEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(markdown)) !== null) {
    entries.push({
      level: match[1].length,
      text: match[2].trim(),
      id: slugify(match[2].trim()),
    });
  }
  return entries;
}

// ─── Markdown Components ──────────────────────────────────────────────────────

function makeMarkdownComponents(headingCounterRef: React.MutableRefObject<Record<string, number>>): Components {
  const HeadingTag =
    (Tag: "h1" | "h2" | "h3") =>
    ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
      const text = String(children ?? "");
      const base = slugify(text);
      headingCounterRef.current[base] = (headingCounterRef.current[base] ?? 0) + 1;
      const id = headingCounterRef.current[base] > 1 ? `${base}-${headingCounterRef.current[base]}` : base;

      const styles: Record<string, string> = {
        h1: "report-h1 text-[2rem] font-serif leading-tight tracking-tight mt-0 mb-6 text-[--ink] scroll-mt-24",
        h2: "report-h2 group flex items-center gap-3 text-[1.2rem] font-semibold tracking-tight mt-14 mb-4 text-[--ink] border-l-[3px] border-[--accent] pl-4 scroll-mt-24",
        h3: "report-h3 text-[1rem] font-semibold mt-8 mb-3 text-[--ink-muted] uppercase tracking-widest text-xs scroll-mt-24",
      };

      return (
        <Tag id={id} className={styles[Tag]} {...props}>
          {children}
        </Tag>
      );
    };

  return {
    h1: HeadingTag("h1"),
    h2: HeadingTag("h2"),
    h3: HeadingTag("h3"),

    p: ({ children }) => (
      <p className="my-5 leading-[1.85] text-[1rem] text-[--ink-body]">{children}</p>
    ),

    ul: ({ children }) => (
      <ul className="my-5 space-y-2 pl-0 list-none">{children}</ul>
    ),

    ol: ({ children }) => (
      <ol className="my-5 space-y-2 pl-6 list-decimal text-[--ink-body]">{children}</ol>
    ),

    li: ({ children }) => (
      <li className="flex gap-3 items-start text-[--ink-body] leading-[1.75]">
        <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[--accent]" aria-hidden />
        <span>{children}</span>
      </li>
    ),

    strong: ({ children }) => (
      <strong className="font-semibold text-[--ink]">{children}</strong>
    ),

    em: ({ children }) => (
      <em className="italic text-[--ink-muted]">{children}</em>
    ),

    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[--accent] underline decoration-[--accent]/40 underline-offset-3 hover:decoration-[--accent] transition-all"
      >
        {children}
      </a>
    ),

    blockquote: ({ children }) => (
      <blockquote className="my-8 relative pl-6 pr-4 py-4 rounded-r-xl border-l-[4px] border-[--accent] bg-[--accent]/5 text-[--ink-muted] italic text-[0.95rem] leading-[1.8]">
        {children}
      </blockquote>
    ),

    hr: () => (
      <div className="my-12 flex items-center gap-4">
        <div className="h-px flex-1 bg-[--border]" />
        <div className="size-1 rounded-full bg-[--accent] opacity-60" />
        <div className="h-px flex-1 bg-[--border]" />
      </div>
    ),

    code: ({ children, className }) => {
      const isBlock = className?.startsWith("language-");
      if (isBlock) {
        return (
          <code className="block rounded-xl bg-[--surface-alt] border border-[--border] px-5 py-4 text-[0.85rem] font-mono leading-relaxed text-[--ink-muted] overflow-x-auto">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded px-1.5 py-0.5 bg-[--surface-alt] text-[--accent] text-[0.875em] font-mono border border-[--border]">
          {children}
        </code>
      );
    },

    pre: ({ children }) => (
      <pre className="my-6 overflow-x-auto rounded-xl border border-[--border] bg-[--surface-alt] shadow-inner">
        {children}
      </pre>
    ),

    table: ({ children }) => (
      <div className="my-8 overflow-x-auto rounded-xl border border-[--border] shadow-sm">
        <table className="w-full border-collapse text-[0.9rem]">{children}</table>
      </div>
    ),

    thead: ({ children }) => (
      <thead className="bg-[--surface-alt] text-[0.75rem] font-bold uppercase tracking-widest text-[--ink-muted] border-b border-[--border]">
        {children}
      </thead>
    ),

    th: ({ children }) => (
      <th className="px-5 py-3.5 text-left font-semibold text-[--ink-muted] normal-case tracking-normal">
        {children}
      </th>
    ),

    tbody: ({ children }) => (
      <tbody className="divide-y divide-[--border]">{children}</tbody>
    ),

    td: ({ children }) => (
      <td className="px-5 py-3.5 text-[--ink-body] align-top">{children}</td>
    ),
  };
}

// ─── Table of Contents ────────────────────────────────────────────────────────

function TableOfContents({ entries, activeId }: { entries: TocEntry[]; activeId: string }) {
  if (entries.length === 0) return null;

  return (
    <nav aria-label="Table of contents" className="sticky top-[5rem] max-h-[calc(100vh-8rem)] overflow-y-auto">
      <p className="mb-3 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-[--ink-muted] opacity-70">
        Contents
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => {
          const isActive = activeId === entry.id;
          const indentClass = entry.level === 1 ? "" : entry.level === 2 ? "pl-3" : "pl-6";
          return (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className={[
                  "block py-1 pr-2 text-[0.8rem] leading-snug rounded-md transition-all duration-150",
                  indentClass,
                  isActive
                    ? "text-[--accent] font-semibold pl-2 border-l-2 border-[--accent]"
                    : "text-[--ink-muted] hover:text-[--ink] hover:pl-2",
                ].join(" ")}
              >
                {entry.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export const ReportApp: React.FC = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string>("");
  const [scrolled, setScrolled] = useState(false);
  const [showBackTop, setShowBackTop] = useState(false);
  const headingCounterRef = useRef<Record<string, number>>({});
  const markdownComponents = makeMarkdownComponents(headingCounterRef);

  const id =
    new URLSearchParams(window.location.search).get("id")?.trim() ?? "";

  // Load report
  useEffect(() => {
    if (!id) { setError("Missing report id."); return; }
    void window.reportAPI
      .loadReport(id)
      .then((res) => {
        if (!res) { setError("Report not found or expired."); return; }
        setLoaded({ id, title: res.title, markdown: res.markdown, createdAt: res.createdAt });
        document.title = res.title || "Research report";
      })
      .catch(() => setError("Could not load report."));
  }, [id]);

  // Scroll tracking
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
      setShowBackTop(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Active heading via IntersectionObserver
  useEffect(() => {
    if (!loaded) return;
    const headings = document.querySelectorAll<HTMLElement>(
      "article h1[id], article h2[id], article h3[id]"
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [loaded]);

  const onDownload = useCallback(async () => {
    if (!id) return;
    const r = await window.reportAPI.saveReportAs(id);
    if (!r.ok && r.error !== "cancelled") console.error("Save failed", r.error);
  }, [id]);

  // ── Error / loading states ──
  if (error) {
    return (
      <div className="min-h-screen bg-[--bg] flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold text-[--ink]">Couldn't load report</p>
          <p className="text-sm text-[--ink-muted]">{error}</p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="min-h-screen bg-[--bg] flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-[--ink-muted]">
          <div className="size-5 rounded-full border-2 border-[--accent] border-t-transparent animate-spin" />
          <span className="text-sm font-medium">Loading report…</span>
        </div>
      </div>
    );
  }

  // Reset heading counter on each render
  headingCounterRef.current = {};

  const toc = extractToc(loaded.markdown);
  const readTime = estimateReadTime(loaded.markdown);
  const dateLabel = new Date(loaded.createdAt).toLocaleDateString(undefined, {
    year: "numeric", month: "long", day: "numeric",
  });

  return (
    <>
      {/* ── CSS Variables ── */}
      <style>{`
        :root {
          --bg: #f5f4ef;
          --surface: #ffffff;
          --surface-alt: #f8f7f2;
          --border: #e8e5dd;
          --ink: #1a1916;
          --ink-body: #3d3a34;
          --ink-muted: #7a7669;
          --accent: #c0521f;
          --accent-light: #f5e8e0;
          font-family: 'Georgia', 'Times New Roman', serif;
        }
        * { box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { background: var(--bg); margin: 0; }

        /* Scrollbar */
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 99px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--ink-muted); }

        /* Drop-cap on first paragraph */
        .report-body > p:first-of-type::first-letter {
          float: left;
          font-size: 4.2em;
          line-height: 0.75;
          margin-right: 0.1em;
          margin-top: 0.08em;
          color: var(--accent);
          font-weight: 900;
          font-family: Georgia, serif;
        }

        /* Heading reveal animation */
        .report-h2 { opacity: 0; transform: translateX(-8px); animation: slideIn 0.4s ease forwards; }
        @keyframes slideIn { to { opacity: 1; transform: none; } }
      `}</style>

      <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--ink)" }}>

        {/* ── Header ── */}
        <header
          className="fixed top-0 inset-x-0 z-30 transition-all duration-300"
          style={{
            background: scrolled ? "rgba(255,255,255,0.94)" : "transparent",
            backdropFilter: scrolled ? "blur(12px)" : "none",
            borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
            boxShadow: scrolled ? "0 1px 20px rgba(0,0,0,0.06)" : "none",
          }}
        >
          <div className="mx-auto flex h-[3.75rem] max-w-7xl items-center justify-between gap-6 px-5 sm:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/icon.png"
                alt=""
                width={28}
                height={28}
                className="size-7 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/8"
              />
              <span className="truncate text-[0.9rem] font-bold tracking-tight" style={{ color: "var(--ink)", fontFamily: "Georgia, serif" }}>
                Blueberry
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-1.5 text-[0.75rem] font-medium px-3 py-1.5 rounded-full" style={{ background: "var(--accent-light)", color: "var(--accent)" }}>
                <Clock className="size-3" />
                {readTime} min read
              </div>
              <button
                type="button"
                onClick={() => void onDownload()}
                className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[0.8rem] font-semibold transition-all active:scale-95"
                style={{
                  background: "var(--ink)",
                  color: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
              >
                <Download className="size-3.5" />
                Download
              </button>
            </div>
          </div>
        </header>

        {/* ── Hero ── */}
        {/* <div
          className="pt-[3.75rem]"
          style={{
            background: "linear-gradient(160deg, var(--ink) 0%, #2d2921 100%)",
            color: "#fff",
          }}
        >
          <div className="mx-auto max-w-7xl px-5 sm:px-8 py-16 sm:py-20">
            <div className="max-w-2xl">
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <span className="text-[0.65rem] font-bold uppercase tracking-[0.2em] px-2.5 py-1 rounded-full" style={{ background: "var(--accent)", color: "#fff" }}>
                  Research Report
                </span>
                <span className="text-[0.75rem] font-medium opacity-60">{dateLabel}</span>
              </div>
              <h1 className="text-[2rem] sm:text-[2.75rem] font-black leading-[1.15] tracking-tight mb-6" style={{ fontFamily: "Georgia, serif" }}>
                {loaded.title}
              </h1>
              <div className="flex flex-wrap items-center gap-4 text-[0.8rem] opacity-60">
                <span className="flex items-center gap-1.5">
                  <BookOpen className="size-3.5" />
                  {estimateReadTime(loaded.markdown)} min read
                </span>
                <span>·</span>
                <span>{loaded.markdown.trim().split(/\s+/).length.toLocaleString()} words</span>
                <span>·</span>
                <span>{toc.length} sections</span>
              </div>
            </div>
          </div>
        </div> */}

        {/* ── Body: TOC + Article ── */}
        <div className="mx-auto max-w-7xl px-5 sm:px-8 py-12 lg:py-16">
          <div className="flex gap-12 xl:gap-16">

            {/* Sidebar TOC */}
            <aside className="hidden lg:block w-56 xl:w-64 shrink-0">
              <TableOfContents entries={toc} activeId={activeId} />
            </aside>

            {/* Article */}
            <article
              className="report-body min-w-0 flex-1 max-w-[720px]"
              style={{
                background: "var(--surface)",
                borderRadius: "1.25rem",
                border: "1px solid var(--border)",
                padding: "3rem 3.5rem",
                boxShadow: "0 8px 40px -8px rgba(26,25,22,0.10), 0 2px 8px -2px rgba(26,25,22,0.06)",
              }}
            >
              <span className="text-[0.75rem] font-medium opacity-60">{dateLabel}</span>
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={markdownComponents}
              >
                {loaded.markdown}
              </ReactMarkdown>

              {/* Sources footer */}
              <div
                className="mt-16 pt-8 text-[0.75rem]"
                style={{ borderTop: "1px solid var(--border)", color: "var(--ink-muted)" }}
              >
                <p className="font-bold uppercase tracking-widest mb-2 text-[0.65rem]">Sources</p>
                <p>Wikipedia · Britannica Money · Related biographical databases</p>
              </div>
            </article>
          </div>
        </div>

        {/* ── Back to Top ── */}
        {showBackTop && (
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="fixed bottom-8 right-6 z-30 size-10 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
            style={{
              background: "var(--ink)",
              color: "#fff",
              boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            }}
            aria-label="Back to top"
          >
            <ChevronUp className="size-4" />
          </button>
        )}
      </div>
    </>
  );
};