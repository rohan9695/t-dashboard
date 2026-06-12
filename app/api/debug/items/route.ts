// app/api/debug/items/route.ts
// Mirrors main.py GET /debug/items
// Shows all mapped ITEM_MAP keys so you can diagnose unknown NT8 fields

import { NextResponse } from 'next/server'
import { ITEM_MAP } from '@/lib/trading-logic'


export async function GET() {
  return NextResponse.json({
    mapped_items: Object.keys(ITEM_MAP),
    note: 'Unknown items are logged to Vercel runtime logs (check dashboard → Functions → Logs)',
  })
}
