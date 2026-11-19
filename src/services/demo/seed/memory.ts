/**
 * The handbook Jarvis answers the phones from, and the log of decisions the
 * owner has made. Edit the wording here; prices and opening hours come from
 * shops.ts so they always match what Jarvis says on calls.
 */
import { localDate } from '@/lib/format'
import type { Decision, HandbookEntry } from '@/lib/types'

import type { Ids } from '../ids'
import { addDays, addMinutes, iso } from '../time'
import { SERVICES, SHOP_PROFILES, describeHours } from './shops'

interface EntryDraft {
  title: string
  category: string
  content: string
  tags: string[]
  notion_page_id?: string
  /** Days since it was last edited. */
  editedDaysAgo: number
}

function priceList(): string {
  const lines = Object.values(SERVICES).map(
    (service) => `${service.name}: $${service.price} (${service.minutes} minutes)`,
  )
  return [
    'The same at every shop.',
    '',
    ...lines,
    '',
    'Kids cut is for 12 and under. Add a beard trim to any cut for $10.',
  ].join('\n')
}

function hoursEntry(): string {
  return SHOP_PROFILES.map((profile) => {
    const note = profile.status === 'paused' ? ' The front desk answers this line for now.' : ''
    return `${profile.name}${note}\n${describeHours(profile).join('\n')}`
  }).join('\n\n')
}

const ENTRIES: readonly EntryDraft[] = [
  {
    title: 'Price list',
    category: 'Pricing',
    content: priceList(),
    tags: ['prices', 'services'],
    notion_page_id: 'notion-3f9a1c2e',
    editedDaysAgo: 12,
  },
  {
    title: 'Opening hours',
    category: 'Hours',
    content: hoursEntry(),
    tags: ['hours'],
    editedDaysAgo: 2,
  },
  {
    title: 'Holiday hours',
    category: 'Hours',
    content:
      'Closed on Thanksgiving Day and Christmas Day.\nThe day before Thanksgiving every shop closes at 3 PM.\nIf someone asks about a holiday that isn’t listed, say the shop is open its usual hours and offer to take a message for the owner.',
    tags: ['hours', 'holidays'],
    editedDaysAgo: 6,
  },
  {
    title: 'Deposits and no-shows',
    category: 'Policies',
    content:
      'First-time clients pay a $10 deposit when they book. It comes off the price at the shop.\nReturning clients don’t pay a deposit.\nCancelling less than 4 hours ahead, or not showing up, costs $10, added to the next booking.\nJarvis can’t waive the fee. If someone asks, take the details and ask the owner.',
    tags: ['deposit', 'no-show', 'cancellations'],
    notion_page_id: 'notion-7b20e8d4',
    editedDaysAgo: 9,
  },
  {
    title: '“Is my barber working today?”',
    category: 'Phone scripts',
    content:
      'Check the barber’s schedule for the day before you answer.\nIf they’re in, offer their next free time.\nIf they’re off, say when they’re back and offer the next free time with someone else.\nNever share why a barber is off.',
    tags: ['barbers', 'schedule'],
    editedDaysAgo: 4,
  },
  {
    title: 'Booking a kids cut',
    category: 'Phone scripts',
    content:
      'Ask for the child’s first name and age.\nUnder 4: book with Dre at Fade House or Joelle at Burnet Road, who are best with little ones.\nA parent or guardian stays in the shop for the whole cut.',
    tags: ['kids', 'booking'],
    editedDaysAgo: 15,
  },
  {
    title: 'When to hand a call to a person',
    category: 'Escalation',
    content:
      'Transfer to the shop when:\n- the caller asks for a person twice\n- it’s a complaint about a cut or a barber\n- it’s about a payment, a refund or a chargeback\n- it’s a supplier or anyone asking for the owner by name\nIf nobody picks up within 20 seconds, take a message and say someone will call back today.',
    tags: ['transfer', 'complaints'],
    editedDaysAgo: 3,
  },
  {
    title: 'Refunds and exceptions',
    category: 'Escalation',
    content:
      'Jarvis never promises a refund, a free cut or an exception.\nSay you’ll ask the owner and text the answer the same day, then send the request for approval with the caller’s name, number and what happened.',
    tags: ['refunds', 'approvals'],
    editedDaysAgo: 9,
  },
  {
    title: 'How Jarvis sounds',
    category: 'Tone',
    content:
      'Warm, quick and plain. Answer with: “Thanks for calling [shop], this is Jarvis.”\nUse the caller’s first name once you have it.\nDon’t read out the whole price list; answer what was asked.\nConfirm every booking out loud: service, barber, day and time.',
    tags: ['greeting', 'voice'],
    notion_page_id: 'notion-c41d5a90',
    editedDaysAgo: 20,
  },
  {
    title: 'Walk-ins',
    category: 'Policies',
    content:
      'Walk-ins are welcome when a chair is free. Jarvis can say how long the wait looks from today’s bookings but can’t hold a place in line.\nSaturdays before noon are usually booked solid; suggest booking ahead.',
    tags: ['walk-ins'],
    editedDaysAgo: 30,
  },
]

