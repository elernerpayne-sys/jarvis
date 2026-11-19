/**
 * The people who call the shops. Every phone number is in the reserved
 * 555-01xx range, so none of them can reach a real person.
 */
import type { Random } from '../random'

export interface Customer {
  /** Full name: "Miguel Herrera". */
  name: string
  first: string
  last: string
  phone: string
  /** Set for parents who book kids cuts. */
  child?: { name: string; age: number }
}

const CUSTOMER_NAMES = [
  'Miguel Herrera', 'Terrence Hall', 'Javier Morales', 'Chris Nguyen', 'Andre Whitfield',
  'Sanjay Patel', 'Lorenzo Ortega', 'Kevin O’Neal', 'Eli Thompson', 'Jordan Reyes',
  'Anthony Russo', 'Devon Carter', 'Isaiah Greene', 'Mateo Castillo', 'Noah Kim',
  'Tyrese Johnson', 'Brandon Lee', 'Carlos Mendoza', 'Victor Salazar', 'Ethan Walker',
  'Malik Robinson', 'Diego Fuentes', 'Ben Schultz', 'Rafael Dominguez', 'Jamal Edwards',
  'Trevor Banks', 'Nate Sullivan', 'Hector Ruiz', 'Dominic Price', 'Aaron Feldman',
  'Xavier Scott', 'Julian Park', 'Wes Harmon', 'Reggie Tate', 'Paulo Silva',
  'Ian McAllister', 'Caleb Turner', 'Omar Haddad', 'Tony Delgado', 'Jesse Ramirez',
  'Kyle Brennan', 'DeShawn Miller', 'Arturo Vega', 'Peter Lindqvist', 'Emmanuel Okafor',
  'Ricky Trujillo', 'Josh Becker', 'Darius Coleman', 'Felipe Cardenas', 'Grant Hollis',
  'Minh Tran', 'Andy Kowalczyk', 'Leon Hayes', 'Sergio Peña', 'Will Abernathy',
  'Kwame Mensah', 'Bobby Trevino', 'Dylan Foster', 'Ahmed Siddiqui', 'Cory Jenkins',
  'Eduardo Luna', 'Travis Maddox', 'Pablo Guerrero', 'Scott Fitzpatrick', 'Lamar Jennings',
  'Gabe Navarro', 'Tomás Ibarra', 'Derek Yoon', 'Rashad Ellis', 'Oscar Benitez',
  'Mitch Gallagher', 'Jerome Watts', 'Ivan Petrov', 'Enrique Solis', 'Colin Reeves',
  'Tariq Hassan', 'Vince Romano', 'Abel Montoya', 'Shawn Griffin', 'Raj Malhotra',
  'Nick Papadakis', 'Elijah Moore', 'Fernando Ríos', 'Hunter Lawson', 'Jalen Pierce',
  'Marco Bianchi', 'Preston Hale', 'Cesar Villanueva', 'Dante Rhodes', 'Louis Tran',
  'Zach Mercer', 'Alonzo Reed', 'Bryce Calloway', 'Emilio Zamora', 'Gus Lindholm',
  'Kenji Watanabe', 'Roland Dupree', 'Simon Achebe', 'Tyler Vance', 'Quentin Shaw',
] as const

/** Parents who call to book a kids cut for a son. */
const PARENTS = [
  { name: 'Maria Alvarez', child: { name: 'Leo', age: 7 } },
  { name: 'Jessica Tran', child: { name: 'Owen', age: 9 } },
  { name: 'Priya Raman', child: { name: 'Arjun', age: 6 } },
  { name: 'Danielle Foster', child: { name: 'Micah', age: 10 } },
  { name: 'Stephanie Cole', child: { name: 'Jonah', age: 8 } },
  { name: 'Rosa Jimenez', child: { name: 'Santi', age: 5 } },
  { name: 'Tasha Williams', child: { name: 'Jayden', age: 11 } },
  { name: 'Brian Keller', child: { name: 'Max', age: 8 } },
  { name: 'Amira Haddad', child: { name: 'Yusuf', age: 7 } },
  { name: 'Lauren Bishop', child: { name: 'Henry', age: 4 } },
] as const

