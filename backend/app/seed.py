"""Demo data so the app has something to show.

Run it on purpose (never on startup):  python -m app.seed   (or `make seed`)
It only seeds an empty database, so running it twice is safe.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

import asyncpg

from .config import settings
from .db import _init_conn

USERS = [
    (1, "Ram D.", "RD", "Bengaluru", 2021, True, 100, 58, "~30 min"),
    (2, "Priya S.", "PS", "Bengaluru", 2019, True, 99.4, 312, "~1 hr"),
    (3, "Arjun M.", "AM", "Bengaluru", 2022, True, 98.0, 24, "~2 hr"),
    (4, "Neha R.", "NR", "Bengaluru", 2020, True, 100, 41, "~1 hr"),
    (5, "Sri Sai Motors", "SS", "Bengaluru", 2018, True, 97.5, 880, "~15 min"),
    (6, "Kavya N.", "KN", "Bengaluru", 2023, False, 100, 6, "~3 hr"),
    (7, "Rahul V.", "RV", "Bengaluru", 2021, False, 96.0, 15, "~4 hr"),
]


def _listings(t: datetime) -> list[tuple]:
    def L(id, seller, title, cat, fmt, price, loc, km, mins_ago, *, buy_now=None, bid=None, bids=0,
          closes_h=None, cond="Used · good", specs=(), desc="", featured=False, views=0, status="active"):
        return (id, seller, title, cat, fmt, price, buy_now, bid, bids,
                t + timedelta(hours=closes_h) if closes_h else None,
                loc, km, cond, [{"k": k, "v": v} for k, v in specs], desc, featured, views,
                status, t - timedelta(minutes=mins_ago))

    return [
        L(1, 1, "iPhone 13 128GB, midnight, unlocked", "Mobiles", "auction", 1, "Koramangala", 0.8, 120,
          buy_now=38000, bid=31500, bids=11, closes_h=3.2, cond="Used · excellent",
          specs=[("Condition", "Used · excellent"), ("Storage", "128 GB"), ("Battery", "89%"), ("Network", "Unlocked")],
          desc="Upgraded so selling my iPhone 13. Always had a case and screen protector on, no scratches on the screen. "
               "Battery health 89%. Original box and cable. Pick up in Koramangala or courier anywhere in India.",
          featured=True, views=214),
        L(2, 1, "Hercules geared cycle, 21-speed", "Bikes", "fixed", 8500, "Koramangala", 0.8, 600,
          specs=[("Condition", "Used · good"), ("Gears", "21-speed"), ("Frame", "18 inch"), ("Brakes", "Disc")],
          desc="Well kept geared cycle, serviced last month. All 21 gears work fine.", views=96),
        L(3, 1, "Cane armchair with cushion", "Home", "offer", 2400, "Koramangala", 0.8, 1440,
          specs=[("Condition", "Used · good"), ("Material", "Cane"), ("Cushion", "Included"), ("Pick up", "Only")],
          desc="Comfortable cane armchair with a washable cushion cover.", views=41),
        L(4, 2, "MacBook Air M2, 16GB", "Tech", "fixed", 78000, "Whitefield", 18, 60,
          specs=[("Condition", "Used · like new"), ("RAM", "16 GB"), ("Storage", "512 GB"), ("Warranty", "4 months")],
          desc="MacBook Air M2 in midnight, 41 battery cycles. Box, charger and bill included. Price dropped by ₹3,000.",
          featured=True, views=380),
        L(5, 4, "Kids' cycle, 20-inch", "Bikes", "free", 0, "BTM Layout", 2.5, 120,
          specs=[("Condition", "Used · fair"), ("Size", "20 inch"), ("Age", "6–10 yrs"), ("Pick up", "Only")],
          desc="My son outgrew it. Free to anyone who can pick it up this week.", views=57),
        L(6, 2, "Sheesham dining set", "Home", "auction", 5000, "Indiranagar", 4.2, 300,
          bid=14500, bids=14, closes_h=5.5, buy_now=22000,
          specs=[("Condition", "Used · excellent"), ("Seats", "6"), ("Wood", "Sheesham"), ("Delivery", "Available")],
          desc="Solid sheesham wood dining table with six chairs. Moving out sale.", views=190),
        L(7, 2, "iPhone 15 Pro 256GB, natural titanium", "Mobiles", "offer", 95000, "HSR Layout", 3.2, 25,
          cond="Used · like new",
          specs=[("Condition", "Used · like new"), ("Storage", "256 GB"), ("Battery", "98%"), ("Network", "Unlocked")],
          desc="Barely used, always in a case. Battery 98%. Bill and box included.", featured=True, views=420),
        L(8, 7, "iPhone 14 Plus 256GB, blue, with case", "Mobiles", "fixed", 52000, "Whitefield", 18, 180,
          specs=[("Condition", "Used · excellent"), ("Storage", "256 GB"), ("Battery", "91%"), ("Network", "Unlocked")],
          desc="Comes with two cases and a tempered glass.", views=88),
        L(9, 5, "iPhone 15 128GB, brand new, sealed box", "Mobiles", "fixed", 69900, "MG Road", 5.1, 240,
          cond="New", specs=[("Condition", "New"), ("Storage", "128 GB"), ("Warranty", "1 year"), ("Seller", "Dealer")],
          desc="Sealed box with 1-year Apple warranty. GST bill provided.", featured=True, views=132),
        L(10, 6, "iPhone SE (3rd gen) 64GB, starlight", "Mobiles", "offer", 18500, "Jayanagar", 9, 480,
          specs=[("Condition", "Used · good"), ("Storage", "64 GB"), ("Battery", "86%"), ("Network", "Unlocked")],
          desc="Works perfectly. Small scuff on the back.", views=44),
        L(11, 5, "2019 Maruti Swift VXI", "Cars", "fixed", 540000, "Jayanagar", 9, 2000,
          specs=[("Year", "2019"), ("Km", "42,000"), ("Fuel", "Petrol"), ("Owners", "1st owner")],
          desc="Single owner, full service history, insurance valid till March.", views=610),
        L(12, 2, "Mirrorless camera + 2 lenses", "Tech", "auction", 20000, "Koramangala", 1.1, 900,
          bid=42000, bids=6, closes_h=5,
          specs=[("Condition", "Used · excellent"), ("Lenses", "2"), ("Shutter", "8k"), ("Bag", "Included")],
          desc="Mirrorless body with kit lens and 50mm prime. Low shutter count.", views=150),
        L(13, 4, "Kids' scooter, adjustable", "Bikes", "fixed", 1200, "BTM Layout", 2.5, 9000,
          desc="Adjustable height, LED wheels.", status="sold"),
        L(14, 7, "2BHK flat for rent, Koramangala 5th Block", "Property", "fixed", 32000, "Koramangala", 0.6, 200,
          specs=[("Type", "2 BHK"), ("Area", "1,050 sq ft"), ("Furnishing", "Semi"), ("Deposit", "₹1,50,000")],
          desc="Bright east-facing flat near Forum Mall. Monthly rent shown.", views=301),
        L(15, 6, "Labrador puppy food, 10 kg (sealed)", "Pets", "fixed", 2900, "HSR Layout", 3.2, 360,
          cond="New", desc="Bought extra by mistake. Sealed bag, expiry next year.", views=19),
        L(16, 4, "Cotton kurta set, size M", "Fashion", "offer", 900, "BTM Layout", 2.5, 700,
          cond="New with tags", desc="Never worn, tags on.", views=23),
    ]


async def seed(conn: asyncpg.Connection) -> None:
    t = datetime.now(timezone.utc)
    await conn.executemany("INSERT INTO users VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", USERS)
    await conn.executemany(
        "INSERT INTO listings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19)",
        _listings(t))
    # Watchlist, with the price each item had when saved (the MacBook has dropped since).
    await conn.executemany(
        "INSERT INTO watches (user_id, listing_id, saved_price, created_at) VALUES ($1,$2,$3,$4)",
        [(1, 4, 81000, t - timedelta(days=2)), (1, 11, 540000, t - timedelta(days=1)),
         (1, 12, 38000, t - timedelta(hours=20)), (1, 9, 69900, t - timedelta(hours=6)),
         (1, 6, 13000, t - timedelta(hours=3))])
    # Ram leads on the dining set and has been outbid on the camera.
    await conn.executemany("INSERT INTO bids (listing_id, user_id, amount, created_at) VALUES ($1,$2,$3,$4)",
                           [(6, 1, 14500, t - timedelta(hours=1)), (12, 1, 41500, t - timedelta(hours=4)),
                            (12, 3, 42000, t - timedelta(hours=2))])
    await conn.execute("INSERT INTO purchases VALUES (1, 13, 'Collected')")
    await conn.executemany("INSERT INTO chats VALUES ($1,$2,$3,$4)",
                           [(1, 1, 3, 1), (2, 6, 1, 2), (3, 11, 1, 5), (4, 2, 6, 1), (5, 4, 1, 2)])

    def M(chat, sender, body, mins_ago, kind="text", amount=None, status=None, read=True):
        return (chat, sender, kind, body, amount, status, read, t - timedelta(minutes=mins_ago))

    await conn.executemany(
        "INSERT INTO messages (chat_id, sender_id, kind, body, amount, offer_status, read, created_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
            M(1, 3, "Hi Ram! Is it still available? Any scratches on the screen?", 9),
            M(1, 1, "Hi Arjun, yes! Screen's perfect, protector on since new.", 6),
            M(1, 3, "Pick up Saturday · UPI via Haat Pay", 2, kind="offer", amount=35000, status="pending", read=False),
            M(2, 1, "Is the table still available?", 40),
            M(2, 2, "Sure, Saturday 10am works", 18, read=False),
            M(3, 1, "Can I book a test drive?", 90),
            M(3, 5, "Test drive booked for Thursday", 60),
            M(4, 6, "Do all the gears work?", 200),
            M(4, 1, "Yes, all 21 gears work fine", 180),
            M(5, 1, "Is the MacBook still available?", 1500),
            M(5, 2, "Yes, still available. I dropped the price by ₹3,000.", 1440),
        ])
    await conn.executemany("INSERT INTO notifications (user_id, text, listing_id) VALUES ($1,$2,$3)",
                           [(1, "Price dropped on MacBook Air M2, 16GB", 4),
                            (1, "Mirrorless camera + 2 lenses closes in 5 hours", 12)])
    # Keep SERIAL counters ahead of the fixed ids above.
    for table in ("users", "listings", "chats"):
        await conn.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), (SELECT MAX(id) FROM {table}))")


async def main() -> int:
    conn = await asyncpg.connect(settings.database_url)
    try:
        await _init_conn(conn)
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(4242)")  # two seeds at once can't both insert
            if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users)"):
                print("Database already has users; nothing to seed.")
                return 0
            await seed(conn)
    except asyncpg.UndefinedTableError:
        print("Tables are missing. Run the migrations first: make migrate", file=sys.stderr)
        return 1
    finally:
        await conn.close()
    print("Seeded demo data.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
