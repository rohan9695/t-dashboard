'use client'
// components/VisibilityProvider.tsx
// Tracks whether header balance totals are revealed.
// Default: hidden (resets on every app open).
// Individual account rows are unaffected.

import { createContext, useContext, useState } from 'react'

interface VisibilityCtx {
  visible: boolean
  toggle: () => void
}

const Ctx = createContext<VisibilityCtx>({ visible: false, toggle: () => {} })

export function useVisibility() {
  return useContext(Ctx)
}

export function VisibilityProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false) // hidden by default on every open

  return (
    <Ctx.Provider value={{ visible, toggle: () => setVisible((v) => !v) }}>
      {children}
    </Ctx.Provider>
  )
}
