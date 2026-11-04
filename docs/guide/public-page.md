<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# The public page

[← Play it and playlists](play-it.md) · [Contents](README.md) · [Automations →](automations.md)

## The public page

The public page lets people passing by start a show from their phone, usually by scanning a QR code
on a sign outside. They see the shows and playlists you've picked, and nothing else of HA-liday Show.

1. Open **Setup → More** and turn on **Let visitors start shows** under **Public page**. A **Public
   page** tab appears along the top.
2. On the **Public page** tab, open **Shows** and, under **What visitors can pick**, press
   **+ Add shows or playlists…**. Tick as many as you like and press **Add**.
3. To try it, open the **Visitors' link** (on **Access**, under **Who can start shows**) on your phone, connected to
   your home Wi-Fi. It's HA-liday Show's address with `:18099` and your code on the end, such as
   `http://192.168.1.20:18099/?c=5fjzqr26`.

A visitors' page left open on a phone loads again by itself after HA-liday Show updates or restarts, so
it always shows what's new.

Down the left (along the top on a phone) is a list of five pages, as in **Library** and **Setup**, and
the last one you had open is remembered. **▶ Open the page**, at the top, opens your real visitors'
link in a new tab.

| Page | What's there |
| --- | --- |
| **Access** | [Who can start shows](#who-can-start-shows): the link and code, the sign and **Nearby only** (and [Installing the page as an app](#installing-the-page-as-an-app)) |
| **Hours** | [Opening hours](#opening-hours), finishing by closing time and rest breaks |
| **Limits** | **Requests per phone**, **Queue length**, **Same song again after** and **Same phone again after** ([Keeping it fair](#visitors-queue)) |
| **Shows** | [What visitors can pick](#what-visitors-can-pick) and [On the page](#on-the-page): how long each lasts and the flashing lights warning |
| **Listening** | [Listening on phones](#listening-on-phones) |
| **Admin** | Your [Admin PIN](#admin-pin) |
| **Look** | [How the page looks](#how-the-page-looks): title, welcome, picture, colours, style and the link at the bottom |
| **Words** | [Every message visitors read](#words), to change to your own |
| **Queue** | [The visitors' queue](#visitors-queue) as it is now, and **Tonight** at a glance |

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

**Shows finish by closing time** (on to start with): a pick that wouldn't finish before closing,
counting everything already waiting, isn't taken. Its button says **Too long for tonight** and the
visitor is told when you close. Your admin phone isn't held to it.

**Rest after** and **Rest for** (30 and 5 minutes to start with): after that long of visitors' picks
playing back to back, the lights rest before the next one starts, and the page says they're resting
"for the neighbours". A natural gap longer than the rest starts the count again. 0 turns rests off.
Your own shows, playlists and the schedule aren't affected.

The line underneath says whether the page is open now, or when it next opens. Sunset is worked out
for your home location, as for playlists; without one, a sunset start never opens, and it says so.

Outside the hours, visitors see when to come back ("Shows start at 5pm. Come back then!", "Shows
start tomorrow at 4:32pm" or "on Saturday at 5pm"), with your shows listed but no **▶ Start**
buttons. Their phones aren't asked for their location until it opens. Anyone already waiting in the
queue at closing time still gets their show. Each show's own dates (below) still apply within the
hours.

### Installing the page as an app

Visitors (and you) can put the page on their home screen as an app. It opens full screen with no
address bar, with your code built in, so it keeps working however long ago it was installed.

- **Android (Chrome)**: an **📲 Install app** button appears at the top of the page when the phone
  offers it. Press it and confirm. It doesn't show once the page is installed, or inside the app.
- **iPhone**: press **Share**, then **Add to Home Screen**. (iPhones don't let a page offer its own
  install button.)
- The app is named after your **Title**, with your page's colours. Its icon is a string of coloured
  bulbs on your page's background.
- It needs the page to be reached over https, as it is through a tunnel such as Cloudflare. Everything
  else (opening hours, **Nearby only**, the admin PIN) works exactly as on the web page.

### Admin PIN

For trying the page out yourself, away from the house or out of hours. Type 4 to 8 numbers in **Admin
PIN** on the **Admin** page; leave it empty for none.

There's no button for it on the visitors' page, so nobody else goes looking. To unlock your phone:

1. Open your visitors' link (the one in the QR code).
2. Tap the page's title five times quickly. A small **Admin PIN** box appears.
3. Type the PIN and press **Unlock**.

A dashed card then says your phone is in admin mode, and **Close** tucks it away. On that phone:

- **Nearby only** and the opening hours don't apply: **▶ Start** shows wherever you are, at any time.
- The listening PIN isn't asked for.
- The limit per phone and **Queue length** don't apply (up to 20 waiting, as a ceiling).
- The cool-down after a show plays doesn't apply, so you can queue it again straight away.
- You still can't queue a show that's already waiting or playing now.

While a show is on, your admin phone also gets, under what's on:

- **⏭ Skip**: ends a visitor's pick that's playing now; the next one waiting starts as usual.
- **■ Stop the lights**: stops whatever is on and clears the queue (it asks first).
- **Remove** beside anyone's pick in **Up next**, to take it out of the queue.
- The page works even with **Let visitors start shows** off, so you can check everything before you
  open. Other people still see it as closed.

You still need the link with your code. Your phone remembers the unlock until you change or empty the
admin PIN (or press **Lock this phone** in the card). Five wrong PINs from one place make it wait ten
minutes. If the admin PIN is the same as the listening PIN, the editor warns you, as anyone with the
listening PIN could then get in as admin too.

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

- Visitors see the list in the order it's in here. Move a row with **↑** and **↓**, or drag it by its
  **⠿** grip.
- **+ Add heading…** groups shows for visitors, such as *Christmas favourites* or *For the kids*. The
  shows below a heading, down to the next one, appear under its name on visitors' phones; shows
  above the first heading stand on their own. With two or more headings, visitors also get a row of
  buttons above the shows (**All** and one per heading) to see just that heading's shows. Move a heading like any row, change its words in place,
  and **Remove** it to ungroup its shows (they stay on the page).
- **+ Add shows or playlists…** opens a window of your saved shows, with **Playlists** beside them. Go into
  your folders as in the Library, or type in **Find in any folder**, tick everything you want and press
  **Add**. Shows in progress are left out unless you tick **Show in-progress shows too**, and visitors
  don't see them until you mark them finished. Archived shows aren't offered, nor are playlists
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
- **Show cover art** (on to start with) puts each show's picture beside its name: its song's cover
  art (from an MP3, M4A or FLAC's own tags), or the show's own **Picture** when you've given it one; for
  a playlist, its first show's. Shows without either get a tile in their colours with their first
  letter. Turn it off for no pictures.
- **Flashing lights warning**, for shows with strobes or fast flashes:
  - **Off** (to start with).
  - **A note at the top**: a boxed warning above the shows, always there.
  - **Ask visitors to accept it before Start**: the same note with an **I understand** button, and no
    **▶ Start** buttons until it's pressed. Each phone remembers it, so it's only asked again if you
    change the warning's words.

  The warning's words, and the button's, are on the **Words** tab.

### Listening on phones

Visitors can hear the music on their own phone, in time with the lights. It's handy before you have an
outdoor speaker, or to keep things quiet for the neighbours. Your show's speaker, if it has one, plays
as usual.

1. On the **Listening** page, turn on **Let visitors listen on their phone**.
2. To keep it to yourself while you try it out, turn on **Needs a PIN to listen** and type a PIN of 4
   to 8 numbers.
3. On your phone, open the visitors' link and press **🎧 Listen** in the card at the top (type the PIN
   if you set one). Press **■ Stop** to stop. **🎧 Listen** only shows while something's on.

How it works:

- The phone plays whatever show is on, however it was started: from the page, a playlist, the schedule,
  an automation or the editor. It starts at the right point, and visitors who arrive part-way through
  join in where the song is. Between shows it waits, and carries on with the next one by itself.
- With **Nearby only** on, phones have to be nearby to listen, as for starting a show. A PIN is asked
  for as well, not instead.
- A phone asks for the PIN once, then remembers it until you change it. Change or clear the PIN and
  phones that were listening are asked again. After five wrong PINs, a phone waits 10 minutes.
- HA-liday Show makes a small copy of each song for phones (about 4 MB for a 3-minute song), so it
  loads quickly over mobile data. The first phone to listen to a song may wait a few seconds while it's
  made. The copies aren't part of your backups. (A Python install needs ffmpeg for this; see
  [With Python](without-home-assistant.md#with-python).)
- On your Wi-Fi the music is usually within a few hundredths of a second of the lights. Over mobile data
  it can be a little further out. Bluetooth headphones and speakers play a little late, as they do with
  any phone.
- If the music and lights aren't together, visitors can fix it on their own phone while listening: they
  press **Music out of time?** under the button, then **◀ Earlier** if they hear the beat after the lights flash (usual with Bluetooth), **Later ▶** if
  they hear it before. Each press moves the music 0.05 s, up to a second either way, and the phone
  remembers it for next time.
- **Shows with no speaker** (no **Show speaker** of their own and no default one) say **🎧 Music on your
  phone** on the visitors' page. A visitor who presses **▶ Start** or **+ Queue** on one starts listening
  with the same press, so the music plays on their phone when it comes on. (Phones only play sound that
  a press starts, so it can't begin by itself for everyone.) Others can press **🎧 Listen** as usual.
- Keep the page open. On some phones the music stops when the screen locks; press **🎧 Listen** again
  to carry on.
- Every word visitors see while listening is on the **Words** tab, under **Listening on a phone**.

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

- **A card at the top** of the page says what's on, with a bar showing how far through it is, and
  **🎧 Listen** if listening is on. It stays in view as they scroll down the shows.
- **Up next** under it lists everyone's waiting picks, with each show's cover art and name (never who
  picked them) and roughly when each starts. The first three show, plus their own wherever it is, and **Show all**
  opens the rest.
- **If nothing's on**, each show has **▶ Start** and their pick starts straight away. While something's
  on (or others are waiting) the button says **+ Queue** instead.
- **If something's on**, the card at the top tells them where they are in the queue and roughly how long
  it'll be, such as "You're next, starting in about 2 minutes". Their picks are highlighted in **Up next**,
  with **Cancel** beside each.
- **During one of your playlists**, a visitor's pick plays after the show that's on, then your
  playlist carries on with its next show. A scheduled playlist that's due to start waits until a
  visitor's show has finished.
- **A playlist** a visitor picks plays its shows through once, not round and round, without its
  building blocks.
- **The music** plays on the show's **Show speaker** (or your default one), as it does for playlists.
  A show with no speaker plays its lights only, unless the
  [Show player](play-it.md#music-with-no-speaker-the-show-player) is open.
- **No repeats:** a show (or playlist) that's already waiting in the queue, or playing now, can't be
  picked again until it's played. Its button says **✓ Queued** or **♪ On now** instead. This applies to
  your own phone with the [Admin PIN](#admin-pin) too.
- Visitors can't stop or skip anyone else's show.

Keeping it fair, on the **Limits** page:

- **Requests per phone** is how many shows one phone can have waiting (1 to start with). Once a
  visitor's show starts, they can pick another. It's a courtesy limit that someone determined could
  get round; **Queue length** is the one that holds.
- **Queue length** is how many shows can wait in all (5 to start with). When it's full, visitors are
  asked to try again in a few minutes.
- **Same song again after** (15 minutes to start with): once a song has played, nobody can pick that
  song again for this long. Any other song is fine. It stops one favourite playing on a loop. Its button says
  **Again in 12 minutes** (say) until then. Your admin phone isn't held to it. 0 turns it off.
- **Same phone again after** (5 minutes to start with): once someone's song has played, their phone
  waits this long before picking another. Other phones aren't affected. It stops one person keeping the
  lights to themselves on a quiet night. Your admin phone doesn't wait. 0 turns it off.

**Tonight**, under the queue on the **Queue** page, counts visitors' picks since midday, lists the most
picked, and says how many phones are listening right now. It starts afresh when HA-liday Show restarts
(an update, say).

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
- **Listening only sends the song that's playing now**, and only to a phone with your code (and your PIN,
  if you set one) that passes the nearby check. Turn on **Needs a PIN to listen** if you'd rather
  strangers couldn't listen.
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
