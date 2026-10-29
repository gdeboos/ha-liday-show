<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# The public page

[← Play it and playlists](play-it.md) · [Contents](README.md) · [Automations →](automations.md)

## The public page

The public page lets people passing by start a show from their phone, usually by scanning a QR code
on a sign outside. They see the shows and playlists you've picked, and nothing else of HA-liday Show.

1. Open **Setup → Settings** and turn on **Let visitors start shows** under **Public page**. A **Public
   page** tab appears along the top.
2. On the **Public page** tab, open **Shows** and, under **What visitors can pick**, choose a show or
   playlist next to **+ Add** and press it. Add as many as you like.
3. To try it, open the **Visitors' link** (on **Access**, under **Who can start shows**) on your phone, connected to
   your home Wi-Fi. It's HA-liday Show's address with `:18099` and your code on the end, such as
   `http://192.168.1.20:18099/?c=5fjzqr26`.

Down the left (along the top on a phone) is a list of five pages, as in **Library** and **Setup**, and
the last one you had open is remembered. **▶ Open the page**, at the top, opens your real visitors'
link in a new tab.

| Page | What's there |
| --- | --- |
| **Access** | [Who can start shows](#who-can-start-shows) and [Opening hours](#opening-hours) |
| **Shows** | [What visitors can pick](#what-visitors-can-pick), and [On the page](#on-the-page): how long each lasts and the flashing lights warning |
| **Look** | [How the page looks](#how-the-page-looks): title, welcome, picture, colours, style and the link at the bottom |
| **Words** | [Every message visitors read](#words), to change to your own |
| **Queue** | [The visitors' queue](#visitors-queue) and its limits |

Beside them (below them on a narrower screen) the **Preview** shows the page as visitors with your
code see it, and catches up as soon as you change something. Its buttons don't start anything.

### Who can start shows

Visitors need the link with your code in it; the QR code on your sign holds it. Opening the page
without the code just says "Scan the code on the sign to start a show".

- **Public address** is the web address your tunnel or proxy gives the public page, such as
  `https://lights.yourdomain.com`. The **Visitors' link** uses it. Leave it empty if visitors only use
  your home Wi-Fi.
- **Copy** copies the link. **New code…** makes a new one, if the link has been shared somewhere it
  shouldn't be. The old link (and any QR code you've printed) stops working.
- **Print sign…** opens an A4 sign in a new tab: your **Title** (in your heading colour, if it reads
  well on white paper), "Scan to start a light show", a big QR code with your visitors' link, your
  opening hours, the **Message on the sign** you type above the button, and the link written out
  for anyone without a camera app. Press **Print sign** there, or **Download QR code** for the code on
  its own as a picture. Set the **Public address** first, so the code takes people to your page from
  the street. Check your phone's camera reads it before you put the sign up, and print a new one
  after **New code…**.
- **Nearby only within … m** (on to start with, at 100 m; anything from 25 to 2000 m): a phone
  reaching the page through the internet must be that close to your house to start a show.
  - As the page opens, the phone asks to share its location. It's only used for this check and isn't
    kept.
  - **▶ Start** only appears once they're close enough. Further away, they see "You're too far away to
    start a show", with the shows listed but no buttons. The page keeps checking while it's open, so
    walking up brings the buttons.
  - A phone that won't share its location is told how to allow it, with **Try again**.
  - Phones on your home Wi-Fi aren't asked. Anyone coming through a tunnel or proxy always is, even
    one set up on the Home Assistant machine itself. (With Docker, keep the host networking from the
    example `docker-compose.yml`, so HA-liday Show sees which phone is which.)
  - Your house is your home location in Home Assistant (**Settings → System → General**), or the one
    you typed in for sunset on the **Schedule** tab. Without either, visitors
    through the internet can't start shows at all until you set one, and the tab says so.
  - The distance is measured generously: a phone that isn't sure where it is gets up to 150 m extra.
    The check stops casual use from afar, but a determined person could fake where their phone is,
    so keep **Queue length** small.

### Opening hours

Off to start with, so visitors can start shows at any time. Turn on **Only open at set times** to choose
when:

- **Opens**: at a time, or at sunset with a number of minutes after it (or before, if less than
  0), so the opening time moves with the sunset through the year.
- **Closes**: at a time. With a set start, a time before it means after midnight, such as 17:00 until
  01:00. With a sunset start, a closing time before midday is the next morning, and any other is
  that evening; on a day the sun sets after it, the page doesn't open (in summer, say, with a 22:00
  close).
- **On these days**: press a day to turn it on or off.

The line underneath says whether the page is open now, or when it next opens. Sunset is worked out
for your home location, as for playlists; without one, a sunset start never opens, and it says so.

Outside the hours, visitors see when to come back ("Shows start at 5pm. Come back then!", "Shows
start tomorrow at 4:32pm" or "on Saturday at 5pm"), with your shows listed but no **▶ Start**
buttons. Their phones aren't asked for their location until it opens. Anyone already waiting in the
queue at closing time still gets their show. Each show's own dates (below) still apply within the
hours.

### How the page looks

On the **Look** tab, in four groups: **Title and welcome**, **Picture at the top**, **Colours and
style** and **Link at the bottom**. The preview beside them shows each change as you make it.

- **Title** replaces "🎄 Light show" at the top, and **Welcome** adds a line or two under it.
- **Picture at the top**: **None**, **Your house photo** (from **Setup → House**), or **Your own
  picture**, chosen with **Choose picture…** (JPEG, PNG or WebP). Your own picture is kept with your
  other settings, and in **Export…**, even while another is picked, so you can switch back. Visitors
  with the page open see a new picture within a few seconds.
- **Colours**: **Plain**, **Classic Christmas**, **Frosty** or **Halloween**, with **Light or dark**:
  **Follow the phone**, **Light** or **Dark**. Every combination is easy to read.
- **Your own colours**, the last choice under **Colours**, gives you pickers for **Background**,
  **Cards**, **Text**, **Headings** and **Buttons**. Small print and borders are mixed from your text
  and background, and the words on buttons are black or white, whichever reads better. Underneath,
  it says whether everything is easy to read, or which pairs aren't.
- **Spacing** (**Compact**, **Normal** or **Roomy**), **Corners** (**Square**, **Soft** or **Round**),
  **Text size** (**Small**, **Normal** or **Large**) and **Card borders** (on or off) change the
  layout, and always fit a phone.
- **Falling snow** drifts behind the page. It's left out for anyone whose phone is set to reduce
  motion.
- **Link at the bottom**: its **Web address** and **Its words**, for a charity, donation or social page, if
  you like.

The title, words and picture only show to people with your code.

### What visitors can pick

- **+ Add** offers your saved shows and playlists. Archived shows aren't offered, nor are playlists
  made only of archived shows, and visitors never see them. A show you archive later disappears from
  the public page straight away, and from inside any playlist visitors pick. The tab still lists it,
  marked as archived, so it comes back if you restore it. A show whose lights' frames were never made
  (it was saved before they reached HA-liday Show, say) is made ready when the tab opens; if that
  can't be done it's listed greyed out, and opening and saving it fixes it.
- **Only from … until … every year**: each show or playlist is available all year until you turn on
  **Only from** and pick the first and last day, such as 1 Dec until 6 Jan. The dates come round every
  year, and can run over New Year. Outside them, visitors see it greyed out under **Coming soon** with
  the day it starts ("From 1 December"). When nothing can be picked yet, the page says when the first
  one starts: "Coming soon on 1 December".
- **Remove** takes something off the public page; the show or playlist itself stays.

### On the page

Also on the **Shows** tab:

- **Show how long each lasts** (on to start with) puts "About 3 minutes" under each show's name,
  worked out from the show. Turn it off for just the names.
- **Flashing lights warning**, for shows with strobes or fast flashes:
  - **Off** (to start with).
  - **A note at the top**: a boxed warning above the shows, always there.
  - **Ask visitors to accept it before Start**: the same note with an **I understand** button, and no
    **▶ Start** buttons until it's pressed. It's asked once per visit.

  The warning's words, and the button's, are on the **Words** tab.

### Words

Every message visitors read is on the **Words** tab, in groups: the top of the page, the list of
shows, a visitor's own pick, opening hours, **Nearby only**, the flashing lights warning, the closed
and "scan the code" pages, and the sign's "Scan to start a light show". (Your title and welcome are
on the **Look** tab.)

- Each box starts with the wording shown. Type your own and it's saved when you leave the box; the
  preview shows it straight away.
- Parts in curly brackets are filled in as the page runs: `{name}` (a show), `{count}`, `{minutes}`
  ("2 minutes"), `{place}` ("3rd"), `{day}` ("1 December") and `{when}` ("at 5pm", "tomorrow at
  4:32pm"). Keep them where you'd like them, or leave them out.
- **Reset**, next to a word you've changed, puts it back. Emptying a box does the same. **Put every
  word back** resets them all; your title, welcome and link stay.
- The same words are used when HA-liday Show itself turns a request down ("The queue is full…",
  "You're too far away…"), so visitors see your wording there too.

### Visitors' queue

What visitors get:

- **If nothing's on**, their pick starts straight away.
- **If something's on**, they're told where they are in the queue and roughly how long it'll be, such
  as "You're next, starting in about 2 minutes". They can **Cancel** while they wait.
- **During one of your playlists**, a visitor's pick plays after the show that's on, then your
  playlist carries on with its next show. A scheduled playlist that's due to start waits until a
  visitor's show has finished.
- **A playlist** a visitor picks plays its shows through once, not round and round, without its
  building blocks.
- **The music** plays on the show's **Show speaker** (or your default one), as it does for playlists.
  A show with no speaker plays its lights only, unless the
  [Show player](play-it.md#music-with-no-speaker-the-show-player) is open.
- Visitors can't stop or skip anyone else's show.

Keeping it fair:

- **Requests per phone** is how many shows one phone can have waiting (1 to start with). Once a
  visitor's show starts, they can pick another. It's a courtesy limit that someone determined could
  get round; **Queue length** is the one that holds.
- **Queue length** is how many shows can wait in all (5 to start with). When it's full, visitors are
  asked to try again in a few minutes.

You stay in charge. Playing a show from the editor or an automation goes on straight away, and the
visitors' queue carries on afterwards. **■ Stop** (or stopping the song on the speaker) stops
everything and empties the queue, and so does **Clear the queue**. Turning off **Let visitors start
shows** empties the queue too, and visitors see "No shows right now".

### The public page's port

The public page has its own port, **18099**, so nothing of the editor can be reached through it. The
port opens the first time you turn on **Let visitors start shows**. If another app already uses 18099,
pick another under **Public page port** on the app's **Configuration** tab in Home Assistant, then
restart the app. With Docker or Python, set `HALIDAY_SHOW_PUBLIC_PORT` instead.

### Reaching the page from outside your home

Visitors' phones are usually on mobile data, not your Wi-Fi, so the page needs a web address the
internet can reach. Whichever way you choose:

- Point it at **port 18099 only**, never Home Assistant's own port (8123), so nothing but the public
  page is reachable.
- Use **https** (all the ways below give you that). Phones only share their location with secure
  pages, so with **Nearby only** on, visitors on plain http can't start shows.
- Put the address you end up with in **Public address** on the **Public page** tab, then press
  **Print sign…**.
- Aim it at your Home Assistant's **home network address**, such as `http://192.168.1.20:18099`
  (in Home Assistant: **Settings → System → Network**). It works however Home Assistant is set up.

**Cloudflare Tunnel** (recommended). Free, and nothing changes on your router. You need a free
Cloudflare account and a domain using Cloudflare for its DNS (a domain costs a few pounds a year).

1. Add the **Cloudflared** app to Home Assistant (see its own instructions for adding it to the
   **App store**).
2. On its **Configuration** tab, under **additional_hosts** (the names here are the app's own, at the
   time of writing; its instructions have the details), add one with **hostname** set to the
   address you want, such as `lights.yourdomain.com`, and **service** set to your Home Assistant's
   home network address on port 18099, such as `http://192.168.1.20:18099`.
3. Leave **external_hostname** empty, unless you also want to reach Home Assistant itself that way.
4. Start the app (it logs in to Cloudflare the first time and makes the address for you), then open
   `https://lights.yourdomain.com` and check you see "Scan the code on the sign".

If you manage your tunnel in Cloudflare's own dashboard instead, add a **public hostname** there with
the same address and service (type **HTTP**, URL `192.168.1.20:18099`).

**Tailscale Funnel**. Free, with no domain needed: you get an address like
`https://homeassistant.your-tailnet.ts.net:8443`. You need a free Tailscale account and Funnel
switched on for your tailnet.

1. Add the **Tailscale** app and log it in.
2. Funnel can only use ports 443, 8443 and 10000. Pick one Home Assistant doesn't already use (8443,
   say), and turn Funnel on for it, sending it to `http://localhost:18099`. How to do that depends on
   the Tailscale app you use, so follow its own instructions for sharing another app's port with
   Funnel.
3. Put the `https://…ts.net:8443` address in **Public address**.

**Your own reverse proxy** (NGINX Proxy Manager, Caddy, Traefik and similar, often with DuckDNS). If
you already run one, add a host for the address you want, sent to your Home Assistant's home network
address on port 18099, with an https certificate (Let's Encrypt). This needs ports 80 and 443 open on
your router to the proxy, which puts your home connection on the internet: keep the proxy up to date,
and send it nothing but this page.

**Wi-Fi only**. No internet at all: leave **Public address** empty and the link, and the sign's QR
code, use your Home Assistant's home address. Only phones on your Wi-Fi can open it, so it suits a
guest Wi-Fi that reaches the pavement, or an event with its own network. The nearby check doesn't
ask phones on your Wi-Fi, since being on it shows they're close.

**Home Assistant Cloud (Nabu Casa)** can't be used for this. It only reaches Home Assistant itself,
behind your login, so it can't show a public page.

With Docker or Python, it's the same: point the tunnel or proxy at port 18099 on the machine
HA-liday Show runs on.

### Keeping it safe

- **Only the visitors' page is on the public port.** Nothing there can reach the editor, your lights'
  settings or Home Assistant.
- **Without your code, visitors see only the page's colours**: not your title, words, picture or
  shows. If the link gets shared somewhere it shouldn't be, press **New code…**; the old link and any
  printed sign stop working at once.
- **Your picture is shared without its hidden details.** Phone photos carry where they were taken (to
  the metre), the phone and the time, and some phones hide an extra picture or a short video in it.
  Visitors get a copy without any of that; for a phone photo, which way up it goes is kept. Your own
  copy, in your backups, is as you uploaded it.  A picture that can't be read well enough to be sure isn't shown at all; the
  preview leaves it out too, so try saving it again from your phone or computer.
- **Each visitor's phone has its own limit** on how often it can ask, so one person (or a script)
  can't slow your lights down or crowd everyone else out. Wrong guesses at the code don't count
  against real visitors.
- **Nearby only** keeps out casual visitors far away, but a phone reports its own location, so
  someone determined at a computer could get round it. **Clear the queue** and **New code…** deal with
  anyone who does.
- **Use a tunnel or proxy with https, not a plain port forward.** Phones only share their location
  with secure (https) pages, so through a plain port forward on your router visitors couldn't start
  shows with **Nearby only** on. Visitors on your home Wi-Fi skip the location check; HA-liday Show
  only counts phones on your home network as at home, never a tunnel or proxy, even one running on
  the Home Assistant machine itself.

---

[← Play it and playlists](play-it.md) · [Contents](README.md) · [Automations →](automations.md)
