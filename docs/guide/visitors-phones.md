<!-- The user guide is written here, a page per topic. tools/check_guide.py checks its links. -->

# Visitors' phones

Visitors hear the music on their own phone, and their screens join the show.

## Listening on phones

Visitors can hear the music on their own phone, in time with the lights. It's handy before you have an
outdoor speaker, or to keep things quiet for the neighbours. Your show's speaker, if it has one, plays
as usual.

1. On the **Listening** page, turn on **Let visitors listen on their phone**.
2. To keep it to yourself while you try it out, turn on **Needs a PIN to listen** and type a PIN of 4
   to 8 numbers.
3. On your phone, open the visitors' link and press **Listen** in the card at the top (type the PIN
   if you set one). Press **Sound off** to stop the music on their phone; the show carries on, on your lights. **Listen** only shows while something's on.

How it works:

- The phone plays whatever show is on, however it was started: from the page, a playlist, the schedule,
  an automation or the editor. It starts at the right point, and visitors who arrive part-way through
  join in where the song is. Between shows it waits, and carries on with the next one by itself.
- **In time from the first beat.** Phones load the next song in the queue while the current show plays. When
  a visitor's show is about to start and phones are listening, the lights wait for every listening phone to
  load its song, then the lights and the music start together. They never wait more than 3 seconds, so one
  slow phone can't hold the show up; meanwhile the page says **Getting the music ready…**. With nobody
  listening, shows start at once as before.
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
- To put the music in time for everyone, use the timing step of the [pre-show check](pre-show-check.md):
  it moves every phone's music by the same amount. **Public page → Listening** says how much, with
  **Reset** to put it back.
- If the music and lights still aren't together on a phone, visitors can fix it on their own phone while listening: they
  press **Music out of time?** under the button, then **Earlier** if they hear the beat after the lights flash (usual with Bluetooth), **Later** if
  they hear it before. Each press moves the music 0.05 s, up to a second either way, on top of the timing for
  every phone, and the phone remembers it for next time.
- **Shows with no speaker** (no **Show speaker** of their own and no default one) say **Music on your
  phone** on the visitors' page. A visitor who presses **Start** or **Queue** on one starts listening
  with the same press, so the music plays on their phone when it comes on. (Phones only play sound that
  a press starts, so it can't begin by itself for everyone.) Others can press **Listen** as usual.
- Keep the page open. On some phones the music stops when the screen locks; press **Listen** again
  to carry on.
- Every word visitors see while listening is on the **Words** tab, under **Listening on a phone**.

## Phones join the show

Visitors' phones can become part of the show: their screen glows with your lights' colours, in time
with the music. Point a crowd of phones at the house and the whole street lights up with it. It's off
until you turn it on.

1. On the **Listening** page, turn on **Let visitors' phones join the show**. Every show joins.
2. To leave a show out (a slow one, say), open it, then **⚙ Show settings…** and turn off **Phones join this
   show** under **Visitors' phones**.
3. On your phone, open the visitors' link while a show's on and press **Join** in the bar at the top. The
   screen goes dark with a warning that it will flash, and the colours fade in a few seconds later. **Leave**
   at the bottom of the screen goes back to the page at any time.

What phones show:

- **Your house's main colour**, unless you say otherwise: the colours of every light that's on, mixed,
  with brighter lights counting for more, and as bright as the brightest light. A dark house with one
  bright prop shows that prop's colour, and when your lights fade, so do the phones.
- **A show's own Phones lane**, if you'd rather design some or all of it: in **⚙ Show settings…**, press
  **Add a Phones lane**. It appears under your lights in the timeline, with a **House colour** effect
  across the whole show, so phones carry on showing the house's main colour. Replace or cut into it
  wherever you want something of your own (a big chorus, say).
  - The phone's screen is treated as a small upright [matrix](lights.md#matrices-panels-and-mega-trees) (54 × 96), so the Phones lane
    takes matrix effects as well as light effects: **Fire**, **Plasma**, **Spiral**, **Scrolling text**
    ("Merry Christmas!"; **Size: small** suits a phone), **Picture** for your pictures and GIFs from
    **Library → Pictures**, and the rest. Light effects such as **Chase** run down the screen, as on a matrix.
  - Each phone draws the lane itself, smoothly, with the same effects the editor uses. Around the
    picture, the rest of the screen glows in its main colour.
  - **House colour** is in the effect chooser's **Basics** on the Phones lane only. Phones show only
    what's on the lane, and stay dark in its gaps. **Remove the Phones lane** goes back to the house's
    main colour everywhere. ✨ **Generate** leaves the Phones lane alone.
  - **Singing face** turns the phone into a singing character (14 to pick from, from a snowman
    to a black cat, or one of your own [faces](pictures-and-faces.md#faces)), whose mouth follows the singer (see the
    [matrix effects](lights.md#matrices-panels-and-mega-trees)). On a phone the face is drawn four times finer
    each way than the rest of the screen, so it's smooth rather than blocky.

While you edit, a small phone in the top corner of the **House** panel shows the phone's screen at
that moment, worked out just as the phones' colours are, and the **Preview** panel has a **Phones** row too. It shows while phones join the show (or it has a
Phones lane); click it to fold it away, and again to bring it back.

How it works:

- Phones join whatever show is on, however it was started, and carry on from show to show. Between shows,
  during playlist building blocks and scenes, the screen goes dark and says it's waiting for the next show.
- The colours are worked out when you save a show. Shows saved before HA-liday Show 0.2.367 have none: they
  show as out of date in **Check all shows** (and the pre-show check) until they're saved again; **Fix**
  does it for you. Until then, **Join** doesn't show for them.
- Phones don't need to be listening, or nearby: they only follow the lights. The listening timing
  doesn't apply to screens, which light up straight away.
- The screen stays on while joined, on phones that allow it. Phones set to reduce motion fade gently
  between colours rather than flashing.
- Every word visitors see while joining is on the **Words** tab, under **Joining the show**.

<!-- nav: made by tools/check_guide.py -->

---

← [Visitors' queue and voting](queue-and-voting.md) · [Contents](README.md) · [Home Assistant](home-assistant.md) →
<!-- /nav -->
