// lib/summary-card.ts
// Draws the shareable "daily P&L" image onto a canvas. Browser-only: call it from
// an event handler, never at module load or on the server. It deliberately
// contains no account ids — only group names, counts and totals — so the image
// is safe to post. Balance appears only when the caller passes it.

import { formatSigned, foldGroups, type CardGroup } from './account-groups'

export interface CardData {
  pnl: number
  accounts: number
  /** Pre-formatted, e.g. "$570,656". Null leaves the balance line off the image. */
  balance: string | null
  groups: CardGroup[]
  /** e.g. "October 29, 2026 at 11:02 AM" */
  stamp: string | null
}

const W = 1080
const H = 1350
const GREEN = '#10d98a'
const RED = '#f87171'
const MUTED = '#8b86a3'
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function pnlColor(v: number) {
  return v > 0 ? GREEN : v < 0 ? RED : '#a1a1aa'
}

export function drawCard(canvas: HTMLCanvasElement, data: CardData): void {
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#1b1036')
  bg.addColorStop(1, '#0a0615')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = `700 52px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText('Trader Dashboard', 64, 112)

  if (data.stamp) {
    ctx.fillStyle = '#d4d0e6'
    ctx.font = `500 30px ${FONT}`
    ctx.textAlign = 'right'
    ctx.fillText(data.stamp, W - 64, 112)
  }

  // Hero number, with a soft glow in its own colour.
  const heroColor = pnlColor(data.pnl)
  ctx.textAlign = 'left'
  ctx.shadowColor = heroColor
  ctx.shadowBlur = 40
  ctx.fillStyle = heroColor
  ctx.font = `800 150px ${FONT}`
  ctx.fillText(formatSigned(data.pnl), 60, 360)
  ctx.shadowBlur = 0

  ctx.fillStyle = MUTED
  ctx.font = `500 38px ${FONT}`
  ctx.fillText('Daily P&L', 64, 424)

  ctx.font = `500 28px ${FONT}`
  let y = 540
  if (data.balance) {
    const label = 'TOTAL BALANCE  ·  '
    ctx.fillStyle = MUTED
    ctx.fillText(label, 64, y)
    const labelWidth = ctx.measureText(label).width
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 28px ${FONT}`
    ctx.fillText(data.balance, 64 + labelWidth, y)
    ctx.font = `500 28px ${FONT}`
    y += 44
  }
  ctx.fillStyle = MUTED
  ctx.font = `500 28px ${FONT}`
  ctx.fillText(`ACROSS ${data.accounts} ACCOUNTS`, 64, y)

  // Group rows.
  const rows = foldGroups(data.groups)
  const rowH = 128
  const gap = 22
  let top = y + 56
  for (const g of rows) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    roundRect(ctx, 56, top, W - 112, rowH, 28)
    ctx.fill()

    ctx.textAlign = 'left'
    ctx.fillStyle = '#ffffff'
    ctx.font = `700 40px ${FONT}`
    ctx.fillText(g.label.toUpperCase(), 92, top + 62)
    ctx.fillStyle = MUTED
    ctx.font = `500 28px ${FONT}`
    ctx.fillText(`${g.count} ${g.count === 1 ? 'acct' : 'accts'}`, 92, top + 100)

    ctx.textAlign = 'right'
    ctx.fillStyle = pnlColor(g.pnl)
    ctx.font = `700 46px ${FONT}`
    ctx.fillText(formatSigned(g.pnl), W - 92, top + 78)
    top += rowH + gap
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = `500 28px ${FONT}`
  ctx.fillText('Read-only summary from NinjaTrader', 64, H - 56)
}

export function cardBlob(data: CardData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  drawCard(canvas, data)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not encode the image'))),
      'image/png',
    )
  })
}
