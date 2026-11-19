/**
 * What gets said on the phone. Each conversation here is a template: it is
 * handed a scene (which shop, who is calling, what time it is, and for
 * bookings the slot that was found) and returns the lines and the summary
 * for the call log. The summary is written from the same details as the
 * lines, so the two always agree.
 *
 * To add a conversation, add an entry to the list for its outcome. To change
 * how the receptionist talks, edit the lines.
 */
import type { CallOutcome } from '@/lib/types'

import type { Random } from '../random'
import { WEEKDAYS, addMinutes, clockTime, dayWord } from '../time'
import { LATE_CANCEL_CUSTOMER, VENDORS } from './people'
import type { Customer } from './people'
import { SERVICES } from './shops'
import type { Service, ServiceKey } from './shops'

export type Speaker = 'agent' | 'caller'

/** One thing said. `pauseBefore` is in seconds, for a noticeable silence. */
export type Line = readonly [speaker: Speaker, text: string, pauseBefore?: number]

export interface Script {
  /** One or two plain sentences for the call log. */
  summary: string
  lines: Line[]
  /** Seconds the line stays open after the last words: the hold after a transfer. */
  holdSeconds?: number
  /** A caller who is not one of the shop's customers, such as a supplier. */
  caller?: { name: string; phone: string }
  /** On a booking: who the appointment is for, when it is not the caller. */
  appointmentFor?: string
  /** On a booking: a note for the barber. */
  appointmentNotes?: string
  /** An appointment the caller already had and cancelled on this call. */
  cancels?: { service: Service; barber: string; startsAt: Date }
}

/** Where and when a call happens. */
export interface Scene {
  rng: Random
  shopName: string
  /** "1804 E 6th St" */
  street: string
  parking: string
  barbers: readonly string[]
  /** Only conversations marked `named` may use the caller's name. */
  caller: Customer
  at: Date
  /** The shop's hours on the day of the call. */
  open: Date
  close: Date
  /** When the shop opens the day after the call. */
  opensTomorrow: Date
}

/** A call that ends with an appointment in the calendar. */
export interface BookingScene extends Scene {
  service: Service
  barber: string
  /** Another barber at the shop, to offer as an alternative. */
  otherBarber: string
  startsAt: Date
  /** A second time Jarvis can offer on the same day. */
  alternative: Date
  /** A nearby time that is already taken. */
  taken: Date
}

export interface Conversation {
  /** A short name for the template, handy when editing. */
  id: string
  /** The caller gives their name, so the call log shows it. */
  named: boolean
  write(scene: Scene): Script
}

export interface BookingConversation {
  id: string
  /** Stick to these services. Any service when left out. */
  services?: readonly ServiceKey[]
  /** The caller is a parent booking for their son. */
  forChild?: boolean
  /** The caller wants to come in the same day if at all possible. */
  wantsToday?: boolean
  /** The caller asks for one barber by name and will wait for that chair. */
  asksForBarber?: boolean
  write(scene: BookingScene): Script
}

// ── Wording helpers ────────────────────────────────────────────────────────

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function greeting(scene: Scene): Line {
  const opener = `Thanks for calling ${scene.shopName}, this is Jarvis`
  return [
    'agent',
    scene.rng.pick([
      `${opener}. How can I help?`,
      `${opener}, the shop’s assistant. How can I help?`,
      `${opener}. What can I do for you?`,
    ]),
  ]
}

/** The different ways a booked slot is put into words. */
function slotWords(scene: BookingScene) {
  const day = dayWord(scene.startsAt, scene.at)
  const time = clockTime(scene.startsAt)
  const sameDay = day === 'today'
  return {
    day,
    time,
    sameDay,
    /** As Jarvis says it: "tomorrow at 2:30 PM". */
    when: `${day} at ${time}`,
    /** As the caller asks for it: "today", "tomorrow", "on Saturday". */
    asked: sameDay || day === 'tomorrow' ? day : `on ${day}`,
    /** For the call log, which is read on other days: "Saturday at 2:30 PM". */
    logged: sameDay
      ? `${time} the same day`
      : `${WEEKDAYS[scene.startsAt.getDay()]} at ${time}`,
  }
}

function phase(scene: Scene): 'before_open' | 'open' | 'after_close' {
  if (scene.at < scene.open) return 'before_open'
  return scene.at < scene.close ? 'open' : 'after_close'
}

