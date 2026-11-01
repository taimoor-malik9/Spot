import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Shared hook for expandable panels (Ask AI and Solve a problem).
 * - Persists expanded state in sessionStorage per panelId, default collapsed.
 * - Listens for Esc (collapses if expanded).
 * - Listens for Ctrl/Cmd+Shift+F (toggles expand/collapse).
 * - Locks body scroll when expanded.
 * - Handles under-768px full screen responsive detection.
 * - Maintains scroll position and manages auto-scroll when user is at bottom.
 */
export function useExpandablePanel({ panelId, inputRef, scrollRef, onCollapse } = {}) {
  const storageKey = `spot:panelExpanded:${panelId || 'default'}`;
  const [isExpanded, setIsExpandedState] = useState(() => {
    try {
      return sessionStorage.getItem(storageKey) === 'true';
    } catch {
      return false;
    }
  });

  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const setIsExpanded = useCallback((val) => {
    setIsExpandedState(prev => {
      const next = typeof val === 'function' ? val(prev) : val;
      try {
        sessionStorage.setItem(storageKey, String(next));
      } catch {}
      return next;
    });
  }, [storageKey]);

  const toggleExpand = useCallback(() => {
    setIsExpanded(prev => !prev);
    // Keep focus in input
    setTimeout(() => {
      if (inputRef?.current) {
        inputRef.current.focus();
      }
    }, 60);
  }, [setIsExpanded, inputRef]);

  // Lock body scroll while expanded
  useEffect(() => {
    if (isExpanded) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isExpanded]);

  // Keyboard shortcuts: Esc collapses; Ctrl/Cmd+Shift+F toggles
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (isExpanded) {
          e.preventDefault();
          e.stopPropagation();
          setIsExpanded(false);
          if (onCollapse) onCollapse();
          setTimeout(() => {
            if (inputRef?.current) inputRef.current.focus();
          }, 60);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        toggleExpand();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded, setIsExpanded, toggleExpand, onCollapse, inputRef]);

  // Auto-scroll management: tracks whether user was at the bottom before content changes
  const isAtBottomRef = useRef(true);
  const handleScroll = useCallback(() => {
    if (!scrollRef?.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  }, [scrollRef]);

  const scrollToBottomIfNear = useCallback((smooth = true) => {
    if (!scrollRef?.current) return;
    if (isAtBottomRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      });
    }
  }, [scrollRef]);

  return {
    isExpanded,
    setIsExpanded,
    toggleExpand,
    isMobile,
    handleScroll,
    scrollToBottomIfNear,
    isAtBottomRef,
  };
}

export default useExpandablePanel;
