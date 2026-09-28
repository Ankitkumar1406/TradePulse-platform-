"use client";

/**
 * Scan builder — drag wiring context.
 *
 * Reorder is drag-and-drop within the same parent group (HTML5 DnD, the same
 * interaction the rest of TradePulse uses). The context carries the handler
 * set + which id currently has the drop indicator, so both ClauseNode and
 * nested GroupNode rows stay dumb.
 */
import { createContext, useContext } from "react";

export interface DragWiring {
  /** currently hovered-over id (drop indicator) */
  dragOverId: string | null;
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: (id: string) => void;
  onDragEnd: () => void;
}

export const DragCtx = createContext<DragWiring>({
  dragOverId: null,
  onDragStart: () => {},
  onDragOver: () => {},
  onDrop: () => {},
  onDragEnd: () => {},
});

export function useDragWiring(): DragWiring {
  return useContext(DragCtx);
}