/** Rounds up to the next half hour. */
function nextHalfHour(date: Date): Date {
  const result = new Date(date)
  result.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0)
  return result
}

// ── Booked ─────────────────────────────────────────────────────────────────

export const BOOKING_CONVERSATIONS: readonly BookingConversation[] = [
  {
    id: 'straight-booking',
    write(scene) {
      const { caller, service, barber, otherBarber, rng } = scene
      const slot = slotWords(scene)
      return {
        summary: `${caller.name} booked ${service.spoken} with ${barber} for ${slot.logged}.`,
        lines: [
          greeting(scene),
          [
            'caller',
            rng.pick([
              `Hey, can I get ${service.spoken} ${slot.asked}?`,
              `Hi, I need ${service.spoken} ${slot.asked} if you’ve got room.`,
            ]),
          ],
          [
            'agent',
            `Sure. For ${slot.day} I have ${slot.time} with ${barber} or ${clockTime(scene.alternative)} with ${otherBarber}.`,
          ],
          ['caller', `Let’s do ${slot.time} with ${barber}.`],
          ['agent', 'Can I get your name?'],
          ['caller', rng.pick([`${caller.name}.`, `It’s ${caller.name}.`])],
          [
            'agent',
            `Thanks, ${caller.first}. You’re booked for ${service.spoken} with ${barber}, ${slot.when}. I’ll text a reminder to this number.`,
          ],
          ['caller', rng.pick(['Perfect, thanks.', 'Great, thank you.'])],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'asks-for-barber',
    asksForBarber: true,
    write(scene) {
      const { caller, service, barber } = scene
      const slot = slotWords(scene)
      return {
        summary: `${caller.name} asked for ${barber} and booked ${service.spoken} for ${slot.logged}.`,
        lines: [
          greeting(scene),
          ['caller', `Hi, is ${barber} free ${slot.asked}? I need ${service.spoken}.`],
          [
            'agent',
            `Let me look at ${barber}’s chair. ${barber} is open ${slot.when}. Want me to hold it for you?`,
          ],
          ['caller', 'Yeah, lock it in.'],
          ['agent', 'Done. What name should I put on it?'],
          ['caller', `${caller.name}.`],
          [
            'agent',
            `Got it, ${caller.first}. ${service.name} with ${barber}, ${slot.when}. You’ll get a reminder text before you come in.`,
          ],
          ['caller', 'Appreciate it.'],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'first-visit',
    services: ['skinFade', 'classicCut', 'cutAndBeard', 'hotTowelShave'],
    write(scene) {
      const { caller, service, barber, shopName } = scene
      const slot = slotWords(scene)
      return {
        summary: `First-time client. ${caller.name} booked ${service.spoken} with ${barber} for ${slot.logged} and paid the $10 deposit.`,
        appointmentNotes: 'First visit. $10 deposit paid.',
        lines: [
          greeting(scene),
          ['caller', `Hi, I’ve never been in before. How much is ${service.spoken}?`],
          [
            'agent',
            `Welcome. ${capitalize(service.spoken)} is $${service.price}. First-time clients pay a $10 deposit when they book, and it comes off the price on the day. Want me to find you a time?`,
          ],
          ['caller', `Sure. What do you have ${slot.asked}?`],
          ['agent', `I have ${slot.time} with ${barber}.`],
          ['caller', 'That works.'],
          ['agent', 'Great. What name is it under?'],
          ['caller', `${caller.name}.`],
          [
            'agent',
            `Thanks, ${caller.first}. I just texted you a link for the $10 deposit. Once it’s paid, the spot is yours.`,
          ],
          ['caller', 'Okay, paid.', 19],
          [
            'agent',
            `It came through. You’re confirmed for ${service.spoken} with ${barber}, ${slot.when}.`,
          ],
          ['caller', 'Thank you.'],
          ['agent', `Welcome to ${shopName}, ${caller.first}. See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'kids-cut',
    services: ['kidsCut'],
    forChild: true,
    write(scene) {
      const { caller, barber } = scene
      const child = caller.child ?? { name: 'Leo', age: 7 }
      const slot = slotWords(scene)
      return {
        summary: `${caller.name} booked a kids cut for ${child.name} with ${barber} for ${slot.logged}.`,
        appointmentFor: `${child.name} ${caller.last}`,
        appointmentNotes: `Age ${child.age}. Booked by ${caller.name}.`,
        lines: [
          greeting(scene),
          ['caller', `Hi, I need a haircut for my son. He’s ${child.age}.`],
          [
            'agent',
            `Happy to help. A kids cut is $${SERVICES.kidsCut.price} and takes about half an hour. When would you like to come in?`,
          ],
          ['caller', `Do you have anything ${slot.asked}?`],
          ['agent', `${barber} is great with kids and has ${slot.when} open.`],
          ['caller', 'Let’s do that.'],
          ['agent', 'What’s his name?'],
          ['caller', `${child.name}. And I’m ${caller.name}.`],
          [
            'agent',
            `Thanks, ${caller.first}. ${child.name} is booked for a kids cut with ${barber}, ${slot.when}. One thing: a parent needs to stay in the shop during the cut.`,
          ],
          ['caller', 'That’s fine. Thank you!'],
          ['agent', `See you both ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'walk-in-question',
    services: ['classicCut'],
    wantsToday: true,
    write(scene) {
      const { caller, barber, rng } = scene
      const slot = slotWords(scene)
      const wait = slot.sameDay
        ? `the wait right now is about ${rng.pick([30, 40, 45, 50])} minutes`
        : 'the rest of today is spoken for'
      return {
        summary: `${caller.name} asked about walk-ins and booked a classic cut with ${barber} for ${slot.logged} instead of waiting.`,
        lines: [
          greeting(scene),
          ['caller', 'Do y’all take walk-ins?'],
          [
            'agent',
            `We do, but ${wait}. I can book you a spot instead. I have ${slot.when} with ${barber}.`,
          ],
          ['caller', 'Yeah, book that. Just a regular cut.'],
          ['agent', 'You got it. What’s your name?'],
          ['caller', `${caller.name}.`],
          ['agent', `Thanks, ${caller.first}. Classic cut with ${barber}, ${slot.when}.`],
          ['caller', 'Cool, thanks.'],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'big-day',
    services: ['skinFade', 'cutAndBeard', 'hotTowelShave'],
    write(scene) {
      const { caller, service, barber, rng } = scene
      const slot = slotWords(scene)
      const occasion = rng.pick([
        {
          said: 'I’ve got a job interview coming up',
          logged: 'has a job interview coming up',
          wish: 'Good luck with the interview',
        },
        {
          said: 'I’m in a wedding soon',
          logged: 'is in a wedding soon',
          wish: 'Enjoy the wedding',
        },
        {
          said: 'we’re taking family photos soon',
          logged: 'has family photos coming up',
          wish: 'Enjoy the photos',
        },
      ])
      return {
        summary: `${caller.name} ${occasion.logged} and booked ${service.spoken} with ${barber} for ${slot.logged}.`,
        lines: [
          greeting(scene),
          [
            'caller',
            `Hey, ${occasion.said} and I need to look sharp. Can I get ${service.spoken} ${slot.asked}?`,
          ],
          ['agent', `Let’s get you ready. ${barber} has ${slot.when}. Should I book it?`],
          ['caller', 'Yes please.'],
          ['agent', 'And your name?'],
          ['caller', `${caller.name}.`],
          [
            'agent',
            `You’re all set, ${caller.first}. ${service.name} with ${barber}, ${slot.when}. ${occasion.wish}.`,
          ],
          ['caller', 'Thanks a lot.'],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'regular',
    asksForBarber: true,
    write(scene) {
      const { caller, service, barber } = scene
      const slot = slotWords(scene)
      return {
        summary: `Regular client. ${caller.name} booked the usual ${service.name.toLowerCase()} with ${barber} for ${slot.logged}.`,
        lines: [
          greeting(scene),
          [
            'caller',
            `Hey, it’s ${caller.first}. Same as always, ${service.spoken} with ${barber}. When’s the next opening?`,
          ],
          ['agent', `Hi ${caller.first}. The next one with ${barber} is ${slot.when}.`],
          ['caller', 'I’ll take it.'],
          ['agent', `Booked. ${service.name} with ${barber}, ${slot.when}. Anything else?`],
          ['caller', 'Nope, that’s it.'],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
  {
    id: 'second-choice',
    write(scene) {
      const { caller, service, barber } = scene
      const slot = slotWords(scene)
      const wanted = clockTime(scene.taken)
      return {
        summary: `${caller.name} wanted ${wanted}, which was taken. Booked ${service.spoken} with ${barber} for ${slot.logged}.`,
        lines: [
          greeting(scene),
          ['caller', `Can I get ${service.spoken} ${slot.asked} around ${wanted}?`],
          ['agent', `${wanted} is taken. The closest I have is ${slot.time} with ${barber}.`],
          ['caller', `Hmm. Okay, ${slot.time} works.`],
          ['agent', 'Great. What’s the name?'],
          ['caller', `${caller.name}.`],
          [
            'agent',
            `Thanks, ${caller.first}. That’s ${service.spoken} with ${barber}, ${slot.when}.`,
          ],
          ['caller', 'Sounds good.'],
          ['agent', `See you ${slot.when}.`],
        ],
      }
    },
  },
]

// ── Answered: handled on the call, nothing booked ──────────────────────────

const ANSWERED: readonly Conversation[] = [
  {
    id: 'hours',
    named: false,
    write(scene) {
      const closes = clockTime(scene.close)
      const now = phase(scene)
      if (now === 'before_open') {
        const opens = clockTime(scene.open)
        return {
          summary: `Asked what time the shop opens. Told ${opens}, closing at ${closes}.`,
          lines: [
            greeting(scene),
            ['caller', 'Hi, what time do you open today?'],
            ['agent', `We open at ${opens} today and close at ${closes}.`],
            ['caller', 'Okay, thank you.'],
            ['agent', 'You’re welcome. Have a good one.'],
          ],
        }
      }
      if (now === 'after_close') {
        const reopens = clockTime(scene.opensTomorrow)
        return {
          summary: `Called after closing to ask if the shop was still open. Told it reopens at ${reopens} the next day.`,
          lines: [
            greeting(scene),
            ['caller', 'Hey, are y’all still open?'],
            [
              'agent',
              `We closed at ${closes} today. We open again tomorrow at ${reopens}. I can book you a time now if you’d like.`,
            ],
            ['caller', 'No, that’s okay. I’ll call tomorrow.'],
            ['agent', 'Sounds good. Have a good night.'],
          ],
        }
      }
      return {
        summary: `Asked what time the shop closes (${closes}). Didn’t book; plans to walk in.`,
        lines: [
          greeting(scene),
          ['caller', 'Hey, what time are y’all open till today?'],
          [
            'agent',
            `We’re open until ${closes} today. The last appointment starts half an hour before that.`,
          ],
          ['caller', 'Cool, thanks.'],
          ['agent', 'Anytime. Want me to book you a spot while you’re on the line?'],
          ['caller', 'No, I’ll just walk in.'],
          ['agent', 'Sounds good. See you soon.'],
        ],
      }
    },
  },
  {
    id: 'prices',
    named: false,
    write(scene) {
      const [first, second] = scene.rng.shuffle([
        SERVICES.skinFade,
        SERVICES.classicCut,
        SERVICES.kidsCut,
        SERVICES.hotTowelShave,
        SERVICES.beardTrim,
      ])
      return {
        summary: `Asked for prices: ${first.name.toLowerCase()} ($${first.price}) and ${second.name.toLowerCase()} ($${second.price}). Didn’t book.`,
        lines: [
          greeting(scene),
          ['caller', `How much do y’all charge for ${first.spoken}?`],
          ['agent', `${capitalize(first.spoken)} is $${first.price}.`],
          ['caller', `And ${second.spoken}?`],
          [
            'agent',
            `${capitalize(second.spoken)} is $${second.price}. Prices are the same with every barber.`,
          ],
          ['caller', 'Alright, appreciate it.'],
          ['agent', 'You’re welcome. Call back any time to book.'],
        ],
      }
    },
  },
  {
    id: 'barber-today',
    named: false,
    write(scene) {
      const barber = scene.rng.pick(scene.barbers)
      const first = addMinutes(nextHalfHour(scene.at), 60)
      const second = addMinutes(first, 90)
      const roomToday = phase(scene) === 'open' && addMinutes(second, 30) <= scene.close
      if (roomToday) {
        const times = `${clockTime(first)} and ${clockTime(second)}`
        return {
          summary: `Asked if ${barber} was working. Offered ${barber}’s openings at ${times}; the caller will call back.`,
          lines: [
            greeting(scene),
            ['caller', `Is ${barber} working today?`],
            ['agent', `${barber} has openings today at ${times}. Want me to book one?`],
            ['caller', 'Not yet, I need to check with work first. I’ll call back.'],
            ['agent', 'No problem. Talk soon.'],
          ],
        }
      }
      const tomorrow = clockTime(addMinutes(scene.opensTomorrow, 60))
      return {
        summary: `Asked if ${barber} was working. Nothing left that day, so offered ${tomorrow} the next morning. The caller will call back.`,
        lines: [
          greeting(scene),
          ['caller', `Is ${barber} working today?`],
          [
            'agent',
            `${barber} doesn’t have anything left today. The next opening is tomorrow at ${tomorrow}. Want me to book it?`,
          ],
          ['caller', 'Let me check my schedule and call back.'],
          ['agent', 'No problem. Talk soon.'],
        ],
      }
    },
  },
  {
    id: 'directions',
    named: false,
    write(scene) {
      return {
        summary: 'Asked for the address and where to park.',
        lines: [
          greeting(scene),
          ['caller', 'Where are y’all located? Is there parking?'],
          ['agent', `We’re at ${scene.street}. ${scene.parking}`],
          ['caller', 'Got it, thanks.'],
          ['agent', 'You’re welcome. See you soon.'],
        ],
      }
    },
  },
  {
    id: 'cancel-ahead',
    named: true,
    write(scene) {
      const { caller, rng } = scene
      const service = rng.pick([SERVICES.skinFade, SERVICES.classicCut, SERVICES.cutAndBeard])
      const barber = rng.pick(scene.barbers)
      const startsAt = addMinutes(scene.opensTomorrow, 30 * rng.int(2, 8))
      const time = clockTime(startsAt)
      return {
        summary: `${caller.name} cancelled ${service.spoken} with ${barber} booked for ${time} the next day. More than four hours’ notice, so no fee. Didn’t rebook.`,
        cancels: { service, barber, startsAt },
        lines: [
          greeting(scene),
          ['caller', `Hi, I need to cancel my appointment tomorrow. It’s under ${caller.name}.`],
          [
            'agent',
            `I see it, ${caller.first}: ${service.spoken} with ${barber}, tomorrow at ${time}. That’s more than four hours away, so there’s no fee. Do you want to pick a new time?`,
          ],
          ['caller', 'Not right now. I’ll call back when I know my week.'],
          ['agent', 'No problem. It’s cancelled. Take care.'],
        ],
      }
    },
  },
  {
    id: 'payment',
    named: false,
    write(scene) {
      return {
        summary: 'Asked about Apple Pay and gift cards. The shop has both.',
        lines: [
          greeting(scene),
          ['caller', 'Quick question, do y’all take Apple Pay?'],
          ['agent', 'We do. Cards, Apple Pay, Google Pay and cash are all fine.'],
          ['caller', 'And do you sell gift cards?'],
          ['agent', 'Yes, in the shop, for any amount from $20.'],
          ['caller', 'Great, thanks.'],
          ['agent', 'Anytime.'],
        ],
      }
    },
  },
  {
    id: 'not-offered',
    named: false,
    write(scene) {
      const ask = scene.rng.pick([
        { question: 'Do you do hair color?', answer: 'We don’t do color.', what: 'hair color' },
        { question: 'Do y’all do braids?', answer: 'We don’t do braids.', what: 'braids' },
        {
          question: 'Do y’all do eyebrow threading?',
          answer: 'We don’t do threading.',
          what: 'eyebrow threading',
        },
      ])
      return {
        summary: `Asked whether the shop does ${ask.what}. It doesn’t; the caller was told what the shop offers.`,
        lines: [
          greeting(scene),
          ['caller', ask.question],
          [
            'agent',
            `${ask.answer} We do cuts, fades, beard work and hot towel shaves. Would any of those help?`,
          ],
          ['caller', 'No, that’s all I needed. Thanks.'],
          ['agent', 'You’re welcome. Have a good one.'],
        ],
      }
    },
  },
]

// ── Message: Jarvis took a message for the shop ────────────────────────────

const MESSAGES: readonly Conversation[] = [
  {
    id: 'supplier',
    named: true,
    write(scene) {
      const vendor = scene.rng.pick(VENDORS)
      const first = vendor.name.split(' ')[0]
      return {
        summary: `${vendor.name} from ${vendor.company} called for the owner: ${vendor.noted}. Wants a call back at this number.`,
        caller: { name: vendor.name, phone: vendor.phone },
        lines: [
          greeting(scene),
          [
            'caller',
            `Hi, this is ${first} with ${vendor.company}. I’m trying to reach the owner about ${vendor.about}.`,
          ],
          [
            'agent',
            'The owner isn’t on the phones today, but I can take a message and make sure it gets to them.',
          ],
          ['caller', `Sure. Tell them ${vendor.said}. They can call me back at this number.`],
          [
            'agent',
            `Got it. ${first} from ${vendor.company}, about ${vendor.about}, call back at this number. I’ll pass it along today.`,
          ],
          ['caller', 'Thanks so much.'],
          ['agent', 'You’re welcome. Goodbye.'],
        ],
      }
    },
  },
  {
    id: 'left-something',
    named: true,
    write(scene) {
      const { caller, rng } = scene
      const barber = rng.pick(scene.barbers)
      const item = rng.pick([
        { mine: 'my AirPods case', logged: 'an AirPods case' },
        { mine: 'my Astros cap', logged: 'an Astros cap' },
        { mine: 'my phone charger', logged: 'a phone charger' },
        { mine: 'my sunglasses', logged: 'a pair of sunglasses' },
      ])
      return {
        summary: `${caller.name} may have left ${item.logged} at ${barber}’s station. Message left for the team to look and call back.`,
        lines: [
          greeting(scene),
          [
            'caller',
            `Hey, I was in for a cut earlier and I think I left ${item.mine} at ${barber}’s station.`,
          ],
          [
            'agent',
            'I can’t see the shop floor from here, but I’ll leave a message for the team to look. What’s your name?',
          ],
          ['caller', `${caller.name}.`],
          [
            'agent',
            `Thanks, ${caller.first}. I’ve passed it on. Someone will call or text you at this number once they’ve looked.`,
          ],
          ['caller', 'Thank you.'],
          ['agent', 'You’re welcome.'],
        ],
      }
    },
  },
  {
    id: 'looking-for-a-chair',
    named: true,
    write(scene) {
      const { caller, rng } = scene
      const years = rng.int(4, 12)
      const from = rng.pick(['Houston', 'San Antonio', 'Dallas', 'El Paso'])
      return {
        summary: `${caller.name}, a licensed barber with ${years} years’ experience, asked about an open chair. Details passed to the owner.`,
        lines: [
          greeting(scene),
          ['caller', `Hey, I’m a barber, just moved here from ${from}. Are y’all hiring or renting chairs?`],
          [
            'agent',
            'I’m the shop’s assistant, so that one is for the owner. I can take your details and pass them on. What’s your name, and how long have you been cutting?',
          ],
          ['caller', `${caller.name}. ${years} years, licensed in Texas.`],
          [
            'agent',
            `Thanks, ${caller.first}. I’ll pass that to the owner, and they’ll reach out at this number if a chair opens up.`,
          ],
          ['caller', 'Appreciate you.'],
          ['agent', 'Good luck with the move.'],
        ],
      }
    },
  },
]

// ── Transferred: handed to a person at the shop ────────────────────────────

const TRANSFERS: readonly Conversation[] = [
  {
    id: 'unhappy-with-cut',
    named: true,
    write(scene) {
      const { caller, rng } = scene
      return {
        summary: `${caller.name} was unhappy with a fade from the day before and asked for a person. Transferred to the front desk.`,
        holdSeconds: rng.int(25, 70),
        lines: [
          greeting(scene),
          [
            'caller',
            'I got a cut there yesterday and the fade is uneven on one side. I want to talk to somebody.',
          ],
          [
            'agent',
            'I’m sorry about that. The shop will want to make it right, so I’m going to put you through to the front desk. Can I get your name first?',
          ],
          ['caller', `${caller.name}.`],
          ['agent', `Thanks, ${caller.first}. Connecting you now. Please hold.`],
        ],
      }
    },
  },
  {
    id: 'group-booking',
    named: false,
    write(scene) {
      const groomsmen = scene.rng.pick(['five', 'six', 'seven'])
      return {
        summary: `Wants to bring in ${groomsmen} groomsmen before a wedding next month. Groups over four are booked by the shop, so the call was transferred to the front desk.`,
        holdSeconds: scene.rng.int(20, 55),
        lines: [
          greeting(scene),
          [
            'caller',
            `Hi, I’m getting married next month and I want to bring my groomsmen in. There’s ${groomsmen} of us. Can we book a morning?`,
          ],
          [
            'agent',
            'Congratulations. For groups of more than four, the shop sets it up directly so they can block out the chairs. Let me put you through to the front desk.',
          ],
          ['caller', 'Great, thank you.'],
          ['agent', 'One moment. Connecting you now.'],
        ],
      }
    },
  },
  {
    id: 'card-charge',
    named: false,
    write(scene) {
      return {
        summary: 'Asked for a person about a charge on a card. Transferred to the front desk.',
        holdSeconds: scene.rng.int(30, 80),
        lines: [
          greeting(scene),
          ['caller', 'Can I talk to a real person?'],
          [
            'agent',
            'I’m Jarvis, the shop’s assistant. I can book, move or cancel appointments and answer most questions. What do you need?',
          ],
          ['caller', 'It’s about a charge on my card. I’d rather talk to someone at the shop.'],
          ['agent', 'Understood. Card questions go to the front desk. Transferring you now.'],
        ],
      }
    },
  },
]

// ── Failed: the call started but broke. The last line is cut off ───────────

const FAILURES: readonly Conversation[] = [
  {
    id: 'bad-audio',
    named: false,
    write(scene) {
      return {
        summary:
          'The caller’s audio kept cutting out and the line dropped before Jarvis could take the booking.',
        lines: [
          greeting(scene),
          ['caller', 'Yeah hi, I wanted to see if I could get a—'],
          ['agent', 'Sorry, you cut out for a second. Could you say that again?', 2],
          ['caller', 'I said can I get a fade on Sat—', 2],
        ],
      }
    },
  },
  {
    id: 'agent-stalled',
    named: false,
    write(scene) {
      return {
        summary:
          'Jarvis stopped responding while looking up an appointment, and the call ended with an error. The caller wasn’t helped.',
        lines: [
          greeting(scene),
          ['caller', 'Hi, I need to move my appointment to next week.'],
          ['agent', 'Sure, I can help with that. Let me pull up your appoint—'],
        ],
      }
    },
  },
  {
    id: 'transfer-dropped',
    named: false,
    write(scene) {
      const barber = scene.rng.pick(scene.barbers)
      return {
        summary: `The caller wanted to reach ${barber}. The transfer to the front desk failed and the call dropped.`,
        lines: [
          greeting(scene),
          ['caller', `Hey, can you put me through to the shop? I need to ask ${barber} something.`],
          ['agent', 'Sure. Connecting you to the front desk now. Please ho—'],
        ],
      }
    },
  },
]

/** Conversations for every outcome where words were exchanged and nothing was booked. */
export const CONVERSATIONS: Record<
  Exclude<CallOutcome, 'booked' | 'missed'>,
  readonly Conversation[]
> = {
  answered: ANSWERED,
  message: MESSAGES,
  transferred: TRANSFERS,
  failed: FAILURES,
}

/** A missed call has no transcript, only how long it rang. */
export function missedCallSummary(seconds: number): string {
  if (seconds <= 1) return 'The call never connected. Nobody was on the line when Jarvis picked up.'
  return `The caller hung up after ${seconds} seconds, before the greeting finished.`
}

/**
 * The one hand-written call: a regular cancels late and asks not to be
 * charged. Jarvis can't decide that, so it becomes a request on Home.
 */
export function lateCancellationScript(scene: Scene, barber: string, startsAt: Date): Script {
  const { first, name } = LATE_CANCEL_CUSTOMER
  const service = SERVICES.skinFade
  const time = clockTime(startsAt)
  return {
    summary: `${name} cancelled his ${time} skin fade with ${barber} inside the four-hour window and asked not to be charged the $10 fee. Jarvis asked the owner.`,
    cancels: { service, barber, startsAt },
    lines: [
      ['agent', `Thanks for calling ${scene.shopName}, this is Jarvis. How can I help?`],
      [
        'caller',
        `Hey, it’s ${name}. I’ve got ${service.spoken} with ${barber} at ${time} today, but my shift just got moved. I need to cancel.`,
      ],
      [
        'agent',
        `Sorry to hear that, ${first}. I can cancel it. It’s inside the four-hour window, though, so there’s a $10 late-cancellation fee before your next booking.`,
      ],
      [
        'caller',
        'Come on. I’ve been coming in since June and I’ve never missed one. I didn’t pick the shift change.',
      ],
      [
        'agent',
        `I hear you. I can’t waive the fee myself, but I’ll ask the owner and text you the answer today. Either way, your appointment is cancelled, so ${barber} isn’t left waiting.`,
      ],
      ['caller', 'Alright. I’d appreciate that.'],
      ['agent', `You’ll hear back today. Thanks for letting us know, ${first}.`],
    ],
  }
}