/** Suppliers who call for the owner. */
export const VENDORS = [
  {
    name: 'Denise Kowalski',
    company: 'Lone Star Barber Supply',
    phone: '+15125550171',
    about: 'the clipper blades on back order',
    said: 'the blades came in and they ship on Thursday',
    noted: 'the back-ordered clipper blades came in and ship on Thursday',
  },
  {
    name: 'Paul Whitaker',
    company: 'Capital City Linen',
    phone: '+15125550172',
    about: 'next week’s towel delivery',
    said: 'next week’s towel delivery is moving from Tuesday to Wednesday',
    noted: 'next week’s towel delivery moves from Tuesday to Wednesday',
  },
  {
    name: 'Gina Marsh',
    company: 'Hill Country Sharpening',
    phone: '+15125550173',
    about: 'the shears that are due for sharpening',
    said: 'I can pick up the shears on Friday morning and have them back Monday',
    noted: 'she can pick up the shears on Friday morning and return them Monday',
  },
] as const

/**
 * The regular whose late cancellation is waiting for the owner's decision on
 * Home. Kept out of the random pool so he only appears in that one story.
 */
export const LATE_CANCEL_CUSTOMER: Customer = {
  name: 'Darnell Brooks',
  first: 'Darnell',
  last: 'Brooks',
  phone: '+15125550134',
}

/** Last two digits already taken: the owner, the three shops, vendors, Darnell. */
const RESERVED_512 = new Set([0, 18, 34, 42, 67, 71, 72, 73])
/** Austin first, then people who kept an out-of-town number. */
const AREA_CODES = ['512', '737', '210', '713'] as const

function splitName(name: string): { first: string; last: string } {
  const [first, ...rest] = name.split(' ')
  return { first, last: rest.join(' ') }
}

/** Every 555-01xx number in those area codes that is not spoken for. */
function phonePool(rng: Random): string[] {
  const numbers: string[] = []
  for (const area of AREA_CODES) {
    for (let n = 0; n < 100; n++) {
      if (area === '512' && RESERVED_512.has(n)) continue
      numbers.push(`+1${area}55501${String(n).padStart(2, '0')}`)
    }
  }
  return rng.shuffle(numbers)
}

export interface Cast {
  /** The next named caller for this shop. Regulars come round again eventually. */
  customer(shopId: string): Customer
  /** A parent with a son who needs a haircut. */
  parent(): Customer
  /** A number nobody at the shop recognises. */
  strangerPhone(): string
}

/**
 * Gives every customer a phone number and a home shop, then deals them out
 * so the same name does not show up twice in a row. `shares` says how many
 * regulars each shop has relative to the others.
 */
export function createCast(rng: Random, shares: Readonly<Record<string, number>>): Cast {
  const phones = phonePool(rng)
  let nextPhone = 0
  const takePhone = () => phones[nextPhone++ % phones.length]
  const withPhone = (name: string): Customer => ({ name, ...splitName(name), phone: takePhone() })

  const customers = rng.shuffle(CUSTOMER_NAMES.map(withPhone))
  const parents = rng.shuffle(
    PARENTS.map((parent) => ({ ...withPhone(parent.name), child: { ...parent.child } })),
  )

  // Each customer belongs to one shop, the way regulars do.
  const shopIds = Object.keys(shares)
  const totalShare = shopIds.reduce((sum, id) => sum + shares[id], 0)
  const byShop = new Map<string, Customer[]>()
  let dealt = 0
  let shareSoFar = 0
  for (const id of shopIds) {
    shareSoFar += shares[id]
    const upTo = Math.round((shareSoFar / totalShare) * customers.length)
    byShop.set(id, customers.slice(dealt, upTo))
    dealt = upTo
  }

  const position = new Map<string, number>()
  function deal(key: string, deck: readonly Customer[]): Customer {
    const index = position.get(key) ?? 0
    position.set(key, index + 1)
    return deck[index % deck.length]
  }

  return {
    customer(shopId) {
      const deck = byShop.get(shopId)
      return deal(shopId, deck && deck.length > 0 ? deck : customers)
    },
    parent: () => deal('parents', parents),
    strangerPhone: takePhone,
  }
}