interface DecisionDraft {
  title: string
  decision: string
  rationale: string | null
  daysAgo: number
  tags: string[]
  notion_page_id?: string
}

const DECISIONS: readonly DecisionDraft[] = [
  {
    title: 'Pause Jarvis at South Lamar for two weeks',
    decision:
      'Stop answering the South Lamar line with Jarvis for two weeks while the new front desk hire learns the phones.',
    rationale:
      'Gives Bianca real calls to learn on. Jarvis keeps the call history, so turning it back on is one switch.',
    daysAgo: 2,
    tags: ['south lamar', 'staffing'],
  },
  {
    title: 'Take a $10 deposit from first-time clients',
    decision: 'First-time clients pay $10 when they book. It comes off the price at the shop.',
    rationale:
      'No-shows from first-time online bookings were costing about six chairs a week across the shops. Regulars almost never no-show, so they skip it.',
    daysAgo: 11,
    tags: ['deposit', 'no-show'],
    notion_page_id: 'notion-1e6f0b77',
  },
  {
    title: 'Four-hour cancellation window',
    decision: 'Cancelling with less than 4 hours’ notice costs $10, added to the next booking.',
    rationale:
      'Four hours is enough time to fill the chair from the walk-in list. Anything shorter usually sits empty.',
    daysAgo: 11,
    tags: ['cancellations'],
  },
  {
    title: 'Jarvis asks before any refund or exception',
    decision: 'Jarvis can’t promise refunds, fee waivers or bookings outside hours. It asks me and texts the answer.',
    rationale: 'Keeps the rules the same for everyone and stops “the phone said it was fine” arguments at the chair.',
    daysAgo: 24,
    tags: ['refunds', 'approvals'],
    notion_page_id: 'notion-9a3c22f1',
  },
  {
    title: 'Same prices at every shop',
    decision: 'One price list for all three shops.',
    rationale: 'Callers move between shops, and one list means Jarvis never quotes the wrong price.',
    daysAgo: 40,
    tags: ['prices'],
  },
  {
    title: 'Quiet hours from 10 PM to 7 AM',
    decision: 'Between 10 PM and 7 AM alerts stay in the app instead of calling or texting.',
    rationale: 'Nothing at night needs me before morning; a missed call at 11 PM can wait until 7.',
    daysAgo: 52,
    tags: ['alerts'],
  },
  {
    title: 'Code changes always go through a pull request',
    decision: 'Jarvis works on a branch and asks before pushing; nothing merges without me.',
    rationale: 'The booking site takes payments. I want to see every change before customers do.',
    daysAgo: 63,
    tags: ['code', 'approvals'],
  },
  {
    title: 'Saturday opens at 8 AM at Fade House',
    decision: 'Fade House opens an hour earlier on Saturdays, from 8 AM.',
    rationale: 'Saturday mornings were turning away walk-ins by 9:30. Marcus and Sam offered to start early.',
    daysAgo: 75,
    tags: ['hours', 'fade house'],
  },
]

export function seedMemory(now: Date, ids: Ids): { handbook_entries: HandbookEntry[]; decisions: Decision[] } {
  const handbook_entries = ENTRIES.map((entry, index): HandbookEntry => {
    const updated = addMinutes(addDays(now, -entry.editedDaysAgo), -index * 7)
    return {
      id: ids.next('entry'),
      title: entry.title,
      category: entry.category,
      content: entry.content,
      tags: [...entry.tags],
      notion_page_id: entry.notion_page_id ?? null,
      created_at: iso(addDays(updated, -30)),
      updated_at: iso(updated),
    }
  }).sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const decisions = DECISIONS.map((draft): Decision => {
    const decidedOn = addDays(now, -draft.daysAgo)
    return {
      id: ids.next('decision'),
      title: draft.title,
      decision: draft.decision,
      rationale: draft.rationale,
      decided_on: localDate(decidedOn),
      tags: [...draft.tags],
      notion_page_id: draft.notion_page_id ?? null,
      created_at: iso(decidedOn),
      updated_at: iso(decidedOn),
    }
  })

  return { handbook_entries, decisions }
}
